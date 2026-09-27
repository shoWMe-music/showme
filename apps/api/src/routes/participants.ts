import { randomBytes } from "node:crypto";
import { PERFORMING_EVENT_ROLES } from "@showme/auth";
import { liveEventDelegationsForEvents } from "@showme/auth";
import { schema } from "@showme/db";
import { notifyProfileMembers } from "@showme/db/notify";
import { and, asc, eq, inArray, isNull, ne, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { badRequest, conflict, forbidden, isUniqueViolation, notFound } from "../errors";
import { writeActivity } from "../lib/activity";
import {
  type AgentAssignment,
  autoAssignAgentOnPerformerJoin,
  notifyAgentsOfAssignment,
} from "../lib/agent-assignment";
import { writeAudit } from "../lib/audit";
import { requireEventCapability } from "../lib/authorize";
import { renderOffPlatformPerformerEmail } from "../lib/email-templates";
import { assertGrantAdminAllows } from "../lib/entitlements";
import { advanceEventStatus } from "../lib/event-status-ladder";
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
  /**
   * NULLABLE, not merely optional — the difference is whether access can come
   * back DOWN.
   *
   * Optional-only, the field could be omitted (leave it alone) or set to a set id
   * (raise it), and there was no third thing to send: a collaborator promoted to
   * full control could never be demoted, because "no permission set, standard for
   * the role" was unsayable. The edit dialog had to state that limit instead of
   * offering a select that would silently no-op (ClickUp 86cbazcc7, item 1).
   *
   * `null` means "back to the role's default". Lowering is never an entitlement
   * grant, so `assertGrantAdminAllows` returns early on it — a free plan can
   * always take admin authority away, and only ever pays to hand it out.
   */
  permissionSetId: z.string().uuid().nullable().optional(),
  status: participantStatus.optional(),
  performerTag: performerTag.optional(),
});

const PermissionSetResponse = z.object({
  id: z.string(),
  name: z.string(),
  capabilities: z.array(z.string()),
  isPreset: z.boolean(),
});

const ParticipantResponse = z.object({
  id: z.string(),
  /** Null once the profile behind the row has been erased (migration 0032) —
   *  the name stays on the bill, but there is no account left to link to. */
  profileId: z.string().nullable(),
  name: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  /** The act's own genres (`86cbcf6gr`). Declared here or the response drops them. */
  genres: z.array(z.string()),
  /** Null unless the profile is published — Fastify strips what is not declared
   *  here, so without this slot the serializer's value never reaches a caller. */
  publicSlug: z.string().nullable(),
  role: z.string(),
  status: z.string(),
  performerTag: z.string().nullable(),
  permissionSetId: z.string().nullable().optional(),
  /** The set itself, so the UI can describe authority rather than compare ids. */
  permissionSet: PermissionSetResponse.optional(),
  /** What a removed row was before it was removed — the restore target. */
  statusBeforeRemoval: z.string().nullable().optional(),
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
          // `details` for the act's own genres (`86cbcf6gr`) — a jsonb leaf read with
          // its parent, which is why it is a leaf (`serialize/profile.ts`).
          profileDetails: schema.profiles.details,
          // The permission set BY VALUE, not by id. Serialized only for the
          // operator tier, but joined for everyone because the join is free —
          // one LEFT JOIN on an indexed primary key against a table of presets.
          permissionSetName: schema.permissionSets.name,
          permissionSetCapabilities: schema.permissionSets.capabilities,
          permissionSetProfileId: schema.permissionSets.profileId,
        })
        .from(schema.eventParticipants)
        .leftJoin(schema.profiles, eq(schema.profiles.id, schema.eventParticipants.profileId))
        .leftJoin(
          schema.permissionSets,
          eq(schema.permissionSets.id, schema.eventParticipants.permissionSetId),
        )
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
            details: row.profileDetails,
          },
          imageUrls,
          selfProfileIds,
          row.participant.permissionSetId && row.permissionSetName
            ? {
                id: row.participant.permissionSetId,
                name: row.permissionSetName,
                capabilities: row.permissionSetCapabilities ?? [],
                isPreset: row.permissionSetProfileId === null,
              }
            : null,
        ),
      );
    },
  );

  /**
   * The permission sets that may be put on a participant of this event.
   *
   * There was no route for this at all, which is what forced the roster to guess
   * at authority by comparing set ids (ClickUp 86cbazcc7, item 2) and left the
   * edit dialog with nothing to populate a select from.
   *
   * TWO SOURCES, one list: the system presets (`profile_id IS NULL`, available to
   * everyone) and the sets belonging to THIS EVENT'S HOST. The host's, not the
   * caller's — the sets are a property of the account whose event this is, a
   * co-host managing the roster hands out the host's vocabulary rather than their
   * own, and it is the host's plan that `assertGrantAdminAllows` charges for an
   * admin-grade grant.
   *
   * `participants.manage`, the capability that lets a caller ASSIGN one. Reading
   * the list is not more sensitive than assigning from it, and gating it any
   * lower would tell an arm's-length party how the host's access is arranged.
   */
  app.get(
    "/events/:id/permission-sets",
    { schema: { params: EventParams, response: { 200: z.array(PermissionSetResponse) } } },
    async (request) => {
      const { database } = request.server;
      const { id } = request.params;

      await requireEventCapability(request, id, "participants.manage");

      const [event] = await database
        .select({ hostProfileId: schema.events.hostProfileId })
        .from(schema.events)
        .where(eq(schema.events.id, id));
      if (!event) throw notFound("Event not found");

      const rows = await database
        .select()
        .from(schema.permissionSets)
        .where(
          or(
            isNull(schema.permissionSets.profileId),
            eq(schema.permissionSets.profileId, event.hostProfileId),
          ),
        )
        .orderBy(asc(schema.permissionSets.name));

      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        capabilities: row.capabilities,
        isPreset: row.profileId === null,
      }));
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
          /** Agents the add attached, told after the commit (QA4-7). */
          let assignedAgents: AgentAssignment[] = [];
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
              // RUNG 1 of the booking ladder (86cbcehmp): putting an act on the
              // bill makes a draft a `suggested` event. Only a PERFORMING role
              // does — booking a sound engineer is not suggesting the night to
              // anybody, and the ladder is about the act's answer.
              if (PERFORMING_EVENT_ROLES.has(request.body.role)) {
                await advanceEventStatus(tx, { eventId: id, trigger: "performer_invited" });
              }
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
                // `profile_id` is nullable since 0032, but a row this code just
                // inserted always carries one.
                if (event && participant.profileId) {
                  assignedAgents = await autoAssignAgentOnPerformerJoin(
                    tx,
                    event,
                    participant.profileId,
                  );
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
            // `profile_id` is nullable since 0032; a row this route just created
            // always has one, so this only satisfies the type — and if it were
            // ever null there would be no members to notify anyway.
            if (!created.profileId) throw new Error("participant created without a profile");
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

          // And the act's agent, if the join handed them the event (decisions #14).
          {
            const [event] = await database
              .select({ title: schema.events.title })
              .from(schema.events)
              .where(eq(schema.events.id, id));
            await notifyAgentsOfAssignment(
              database,
              request,
              { id, title: event?.title ?? "an event" },
              assignedAgents,
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
        // Same rung, the other door — Ran: *"Same when inviting external
        // performers via email using the invite collaborator button."*
        if (PERFORMING_EVENT_ROLES.has(request.body.role)) {
          await advanceEventStatus(tx, { eventId: id, trigger: "performer_invited" });
        }

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

      // Coming back from `removed` retires the memory of what it was. Left
      // behind, `status_before_removal` would be a second and older opinion about
      // a row that is no longer removed, and the next reader would have to work
      // out which one counts. Only a status change AWAY from `removed` clears it,
      // so an edit that touches something else leaves an undo intact.
      const isRestore =
        before.status === "removed" &&
        request.body.status !== undefined &&
        request.body.status !== "removed";

      const updated = await database.transaction(async (tx) => {
        const [after] = await tx
          .update(schema.eventParticipants)
          .set({
            ...request.body,
            ...(isRestore ? { statusBeforeRemoval: null } : {}),
            updatedAt: new Date(),
          })
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
          .set({
            status: "removed",
            // Keep what is about to be written over, so the confirm can honestly
            // offer an undo. Guarded against a second remove: removing an
            // already-removed row would otherwise record `removed` as the thing
            // to restore to, turning the undo into a no-op.
            ...(before.status === "removed" ? {} : { statusBeforeRemoval: before.status }),
            updatedAt: new Date(),
          })
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

  /**
   * ── ANSWERING AN INVITATION ────────────────────────────────────────────────
   *
   * ClickUp 86cbcehmp, and the symptom reported separately as 123qy9rnf87.
   * Ran: *"Invited users should first have the option to 'Accept invite' -
   * currently the invited party gets invited to an event → gets access to the
   * event manager as a collaborator immediately → stays as 'Invited'."*
   *
   * That was exact. `event_participants.status` has held `invited | accepted |
   * declined | confirmed | removed` since the schema was written and NOTHING
   * ever advanced it — no route set `accepted`, and authorization asked only
   * `status <> 'removed'`, so all four non-removed values meant the same thing.
   * The column was decorative. These two routes are what makes it real, and
   * `NON_STANDING_PARTICIPANT_STATUSES` in `@showme/auth` is what makes it
   * matter.
   *
   * ── Why these do NOT call `requireEventCapability` ─────────────────────────
   * They cannot. `invited` now grants no capabilities, so gating the answer on a
   * capability would mean only people who had already accepted could accept.
   * The authorization here is the invitation itself: you hold an `invited`
   * participant row on this event, through a profile you are an active member
   * of. That is narrower than the old rule, not wider — it authorizes exactly
   * one action on exactly one row, and cannot be used to read the event.
   *
   * ── One participation, answered once ──────────────────────────────────────
   * The unique index on `(event_id, profile_id)` means a profile has at most one
   * row here, so "the caller's participation" is unambiguous. Answering twice is
   * a 409 rather than a silent no-op: an operator watching the collaborators tab
   * should not see a decline quietly overwrite an accept.
   */
  const AnswerBody = z.object({
    /** Ran asked for this on decline: *"so that the decliner can say if it is a
     * date issue or if they simply don't want to be booked by this operator"*.
     * Optional — a refusal nobody explains is still a refusal. */
    note: z.string().trim().max(2000).optional(),
  });

  const AnswerResponse = z.object({
    eventId: z.string(),
    participantId: z.string(),
    status: z.enum(["accepted", "declined"]),
  });

  /**
   * The caller's own unanswered participation on this event, or a 404.
   *
   * 404 and not 403 throughout: to somebody with no invitation, an event they
   * cannot otherwise read must not be confirmed to exist by the shape of the
   * refusal. Same reasoning as the holds routes.
   */
  async function resolvePendingParticipation(
    request: FastifyRequest,
    eventId: string,
  ): Promise<{ id: string; profileId: string | null; agentParticipantId: string | null }> {
    const principal = request.principal;
    if (!principal) throw new Error("principal missing after authentication");
    const myProfileIds = new Set(principal.memberships.map((one) => one.profileId));

    // Every answerable participation on this event — which for an agent means
    // their ACT's row, not their own (86cbcehmp / decisions #14).
    const onEvent = await request.server.database
      .select({
        id: schema.eventParticipants.id,
        eventId: schema.eventParticipants.eventId,
        profileId: schema.eventParticipants.profileId,
        role: schema.eventParticipants.role,
        status: schema.eventParticipants.status,
      })
      .from(schema.eventParticipants)
      .where(
        and(
          eq(schema.eventParticipants.eventId, eventId),
          inArray(schema.eventParticipants.role, [...INVITABLE_ROLES]),
        ),
      );

    const answerable = await answerableInvitations(request, onEvent, myProfileIds);
    const mine = onEvent.filter((row) => answerable.has(row.id));
    if (mine.length === 0) throw notFound("Event not found");

    const pending = mine.find((row) => row.status === "invited");
    if (!pending) {
      const settled = mine[0];
      throw conflict(
        settled?.status === "declined"
          ? "You already declined this invitation"
          : "You have already answered this invitation",
      );
    }
    return {
      id: pending.id,
      profileId: pending.profileId,
      // The agent's own row moves with the answer — a projection cannot be
      // further along, or further behind, than the act it projects.
      agentParticipantId: answerable.get(pending.id)?.agentParticipantId ?? null,
    };
  }

  /** Answer an invitation — the one write both routes share. */
  async function answerInvitation(
    request: Parameters<typeof requireEventCapability>[0],
    eventId: string,
    answer: "accepted" | "declined",
    note: string | undefined,
  ) {
    const { database } = request.server;
    const principal = request.principal;
    if (!principal) throw new Error("principal missing after authentication");

    const participation = await resolvePendingParticipation(request, eventId);
    // Read directly rather than through `loadEventSummary`, which carries the
    // display fields and not `host_profile_id` — the one column this needs.
    const [event] = await database
      .select({ title: schema.events.title, hostProfileId: schema.events.hostProfileId })
      .from(schema.events)
      .where(eq(schema.events.id, eventId));

    const updated = await database.transaction(async (tx) => {
      const [after] = await tx
        .update(schema.eventParticipants)
        .set({ status: answer, updatedAt: new Date() })
        .where(
          and(
            eq(schema.eventParticipants.id, participation.id),
            // Answered under the row we checked, or not at all — two tabs must
            // not both win. The 409 above is the friendly path; this is the race.
            eq(schema.eventParticipants.status, "invited"),
          ),
        )
        .returning();
      if (!after) throw conflict("You have already answered this invitation");

      // The agent row follows the act's. Without this an agent who accepts on
      // their act's behalf would leave themselves at `invited` — locked out of
      // the very booking they just agreed to.
      if (participation.agentParticipantId) {
        await tx
          .update(schema.eventParticipants)
          .set({ status: answer, updatedAt: new Date() })
          .where(eq(schema.eventParticipants.id, participation.agentParticipantId));
      }

      // RUNG 2: an act has said yes, so the booking is no longer merely
      // suggested. Declining moves nothing — Ran's spec for a refusal is a
      // notification and the operator's choice of what to do next ("delete the
      // event or edit it to change the date"), not a status change, and
      // inventing a revert would fight that.
      if (answer === "accepted") {
        await advanceEventStatus(tx, { eventId, trigger: "invitation_accepted" });
      }

      await writeAudit(tx, request, {
        capability: "event.view",
        action: `participant.${answer === "accepted" ? "accept" : "decline"}`,
        targetKind: "event_participant",
        targetId: participation.id,
        eventId,
        before: participation,
        after,
      });
      // The bill changing is what the other participants are watching for, and
      // a decline is the one that needs acting on.
      await writeActivity(tx, request, {
        eventId,
        type: `participant.${answer === "accepted" ? "accepted" : "declined"}`,
        targetKind: "event",
        targetId: eventId,
        summary: { profileId: participation.profileId, ...(note ? { note } : {}) },
      });
      return after;
    });

    // The operator who sent it is the one who needs to know — outside the
    // transaction, because a notification failing must not roll back an answer
    // the person has already given. Same pattern as the invite itself.
    if (event?.hostProfileId) {
      try {
        await notifyProfileMembers(database, event.hostProfileId, principal.userId, {
          type: `event.invitation_${answer}`,
          title:
            answer === "accepted"
              ? `Invitation accepted${event.title ? ` — ${event.title}` : ""}`
              : `Invitation declined${event.title ? ` — ${event.title}` : ""}`,
          body: note || undefined,
          eventId,
          link: `/events/${eventId}`,
          metadata: { participantId: participation.id, ...(note ? { note } : {}) },
        });
      } catch (cause) {
        request.log.warn({ err: cause, eventId }, "invitation-answer notification failed");
      }
    }

    return { eventId, participantId: updated.id, status: answer };
  }

  /**
   * WHO ANSWERS AN INVITATION — the act, unless an agent speaks for them.
   *
   * ClickUp 86cbcehmp. decisions #14 and story.md: *"on in-region events the
   * agent negotiates and confirms while the performer's own screens go
   * read-only."* Accepting a booking is the most consequential confirm there is,
   * so for a represented act it belongs to the agent.
   *
   * The first version of this route got that exactly backwards: the delegated act
   * was asked and could answer, while the agent was told nothing and — because
   * their own row had been auto-accepted — could not answer if they wanted to.
   * Found by driving the invitation as the agent rather than as the operator.
   *
   * `liveEventDelegationsForEvents` is the same resolver `authorize` and the
   * change-request flow use, so a representation that has lapsed hands the answer
   * straight back to the act without waiting for a sweep.
   *
   * Returns, for the caller: the participations they may answer, and for each the
   * agent row that has to move with it.
   */
  async function answerableInvitations(
    request: FastifyRequest,
    rows: {
      id: string;
      eventId: string;
      profileId: string | null;
      role: string;
      [key: string]: unknown;
    }[],
    myProfileIds: Set<string>,
  ): Promise<Map<string, { agentParticipantId: string | null }>> {
    const answerable = new Map<string, { agentParticipantId: string | null }>();
    if (rows.length === 0) return answerable;

    const delegations = await liveEventDelegationsForEvents(
      request.server.database,
      [...new Set(rows.map((row) => row.eventId))],
      new Date(),
      // Unanswered rows INCLUDED. The question here is who answers for an act
      // that has not accepted yet, which the authorization default deliberately
      // excludes — an agent holds no capabilities on an unaccepted event, but
      // they are still the one who answers for it (86cbcehmp / decisions #14).
      ["invited", "accepted", "confirmed"],
    );

    // The agent's own participation on each event, so answering can move it too.
    const agentRows = await request.server.database
      .select({
        id: schema.eventParticipants.id,
        eventId: schema.eventParticipants.eventId,
        profileId: schema.eventParticipants.profileId,
      })
      .from(schema.eventParticipants)
      .where(
        and(
          inArray(schema.eventParticipants.eventId, [...new Set(rows.map((r) => r.eventId))]),
          eq(schema.eventParticipants.role, "agent"),
        ),
      );
    const agentRowFor = new Map(
      agentRows.map((row) => [`${row.eventId}:${row.profileId}`, row.id]),
    );

    for (const row of rows) {
      const onEvent = delegations.get(row.eventId) ?? [];
      const delegated = onEvent.find((one) => one.performerParticipantId === row.id);

      if (!delegated) {
        // Nobody speaks for this participation — it is the holder's to answer.
        if (row.profileId && myProfileIds.has(row.profileId)) {
          answerable.set(row.id, { agentParticipantId: null });
        }
        continue;
      }
      // Delegated: the AGENT answers, and the act does not.
      if (myProfileIds.has(delegated.agentProfileId)) {
        answerable.set(row.id, {
          agentParticipantId: agentRowFor.get(`${row.eventId}:${delegated.agentProfileId}`) ?? null,
        });
      }
    }
    return answerable;
  }

  /**
   * EVERY INVITATION THIS CALLER HAS NOT ANSWERED — across all their profiles.
   *
   * The gate above creates a door that needs a handle. `invited` now grants no
   * capabilities, so an invited performer cannot reach the event, cannot see it
   * in `GET /events`, and would have nothing to press: the invitation would be a
   * notification pointing at a 404. This read is the handle.
   *
   * It is deliberately NOT `GET /events?status=invited`. That route serializes
   * events through the capability layer, and the whole point here is that the
   * caller holds no capabilities on these events yet. So this returns the thin
   * slice an invitation legitimately reveals — who is asking, which night, where
   * — and nothing else. No budget, no deal, no roster, no participant list.
   * Enough to answer with, which is all an unanswered invitation has earned.
   */
  const PendingInvitationsResponse = z.array(
    z.object({
      eventId: z.string(),
      participantId: z.string(),
      profileId: z.string().nullable(),
      role: z.string(),
      title: z.string().nullable(),
      eventDate: z.string().nullable(),
      venueName: z.string().nullable(),
      hostName: z.string().nullable(),
      invitedAt: z.string(),
      /** The participation's own state: `invited` until answered. */
      status: z.string(),
      /**
       * WHERE THIS SITS IN THE INBOX — the participation's state crossed with the
       * calendar, in the vocabulary the Requests screen already uses.
       *
       * Ran (86cbcehmp): an invitation arrives as **pending**, and once answered
       * *"stays in the 'Accepted' tab of the incoming requests until Expired"*.
       * Expiry is not a stored state and must not become one: it is simply the
       * night having passed, so it is derived here rather than swept by a job
       * that would have to run to make the inbox truthful.
       */
      requestStatus: z.enum(["pending", "accepted", "declined", "expired"]),
    }),
  );

  /** `invited` → pending, and anything whose night is past → expired. */
  function inboxStatusFor(
    status: string,
    eventDate: string | null,
    today: string,
  ): "pending" | "accepted" | "declined" | "expired" {
    if (eventDate && eventDate < today) return "expired";
    if (status === "accepted") return "accepted";
    if (status === "declined") return "declined";
    return "pending";
  }

  /**
   * Roles that are INVITED to somebody else's event. The host and a co-host are
   * running it — nobody invited them to it — and an `agent` row is the projection
   * of a representation rather than an invitation anybody answers (decisions #14).
   */
  const INVITABLE_ROLES = ["performer", "support", "crew_lead", "crew"] as const;

  app.get(
    "/me/event-invitations",
    { schema: { response: { 200: PendingInvitationsResponse } } },
    async (request) => {
      const { database } = request.server;
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");

      const myProfileIds = new Set(principal.memberships.map((one) => one.profileId));

      // EVENTS THIS CALLER TOUCHES AT ALL — their own participations, and the
      // `agent` rows that project a representation. The second half is why this
      // is not a single join on `profile_members`: an agent answers for an act
      // whose participation is not theirs, so the row they need is one the old
      // query could never return (86cbcehmp).
      const reachable = await database
        .select({ eventId: schema.eventParticipants.eventId })
        .from(schema.eventParticipants)
        .innerJoin(
          schema.profileMembers,
          eq(schema.profileMembers.profileId, schema.eventParticipants.profileId),
        )
        .where(
          and(
            eq(schema.profileMembers.userId, principal.userId),
            eq(schema.profileMembers.status, "active"),
            ne(schema.eventParticipants.status, "removed"),
          ),
        );
      const eventIds = [...new Set(reachable.map((row) => row.eventId))];
      if (eventIds.length === 0) return [];

      const host = alias(schema.profiles, "host_profile");
      const candidates = await database
        .select({
          eventId: schema.eventParticipants.eventId,
          participantId: schema.eventParticipants.id,
          profileId: schema.eventParticipants.profileId,
          role: schema.eventParticipants.role,
          status: schema.eventParticipants.status,
          title: schema.events.title,
          eventDate: schema.events.eventDate,
          venueName: schema.events.venueName,
          hostName: host.name,
          invitedAt: schema.eventParticipants.createdAt,
        })
        .from(schema.eventParticipants)
        .innerJoin(schema.events, eq(schema.events.id, schema.eventParticipants.eventId))
        .leftJoin(host, eq(host.id, schema.events.hostProfileId))
        .where(
          and(
            inArray(schema.eventParticipants.eventId, eventIds),
            // Answered ones stay, so the inbox can show an Accepted tab — a
            // `removed` participation is gone and has nothing to say.
            inArray(schema.eventParticipants.status, ["invited", "accepted", "declined"]),
            inArray(schema.eventParticipants.role, [...INVITABLE_ROLES]),
          ),
        )
        .orderBy(asc(schema.events.eventDate));

      // Whose answer each one is. A delegated act's invitation belongs to their
      // agent, and disappears from the act's own list — their screens are
      // read-only on it (decisions #14).
      const answerable = await answerableInvitations(
        request,
        candidates.map((row) => ({ ...row, id: row.participantId })),
        myProfileIds,
      );
      const rows = candidates.filter((row) => answerable.has(row.participantId));

      // One "today", read once: deriving expiry per row against a moving clock
      // could put two rows on opposite sides of midnight in the same response.
      const today = new Date().toISOString().slice(0, 10);

      return rows.map((row) => ({
        ...row,
        eventDate: row.eventDate ?? null,
        invitedAt: row.invitedAt.toISOString(),
        requestStatus: inboxStatusFor(row.status, row.eventDate ?? null, today),
      }));
    },
  );

  app.post(
    "/events/:id/participation/accept",
    { schema: { params: EventParams, body: AnswerBody, response: { 200: AnswerResponse } } },
    async (request) => answerInvitation(request, request.params.id, "accepted", request.body.note),
  );

  app.post(
    "/events/:id/participation/decline",
    { schema: { params: EventParams, body: AnswerBody, response: { 200: AnswerResponse } } },
    async (request) => answerInvitation(request, request.params.id, "declined", request.body.note),
  );
}
