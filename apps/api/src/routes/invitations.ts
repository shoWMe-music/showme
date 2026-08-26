import { randomBytes, randomInt } from "node:crypto";
import { type Database, schema } from "@showme/db";
import { and, desc, eq, gt, isNull, or } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { badRequest, conflict, notFound } from "../errors";
import { writeActivity } from "../lib/activity";
import { writeAudit } from "../lib/audit";
import { requireEventCapability, requireProfileRole } from "../lib/authorize";
import { renderInvitationEmail } from "../lib/email-templates";
import { assertGrantAdminAllows, assertProfileAdminGrantAllows } from "../lib/entitlements";
import { notifyUsers } from "../lib/notify";
import { withIdempotency } from "../plugins/idempotency";

const TokenParams = z.object({ token: z.string().min(1) });
const EventParams = z.object({ id: z.string().uuid() });

const invitationTypeEnum = z.enum(["profile_member", "event_participant", "code"]);
const invitationSourceEnum = z.enum([
  "collaborator",
  "admin",
  "team",
  "venue_handoff",
  "performer_offer",
]);

const CreateInvitationBody = z.object({
  type: invitationTypeEnum,
  source: invitationSourceEnum,
  recipientEmail: z.string().email().optional(),
  recipientName: z.string().min(1).optional(),
  targetProfileId: z.string().uuid().optional(),
  targetEventId: z.string().uuid().optional(),
  role: z.string().min(1).optional(),
  permissionSetId: z.string().uuid().optional(),
});

const InvitationResponse = z.object({
  id: z.string(),
  type: z.string(),
  status: z.string(),
  source: z.string(),
  code: z.string().nullable(),
  token: z.string().nullable(),
  recipientEmail: z.string().nullable(),
  recipientName: z.string().nullable(),
  targetProfileId: z.string().nullable(),
  targetEventId: z.string().nullable(),
  role: z.string().nullable(),
  permissionSetId: z.string().nullable(),
});

/**
 * An invitation as the EVENT sees it — the roster view, for everyone who may
 * manage who is on the event.
 *
 * Deliberately NOT `InvitationResponse`: that shape carries `token`/`code`, the
 * bearer secrets that redeem the grant. The person who sent the invite already
 * holds theirs; handing it to every other roster manager would let any of them
 * accept in the invitee's place. What the roster actually needs is who was asked,
 * as what, and whether they have answered.
 */
const EventInvitationResponse = z.object({
  id: z.string(),
  status: z.string(),
  source: z.string(),
  recipientEmail: z.string().nullable(),
  recipientName: z.string().nullable(),
  role: z.string().nullable(),
  permissionSetId: z.string().nullable(),
  createdAt: z.string(),
  expiresAt: z.string().nullable(),
});

type InvitationRow = typeof schema.invitations.$inferSelect;

/**
 * The safe view of an invitation — the fields the holder/creator may see. Never
 * exposes `passwordHash` or the internal `usedByUser`/audit columns (no recipient
 * data leak per the module contract).
 */
function serializeInvitation(invitation: InvitationRow): z.infer<typeof InvitationResponse> {
  return {
    id: invitation.id,
    type: invitation.type,
    status: invitation.status,
    source: invitation.source,
    code: invitation.code,
    token: invitation.token,
    recipientEmail: invitation.recipientEmail,
    recipientName: invitation.recipientName,
    targetProfileId: invitation.targetProfileId,
    targetEventId: invitation.targetEventId,
    role: invitation.role,
    permissionSetId: invitation.permissionSetId,
  };
}

/**
 * The display name of whatever the invitation grants access to — the event's
 * title or the account's name. Used only to write the invitation email, which is
 * why it reads a single column and tolerates a missing row: an unnamed target
 * degrades the copy, it must never fail the send.
 */
async function loadInvitationTargetName(
  database: Database,
  invitation: { targetEventId: string | null; targetProfileId: string | null },
): Promise<string | undefined> {
  if (invitation.targetEventId) {
    const [event] = await database
      .select({ name: schema.events.title })
      .from(schema.events)
      .where(eq(schema.events.id, invitation.targetEventId));
    return event?.name;
  }
  if (invitation.targetProfileId) {
    const [profile] = await database
      .select({ name: schema.profiles.name })
      .from(schema.profiles)
      .where(eq(schema.profiles.id, invitation.targetProfileId));
    return profile?.name;
  }
  return undefined;
}

/** Postgres unique-violation — a `(profile_id, user_id)` membership already exists. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

/** Unambiguous uppercase alphanumerics (no O/0, I/1) for a human-readable code. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** A human `SHOW-XXXX-XXXX` code — what a recipient types to redeem a `code` invite. */
function generateCode(): string {
  const block = () =>
    Array.from({ length: 4 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
  return `SHOW-${block()}-${block()}`;
}

/** An opaque link token for non-code invites — never guessable, never human-typed. */
function generateToken(): string {
  return randomBytes(24).toString("hex");
}

/** Load an invitation by its opaque token OR its human code, or 404. Expired = gone. */
async function loadInvitation(request: FastifyRequest, param: string): Promise<InvitationRow> {
  const [invitation] = await request.server.database
    .select()
    .from(schema.invitations)
    .where(or(eq(schema.invitations.token, param), eq(schema.invitations.code, param)));
  if (!invitation) throw notFound("Invitation not found");
  const expired =
    invitation.status === "expired" ||
    (invitation.expiresAt != null && invitation.expiresAt.getTime() < Date.now());
  if (expired) throw notFound("Invitation not found");
  return invitation;
}

export async function invitationRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // Create — authorize by TARGET (profile role or event capability), mint a code
  // or token, insert pending, audit. Idempotent so a retried create is one invite.
  app.post(
    "/invitations",
    { schema: { body: CreateInvitationBody, response: { 201: InvitationResponse } } },
    async (request, reply) => {
      const { database } = request.server;
      const body = request.body;
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");

      // Deny-by-default: the caller must control whatever the invite grants access to.
      let auditCapability: "members.manage" | "participants.manage";
      if (body.targetProfileId) {
        requireProfileRole(request, body.targetProfileId, ["owner", "admin"]);
        auditCapability = "members.manage";
      } else if (body.targetEventId) {
        await requireEventCapability(request, body.targetEventId, "participants.manage");
        auditCapability = "participants.manage";
      } else {
        throw badRequest("An invitation needs a target profile or event");
      }

      // Entitlement gate (decisions #4/§C, PLAN.md:614): an invitation is a DEFERRED
      // grant — if redeeming it would hand the invitee an admin-grade permission set
      // on the event, it is the same paid-plan `grant_admin` grant as writing the
      // participant row directly (routes/participants.ts). Charged to the EVENT
      // HOST's plan. Gated HERE, at create, because that is where the answer is
      // useful: the inviting host gets an immediate, honest 403 instead of an
      // invitation that dies silently in the recipient's hands. Accept re-checks it
      // as the correctness backstop (a plan can lapse in between). Composed AFTER
      // the authorization block above, never conflated with it.
      if (body.targetEventId) {
        const [event] = await database
          .select({ hostProfileId: schema.events.hostProfileId })
          .from(schema.events)
          .where(eq(schema.events.id, body.targetEventId));
        if (!event) throw notFound("Event not found");
        await assertGrantAdminAllows(database, {
          hostProfileId: event.hostProfileId,
          nextPermissionSetId: body.permissionSetId,
        });
      }

      // The PROFILE-level sibling (A-37). `role: "admin"` here mints an admin
      // membership over the whole account — a larger grant than admin on one
      // event — and until now it walked straight past the gate that
      // `POST /profiles/:id/members` applies to the very same grant. Charged to
      // the TARGET profile, which is the account gaining an administrator.
      if (body.targetProfileId) {
        await assertProfileAdminGrantAllows(database, {
          profileId: body.targetProfileId,
          nextRole: body.role,
        });
      }

      const { statusCode, body: result } = await withIdempotency(
        request,
        "POST /invitations",
        async () => {
          const created = await database.transaction(async (tx) => {
            const [invitation] = await tx
              .insert(schema.invitations)
              .values({
                type: body.type,
                source: body.source,
                status: "pending",
                code: body.type === "code" ? generateCode() : null,
                token: body.type === "code" ? null : generateToken(),
                recipientEmail: body.recipientEmail,
                recipientName: body.recipientName,
                targetProfileId: body.targetProfileId,
                targetEventId: body.targetEventId,
                role: body.role,
                permissionSetId: body.permissionSetId,
                createdByUser: principal.userId,
                createdByProfile: principal.actingProfileId,
              })
              .returning();
            if (!invitation) throw new Error("invitation create failed");
            await writeAudit(tx, request, {
              capability: auditCapability,
              action: "invitation.create",
              targetKind: "invitation",
              targetId: invitation.id,
              eventId: body.targetEventId,
              after: invitation,
            });
            // Only an EVENT invite has an event history to appear in — a
            // profile-member invite belongs to the account, not to any booking, and
            // an activity row with a null `event_id` is unreachable from every feed
            // this route serves. The recipient's EMAIL is deliberately left out: it
            // is contact detail the inviter holds, not something the rest of the
            // bill is entitled to read off the timeline.
            if (invitation.targetEventId) {
              await writeActivity(tx, request, {
                eventId: invitation.targetEventId,
                type: "invitation.sent",
                targetKind: "invitation",
                targetId: invitation.id,
                summary: { recipientName: invitation.recipientName, role: invitation.role },
              });
            }
            return invitation;
          });
          return { statusCode: 201, body: serializeInvitation(created) };
        },
      );

      // Email the invitee their invite (code or link token). Optional recipient,
      // so only when we have an address; a mail failure is logged, never surfaced —
      // the invitation is already persisted and redeemable.
      if (result.recipientEmail) {
        try {
          // "Invited to collaborate" is meaningless without naming what. The
          // grant already points at exactly one target, so read that one name
          // here, inside the best-effort path — a failure skips the email, it
          // never touches the persisted invitation.
          const targetName = await loadInvitationTargetName(database, result);

          await request.server.emailSink.sendEmail({
            to: result.recipientEmail,
            ...renderInvitationEmail({
              recipientName: result.recipientName,
              // The inviter's display name off the verified token — no extra
              // query, and it is the name they use everywhere else in the app.
              inviterName: request.firebaseUser?.name,
              targetName,
              targetKind: result.targetEventId ? "event" : "profile",
              code: result.code,
              token: result.token,
            }),
          });
        } catch (error) {
          request.log.error({ error }, "invitation email failed");
        }
      }

      return reply.status(statusCode as 201).send(result);
    },
  );

  // The event's OPEN invitations — the other half of its roster.
  //
  // `GET /events/:id/participants` only ever returned people who are already ON
  // the event, and an invitation writes no participant row until it is accepted
  // (that is the whole point — nothing is granted until they answer). So an
  // operator who had just invited someone saw their Collaborators tab exactly as
  // it was before, with no evidence the invite existed. This route is that
  // evidence.
  //
  // Gated on `participants.manage`, not `event.view`: an invitation carries the
  // recipient's EMAIL, which is contact detail the inviter holds — a performer on
  // the bill has no claim to the address of everyone else who was approached.
  // Accepted/declined/used invites are excluded: the accepted ones are already on
  // the participants list (two rows for one person reads as a duplicate), and a
  // refusal that lingers as a card looks like an outstanding ask.
  app.get(
    "/events/:id/invitations",
    { schema: { params: EventParams, response: { 200: z.array(EventInvitationResponse) } } },
    async (request) => {
      const { database } = request.server;
      const { id } = request.params;

      await requireEventCapability(request, id, "participants.manage");

      const rows = await database
        .select()
        .from(schema.invitations)
        .where(
          and(
            eq(schema.invitations.targetEventId, id),
            eq(schema.invitations.status, "pending"),
            // An expired invite is gone everywhere else in this module
            // (`loadInvitation` 404s on it), so it must not linger here either.
            or(isNull(schema.invitations.expiresAt), gt(schema.invitations.expiresAt, new Date())),
          ),
        )
        .orderBy(desc(schema.invitations.createdAt));

      return rows.map((invitation) => ({
        id: invitation.id,
        status: invitation.status,
        source: invitation.source,
        recipientEmail: invitation.recipientEmail,
        recipientName: invitation.recipientName,
        role: invitation.role,
        permissionSetId: invitation.permissionSetId,
        createdAt: invitation.createdAt.toISOString(),
        expiresAt: invitation.expiresAt ? invitation.expiresAt.toISOString() : null,
      }));
    },
  );

  // Look up by token OR code — the authenticated recipient's redemption preview.
  app.get(
    "/invitations/:token",
    { schema: { params: TokenParams, response: { 200: InvitationResponse } } },
    async (request) => {
      const invitation = await loadInvitation(request, request.params.token);
      return serializeInvitation(invitation);
    },
  );

  // Accept — the recipient redeems the grant: a profile membership or an event
  // participation, atomically with flipping the invite to accepted + audit.
  app.post(
    "/invitations/:token/accept",
    { schema: { params: TokenParams, response: { 200: InvitationResponse } } },
    async (request) => {
      const { database } = request.server;
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");

      const invitation = await loadInvitation(request, request.params.token);
      if (invitation.status !== "pending") {
        throw conflict("This invitation has already been used");
      }

      // Dispatch on what the invite actually grants. A `code` invite is a delivery
      // form, not a grant kind — so it redeems against whichever target it carries.
      const grantsProfileMember =
        invitation.targetProfileId != null &&
        (invitation.type === "profile_member" || invitation.type === "code");
      const grantsEventParticipant =
        invitation.targetEventId != null &&
        (invitation.type === "event_participant" || invitation.type === "code");

      // Entitlement BACKSTOP (decisions #4/§C, PLAN.md:614): create already refused an
      // admin-grade event invitation, but a host's plan can LAPSE between the invite
      // and its redemption — re-check at the moment the grant actually lands, since
      // this is the write that confers the authority. Same rule, same 403, still
      // charged to the EVENT HOST's plan (the invitee never pays for it).
      if (grantsEventParticipant && invitation.targetEventId) {
        const [event] = await database
          .select({ hostProfileId: schema.events.hostProfileId })
          .from(schema.events)
          .where(eq(schema.events.id, invitation.targetEventId));
        if (!event) throw notFound("Event not found");
        await assertGrantAdminAllows(database, {
          hostProfileId: event.hostProfileId,
          nextPermissionSetId: invitation.permissionSetId,
        });
      }

      // Same backstop for the profile-level grant (A-37): the target account's
      // plan can lapse between the invite being sent and the invitee redeeming
      // it, and redemption is the write that actually confers the authority.
      if (grantsProfileMember && invitation.targetProfileId) {
        await assertProfileAdminGrantAllows(database, {
          profileId: invitation.targetProfileId,
          nextRole: invitation.role,
        });
      }

      let updated: InvitationRow;
      try {
        updated = await database.transaction(async (tx) => {
          if (grantsProfileMember && invitation.targetProfileId) {
            await tx.insert(schema.profileMembers).values({
              profileId: invitation.targetProfileId,
              userId: principal.userId,
              role: (invitation.role ??
                "viewer") as (typeof schema.profileMembers.$inferInsert)["role"],
              status: "active",
              // A-37: an admin membership costs a seat however it was granted —
              // `POST /profiles/:id/members` has always recorded that, and a
              // redeemed invitation now records it too, or the seat count is a
              // lie the moment anyone invites rather than adds.
              seatConsumed: invitation.role === "admin",
              permissionSetId: invitation.permissionSetId,
              addedBy: invitation.createdByUser,
            });
          } else if (grantsEventParticipant && invitation.targetEventId) {
            if (!principal.actingProfileId) {
              throw badRequest("Select a profile (X-Profile-Id) to accept as");
            }
            await tx.insert(schema.eventParticipants).values({
              eventId: invitation.targetEventId,
              profileId: principal.actingProfileId,
              role: (invitation.role ??
                "performer") as (typeof schema.eventParticipants.$inferInsert)["role"],
              permissionSetId: invitation.permissionSetId,
              addedBy: principal.userId,
            });
          } else {
            throw badRequest("This invitation cannot be accepted directly");
          }

          const [after] = await tx
            .update(schema.invitations)
            .set({ status: "accepted", usedByUser: principal.userId, usedAt: new Date() })
            .where(eq(schema.invitations.id, invitation.id))
            .returning();
          if (!after) throw new Error("invitation accept failed");
          await writeAudit(tx, request, {
            capability: grantsEventParticipant ? "participants.manage" : "members.manage",
            action: "invitation.accept",
            targetKind: "invitation",
            targetId: invitation.id,
            eventId: invitation.targetEventId ?? undefined,
            before: invitation,
            after,
          });
          // The acceptance is the moment somebody actually joined the bill, and this
          // path inserts the `event_participants` row WITHOUT going through
          // `POST /events/:id/participants` — so without this write, a booking made
          // by invitation leaves no trace at all in the history that a booking made
          // by direct add does.
          if (after.targetEventId) {
            await writeActivity(tx, request, {
              eventId: after.targetEventId,
              type: "invitation.accepted",
              targetKind: "invitation",
              targetId: after.id,
              summary: {
                recipientName: after.recipientName,
                role: after.role,
                profileId: principal.actingProfileId,
              },
            });
          }
          return after;
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw conflict("Already a member of this target");
        }
        throw error;
      }

      // Realtime + feed: the person who sent the invite is the one waiting on it.
      // `POST /invitations` itself notifies nobody in-app — it targets an email
      // address that may not belong to a platform user yet, and email covers that.
      // The acceptance is the first moment there is someone to tell.
      try {
        await notifyUsers(database, [updated.createdByUser], principal.userId, {
          type: "invitation.accepted",
          title: `${updated.recipientName ?? updated.recipientEmail ?? "Your invitee"} accepted`,
          body: "They now have access.",
          eventId: updated.targetEventId ?? undefined,
          actorDisplay: request.firebaseUser?.name ?? undefined,
          link: updated.targetEventId ? `/events/${updated.targetEventId}` : "/team",
          metadata: { invitationId: updated.id },
        });
      } catch (error) {
        request.log.error(
          { error, invitationId: updated.id },
          "invitation-accept notification failed",
        );
      }

      return serializeInvitation(updated);
    },
  );

  // Decline — the recipient refuses; the grant is closed out, audited.
  app.post(
    "/invitations/:token/decline",
    { schema: { params: TokenParams, response: { 200: InvitationResponse } } },
    async (request) => {
      const { database } = request.server;
      const invitation = await loadInvitation(request, request.params.token);
      if (invitation.status !== "pending") {
        throw conflict("This invitation is no longer pending");
      }

      const updated = await database.transaction(async (tx) => {
        const [after] = await tx
          .update(schema.invitations)
          .set({ status: "declined" })
          .where(eq(schema.invitations.id, invitation.id))
          .returning();
        if (!after) throw new Error("invitation decline failed");
        await writeAudit(tx, request, {
          capability: "members.manage",
          action: "invitation.decline",
          targetKind: "invitation",
          targetId: invitation.id,
          eventId: invitation.targetEventId ?? undefined,
          before: invitation,
          after,
        });
        // A refusal closes the slot as surely as an acceptance fills it — the
        // operator waiting on an answer needs the "no" in the same timeline.
        if (after.targetEventId) {
          await writeActivity(tx, request, {
            eventId: after.targetEventId,
            type: "invitation.declined",
            targetKind: "invitation",
            targetId: after.id,
            summary: { recipientName: after.recipientName, role: after.role },
          });
        }
        return after;
      });

      return serializeInvitation(updated);
    },
  );

  // Claim — take ownership of the unclaimed stub profile this invite links, then
  // add an owner membership. One-shot: the invite is spent (status='used').
  app.post(
    "/invitations/:token/claim",
    { schema: { params: TokenParams, response: { 200: InvitationResponse } } },
    async (request) => {
      const { database } = request.server;
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");

      const invitation = await loadInvitation(request, request.params.token);
      if (invitation.status !== "pending") {
        throw conflict("This invitation has already been used");
      }
      if (!invitation.targetProfileId) {
        throw badRequest("Invitation does not link a profile to claim");
      }

      const [profile] = await database
        .select()
        .from(schema.profiles)
        .where(eq(schema.profiles.id, invitation.targetProfileId));
      if (!profile) throw notFound("Profile not found");
      if (profile.claimedAt != null) {
        throw conflict("This profile has already been claimed");
      }

      let updated: InvitationRow;
      try {
        updated = await database.transaction(async (tx) => {
          await tx
            .update(schema.profiles)
            .set({ ownerUserId: principal.userId, claimedAt: new Date(), updatedAt: new Date() })
            .where(eq(schema.profiles.id, profile.id));
          await tx.insert(schema.profileMembers).values({
            profileId: profile.id,
            userId: principal.userId,
            role: "owner",
            status: "active",
            addedBy: principal.userId,
          });
          const [after] = await tx
            .update(schema.invitations)
            .set({ status: "used", usedByUser: principal.userId, usedAt: new Date() })
            .where(eq(schema.invitations.id, invitation.id))
            .returning();
          if (!after) throw new Error("invitation claim failed");
          await writeAudit(tx, request, {
            capability: "members.manage",
            action: "invitation.claim",
            targetKind: "invitation",
            targetId: invitation.id,
            before: invitation,
            after,
          });
          return after;
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw conflict("Already a member of this profile");
        }
        throw error;
      }

      return serializeInvitation(updated);
    },
  );
}
