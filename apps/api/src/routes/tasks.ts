import type { Database } from "@showme/db";
import { schema } from "@showme/db";
import { notifyProfileMembers } from "@showme/db/notify";
import { and, asc, eq, inArray, ne, or, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { badRequest, forbidden, notFound } from "../errors";
import { writeActivity } from "../lib/activity";
import { type Transaction, writeAudit } from "../lib/audit";
import { eventCapabilities, requireEventCapability } from "../lib/authorize";
import { renderNotificationEmail } from "../lib/email-templates";
import { PaginationQuery, decodeCursor, paginate } from "../lib/pagination";

const TaskParams = z.object({ id: z.string().uuid() });

// `budgetAmount` arrives as a STRING and is parsed to bigint minor units
// (money.md) — never a JS number, which loses precision past 2^53.
/**
 * Ran's four words, in his order (ClickUp `123qy9rnk29`). Declared once and used
 * by the create body, the update body and the response, so the three can never
 * drift into accepting different spellings of the same idea.
 */
const TaskPriority = z.enum(["urgent", "high", "normal", "low"]);

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
  /** Urgent / high / normal / low, or absent for untagged (ClickUp `123qy9rnk29`). */
  priority: TaskPriority.optional(),
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
  /** Null takes the tag off entirely, back to untagged. */
  priority: TaskPriority.nullable().optional(),
  budgetAmount: z.string().min(1).nullable().optional(),
  /** A new instant re-arms the reminder; null takes it off entirely. */
  remindAt: z.string().datetime().nullable().optional(),
});

const ListQuery = PaginationQuery.extend({
  completed: z.enum(["true", "false"]).optional(),
  groupId: z.string().uuid().optional(),
  /** Scope to one event's to-do list (gated by `event.view`, not owner). */
  eventId: z.string().uuid().optional(),
  /**
   * HOW TO RANK THEM (ClickUp `123qy9rnk27`, the Dashboard's *"top 5 tasks by
   * priority and by time/date"*).
   *
   * `created` is the default and the only PAGEABLE order — the keyset cursor is
   * `(created_at, id)`, which is what makes walking the list stable while rows
   * are being added underneath it.
   *
   * `priority` answers a different question: not "give me the next page" but
   * "give me the few that matter most". It sorts by tag, then by due date, then
   * by age, and deliberately returns **no cursor** — see the handler. Sorting
   * this in the browser instead would rank only the page already loaded, so the
   * urgent task sitting at position 40 would never reach the Dashboard's top
   * five, which is the entire point of the card.
   */
  order: z.enum(["created", "priority"]).optional().default("created"),
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
  /** Urgent / high / normal / low, or null for untagged. */
  priority: TaskPriority.nullable(),
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
    priority: task.priority,
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
/**
 * Returns the assignee's NAME and PROFILE. The profile is what
 * `notifyProfileMembers` addresses, so that handing somebody a job can tell them
 * (ClickUp `123qy9rnk3k`) — and it comes off the join this check already does
 * rather than a second query for a row just looked at.
 */
async function assertMayAssignParticipant(
  request: FastifyRequest,
  eventId: string | null,
  participantId: string,
): Promise<{ name: string; profileId: string }> {
  if (!eventId) {
    throw badRequest("Only a task on an event can be assigned to a participant");
  }
  const [row] = await request.server.database
    .select({ name: schema.profiles.name, profileId: schema.profiles.id })
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
  return row;
}

/**
 * TELL SOMEBODY THEY HAVE BEEN HANDED A JOB (ClickUp `123qy9rnk3k`).
 *
 * Ran asked for *"an email notification to the team/crew member"* for task
 * notifications — and the finding underneath the ticket is that there was no task
 * notification of any kind to add an email to. `POST /tasks` and `PATCH /tasks/:id`
 * wrote an audit row and an event-history line and told the assignee nothing, so a
 * crew member learned they owed work by opening the app and looking. This is both
 * halves at once: the bell, and the mail beside it.
 *
 * ADDRESSED TO THE ASSIGNEE'S PROFILE, not to one person, because that is how the
 * rest of the app addresses somebody — a task handed to a band reaches the band
 * (`notifyProfileMembers`), and a crew company's members are the people who do the
 * work. `notifyUsers` drops the actor, so assigning a task to yourself is silent.
 *
 * NOBODY ELSE HEARS IT. A to-do is one party's slice of the show; broadcasting
 * "chase the rider" to every profile on the bill would tell a performer what the
 * promoter is behind on, which is the line story.md draws. The same reasoning is
 * written out at length over the reminder sweep's recipient rule, and this is the
 * same rule.
 *
 * Best-effort and logged: a task that was written must not fail because a mail
 * server was slow.
 */
async function announceAssignment(
  request: FastifyRequest,
  task: { id: string; title: string; eventId: string | null; dueDate: string | null },
  assignee: { name: string; profileId: string },
): Promise<void> {
  try {
    const { database } = request.server;
    const [event] = task.eventId
      ? await database
          .select({
            id: schema.events.id,
            title: schema.events.title,
            eventDate: schema.events.eventDate,
            venueName: schema.events.venueName,
          })
          .from(schema.events)
          .where(eq(schema.events.id, task.eventId))
      : [];
    const handedBy = request.firebaseUser?.name ?? "Someone";
    const due = task.dueDate ? ` Due ${task.dueDate}.` : "";

    await notifyProfileMembers(
      database,
      assignee.profileId,
      request.principal?.userId ?? null,
      {
        type: "task.assigned",
        title: "You have a new task",
        // The TITLE of the task travels, because a task is its title — a bell
        // saying only "a task" is a bell that costs a trip to find out what.
        // The description does not: it is free text on one party's slice.
        body: event
          ? `${handedBy} gave you "${task.title}" on ${event.title}.${due}`
          : `${handedBy} gave you "${task.title}".${due}`,
        eventId: task.eventId ?? undefined,
        actorDisplay: request.firebaseUser?.name ?? undefined,
        // A bare event path. Which TAB it opens is derived from the type by
        // `notificationDestination` (ClickUp `86cbcgq5f`), which maps
        // `task.assigned` to the To Do list — the job is read where the rest of
        // the show's jobs are.
        link: task.eventId ? `/events/${task.eventId}` : "/tasks",
      },
      event
        ? {
            sink: request.server.emailSink,
            message: renderNotificationEmail({
              subject: `New task: ${task.title}`,
              preheader: `${handedBy} handed you a job on ${event.title}.`,
              heading: "You have a new task",
              paragraphs: [
                `${handedBy} gave you "${task.title}" on ${event.title}.${due}`,
                "Open the event's To Do list to see the detail, mark it done, or hand it on.",
              ],
              event,
              action: { label: "Open the to-do list", path: `/events/${event.id}` },
            }),
          }
        : undefined,
    );
  } catch (error) {
    request.log.error({ error, taskId: task.id }, "task assignment notification failed");
  }
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
      const { cursor, limit, completed, groupId, eventId, order } = request.query;

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

      /**
       * THE RANKING, in SQL, so it is the same one however few rows the caller
       * asked for (`123qy9rnk27`).
       *
       * `array_position(enum_range(...))` reads the ORDER THE TYPE WAS DECLARED IN
       * — urgent, high, normal, low — instead of a CASE that has to be edited
       * every time the enum gains a value. `NULLS LAST` puts untagged below
       * `low`: a job nobody has triaged should not outrank one somebody called
       * unimportant. The due date breaks a tie, with undated after dated, because
       * "urgent, by Friday" is more actionable than "urgent, someday".
       */
      const orderBy =
        order === "priority"
          ? [
              sql`array_position(enum_range(null::task_priority), ${schema.tasks.priority}) nulls last`,
              sql`${schema.tasks.dueDate} asc nulls last`,
              asc(createdAtMillis),
              asc(schema.tasks.id),
            ]
          : [asc(createdAtMillis), asc(schema.tasks.id)];

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
        .orderBy(...orderBy)
        .limit(limit + 1);

      /**
       * A RANKED HEAD OF THE LIST DOES NOT PAGINATE, and says so by returning no
       * cursor rather than by returning a cursor that would quietly skip rows.
       *
       * The keyset is `(created_at, id)`; under the priority ordering the next
       * page's boundary is a composite of tag, due date and age, which that
       * cursor cannot express. Handing back a `created_at` cursor here would walk
       * the caller into a second page ordered by one rule and filtered by
       * another — rows missed, rows repeated, and nothing to tell them apart.
       *
       * `order=priority` is for "the five that matter most", which is one page by
       * construction.
       */
      if (order === "priority") {
        const ranked = rows.slice(0, limit);
        return {
          items: ranked.map((row) => serializeTask(row.task, row.assigneeName)),
          nextCursor: null,
        };
      }

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
      const assignee = body.assigneeParticipantId
        ? await assertMayAssignParticipant(
            request,
            body.eventId ?? null,
            body.assigneeParticipantId,
          )
        : null;
      const assigneeName = assignee?.name ?? null;

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
            priority: body.priority ?? null,
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

      // AFTER the commit, never inside it: delivery is best-effort by contract
      // (`@showme/db/notify`) and a wobble on the mail path must not roll back a
      // task somebody just wrote.
      if (assignee) await announceAssignment(request, created, assignee);

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
      // `undefined` leaves the tag alone, `null` takes it off — the same
      // three-state convention `assigneeParticipantId` and `remindAt` use, so a
      // PATCH that says nothing about priority never silently untags a task.
      if (body.priority !== undefined) fields.priority = body.priority;
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
      // Only a NEW assignee is announced. Re-saving a task that was already
      // theirs, or editing its title, must not ring the same bell again — and an
      // unassign (`null`) tells nobody, because "you no longer owe this" is not
      // news somebody needs mailed.
      let newAssignee: { name: string; profileId: string } | null = null;
      if (body.assigneeParticipantId !== undefined) {
        if (body.assigneeParticipantId) {
          const assignee = await assertMayAssignParticipant(
            request,
            before.eventId,
            body.assigneeParticipantId,
          );
          if (body.assigneeParticipantId !== before.assigneeParticipantId) newAssignee = assignee;
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

      if (newAssignee) await announceAssignment(request, updated, newAssignee);

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
