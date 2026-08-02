import { schema } from "@showme/db";
import { resolveLocalToInstant } from "@showme/time";
import { and, asc, eq } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { notFound } from "../errors";
import { writeAudit } from "../lib/audit";
import { requireEventCapability } from "../lib/authorize";

const EventParams = z.object({ id: z.string().uuid() });
const ScheduleParams = z.object({ id: z.string().uuid(), sid: z.string().uuid() });

const scheduleCategoryEnum = z.enum(["production", "crew"]);

/** Offset-free local wall-clock, e.g. "2026-07-15T20:00" (decisions #10). */
const localDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/);

const CreateScheduleBody = z.object({
  localDateTime: localDateTime.optional(),
  duration: z.number().int().optional(),
  label: z.string().min(1),
  description: z.string().optional(),
  category: scheduleCategoryEnum.default("production"),
  ownerParticipantId: z.string().uuid().optional(),
});

const UpdateScheduleBody = z.object({
  localDateTime: localDateTime.nullable().optional(),
  duration: z.number().int().nullable().optional(),
  label: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  category: scheduleCategoryEnum.optional(),
  ownerParticipantId: z.string().uuid().nullable().optional(),
});

const ScheduleResponse = z.object({
  id: z.string(),
  eventId: z.string(),
  /** Wall-clock local time + the anchoring IANA zone (decisions #10). */
  localDateTime: z.string().nullable(),
  timezone: z.string().nullable(),
  /** Absolute UTC instant resolved from `localDateTime` in `timezone`, DST-correct. */
  instant: z.string().nullable(),
  duration: z.number().nullable(),
  label: z.string(),
  description: z.string().nullable(),
  category: z.string(),
  ownerParticipantId: z.string().nullable(),
});

type ScheduleRow = typeof schema.scheduleItems.$inferSelect;

function serializeScheduleItem(
  item: ScheduleRow,
  timezone: string | null,
): z.infer<typeof ScheduleResponse> {
  let instant: string | null = null;
  if (item.localDateTime && timezone) {
    try {
      instant = resolveLocalToInstant(item.localDateTime, timezone).toISOString();
    } catch {
      instant = null;
    }
  }
  return {
    id: item.id,
    eventId: item.eventId,
    localDateTime: item.localDateTime ?? null,
    timezone,
    instant,
    duration: item.duration ?? null,
    label: item.label,
    description: item.description ?? null,
    category: item.category,
    ownerParticipantId: item.ownerParticipantId ?? null,
  };
}

/** The event's snapshotted IANA zone — the anchor every schedule item resolves against. */
async function eventTimezone(request: FastifyRequest, eventId: string): Promise<string | null> {
  const [event] = await request.server.database
    .select({ timezone: schema.events.timezone })
    .from(schema.events)
    .where(eq(schema.events.id, eventId));
  return event?.timezone ?? null;
}

/** Fetch a schedule item scoped to its event, or 404. */
async function loadScheduleItem(
  request: FastifyRequest,
  eventId: string,
  scheduleItemId: string,
): Promise<ScheduleRow> {
  const [item] = await request.server.database
    .select()
    .from(schema.scheduleItems)
    .where(
      and(eq(schema.scheduleItems.id, scheduleItemId), eq(schema.scheduleItems.eventId, eventId)),
    );
  if (!item) throw notFound("Schedule item not found");
  return item;
}

export async function scheduleRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // List an event's run-of-show — `schedule.view`, ordered by start time.
  app.get(
    "/events/:id/schedule",
    { schema: { params: EventParams, response: { 200: z.array(ScheduleResponse) } } },
    async (request) => {
      const { database } = request.server;
      const eventId = request.params.id;

      await requireEventCapability(request, eventId, "schedule.view");
      const items = await database
        .select()
        .from(schema.scheduleItems)
        .where(eq(schema.scheduleItems.eventId, eventId))
        .orderBy(asc(schema.scheduleItems.localDateTime));
      const timezone = await eventTimezone(request, eventId);

      return items.map((item) => serializeScheduleItem(item, timezone));
    },
  );

  // Create a schedule item — `schedule.edit`, audited.
  app.post(
    "/events/:id/schedule",
    {
      schema: {
        params: EventParams,
        body: CreateScheduleBody,
        response: { 201: ScheduleResponse },
      },
    },
    async (request, reply) => {
      const { database } = request.server;
      const eventId = request.params.id;
      const body = request.body;

      await requireEventCapability(request, eventId, "schedule.edit");

      const created = await database.transaction(async (tx) => {
        const [item] = await tx
          .insert(schema.scheduleItems)
          .values({
            eventId,
            localDateTime: body.localDateTime,
            duration: body.duration,
            label: body.label,
            description: body.description,
            category: body.category,
            ownerParticipantId: body.ownerParticipantId,
          })
          .returning();
        if (!item) throw new Error("schedule item create failed");
        await writeAudit(tx, request, {
          capability: "schedule.edit",
          action: "schedule.create",
          targetKind: "schedule_item",
          targetId: item.id,
          eventId,
          after: item,
        });
        return item;
      });

      const timezone = await eventTimezone(request, eventId);
      return reply.status(201).send(serializeScheduleItem(created, timezone));
    },
  );

  // Update a schedule item — `schedule.edit`, audited.
  app.patch(
    "/events/:id/schedule/:sid",
    {
      schema: {
        params: ScheduleParams,
        body: UpdateScheduleBody,
        response: { 200: ScheduleResponse },
      },
    },
    async (request) => {
      const { database } = request.server;
      const { id: eventId, sid } = request.params;

      await requireEventCapability(request, eventId, "schedule.edit");
      const before = await loadScheduleItem(request, eventId, sid);

      const updated = await database.transaction(async (tx) => {
        const [after] = await tx
          .update(schema.scheduleItems)
          .set({ ...request.body, updatedAt: new Date() })
          .where(eq(schema.scheduleItems.id, sid))
          .returning();
        if (!after) throw notFound("Schedule item not found");
        await writeAudit(tx, request, {
          capability: "schedule.edit",
          action: "schedule.update",
          targetKind: "schedule_item",
          targetId: sid,
          eventId,
          before,
          after,
        });
        return after;
      });

      const timezone = await eventTimezone(request, eventId);
      return serializeScheduleItem(updated, timezone);
    },
  );

  // Delete a schedule item — `schedule.edit`, audited.
  app.delete(
    "/events/:id/schedule/:sid",
    { schema: { params: ScheduleParams } },
    async (request, reply) => {
      const { database } = request.server;
      const { id: eventId, sid } = request.params;

      await requireEventCapability(request, eventId, "schedule.edit");
      const before = await loadScheduleItem(request, eventId, sid);

      await database.transaction(async (tx) => {
        const [deleted] = await tx
          .delete(schema.scheduleItems)
          .where(eq(schema.scheduleItems.id, sid))
          .returning();
        if (!deleted) throw notFound("Schedule item not found");
        await writeAudit(tx, request, {
          capability: "schedule.edit",
          action: "schedule.delete",
          targetKind: "schedule_item",
          targetId: sid,
          eventId,
          before,
        });
      });

      return reply.status(204).send();
    },
  );
}
