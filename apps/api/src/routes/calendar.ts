import { schema } from "@showme/db";
import { and, asc, eq, gte, inArray, lte, or } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { forbidden, notFound } from "../errors";
import { writeAudit } from "../lib/audit";

const CalendarParams = z.object({ id: z.string().uuid() });

const calendarItemType = z.enum(["task", "appointment", "note"]);

const CreateCalendarBody = z.object({
  type: calendarItemType,
  title: z.string().min(1),
  date: z.string().min(1),
  startTime: z.string().min(1).optional(),
  endTime: z.string().min(1).optional(),
  ownerProfileId: z.string().uuid().optional(),
  ownerUserId: z.string().optional(),
  entity: z.string().optional(),
  assigneeUserId: z.string().optional(),
  assigneeName: z.string().optional(),
});

const UpdateCalendarBody = z.object({
  type: calendarItemType.optional(),
  title: z.string().min(1).optional(),
  date: z.string().min(1).optional(),
  startTime: z.string().min(1).nullable().optional(),
  endTime: z.string().min(1).nullable().optional(),
  entity: z.string().nullable().optional(),
  assigneeUserId: z.string().nullable().optional(),
  assigneeName: z.string().nullable().optional(),
});

const ListQuery = z.object({
  from: z.string().min(1).optional(),
  to: z.string().min(1).optional(),
});

const CalendarResponse = z.object({
  id: z.string(),
  ownerProfileId: z.string().nullable(),
  ownerUserId: z.string().nullable(),
  type: z.string(),
  title: z.string(),
  date: z.string(),
  startTime: z.string().nullable(),
  endTime: z.string().nullable(),
  entity: z.string().nullable(),
  assigneeUserId: z.string().nullable(),
  assigneeName: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const DeleteResponse = z.object({ id: z.string(), deleted: z.boolean() });

type CalendarRow = typeof schema.calendarItems.$inferSelect;

function serializeCalendarItem(item: CalendarRow): z.infer<typeof CalendarResponse> {
  return {
    id: item.id,
    ownerProfileId: item.ownerProfileId,
    ownerUserId: item.ownerUserId,
    type: item.type,
    title: item.title,
    date: item.date,
    startTime: item.startTime,
    endTime: item.endTime,
    entity: item.entity,
    assigneeUserId: item.assigneeUserId,
    assigneeName: item.assigneeName,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

/**
 * Owner-scoped access: a calendar item is reachable iff the caller owns it
 * directly or through a profile they belong to. Non-reachable is a 404.
 */
async function loadAccessibleItem(request: FastifyRequest, id: string): Promise<CalendarRow> {
  const { database } = request.server;
  const principal = request.principal;
  if (!principal) throw new Error("principal missing after authentication");

  const [item] = await database
    .select()
    .from(schema.calendarItems)
    .where(eq(schema.calendarItems.id, id));
  if (!item) throw notFound("Calendar item not found");

  if (item.ownerUserId && item.ownerUserId === principal.userId) return item;
  if (
    item.ownerProfileId &&
    principal.memberships.some((m) => m.profileId === item.ownerProfileId)
  ) {
    return item;
  }
  throw notFound("Calendar item not found");
}

/** Validate the caller may create in the requested scope; throws 403 otherwise. */
function assertMayWriteScope(
  request: FastifyRequest,
  scope: { ownerUserId: string | null; ownerProfileId?: string },
): void {
  const principal = request.principal;
  if (!principal) throw new Error("principal missing after authentication");

  if (scope.ownerUserId && scope.ownerUserId !== principal.userId) {
    throw forbidden("Cannot create an item owned by another user");
  }
  if (
    scope.ownerProfileId &&
    !principal.memberships.some((m) => m.profileId === scope.ownerProfileId)
  ) {
    throw forbidden("You are not a member of that profile");
  }
}

export async function calendarRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // List the caller's own + their profiles' items, optionally within a date range.
  app.get(
    "/calendar",
    { schema: { querystring: ListQuery, response: { 200: z.array(CalendarResponse) } } },
    async (request) => {
      const { database } = request.server;
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");
      const { from, to } = request.query;

      const profileIds = principal.memberships.map((m) => m.profileId);
      const ownerConditions = [eq(schema.calendarItems.ownerUserId, principal.userId)];
      if (profileIds.length > 0) {
        ownerConditions.push(inArray(schema.calendarItems.ownerProfileId, profileIds));
      }
      const ownerFilter = or(...ownerConditions);

      const rows = await database
        .select()
        .from(schema.calendarItems)
        .where(
          and(
            ownerFilter,
            from ? gte(schema.calendarItems.date, from) : undefined,
            to ? lte(schema.calendarItems.date, to) : undefined,
          ),
        )
        .orderBy(asc(schema.calendarItems.date), asc(schema.calendarItems.id));

      return rows.map(serializeCalendarItem);
    },
  );

  // Create a personal / profile-scoped calendar item.
  app.post(
    "/calendar",
    { schema: { body: CreateCalendarBody, response: { 201: CalendarResponse } } },
    async (request, reply) => {
      const { database } = request.server;
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");
      const body = request.body;

      const ownerUserId = body.ownerUserId ?? (body.ownerProfileId ? null : principal.userId);
      assertMayWriteScope(request, { ownerUserId, ownerProfileId: body.ownerProfileId });

      const created = await database.transaction(async (tx) => {
        const [item] = await tx
          .insert(schema.calendarItems)
          .values({
            ownerProfileId: body.ownerProfileId ?? null,
            ownerUserId,
            type: body.type,
            title: body.title,
            date: body.date,
            startTime: body.startTime ?? null,
            endTime: body.endTime ?? null,
            entity: body.entity ?? null,
            assigneeUserId: body.assigneeUserId ?? null,
            assigneeName: body.assigneeName ?? null,
          })
          .returning();
        if (!item) throw new Error("calendar item create failed");
        const serialized = serializeCalendarItem(item);
        await writeAudit(tx, request, {
          capability: "profile.edit",
          action: "calendar.create",
          targetKind: "calendar_item",
          targetId: item.id,
          after: serialized,
        });
        return serialized;
      });

      return reply.status(201).send(created);
    },
  );

  // Update an item within the caller's scope.
  app.patch(
    "/calendar/:id",
    {
      schema: {
        params: CalendarParams,
        body: UpdateCalendarBody,
        response: { 200: CalendarResponse },
      },
    },
    async (request) => {
      const { database } = request.server;
      const { id } = request.params;
      const before = await loadAccessibleItem(request, id);
      const body = request.body;

      const fields: Partial<typeof schema.calendarItems.$inferInsert> = { updatedAt: new Date() };
      if (body.type !== undefined) fields.type = body.type;
      if (body.title !== undefined) fields.title = body.title;
      if (body.date !== undefined) fields.date = body.date;
      if (body.startTime !== undefined) fields.startTime = body.startTime;
      if (body.endTime !== undefined) fields.endTime = body.endTime;
      if (body.entity !== undefined) fields.entity = body.entity;
      if (body.assigneeUserId !== undefined) fields.assigneeUserId = body.assigneeUserId;
      if (body.assigneeName !== undefined) fields.assigneeName = body.assigneeName;

      const updated = await database.transaction(async (tx) => {
        const [after] = await tx
          .update(schema.calendarItems)
          .set(fields)
          .where(eq(schema.calendarItems.id, id))
          .returning();
        if (!after) throw notFound("Calendar item not found");
        const serialized = serializeCalendarItem(after);
        await writeAudit(tx, request, {
          capability: "profile.edit",
          action: "calendar.update",
          targetKind: "calendar_item",
          targetId: id,
          before: serializeCalendarItem(before),
          after: serialized,
        });
        return serialized;
      });

      return updated;
    },
  );

  // Delete an item within the caller's scope.
  app.delete(
    "/calendar/:id",
    { schema: { params: CalendarParams, response: { 200: DeleteResponse } } },
    async (request) => {
      const { database } = request.server;
      const { id } = request.params;
      const before = await loadAccessibleItem(request, id);

      await database.transaction(async (tx) => {
        await tx.delete(schema.calendarItems).where(eq(schema.calendarItems.id, id));
        await writeAudit(tx, request, {
          capability: "profile.edit",
          action: "calendar.delete",
          targetKind: "calendar_item",
          targetId: id,
          before: serializeCalendarItem(before),
        });
      });

      return { id, deleted: true };
    },
  );
}
