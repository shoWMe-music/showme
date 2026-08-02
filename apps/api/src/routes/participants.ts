import { schema } from "@showme/db";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { conflict, forbidden, notFound } from "../errors";
import { writeActivity } from "../lib/activity";
import { autoAssignAgentOnPerformerJoin } from "../lib/agent-assignment";
import { writeAudit } from "../lib/audit";
import { requireEventCapability } from "../lib/authorize";
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

const UpdateParticipantBody = z.object({
  role: participantRole.optional(),
  permissionSetId: z.string().uuid().optional(),
  status: participantStatus.optional(),
  performerTag: performerTag.optional(),
});

const ParticipantResponse = z.object({
  id: z.string(),
  profileId: z.string(),
  role: z.string(),
  status: z.string(),
  performerTag: z.string().nullable(),
  permissionSetId: z.string().nullable().optional(),
  details: z.unknown().optional(),
});

/** Postgres unique-violation — the `(event_id, profile_id)` constraint tripped. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

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
      const participants = await database
        .select()
        .from(schema.eventParticipants)
        .where(eq(schema.eventParticipants.eventId, id));

      return participants.map((participant) => serializeParticipant(participant, capabilities));
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
          return { statusCode: 201, body: serializeParticipant(created, capabilities) };
        },
      );

      return reply.status(statusCode as 201).send(body);
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

      // The host is the event's anchor — its role is immutable (the host is both
      // `events.host_profile_id` and a `host` row; changing it would orphan access).
      if (request.body.role !== undefined && request.body.role !== before.role) {
        const [event] = await database.select().from(schema.events).where(eq(schema.events.id, id));
        if (event && event.hostProfileId === before.profileId) {
          throw forbidden("The host's role cannot be changed");
        }
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
        return after;
      });

      return serializeParticipant(updated, capabilities);
    },
  );
}
