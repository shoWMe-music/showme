import { randomBytes } from "node:crypto";
import { schema } from "@showme/db";
import { notifyProfileMembers } from "@showme/db/notify";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { badRequest, conflict, forbidden, isUniqueViolation, notFound } from "../errors";
import { writeActivity } from "../lib/activity";
import { autoAssignAgentOnPerformerJoin } from "../lib/agent-assignment";
import { writeAudit } from "../lib/audit";
import { requireEventCapability } from "../lib/authorize";
import { renderOffPlatformPerformerEmail } from "../lib/email-templates";
import { assertGrantAdminAllows } from "../lib/entitlements";
import { loadEventSummary } from "../lib/event-summary";
import { createPerformerStub } from "../lib/off-platform";
import { signProfileImageUrls } from "../lib/profile-media";
import { withIdempotency } from "../plugins/idempotency";
import { serializeParticipant } from "../serialize/participant";

const EventParams = z.object({ id: z.string().uuid() });
const ParticipantParams = z.object({ id: z.string().uuid(), pid: z.string().uuid() });

const participantRole = z.enum([
  "host",
  "co_host",
  "performer",
  "support",
  "crew_lead",
  "crew",
  "agent",
]);
const participantStatus = z.enum(["invited", "accepted", "declined", "confirmed", "removed"]);
const performerTag = z.enum(["headliner", "support", "dj", "opener"]);

const CreateParticipantBody = z.object({
  profileId: z.string().uuid(),
  role: participantRole,
  permissionSetId: z.string().uuid().optional(),
  performerTag: performerTag.optional(),
});

/** Add a performer not yet on the platform. A name + email (given directly or
 * read from a linked contact) mints an unclaimed stub profile they later claim.
 * Name-only performers are drafts on the client and never hit this route. */
const OffPlatformParticipantBody = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  contactId: z.string().uuid().optional(),
  role: participantRole.default("performer"),
  performerTag: performerTag.optional(),
});

const UpdateParticipantBody = z.object({
  role: participantRole.optional(),
  permissionSetId: z.string().uuid().optional(),
  status: participantStatus.optional(),
  performerTag: performerTag.optional(),
});

const ParticipantResponse = z.object({
  id: z.string(),
  profileId: z.string(),
  name: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  /** Null unless the profile is published — Fastify strips what is not declared
   *  here, so without this slot the serializer's value never reaches a caller. */
  publicSlug: z.string().nullable(),
  role: z.string(),
  status: z.string(),
  performerTag: z.string().nullable(),
  permissionSetId: z.string().nullable().optional(),
  details: z.unknown().optional(),
});

export async function participantRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // List: authorize `event.view`, then serialize each participant by the caller's tier.
  app.get(
    "/events/:id/participants",
    { schema: { params: EventParams, response: { 200: z.array(ParticipantResponse) } } },
    async (request) => {
      const { database } = request.server;
      const { id } = request.params;

      const capabilities = await requireEventCapability(request, id, "event.view");
      // Join the profile so each row carries its display name/avatar — the public
      // face of who is on the bill (names, not just ids, drive the roster UI).
      //
      // BOTH picture columns. Since migration 0022 an avatar is normally an
      // UPLOADED file (`avatar_file_id` → `files.id`) and `avatar_url` is only the
      // legacy external address, so selecting the URL alone reported every
      // performer who uploaded a picture as having none — which is exactly what
      // this roster did until now.
      const rows = await database
        .select({
          participant: schema.eventParticipants,
          name: schema.profiles.name,
          avatarFileId: schema.profiles.avatarFileId,
          avatarUrl: schema.profiles.avatarUrl,
          // Both, or the link is a guess: a slug without `is_public` points at a
          // 404 for every unpublished act.
          slug: schema.profiles.slug,
          isPublic: schema.profiles.isPublic,
        })
        .from(schema.eventParticipants)
        .leftJoin(schema.profiles, eq(schema.profiles.id, schema.eventParticipants.profileId))
        .where(eq(schema.eventParticipants.eventId, id));

      // Every face on the bill signed in ONE round, not one round trip per row —
      // the same batched shape the public shows and the admin list use. A signed
      // URL lives fifteen minutes, so it is minted per response and never stored.
      const imageUrls = await signProfileImageUrls(
        database,
        request.server.storageSigner,
        rows.map((row) => row.avatarFileId),
      );

      // WHICH ROWS ARE THE CALLER'S OWN. The flat membership set — owned plus
      // member-of together, the same set `authorize()` computes standing from —
      // so a manager of the crew member's profile reads the call time exactly as
      // the crew member does, and no second notion of "self" can drift from the
      // one authorization already uses. Deliberately not `actingProfileId`: the
      // roster is fetched without a profile header from several screens, and a
      // missing header must not be the reason someone cannot read their own
      // call time.
      const selfProfileIds = new Set(
        (request.principal?.memberships ?? []).map((membership) => membership.profileId),
      );

      return rows.map((row) =>
        serializeParticipant(
          row.participant,
          capabilities,
          {
            name: row.name,
            avatarFileId: row.avatarFileId,
            avatarUrl: row.avatarUrl,
            slug: row.slug,
            // LEFT JOIN: a participant row can outlive its profile, and no
            // profile is not a published one.
            isPublic: row.isPublic ?? false,
          },
          imageUrls,
          selfProfileIds,
        ),
      );
    },
  );

  // Add: authorize `participants.manage` + idempotency + audit. A duplicate
  // (event, profile) surfaces as 409 via the unique constraint.
  app.post(
    "/events/:id/participants",
    {
      schema: {
        params: EventParams,
        body: CreateParticipantBody,
        response: { 201: ParticipantResponse },
      },
    },
    async (request, reply) => {
      const { database } = request.server;
      const { id } = request.params;

      const capabilities = await requireEventCapability(request, id, "participants.manage");
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");

      const [event] = await database
        .select({ hostProfileId: schema.events.hostProfileId })
        .from(schema.events)
        .where(eq(schema.events.id, id));
      if (!event) throw notFound("Event not found");

      // Entitlement gate (decisions #4/§C, PLAN.md:615/656): handing a collaborator a
      // permission set with ADMIN-GRADE authority over the event is a paid-plan
      // feature — the same `grant_admin` rule and 403 shape the profile-member
      // promotion uses in routes/profiles.ts (audit A-21). Charged to the EVENT
      // HOST's plan. Composed AFTER authorization, never conflated with it.
      await assertGrantAdminAllows(database, {
        hostProfileId: event.hostProfileId,
        nextPermissionSetId: request.body.permissionSetId,
      });

      // A crew member added directly is SPONSORED by whoever adds them (their own
      // participant), so rider visibility scopes to that sponsor's reach (decisions
      // #12) — the same stamp `assignGroupToEvent` writes. Operators add as the host
      // → all-rider reach when granted `rider.view`.
      let crewDetails: { sponsorParticipantId: string } | undefined;
      if (request.body.role === "crew" || request.body.role === "crew_lead") {
        const mine = await database
          .select({ id: schema.eventParticipants.id, role: schema.eventParticipants.role })
          .from(schema.eventParticipants)
          .innerJoin(
            schema.profileMembers,
            eq(schema.profileMembers.profileId, schema.eventParticipants.profileId),
          )
          .where(
            and(
              eq(schema.eventParticipants.eventId, id),
              eq(schema.profileMembers.userId, principal.userId),
              eq(schema.profileMembers.status, "active"),
            ),
          );
        const sponsor =
          mine.find((row) => row.role === "host" || row.role === "co_host") ?? mine[0];
        if (sponsor) crewDetails = { sponsorParticipantId: sponsor.id };
      }

      const { statusCode, body } = await withIdempotency(
        request,
        "POST /events/:id/participants",
        async () => {
          let created: typeof schema.eventParticipants.$inferSelect;
          try {
            created = await database.transaction(async (tx) => {
              const [participant] = await tx
                .insert(schema.eventParticipants)
                .values({
                  eventId: id,
                  profileId: request.body.profileId,
                  role: request.body.role,
                  permissionSetId: request.body.permissionSetId,
                  performerTag: request.body.performerTag,
                  details: crewDetails,
                  addedBy: principal.userId,
                })
                .returning();
              if (!participant) throw new Error("participant create failed");
              await writeAudit(tx, request, {
                capability: "participants.manage",
                action: "participant.add",
                targetKind: "event_participant",
                targetId: participant.id,
                eventId: id,
                after: participant,
              });
              // Event-level activity — visible to every participant of the event.
              await writeActivity(tx, request, {
                eventId: id,
                type: "participant.added",
                targetKind: "event",
                targetId: id,
                summary: { profileId: participant.profileId, role: participant.role },
              });
              // FUTURE-events rule (decisions #14): a represented performer joining
              // an in-region event auto-hands control to their active agent.
              if (participant.role === "performer" || participant.role === "support") {
                const [event] = await tx
                  .select()
                  .from(schema.events)
                  .where(eq(schema.events.id, id));
                if (event) {
                  await autoAssignAgentOnPerformerJoin(tx, event, participant.profileId);
                }
              }
              return participant;
            });
          } catch (error) {
            if (isUniqueViolation(error)) {
              throw conflict("That profile is already a participant on this event");
            }
            throw error;
          }
          // Realtime + feed: tell the newly-added profile's members they're on the
          // event. Best-effort — a delivery failure must never undo the add above,
          // so it runs after the commit, off the transaction, wrapped in try/catch.
          try {
            const [event] = await database
              .select({ title: schema.events.title })
              .from(schema.events)
              .where(eq(schema.events.id, id));
            await notifyProfileMembers(database, created.profileId, principal.userId, {
              type: "event.participant_added",
              title: `Added to "${event?.title ?? "an event"}"`,
              body: `You were added as ${created.role} to "${event?.title ?? "an event"}".`,
              eventId: id,
              actorDisplay: request.firebaseUser?.name ?? undefined,
              link: `/events/${id}`,
              metadata: { participantId: created.id, role: created.role },
            });
          } catch (error) {
            request.log.error(
              { error, eventId: id, profileId: created.profileId },
              "participant-add notification failed",
            );
          }

          return { statusCode: 201, body: serializeParticipant(created, capabilities) };
        },
      );

      return reply.status(statusCode as 201).send(body);
    },
  );

  // Add an OFF-PLATFORM performer: mint an unclaimed stub profile (keyed by
  // email) + participant + a pending invitation, in one transaction. The
  // performer claims the stub — and inherits this event — when they sign up with
  // the matching verified email (see lib/off-platform + session claim-on-signup).
  app.post(
    "/events/:id/participants/off-platform",
    {
      schema: {
        params: EventParams,
        body: OffPlatformParticipantBody,
        response: { 201: ParticipantResponse },
      },
    },
    async (request, reply) => {
      const { database } = request.server;
      const { id } = request.params;

      const capabilities = await requireEventCapability(request, id, "participants.manage");
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");

      // Resolve name + email — from a linked contact card, or supplied directly.
      let name = request.body.name;
      let email = request.body.email;
      const contactId = request.body.contactId;
      if (contactId) {
        const [contact] = await database
          .select()
          .from(schema.contacts)
          .where(
            and(
              eq(schema.contacts.id, contactId),
              eq(schema.contacts.ownerProfileId, principal.actingProfileId ?? ""),
            ),
          );
        if (!contact) throw notFound("Contact not found");
        name = name ?? contact.name;
        if (!email) {
          const persons = (contact.persons as { email?: string }[] | null) ?? [];
          email = persons.find((person) => person.email)?.email;
        }
      }
      if (!name || !email) {
        throw badRequest("An off-platform performer needs a name and an email.");
      }
      const performerName = name;
      const performerEmail = email;

      const created = await database.transaction(async (tx) => {
        const { profileId } = await createPerformerStub(tx, {
          name: performerName,
          email: performerEmail,
          operatorUserId: principal.userId,
        });
        const [participant] = await tx
          .insert(schema.eventParticipants)
          .values({
            eventId: id,
            profileId,
            role: request.body.role,
            performerTag: request.body.performerTag,
            status: "invited",
            addedBy: principal.userId,
          })
          .returning();
        if (!participant) throw new Error("participant create failed");

        const [invitation] = await tx
          .insert(schema.invitations)
          .values({
            type: "profile_member",
            source: "performer_offer",
            status: "pending",
            token: randomBytes(24).toString("hex"),
            recipientEmail: performerEmail.toLowerCase(),
            recipientName: performerName,
            targetProfileId: profileId,
            targetEventId: id,
            linkedContactId: contactId ?? null,
            role: "owner",
            createdByUser: principal.userId,
            createdByProfile: principal.actingProfileId,
          })
          .returning();
        if (contactId && invitation) {
          await tx
            .update(schema.contacts)
            .set({ invitationId: invitation.id })
            .where(eq(schema.contacts.id, contactId));
        }

        await writeAudit(tx, request, {
          capability: "participants.manage",
          action: "participant.add_off_platform",
          targetKind: "event_participant",
          targetId: participant.id,
          eventId: id,
          after: { participant, stubProfileId: profileId },
        });
        await writeActivity(tx, request, {
          eventId: id,
          type: "participant.added",
          targetKind: "event",
          targetId: id,
          summary: { profileId, role: participant.role, offPlatform: true },
        });
        return participant;
      });

      // Best-effort "you were added — sign up to claim your events" email. The
      // handler never needed the event row itself, but the recipient cannot tell
      // WHICH booking this is about without it, so read the three public-facing
      // columns here, inside the best-effort path: if this read fails the email
      // is simply skipped, exactly as a send failure already is.
      try {
        const event = await loadEventSummary(database, id);
        await request.server.emailSink.sendEmail({
          to: performerEmail,
          ...renderOffPlatformPerformerEmail({ performerName, event }),
        });
      } catch (error) {
        request.log.error({ error }, "off-platform performer email failed");
      }

      return reply.status(201).send(
        serializeParticipant(created, capabilities, {
          name: performerName,
          avatarFileId: null,
          avatarUrl: null,
          // An off-platform act has no shoWMe profile at all, so there is
          // nothing to link to — not an unpublished page, no page.
          slug: null,
          isPublic: false,
        }),
      );
    },
  );

  // Update: authorize `participants.manage`, protect the host's role, mutate + audit.
  app.patch(
    "/events/:id/participants/:pid",
    {
      schema: {
        params: ParticipantParams,
        body: UpdateParticipantBody,
        response: { 200: ParticipantResponse },
      },
    },
    async (request) => {
      const { database } = request.server;
      const { id, pid } = request.params;

      const capabilities = await requireEventCapability(request, id, "participants.manage");
      const [before] = await database
        .select()
        .from(schema.eventParticipants)
        .where(and(eq(schema.eventParticipants.id, pid), eq(schema.eventParticipants.eventId, id)));
      if (!before) throw notFound("Participant not found");

      const [event] = await database
        .select({ hostProfileId: schema.events.hostProfileId })
        .from(schema.events)
        .where(eq(schema.events.id, id));

      // The host is the event's anchor — its role is immutable (the host is both
      // `events.host_profile_id` and a `host` row; changing it would orphan access).
      if (request.body.role !== undefined && request.body.role !== before.role) {
        if (event && event.hostProfileId === before.profileId) {
          throw forbidden("The host's role cannot be changed");
        }
      }

      // Entitlement gate (decisions #4/§C, PLAN.md:615/656): PROMOTING a participant
      // to an admin-grade permission set is the same paid-plan `grant_admin` grant as
      // adding them with one (audit A-21) — a free plan must not reach event admin
      // through the back door of an update. Only a set that ADDS admin authority is
      // charged. Composed AFTER authorization, never conflated with it.
      if (event) {
        await assertGrantAdminAllows(database, {
          hostProfileId: event.hostProfileId,
          nextPermissionSetId: request.body.permissionSetId,
          currentPermissionSetId: before.permissionSetId,
        });
      }

      const updated = await database.transaction(async (tx) => {
        const [after] = await tx
          .update(schema.eventParticipants)
          .set({ ...request.body, updatedAt: new Date() })
          .where(eq(schema.eventParticipants.id, pid))
          .returning();
        if (!after) throw notFound("Participant not found");
        await writeAudit(tx, request, {
          capability: "participants.manage",
          action: "participant.update",
          targetKind: "event_participant",
          targetId: pid,
          eventId: id,
          before,
          after,
        });
        // Who someone is on this event, and what they may touch, is event-level
        // news — the same tier as the add that put them there.
        await writeActivity(tx, request, {
          eventId: id,
          type: "participant.updated",
          targetKind: "event",
          targetId: id,
          summary: {
            profileId: after.profileId,
            role: after.role,
            roleChanged: before.role !== after.role,
            permissionSetChanged: before.permissionSetId !== after.permissionSetId,
          },
        });
        return after;
      });

      return serializeParticipant(updated, capabilities);
    },
  );

  // Remove: authorize `participants.manage`, soft-remove (status='removed'), never
  // the host. Audit "participant.remove".
  app.delete(
    "/events/:id/participants/:pid",
    { schema: { params: ParticipantParams, response: { 200: ParticipantResponse } } },
    async (request) => {
      const { database } = request.server;
      const { id, pid } = request.params;

      const capabilities = await requireEventCapability(request, id, "participants.manage");
      const [before] = await database
        .select()
        .from(schema.eventParticipants)
        .where(and(eq(schema.eventParticipants.id, pid), eq(schema.eventParticipants.eventId, id)));
      if (!before) throw notFound("Participant not found");

      const [event] = await database.select().from(schema.events).where(eq(schema.events.id, id));
      if (event && event.hostProfileId === before.profileId) {
        throw forbidden("The host cannot be removed from the event");
      }

      const updated = await database.transaction(async (tx) => {
        const [after] = await tx
          .update(schema.eventParticipants)
          .set({ status: "removed", updatedAt: new Date() })
          .where(eq(schema.eventParticipants.id, pid))
          .returning();
        if (!after) throw notFound("Participant not found");
        await writeAudit(tx, request, {
          capability: "participants.manage",
          action: "participant.remove",
          targetKind: "event_participant",
          targetId: pid,
          eventId: id,
          before,
          after,
        });
        // Somebody dropping off the bill is the change other participants most
        // need explained, and the soft-remove leaves nothing else to see.
        await writeActivity(tx, request, {
          eventId: id,
          type: "participant.removed",
          targetKind: "event",
          targetId: id,
          summary: { profileId: before.profileId, role: before.role },
        });
        return after;
      });

      return serializeParticipant(updated, capabilities);
    },
  );
}
