import { schema } from "@showme/db";
import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { forbidden, notFound } from "../errors";
import { writeActivity } from "../lib/activity";
import { writeAudit } from "../lib/audit";
import { eventCapabilities, requireEventCapability } from "../lib/authorize";
import { PaginationQuery, decodeCursor, paginate } from "../lib/pagination";

const TaskParams = z.object({ id: z.string().uuid() });

const ReminderInput = z.object({
  date: z.string().min(1),
  time: z.string().min(1).optional(),
  label: z.string().min(1).optional(),
});

// `budgetAmount` arrives as a STRING and is parsed to bigint minor units
// (money.md) — never a JS number, which loses precision past 2^53.
const CreateTaskBody = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  dueDate: z.string().min(1).optional(),
  ownerProfileId: z.string().uuid().optional(),
  ownerUserId: z.string().optional(),
  eventId: z.string().uuid().optional(),
  // Optional named work-group (must be one the caller owns).
  groupId: z.string().uuid().optional(),
  budgetType: z.string().optional(),
  budgetAmount: z.string().min(1).optional(),
  reminders: z.array(ReminderInput).optional(),
});

const UpdateTaskBody = z.object({
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  completed: z.boolean().optional(),
  dueDate: z.string().min(1).nullable().optional(),
  groupId: z.string().uuid().nullable().optional(),
  budgetAmount: z.string().min(1).nullable().optional(),
});

const ListQuery = PaginationQuery.extend({
  completed: z.enum(["true", "false"]).optional(),
  groupId: z.string().uuid().optional(),
  /** Scope to one event's to-do list (gated by `event.view`, not owner). */
  eventId: z.string().uuid().optional(),
});

const TaskResponse = z.object({
  id: z.string(),
  eventId: z.string().nullable(),
  ownerProfileId: z.string().nullable(),
  ownerUserId: z.string().nullable(),
  groupId: z.string().nullable(),
  title: z.string(),
  description: z.string().nullable(),
  completed: z.boolean(),
  completedAt: z.string().nullable(),
  dueDate: z.string().nullable(),
  budgetType: z.string().nullable(),
  budgetAmount: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const ListResponse = z.object({
  items: z.array(TaskResponse),
  nextCursor: z.string().nullable(),
});

const DeleteResponse = z.object({ id: z.string(), deleted: z.boolean() });

type TaskRow = typeof schema.tasks.$inferSelect;

interface TaskCursor {
  createdAt: string;
  id: string;
}

/** Response projection — bigint money → STRING, timestamps → ISO (money.md boundary). */
function serializeTask(task: TaskRow): z.infer<typeof TaskResponse> {
  return {
    id: task.id,
    eventId: task.eventId,
    ownerProfileId: task.ownerProfileId,
    ownerUserId: task.ownerUserId,
    groupId: task.groupId,
    title: task.title,
    description: task.description,
    completed: task.completed,
    completedAt: task.completedAt ? task.completedAt.toISOString() : null,
    dueDate: task.dueDate,
    budgetType: task.budgetType,
    budgetAmount: task.budgetAmount != null ? task.budgetAmount.toString() : null,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}

/**
 * Owner-scoped access: a task is reachable iff the caller owns it directly, owns
 * it through a profile they belong to, or it hangs off an event they can view.
 * Non-reachable is a 404 (no existence leak).
 */
async function loadAccessibleTask(request: FastifyRequest, id: string): Promise<TaskRow> {
  const { database } = request.server;
  const principal = request.principal;
  if (!principal) throw new Error("principal missing after authentication");

  const [task] = await database.select().from(schema.tasks).where(eq(schema.tasks.id, id));
  if (!task) throw notFound("Task not found");

  if (task.ownerUserId && task.ownerUserId === principal.userId) return task;
  if (
    task.ownerProfileId &&
    principal.memberships.some((m) => m.profileId === task.ownerProfileId)
  ) {
    return task;
  }
  if (task.eventId) {
    const capabilities = await eventCapabilities(request, task.eventId);
    if (capabilities.has("event.view")) return task;
  }
  throw notFound("Task not found");
}

/** Validate the caller may create in the requested scope; throws 403/404 otherwise. */
async function assertMayWriteScope(
  request: FastifyRequest,
  scope: { ownerUserId: string | null; ownerProfileId?: string; eventId?: string },
): Promise<void> {
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
  if (scope.eventId) {
    await requireEventCapability(request, scope.eventId, "event.view");
  }
}

/** A task may only reference a work-group the caller owns. Throws 404 otherwise. */
async function assertMayUseGroup(request: FastifyRequest, groupId: string): Promise<void> {
  const principal = request.principal;
  if (!principal) throw new Error("principal missing after authentication");
  const [group] = await request.server.database
    .select({ id: schema.groups.id })
    .from(schema.groups)
    .where(and(eq(schema.groups.id, groupId), eq(schema.groups.ownerUserId, principal.userId)));
  if (!group) throw notFound("Work-group not found");
}

/**
 * The task fields whose movement is worth a history line. Names only — `budgetAmount`
 * is money and stays out of a summary (`lib/activity.ts`), and `description` is free
 * text an event-wide feed has no business echoing.
 */
const TRACKED_TASK_FIELDS = ["title", "dueDate", "groupId", "budgetAmount"] as const;

export async function taskRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // List the caller's own + their profiles' tasks. Access IS the WHERE clause.
  app.get(
    "/tasks",
    { schema: { querystring: ListQuery, response: { 200: ListResponse } } },
    async (request) => {
      const { database } = request.server;
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");
      const { cursor, limit, completed, groupId, eventId } = request.query;

      // Event-scoped list = the event's shared to-do, gated by event.view (the
      // access predicate IS the filter). Otherwise the caller's own + profile tasks.
      let scopeFilter: ReturnType<typeof or> | ReturnType<typeof eq> | undefined;
      if (eventId) {
        await requireEventCapability(request, eventId, "event.view");
        scopeFilter = eq(schema.tasks.eventId, eventId);
      } else {
        const profileIds = principal.memberships.map((m) => m.profileId);
        const ownerConditions = [eq(schema.tasks.ownerUserId, principal.userId)];
        if (profileIds.length > 0) {
          ownerConditions.push(inArray(schema.tasks.ownerProfileId, profileIds));
        }
        scopeFilter = or(...ownerConditions);
      }

      // Keyset over (created_at, id), truncated to millisecond so the JS-Date
      // round-trip stays exact (mirrors events-list). Bind cursor values as casts.
      const createdAtMillis = sql`date_trunc('milliseconds', ${schema.tasks.createdAt})`;
      const decoded = cursor ? decodeCursor<TaskCursor>(cursor) : null;
      const afterCursor = decoded
        ? sql`(${createdAtMillis}, ${schema.tasks.id}) > (${decoded.createdAt}::timestamptz, ${decoded.id}::uuid)`
        : undefined;

      const rows = await database
        .select()
        .from(schema.tasks)
        .where(
          and(
            scopeFilter,
            completed !== undefined ? eq(schema.tasks.completed, completed === "true") : undefined,
            groupId ? eq(schema.tasks.groupId, groupId) : undefined,
            afterCursor,
          ),
        )
        .orderBy(asc(createdAtMillis), asc(schema.tasks.id))
        .limit(limit + 1);

      const { items, nextCursor } = paginate(rows, limit, (task) => ({
        createdAt: task.createdAt.toISOString(),
        id: task.id,
      }));
      return { items: items.map(serializeTask), nextCursor };
    },
  );

  // Create a task in a personal / profile / event scope, plus any reminders.
  app.post(
    "/tasks",
    { schema: { body: CreateTaskBody, response: { 201: TaskResponse } } },
    async (request, reply) => {
      const { database } = request.server;
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");
      const body = request.body;

      // Default to a personal task unless it is explicitly profile-scoped.
      const ownerUserId = body.ownerUserId ?? (body.ownerProfileId ? null : principal.userId);
      await assertMayWriteScope(request, {
        ownerUserId,
        ownerProfileId: body.ownerProfileId,
        eventId: body.eventId,
      });
      if (body.groupId) await assertMayUseGroup(request, body.groupId);

      const created = await database.transaction(async (tx) => {
        const [task] = await tx
          .insert(schema.tasks)
          .values({
            eventId: body.eventId ?? null,
            ownerProfileId: body.ownerProfileId ?? null,
            ownerUserId,
            groupId: body.groupId ?? null,
            title: body.title,
            description: body.description ?? null,
            dueDate: body.dueDate ?? null,
            budgetType: body.budgetType ?? null,
            budgetAmount: body.budgetAmount != null ? BigInt(body.budgetAmount) : null,
            createdBy: principal.userId,
          })
          .returning();
        if (!task) throw new Error("task create failed");

        if (body.reminders && body.reminders.length > 0) {
          await tx.insert(schema.taskReminders).values(
            body.reminders.map((reminder) => ({
              taskId: task.id,
              date: reminder.date,
              time: reminder.time ?? null,
              label: reminder.label ?? null,
            })),
          );
        }

        const serialized = serializeTask(task);
        await writeAudit(tx, request, {
          capability: "profile.edit",
          action: "task.create",
          targetKind: "task",
          targetId: task.id,
          eventId: task.eventId ?? undefined,
          after: serialized,
        });
        // ONLY an event-scoped task is event history. A personal or profile task is
        // the owner's own list and has no event to belong to — writing it with a
        // null `event_id` would put it in a feed nobody can scope and nobody reads.
        //
        // `budgetAmount` is deliberately absent from the summary: kind `task` sits
        // at the `event.view` tier, which is where a `view_only` participant lives,
        // and a task budget is a figure.
        if (task.eventId) {
          await writeActivity(tx, request, {
            eventId: task.eventId,
            type: "task.created",
            targetKind: "task",
            targetId: task.id,
            summary: { title: task.title, dueDate: task.dueDate ?? null },
          });
        }
        return serialized;
      });

      return reply.status(201).send(created);
    },
  );

  // Update — completing a task stamps `completed_at`; clearing it unsets it.
  app.patch(
    "/tasks/:id",
    { schema: { params: TaskParams, body: UpdateTaskBody, response: { 200: TaskResponse } } },
    async (request) => {
      const { database } = request.server;
      const { id } = request.params;
      const before = await loadAccessibleTask(request, id);
      const body = request.body;

      const fields: Partial<typeof schema.tasks.$inferInsert> = { updatedAt: new Date() };
      if (body.title !== undefined) fields.title = body.title;
      if (body.description !== undefined) fields.description = body.description;
      if (body.dueDate !== undefined) fields.dueDate = body.dueDate;
      if (body.budgetAmount !== undefined) {
        fields.budgetAmount = body.budgetAmount != null ? BigInt(body.budgetAmount) : null;
      }
      if (body.completed !== undefined) {
        fields.completed = body.completed;
        fields.completedAt = body.completed ? new Date() : null;
      }
      if (body.groupId !== undefined) {
        if (body.groupId) await assertMayUseGroup(request, body.groupId);
        fields.groupId = body.groupId;
      }

      const updated = await database.transaction(async (tx) => {
        const [after] = await tx
          .update(schema.tasks)
          .set(fields)
          .where(eq(schema.tasks.id, id))
          .returning();
        if (!after) throw notFound("Task not found");
        const serialized = serializeTask(after);
        await writeAudit(tx, request, {
          capability: "profile.edit",
          action: "task.update",
          targetKind: "task",
          targetId: id,
          eventId: after.eventId ?? undefined,
          before: serializeTask(before),
          after: serialized,
        });
        if (after.eventId) {
          // Completion is the headline — "is the backline booked yet?" is the
          // question the list exists to answer, so it gets its own type rather
          // than hiding inside a field list.
          const completionChanged = before.completed !== after.completed;
          const changed = TRACKED_TASK_FIELDS.filter(
            (field) => String(before[field] ?? "") !== String(after[field] ?? ""),
          );
          if (completionChanged || changed.length > 0) {
            await writeActivity(tx, request, {
              eventId: after.eventId,
              type: completionChanged
                ? after.completed
                  ? "task.completed"
                  : "task.reopened"
                : "task.updated",
              targetKind: "task",
              targetId: id,
              summary: { title: after.title, fields: changed },
            });
          }
        }
        return serialized;
      });

      return updated;
    },
  );

  // Delete — reminders cascade via the FK.
  app.delete(
    "/tasks/:id",
    { schema: { params: TaskParams, response: { 200: DeleteResponse } } },
    async (request) => {
      const { database } = request.server;
      const { id } = request.params;
      const before = await loadAccessibleTask(request, id);

      await database.transaction(async (tx) => {
        await tx.delete(schema.tasks).where(eq(schema.tasks.id, id));
        await writeAudit(tx, request, {
          capability: "profile.edit",
          action: "task.delete",
          targetKind: "task",
          targetId: id,
          eventId: before.eventId ?? undefined,
          before: serializeTask(before),
        });
        if (before.eventId) {
          await writeActivity(tx, request, {
            eventId: before.eventId,
            type: "task.deleted",
            targetKind: "task",
            targetId: id,
            summary: { title: before.title },
          });
        }
      });

      return { id, deleted: true };
    },
  );
}
