import { PRESET_PERMISSION_SETS } from "@showme/auth";
import { schema } from "@showme/db";
import type { Capability } from "@showme/shared";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { badRequest, conflict, forbidden, notFound } from "../errors";
import { writeAudit } from "../lib/audit";
import { requireEventCapability } from "../lib/authorize";
import { canUseFeature } from "../lib/entitlements";
import { resolveEventTimezone } from "../lib/event-timezone";
import { withIdempotency } from "../plugins/idempotency";
import { serializeEvent } from "../serialize/event";

const EventParams = z.object({ id: z.string().uuid() });

const CreateEventBody = z.object({
  title: z.string().min(1),
  baseCurrency: z.string().min(1),
  eventDate: z.string().optional(),
  venueProfileId: z.string().uuid().optional(),
  stageId: z.string().uuid().optional(),
  /** Explicit IANA zone override; otherwise snapshotted from the venue (decisions #10). */
  timezone: z.string().optional(),
});

const UpdateEventBody = z.object({
  title: z.string().min(1).optional(),
  notes: z.string().optional(),
  status: z
    .enum(["draft", "suggested", "pending", "confirmed", "on_hold", "concluded", "cancelled"])
    .optional(),
  published: z.boolean().optional(),
  eventDate: z.string().nullable().optional(),
  venueProfileId: z.string().uuid().nullable().optional(),
  stageId: z.string().uuid().nullable().optional(),
  timezone: z.string().optional(),
  /** Expected version for optimistic locking (decisions #8); mismatch → 409. */
  expectedVersion: z.number().int().optional(),
});

const EventResponse = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  published: z.boolean(),
  baseCurrency: z.string(),
  eventDate: z.string().nullable(),
  timezone: z.string().nullable(),
  venueProfileId: z.string().nullable(),
  stageId: z.string().nullable(),
  version: z.number(),
  holdRank: z.number().nullable().optional(),
  holdAutoPromote: z.boolean().optional(),
});

const OPERATOR_CAPABILITIES = new Set(PRESET_PERMISSION_SETS.operator_full as Capability[]);

export async function eventRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // Create: operator-kind gate + idempotency (decisions #8) + audit.
  app.post(
    "/events",
    { schema: { body: CreateEventBody, response: { 201: EventResponse } } },
    async (request, reply) => {
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");
      const actingProfileId = principal.actingProfileId;
      const membership = principal.memberships.find((m) => m.profileId === actingProfileId);
      if (!actingProfileId || !membership) {
        throw badRequest("Set X-Profile-Id to a profile you belong to");
      }
      if (membership.kind !== "operator") {
        throw forbidden("Only operator profiles can create events");
      }
      const { database } = request.server;

      const { statusCode, body } = await withIdempotency(request, "POST /events", async () => {
        const created = await database.transaction(async (tx) => {
          const [permissionSet] = await tx
            .insert(schema.permissionSets)
            .values({
              profileId: actingProfileId,
              name: "operator_full",
              capabilities: [...PRESET_PERMISSION_SETS.operator_full],
            })
            .returning();
          const timezone = await resolveEventTimezone(
            tx,
            request.body.venueProfileId,
            request.body.timezone,
          );
          const [event] = await tx
            .insert(schema.events)
            .values({
              hostProfileId: actingProfileId,
              title: request.body.title,
              baseCurrency: request.body.baseCurrency,
              eventDate: request.body.eventDate,
              venueProfileId: request.body.venueProfileId,
              stageId: request.body.stageId,
              timezone,
              createdBy: principal.userId,
            })
            .returning();
          if (!event || !permissionSet) throw new Error("event create failed");
          await tx.insert(schema.eventParticipants).values({
            eventId: event.id,
            profileId: actingProfileId,
            role: "host",
            permissionSetId: permissionSet.id,
            status: "confirmed",
          });
          await writeAudit(tx, request, {
            capability: "event.edit",
            action: "event.create",
            targetKind: "event",
            targetId: event.id,
            eventId: event.id,
            after: event,
          });
          return event;
        });
        return { statusCode: 201, body: serializeEvent(created, OPERATOR_CAPABILITIES) };
      });

      return reply.status(statusCode as 201).send(body);
    },
  );

  // Read: authorize `event.view`, then serialize by the caller's capabilities.
  app.get(
    "/events/:id",
    { schema: { params: EventParams, response: { 200: EventResponse } } },
    async (request) => {
      const { database } = request.server;
      const { id } = request.params;

      const capabilities = await requireEventCapability(request, id, "event.view");
      const [event] = await database.select().from(schema.events).where(eq(schema.events.id, id));
      if (!event) throw notFound("Event not found");

      return serializeEvent(event, capabilities);
    },
  );

  // Write: authorize `event.edit`, optimistic-lock on version, mutate + audit.
  app.patch(
    "/events/:id",
    { schema: { params: EventParams, body: UpdateEventBody, response: { 200: EventResponse } } },
    async (request) => {
      const { database } = request.server;
      const { id } = request.params;

      const capabilities = await requireEventCapability(request, id, "event.edit");
      const [before] = await database.select().from(schema.events).where(eq(schema.events.id, id));
      if (!before) throw notFound("Event not found");

      const { expectedVersion, timezone: bodyTimezone, ...fields } = request.body;

      // Entitlement gate (decisions #4/§C): confirming an event counts against the
      // free-tier event cap. Composed AFTER authorization, never conflated with it.
      if (fields.status === "confirmed" && before.status !== "confirmed") {
        const gate = await canUseFeature(database, before.hostProfileId, "create_event");
        if (!gate.allowed) {
          throw forbidden(gate.reason ?? "Event cap reached — upgrade to confirm more events");
        }
      }

      const where =
        expectedVersion != null
          ? and(eq(schema.events.id, id), eq(schema.events.version, expectedVersion))
          : eq(schema.events.id, id);

      const updated = await database.transaction(async (tx) => {
        // Re-snapshot the timezone when the venue changes or an explicit zone is given
        // (decisions #10). Untouched otherwise — a title edit never re-resolves it.
        const reTimezone =
          fields.venueProfileId !== undefined || bodyTimezone !== undefined
            ? await resolveEventTimezone(
                tx,
                fields.venueProfileId ?? before.venueProfileId,
                bodyTimezone,
              )
            : undefined;

        const [after] = await tx
          .update(schema.events)
          .set({
            ...fields,
            ...(reTimezone !== undefined ? { timezone: reTimezone } : {}),
            version: before.version + 1,
            updatedAt: new Date(),
          })
          .where(where)
          .returning();
        if (!after) {
          // The row exists (checked above) but the version moved → conflict.
          throw conflict("Event was changed by someone else; reload and retry");
        }
        await writeAudit(tx, request, {
          capability: "event.edit",
          action: "event.update",
          targetKind: "event",
          targetId: id,
          eventId: id,
          before,
          after,
        });
        return after;
      });

      return serializeEvent(updated, capabilities);
    },
  );
}
