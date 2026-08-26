import { randomBytes, randomInt } from "node:crypto";
import { type Database, schema } from "@showme/db";
import { invitationExpiresAt } from "@showme/shared";
import { and, desc, eq, gt, isNull, or, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { badRequest, conflict, forbidden, isUniqueViolation, notFound } from "../errors";
import { writeActivity } from "../lib/activity";
import { writeAudit } from "../lib/audit";
import { requireEventCapability, requireProfileRole } from "../lib/authorize";
import { renderInvitationEmail } from "../lib/email-templates";
import { assertGrantAdminAllows, assertProfileAdminGrantAllows } from "../lib/entitlements";
import { notifyUsers } from "../lib/notify";
import { withIdempotency } from "../plugins/idempotency";

const TokenParams = z.object({ token: z.string().min(1) });
const EventParams = z.object({ id: z.string().uuid() });
const IdParams = z.object({ id: z.string().uuid() });

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
 * The invitation as the PERSON HOLDING THE LINK sees it, before they answer.
 *
 * The redemption page has to say who invited them, to what, in what role, and
 * what state the invitation is in — otherwise "accept" is a button with no
 * sentence attached. But the reader is, by construction, unauthenticated at
 * first: someone with no shoWMe account clicked a link in their email. So this
 * shape is built on one question — *what does a link-holder already know?* —
 * and carries nothing beyond it:
 *
 * - **No `token`, no `code`.** They hold theirs; printing it back adds nothing
 *   and puts a bearer secret in a response body, a log and a screenshot.
 * - **The recipient address is masked** (`d•••@s•••.music`). Its owner
 *   recognises it at a glance, which is exactly what the wrong-account state
 *   needs to say; someone the link was forwarded to learns nothing usable.
 *   Only when the viewer's own verified address matches does the full address
 *   come back — and then it is their own.
 * - **No permission set, no other participants, no money.** The email is held
 *   to the same line (`lib/email-templates.ts`).
 */
const InvitationOfferResponse = z.object({
  /** Includes `expired`, which is DERIVED from `expires_at` and may not be the stored value. */
  status: z.enum(["pending", "accepted", "declined", "revoked", "expired", "used"]),
  type: invitationTypeEnum,
  source: invitationSourceEnum,
  role: z.string().nullable(),
  targetKind: z.enum(["event", "profile"]).nullable(),
  targetName: z.string().nullable(),
  targetEventId: z.string().nullable(),
  inviterName: z.string().nullable(),
  recipientName: z.string().nullable(),
  /** Masked unless it is the viewer's own address. Null when no address was named. */
  recipientEmail: z.string().nullable(),
  /** Whether an address was named at all — a `false` here means the token is the whole grant. */
  boundToEmail: z.boolean(),
  /**
   * The invitation points at an UNCLAIMED profile, so the answer is "claim this
   * act/venue", not "join as yourself". Derived from `profiles.claimed_at`, never
   * from the invitation's `source` — a handoff whose stub has since been claimed
   * must stop offering to hand it over, and the row is the only thing that knows.
   */
  claimable: z.boolean(),
  viewer: z.object({
    signedIn: z.boolean(),
    emailMatches: z.boolean(),
    emailVerified: z.boolean(),
  }),
});

/**
 * The invited address, blurred to the point where only its owner recognises it.
 *
 * `daniel@showme.music` → `d•••@s•••.music`. The first letter and the public
 * suffix are enough for the real recipient to say "yes, that's my work address"
 * on the wrong-account screen, and not enough for a stranger holding a forwarded
 * link to learn who was approached or where they work.
 */
function maskEmail(email: string): string {
  const [localPart = "", domain = ""] = email.split("@");
  const suffixStart = domain.indexOf(".");
  const maskedDomain =
    suffixStart === -1 ? "•••" : `${domain.slice(0, 1)}•••${domain.slice(suffixStart)}`;
  return `${localPart.slice(0, 1)}•••@${maskedDomain}`;
}

function normalizeEmail(email: string | null | undefined): string | null {
  const normalized = email?.trim().toLowerCase();
  return normalized ? normalized : null;
}

/**
 * Who is reading the offer, when there is anyone to read it.
 *
 * `GET /invitations/:token` is `public`, so the global `preHandler` never looks
 * at the Authorization header — but the three states the page most needs to
 * separate (*signed out* · *signed in as the right person* · **signed in as the
 * wrong person**) all turn on the viewer's identity. So the route verifies a
 * bearer token itself when one is offered, and treats a missing or stale one as
 * "nobody is signed in" rather than as an error: this is a page anyone may open.
 *
 * This does NOT resolve a principal and grants nothing. Every actual grant on
 * this module is still decided by `assertInvitationRecipient` on the redemption
 * routes, which run behind the ordinary authenticated pipeline.
 */
async function readViewerIdentity(
  request: FastifyRequest,
): Promise<{ email: string | null; emailVerified: boolean } | null> {
  const [scheme, idToken] = (request.headers.authorization ?? "").split(" ");
  if (scheme !== "Bearer" || !idToken) return null;
  try {
    const firebaseUser = await request.server.tokenVerifier.verify(idToken);
    return {
      email: normalizeEmail(firebaseUser.email),
      emailVerified: firebaseUser.emailVerified === true,
    };
  } catch {
    return null;
  }
}

/**
 * THE RECIPIENT CHECK — the one thing the old app got right that this module did
 * not (`docs/old-app-analysis-flows-invite-settle.md` §4).
 *
 * Until now the token was the entire grant on every redemption route: anyone who
 * was forwarded the link could accept in the invitee's place, or — worse, because
 * it is silent and irreversible from the invitee's side — DECLINE on their behalf
 * and close the slot. `invitations.recipient_email` has always held the binding;
 * nothing read it.
 *
 * The rule, in the order it is checked so the message is the useful one:
 *
 * 1. **No address named → no check.** A few invitations are minted with no
 *    recipient (a link the sender hands over in person). There the token IS the
 *    grant, deliberately, and there is nothing to compare against.
 * 2. **A different address → refused.** Not 404: telling the wrong person "this
 *    is not yours" is the whole point of the wrong-account state, and the offer
 *    they can already read tells them no more than the mask does.
 * 3. **The right address, unverified → refused.** Anyone may register any
 *    address at Firebase without proving they hold it, so an unverified match is
 *    a claim, not evidence. `claimStubsForEmail` has required
 *    `emailVerified === true` since it was written (`routes/session.ts`) and
 *    `docs/off-platform-access.md`:134 makes it the platform-wide rule; the
 *    invitation routes are simply catching up to their own sibling.
 */
function assertInvitationRecipient(request: FastifyRequest, invitation: InvitationRow): void {
  const invited = normalizeEmail(invitation.recipientEmail);
  if (!invited) return;
  const viewerEmail = normalizeEmail(request.firebaseUser?.email);
  if (viewerEmail !== invited) {
    throw forbidden("This invitation was sent to a different email address");
  }
  if (request.firebaseUser?.emailVerified !== true) {
    throw forbidden("Verify your email address before redeeming this invitation");
  }
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
                // ARMED HERE, not left null. Every guard downstream already read
                // this column (`loadInvitation`, the roster list, the offer) and
                // every one of them was dead code, because no insert had ever
                // written it — so an invitation sent in 2026 was still redeemable
                // in 2030. The duration is shared with the reaper that converges
                // the status later (`@showme/shared`), because those two numbers
                // disagreeing is worse than either one being wrong.
                expiresAt: invitationExpiresAt(body.source, new Date()),
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

  // Withdraw an invitation that has not been answered yet.
  //
  // By ID, not by token: the roster deliberately withholds the token from
  // everyone but the recipient (`EventInvitationResponse`), so the sender's own
  // screen has only an id to act on — and a revoke that demanded the bearer
  // secret would be a revoke the sender could not perform.
  //
  // The row is KEPT and flipped to `revoked`, never deleted. The old app deleted
  // four documents to withdraw one invitation and still missed the fifth, which
  // left its off-platform door open after the revoke reported success
  // (`docs/old-app-analysis-flows-invite-settle.md` §1.6). One row with one
  // status cannot have that bug, and the recipient who arrives afterwards gets
  // "this was withdrawn" instead of "this does not exist" — a true sentence
  // rather than a confusing one.
  //
  // Authorized exactly like the create it undoes: whoever may hand out the grant
  // may take it back, and nobody else.
  app.post(
    "/invitations/:id/revoke",
    { schema: { params: IdParams, response: { 200: InvitationResponse } } },
    async (request) => {
      const { database } = request.server;
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");

      const [invitation] = await database
        .select()
        .from(schema.invitations)
        .where(eq(schema.invitations.id, request.params.id));
      if (!invitation) throw notFound("Invitation not found");

      let auditCapability: "members.manage" | "participants.manage";
      if (invitation.targetEventId) {
        await requireEventCapability(request, invitation.targetEventId, "participants.manage");
        auditCapability = "participants.manage";
      } else if (invitation.targetProfileId) {
        requireProfileRole(request, invitation.targetProfileId, ["owner", "admin"]);
        auditCapability = "members.manage";
      } else {
        throw badRequest("This invitation has no target to authorize against");
      }

      // Only an OPEN invitation can be withdrawn. Revoking an accepted one would
      // read as "undo the membership" and does not do that — the way to remove
      // someone who has already joined is to remove the participant.
      if (invitation.status !== "pending") {
        throw conflict("This invitation has already been answered");
      }

      const updated = await database.transaction(async (tx) => {
        const [after] = await tx
          .update(schema.invitations)
          .set({ status: "revoked" })
          .where(
            and(
              eq(schema.invitations.id, invitation.id),
              // Guarded on the status as well as the id: two managers hitting
              // Withdraw at once must not both believe they did it, and an
              // acceptance landing in between must win.
              eq(schema.invitations.status, "pending"),
            ),
          )
          .returning();
        if (!after) throw conflict("This invitation has already been answered");
        await writeAudit(tx, request, {
          capability: auditCapability,
          action: "invitation.revoke",
          targetKind: "invitation",
          targetId: invitation.id,
          eventId: invitation.targetEventId ?? undefined,
          before: invitation,
          after,
        });
        // The slot closing is event history for the same reason the send and the
        // acceptance are: the bill changed shape. The recipient's address stays
        // out of the summary, as everywhere else in this module.
        if (after.targetEventId) {
          await writeActivity(tx, request, {
            eventId: after.targetEventId,
            type: "invitation.revoked",
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

  // The offer, read by whoever opened the link — by token OR code.
  //
  // `public` on purpose, and it is the reason the whole redemption flow can
  // exist: the invitation email goes to people who have never signed in, and
  // half of them have no account at all. A page that cannot say what it is
  // offering until you have signed up is a page that asks you to accept blind.
  // The payload is built for exactly that reader (`InvitationOfferResponse`) —
  // no token, no code, a masked address — so opening it costs the invitee
  // nothing beyond what the link they were sent already told the holder.
  //
  // Unlike `loadInvitation`, this does NOT 404 an expired or revoked invitation.
  // Silence is the bug being fixed here: every terminal state has to come back
  // named, or the page cannot tell "we have never seen this link" apart from
  // "you are three days late", and the recipient is left where they were before
  // — at a screen where nothing happened.
  app.get(
    "/invitations/:token",
    {
      config: { public: true },
      schema: { params: TokenParams, response: { 200: InvitationOfferResponse } },
    },
    async (request) => {
      const { database } = request.server;
      const parameter = request.params.token;

      const [invitation] = await database
        .select()
        .from(schema.invitations)
        .where(or(eq(schema.invitations.token, parameter), eq(schema.invitations.code, parameter)));
      if (!invitation) throw notFound("Invitation not found");

      const viewer = await readViewerIdentity(request);
      const invited = normalizeEmail(invitation.recipientEmail);
      const emailMatches = invited != null && viewer?.email === invited;

      const expired = invitation.expiresAt != null && invitation.expiresAt.getTime() < Date.now();
      const status =
        expired && invitation.status === "pending"
          ? ("expired" as const)
          : (invitation.status as z.infer<typeof InvitationOfferResponse>["status"]);

      const [inviter] = await database
        .select({ name: schema.users.name })
        .from(schema.users)
        .where(eq(schema.users.id, invitation.createdByUser));

      // Claiming is a different answer from accepting — it takes over an existing
      // unclaimed profile rather than adding the reader as themselves — so the
      // page has to know which verb to put on the button. `POST /:token/claim`
      // additionally requires a named address, so an unaddressed invitation is
      // never offered as claimable.
      let claimable = false;
      if (invitation.targetProfileId && invited != null && invitation.status === "pending") {
        const [target] = await database
          .select({ claimedAt: schema.profiles.claimedAt })
          .from(schema.profiles)
          .where(eq(schema.profiles.id, invitation.targetProfileId));
        claimable = target != null && target.claimedAt == null;
      }

      return {
        status,
        type: invitation.type as z.infer<typeof invitationTypeEnum>,
        source: invitation.source as z.infer<typeof invitationSourceEnum>,
        role: invitation.role,
        targetKind: invitation.targetEventId
          ? ("event" as const)
          : invitation.targetProfileId
            ? ("profile" as const)
            : null,
        targetName: (await loadInvitationTargetName(database, invitation)) ?? null,
        targetEventId: invitation.targetEventId,
        inviterName: inviter?.name ?? null,
        recipientName: invitation.recipientName,
        // Their own address back, or a mask. Never a stranger's address in full.
        recipientEmail: invited == null ? null : emailMatches ? invited : maskEmail(invited),
        boundToEmail: invited != null,
        claimable,
        viewer: {
          signedIn: viewer != null,
          emailMatches,
          emailVerified: viewer?.emailVerified === true,
        },
      };
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
      assertInvitationRecipient(request, invitation);
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
      // A refusal is as much the invitee's answer as an acceptance, and it is the
      // one nobody can undo from their side — a forwarded link must not let a
      // stranger close someone else's slot quietly.
      assertInvitationRecipient(request, invitation);
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
      // A claim is the largest of the three grants — it hands over OWNERSHIP of a
      // profile and everything that profile is a participant of — so it is the
      // one route that refuses an unbound invitation outright. Accept and decline
      // tolerate a null `recipient_email` (a link the sender hands over in
      // person); "whoever opens this link first owns this act" is not a state
      // worth supporting, and is precisely the old app's first-come-first-served
      // collaborator password (§1.8).
      if (!invitation.recipientEmail) {
        throw forbidden("This invitation is not addressed to anyone, so it cannot be claimed");
      }
      // Captured before the transaction closure, where the null-check above no
      // longer narrows. It is the claim key twice over: the recipient check
      // below, and the stub membership this links.
      const invitedEmail = invitation.recipientEmail.trim().toLowerCase();
      assertInvitationRecipient(request, invitation);
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
          const now = new Date();
          await tx
            .update(schema.profiles)
            .set({ ownerUserId: principal.userId, claimedAt: now, updatedAt: now })
            .where(eq(schema.profiles.id, profile.id));

          // LINK the stub's own membership row rather than adding a second one.
          //
          // An off-platform stub is created with `{user_id: null, email}` — that
          // email IS the claim key (`lib/off-platform.ts`). Inserting a fresh
          // owner row beside it left the original unlinked forever: the unique
          // constraint does not catch it because the old row's `user_id` is NULL,
          // so the profile ended up with two owner memberships, one of them a
          // ghost pointing at nobody. `claimStubsForEmail` has always done this
          // correctly; this route is catching up to its own sibling.
          //
          // Guarded on `user_id IS NULL` so a racing claim cannot double-apply,
          // and matched on the lowercased address exactly as the sibling matches
          // it. If there is no such row (a handoff stub is minted without one),
          // fall through and insert — a claimer must end up a member either way.
          const linked = await tx
            .update(schema.profileMembers)
            .set({ userId: principal.userId, role: "owner", status: "active", updatedAt: now })
            .where(
              and(
                eq(schema.profileMembers.profileId, profile.id),
                isNull(schema.profileMembers.userId),
                eq(sql`lower(${schema.profileMembers.email})`, invitedEmail),
              ),
            )
            .returning({ id: schema.profileMembers.id });

          if (linked.length === 0) {
            await tx.insert(schema.profileMembers).values({
              profileId: profile.id,
              userId: principal.userId,
              role: "owner",
              status: "active",
              addedBy: principal.userId,
            });
          }
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
            eventId: invitation.targetEventId ?? undefined,
            before: invitation,
            after,
          });
          // A handoff invitation carries an event: the off-platform stub the
          // operator entered by hand has just been taken over by the real person.
          // Everyone on the bill has been dealing with that row, so everyone on the
          // bill should see that it is now a live account — kind `invitation`, the
          // same `event.view` tier as the send and the acceptance beside it.
          if (invitation.targetEventId) {
            await writeActivity(tx, request, {
              eventId: invitation.targetEventId,
              type: "invitation.claimed",
              targetKind: "invitation",
              targetId: invitation.id,
              summary: { profileId: profile.id, profileName: profile.name },
            });
          }
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
