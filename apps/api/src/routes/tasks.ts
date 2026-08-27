import type { Database } from "@showme/db";
import { schema } from "@showme/db";
import { and, asc, eq, inArray, ne, or, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { badRequest, forbidden, notFound } from "../errors";
import { writeActivity } from "../lib/activity";
import { type Transaction, writeAudit } from "../lib/audit";
import { eventCapabilities, requireEventCapability } from "../lib/authorize";
import { PaginationQuery, decodeCursor, paginate } from "../lib/pagination";

const TaskParams = z.object({ id: z.string().uuid() });

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
  // The ONE person who owes this task, as an `event_participants` row — see
  // `assertMayAssignParticipant`. A work-group and an assignee are different
  // acts: the group says which team it belongs to, the assignee says who does it.
  assigneeParticipantId: z.string().uuid().optional(),
  budgetType: z.string().optional(),
  budgetAmount: z.string().min(1).optional(),
  // An ABSOLUTE instant, ISO-8601 (`schema.tasks.remindAt` explains why it is not
  // an offset from `dueDate`). The client resolves the wall-clock the user picked
  // in the user's own zone; the API stores the moment, never the wall-clock.
  remindAt: z.string().datetime().optional(),
});

const UpdateTaskBody = z.object({
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  completed: z.boolean().optional(),
  dueDate: z.string().min(1).nullable().optional(),
  groupId: z.string().uuid().nullable().optional(),
  /** Null hands the task back to nobody in particular — an explicit unassign. */
  assigneeParticipantId: z.string().uuid().nullable().optional(),
  budgetAmount: z.string().min(1).nullable().optional(),
  /** A new instant re-arms the reminder; null takes it off entirely. */
  remindAt: z.string().datetime().nullable().optional(),
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
  assigneeParticipantId: z.string().nullable(),
  /** The assignee's display name, joined through the participant's profile — an
   * id alone leaves a screen with nothing to render but a UUID (the same reason
   * calendar items carry `assigneeName`, and participants carry `name`). */
  assigneeName: z.string().nullable(),
  title: z.string(),
  description: z.string().nullable(),
  completed: z.boolean(),
  completedAt: z.string().nullable(),
  dueDate: z.string().nullable(),
  remindAt: z.string().nullable(),
  /** When the sweep rang this reminder. Non-null ⇒ it has fired and will not again. */
  remindedAt: z.string().nullable(),
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

/**
 * Response projection — bigint money → STRING, timestamps → ISO (money.md boundary).
 *
 * `assigneeName` is not on the row: it is the participant's profile name, read
 * through the join the caller already had to make, and passed in rather than
 * fetched here so a list serializes in one query instead of one per task.
 */
function serializeTask(task: TaskRow, assigneeName: string | null): z.infer<typeof TaskResponse> {
  return {
    id: task.id,
    eventId: task.eventId,
    ownerProfileId: task.ownerProfileId,
    ownerUserId: task.ownerUserId,
    groupId: task.groupId,
    assigneeParticipantId: task.assigneeParticipantId,
    assigneeName: task.assigneeParticipantId ? assigneeName : null,
    title: task.title,
    description: task.description,
    completed: task.completed,
    completedAt: task.completedAt ? task.completedAt.toISOString() : null,
    dueDate: task.dueDate,
    remindAt: task.remindAt ? task.remindAt.toISOString() : null,
    remindedAt: task.remindedAt ? task.remindedAt.toISOString() : null,
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
 * The display name behind `tasks.assignee_participant_id` — the participant's
 * profile name, or null when nobody is assigned. `profiles.name` is NOT NULL, so
 * an inner join either produces a name or produces nothing (a participant row
 * whose profile vanished is not a person this screen can name).
 */
async function assigneeNameOf(
  executor: Database | Transaction,
  participantId: string | null,
): Promise<string | null> {
  if (!participantId) return null;
  const [row] = await executor
    .select({ name: schema.profiles.name })
    .from(schema.eventParticipants)
    .innerJoin(schema.profiles, eq(schema.profiles.id, schema.eventParticipants.profileId))
    .where(eq(schema.eventParticipants.id, participantId));
  return row?.name ?? null;
}

/**
 * THE ASSIGNEE RULE: a task may only be handed to somebody who is ON the event
 * that task belongs to, and who has not been removed from it.
 *
 * Why event membership is the whole rule: `event_participants` IS the app's
 * "who can see this show" join (`lib/authorize.ts` resolves event capabilities
 * through it), so a participant row on this event is, by construction, a person
 * entitled to read the event the task hangs off. Assigning outside it would put
 * a stranger's name on a task inside a workspace they cannot open — and would
 * leak, to the assignee's own screens later, that the show exists at all.
 *
 * A REMOVED participant is refused too. Their row is kept for history, not as a
 * standing address; handing them new work would be assigning it to somebody the
 * host has already taken off the show.
 *
 * A TASK WITH NO EVENT (a personal or profile task) cannot be assigned at all,
 * and that is a 400 rather than a silent null. The column is a foreign key into
 * `event_participants`, so the only people it can name are people on some event;
 * pointing a personal task at a participant of an unrelated show would assert a
 * relationship that does not exist. A personal task already has an owner — the
 * person whose list it is on — and a profile task belongs to the profile's
 * members (`docs/story.md`: the profile's shared pile). Assigning an account
 * member by name needs a column that can hold one (`assignee_user_id`), not a
 * misuse of this one.
 *
 * Returns the assignee's display name so the caller does not re-query for it.
 */
async function assertMayAssignParticipant(
  request: FastifyRequest,
  eventId: string | null,
  participantId: string,
): Promise<string> {
  if (!eventId) {
    throw badRequest("Only a task on an event can be assigned to a participant");
  }
  const [row] = await request.server.database
    .select({ name: schema.profiles.name })
    .from(schema.eventParticipants)
    .innerJoin(schema.profiles, eq(schema.profiles.id, schema.eventParticipants.profileId))
    .where(
      and(
        eq(schema.eventParticipants.id, participantId),
        eq(schema.eventParticipants.eventId, eventId),
        ne(schema.eventParticipants.status, "removed"),
      ),
    );
  // 404, not 403: a participant of some other event is not this caller's
  // business to have confirmed the existence of.
  if (!row) throw notFound("That person is not on this event");
  return row.name;
}

/**
 * The task fields whose movement is worth a history line. Names only — `budgetAmount`
 * is money and stays out of a summary (`lib/activity.ts`), and `description` is free
 * text an event-wide feed has no business echoing.
 */
// `remindAt` is deliberately absent: a reminder is the private nudge one person
// set for themselves, not a fact about the show, and an event-wide feed line every
// time somebody re-snoozed their own alarm is noise the To Do tab does not need.
// It is still in the audit trail's before/after like every other column.
const TRACKED_TASK_FIELDS = [
  "title",
  "dueDate",
  "groupId",
  "assigneeParticipantId",
  "budgetAmount",
] as const;

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

      // The assignee's name comes along on the same query — two LEFT joins, not a
      // lookup per row: tasks → the participant it names → that participant's
      // profile. Left, because most tasks name nobody and must still be listed.
      const rows = await database
        .select({ task: schema.tasks, assigneeName: schema.profiles.name })
        .from(schema.tasks)
        .leftJoin(
          schema.eventParticipants,
          eq(schema.eventParticipants.id, schema.tasks.assigneeParticipantId),
        )
        .leftJoin(schema.profiles, eq(schema.profiles.id, schema.eventParticipants.profileId))
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

      const { items, nextCursor } = paginate(rows, limit, (row) => ({
        createdAt: row.task.createdAt.toISOString(),
        id: row.task.id,
      }));
      return {
        items: items.map((row) => serializeTask(row.task, row.assigneeName)),
        nextCursor,
      };
    },
  );

  // Create a task in a personal / profile / event scope.
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
      const assigneeName = body.assigneeParticipantId
        ? await assertMayAssignParticipant(
            request,
            body.eventId ?? null,
            body.assigneeParticipantId,
          )
        : null;

      const created = await database.transaction(async (tx) => {
        const [task] = await tx
          .insert(schema.tasks)
          .values({
            eventId: body.eventId ?? null,
            ownerProfileId: body.ownerProfileId ?? null,
            ownerUserId,
            groupId: body.groupId ?? null,
            assigneeParticipantId: body.assigneeParticipantId ?? null,
            title: body.title,
            description: body.description ?? null,
            dueDate: body.dueDate ?? null,
            remindAt: body.remindAt ? new Date(body.remindAt) : null,
            budgetType: body.budgetType ?? null,
            budgetAmount: body.budgetAmount != null ? BigInt(body.budgetAmount) : null,
            createdBy: principal.userId,
          })
          .returning();
        if (!task) throw new Error("task create failed");

        const serialized = serializeTask(task, assigneeName);
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
      // Setting a reminder RE-ARMS it: `reminded_at` goes back to null, so the
      // sweep will ring an instant the user has just moved even if the previous
      // one already fired. Without this, "remind me again tomorrow" would be
      // stored and then silently ignored — the fire-once mark outliving the
      // reminder it was about. Clearing to null disarms it the same way.
      if (body.remindAt !== undefined) {
        fields.remindAt = body.remindAt ? new Date(body.remindAt) : null;
        fields.remindedAt = null;
      }
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
      // The assignee is checked against the event the task ALREADY belongs to —
      // `eventId` is not patchable here (a task does not move between events), so
      // `before.eventId` is the event both the caller and the assignee are on.
      if (body.assigneeParticipantId !== undefined) {
        if (body.assigneeParticipantId) {
          await assertMayAssignParticipant(request, before.eventId, body.assigneeParticipantId);
        }
        fields.assigneeParticipantId = body.assigneeParticipantId;
      }

      const updated = await database.transaction(async (tx) => {
        const [after] = await tx
          .update(schema.tasks)
          .set(fields)
          .where(eq(schema.tasks.id, id))
          .returning();
        if (!after) throw notFound("Task not found");
        const serialized = serializeTask(
          after,
          await assigneeNameOf(tx, after.assigneeParticipantId),
        );
        await writeAudit(tx, request, {
          capability: "profile.edit",
          action: "task.update",
          targetKind: "task",
          targetId: id,
          eventId: after.eventId ?? undefined,
          before: serializeTask(before, await assigneeNameOf(tx, before.assigneeParticipantId)),
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

  // Delete.
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
          before: serializeTask(before, await assigneeNameOf(tx, before.assigneeParticipantId)),
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
