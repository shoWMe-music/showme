import { type Database, schema } from "@showme/db";
import { and, eq, inArray, isNotNull, isNull, lte } from "drizzle-orm";
// CROSSING AN APP BOUNDARY ON PURPOSE, AND ONLY THIS FAR.
//
// `notifyUsers` is where the notification-preference gate lives, and the comment
// on it is emphatic about why: "a route cannot forget to honour a preference,
// because honouring it is not a thing a route does". A sweep is no different. The
// alternative was a second copy of the gate here, which is precisely the drift
// that argument exists to prevent — one of the two copies would eventually stop
// agreeing with the settings screen, and nobody would find out.
//
// It costs nothing at runtime: `notify.ts` imports `@showme/db`, `drizzle-orm`
// and `./publish` (also db-only); its `./email` and `./email-templates` imports
// are type-only and erase. No Fastify comes with it.
//
// THE PROPER HOME IS `@showme/db`, beside `representation-termination.ts`, which
// was carved out for exactly this reason — "apps/jobs and apps/api are sibling
// apps that must run the byte-identical effect, and this package is the only
// module both already depend on". Moving `notify.ts` there touches every route
// that emits, so it is a change of its own rather than a passenger on this one.
import { notifyUsers } from "../../api/src/lib/notify";

/**
 * TASK REMINDERS — the sweep half (ClickUp 86cbaxxu1).
 *
 * `tasks.remind_at` is an absolute instant the user asked to be spoken to at, and
 * this is the thing that speaks. In production Cloud Scheduler runs it with the
 * rest of `apps/jobs`; locally nothing does, so `pnpm jobs:run` is how a
 * developer converges it by hand.
 *
 * The GOOGLE TASKS half Ran asked for next is not here and is not started. When
 * it is, it hangs off the same column: `remind_at` is already the RFC-3339 moment
 * Google Tasks stores, so the sync is a copy rather than a translation, and it
 * will want an `external_id` per task the way `calendar_items` has one, plus the
 * OAuth token storage the calendar integration already models
 * (`calendar_connections`, sealed key, 0012).
 */

/** The columns the sweep reads off a claimed task. Nothing here is money. */
interface ClaimedTask {
  id: string;
  title: string;
  dueDate: string | null;
  eventId: string | null;
  ownerUserId: string | null;
  ownerProfileId: string | null;
  assigneeParticipantId: string | null;
}

/**
 * Claim every reminder that has come due, in ONE statement, and return what was
 * claimed.
 *
 * The claim IS the fire-once mechanism. `reminded_at` is stamped inside the same
 * UPDATE whose WHERE requires it to be null, so a second sweep — overlapping,
 * retried, or simply the next one five minutes later — finds nothing to take.
 * Notifying first and stamping after would be at-least-once and would re-ring the
 * bell on every pass until the stamp landed; this is at-most-once, and the
 * trade-off is argued in migration 0028.
 *
 * A COMPLETED task is skipped. The work is done; a nudge about it is an
 * interruption that can only be dismissed. It is still stamped, so the reminder
 * does not lie in wait to fire the moment somebody reopens the task.
 */
async function claimDueReminders(database: Database, now: Date): Promise<ClaimedTask[]> {
  return database
    .update(schema.tasks)
    .set({ remindedAt: now })
    .where(
      and(
        isNotNull(schema.tasks.remindAt),
        lte(schema.tasks.remindAt, now),
        isNull(schema.tasks.remindedAt),
      ),
    )
    .returning({
      id: schema.tasks.id,
      title: schema.tasks.title,
      dueDate: schema.tasks.dueDate,
      eventId: schema.tasks.eventId,
      ownerUserId: schema.tasks.ownerUserId,
      ownerProfileId: schema.tasks.ownerProfileId,
      assigneeParticipantId: schema.tasks.assigneeParticipantId,
      completed: schema.tasks.completed,
    })
    .then((rows) => rows.filter((row) => !row.completed));
}

/**
 * WHO HEARS A TASK REMINDER: the owner AND the assignee, and nobody else.
 *
 * Both, because they are two different stakes in the same task and story.md
 * separates them. The ASSIGNEE is the one person who owes the work — a reminder
 * that never reaches the hands doing the job is not a reminder. The OWNER is
 * whose list it sits on and, for an event task, the operator who "runs the show"
 * and takes the residual: they carry this event's risk, so a task slipping is
 * their exposure whether or not they handed it to somebody. Reminding only the
 * assignee would take the operator's own alarm away from them; reminding only the
 * owner would make the assignee field decorative.
 *
 * And NOBODY ELSE — explicitly not `eventParticipantRecipients`. A to-do is one
 * party's slice of the show, and broadcasting "chase the rider" to every profile
 * on the bill tells a performer what the promoter is behind on. story.md's
 * through-line is that each party sees only their slice; a reminder is not an
 * announcement.
 *
 * An owner or assignee expressed as a PROFILE resolves to that profile's active
 * on-platform members, which is how the rest of the app addresses a profile
 * (`notifyProfileMembers`): a band's task reaches the band.
 *
 * Batched into two queries for the whole sweep rather than two per task — the
 * claimed set is small but unbounded, and a reminder storm must not become a
 * query storm.
 */
async function recipientsByTask(
  database: Database,
  tasks: readonly ClaimedTask[],
): Promise<Map<string, string[]>> {
  const participantIds = [
    ...new Set(tasks.map((task) => task.assigneeParticipantId).filter((id) => id !== null)),
  ];
  const participantProfiles = participantIds.length
    ? await database
        .select({ id: schema.eventParticipants.id, profileId: schema.eventParticipants.profileId })
        .from(schema.eventParticipants)
        .where(inArray(schema.eventParticipants.id, participantIds))
    : [];
  const profileOfParticipant = new Map(
    participantProfiles.map((row) => [row.id, row.profileId] as const),
  );

  const profileIds = [
    ...new Set([
      ...tasks.map((task) => task.ownerProfileId).filter((id) => id !== null),
      ...profileOfParticipant.values(),
    ]),
  ];
  const members = profileIds.length
    ? await database
        .select({
          profileId: schema.profileMembers.profileId,
          userId: schema.profileMembers.userId,
        })
        .from(schema.profileMembers)
        .where(
          and(
            inArray(schema.profileMembers.profileId, profileIds),
            eq(schema.profileMembers.status, "active"),
            isNotNull(schema.profileMembers.userId),
          ),
        )
    : [];
  const usersOfProfile = new Map<string, string[]>();
  for (const member of members) {
    if (!member.userId) continue;
    const existing = usersOfProfile.get(member.profileId);
    if (existing) existing.push(member.userId);
    else usersOfProfile.set(member.profileId, [member.userId]);
  }

  const byTask = new Map<string, string[]>();
  for (const task of tasks) {
    const recipients = new Set<string>();
    if (task.ownerUserId) recipients.add(task.ownerUserId);
    if (task.ownerProfileId) {
      for (const userId of usersOfProfile.get(task.ownerProfileId) ?? []) recipients.add(userId);
    }
    const assigneeProfileId = task.assigneeParticipantId
      ? profileOfParticipant.get(task.assigneeParticipantId)
      : undefined;
    if (assigneeProfileId) {
      for (const userId of usersOfProfile.get(assigneeProfileId) ?? []) recipients.add(userId);
    }
    byTask.set(task.id, [...recipients].sort());
  }
  return byTask;
}

/** The bell's own words. No money and no note body — a title is what a task IS. */
function reminderNotification(task: ClaimedTask) {
  return {
    type: "task.reminder",
    title: `Reminder: ${task.title}`,
    body: task.dueDate ? `Due ${task.dueDate}.` : "You asked to be reminded about this.",
    eventId: task.eventId ?? undefined,
    // An event task belongs on its workspace's To Do tab; anything else is on the
    // Tasks screen, which is the only place a personal or profile task appears.
    link: task.eventId ? `/events/${task.eventId}` : "/tasks",
  };
}

/**
 * Ring every reminder that has come due. Returns how many tasks were reminded
 * about (not how many notifications were written — one task can reach a band).
 *
 * `actorUserId` is null: nobody did this, the clock did. That also matters for
 * delivery — `notifyUsers` excludes the actor, and the whole point of a reminder
 * is that it reaches the person who set it.
 *
 * Per-task try/catch so one undeliverable reminder does not cost the rest of the
 * run theirs. A throw here loses that one reminder for good (it is already
 * claimed) — see the at-most-once argument in migration 0028.
 */
export async function sweepDueTaskReminders(database: Database, now: Date): Promise<number> {
  const claimed = await claimDueReminders(database, now);
  if (claimed.length === 0) return 0;

  const recipients = await recipientsByTask(database, claimed);
  let reminded = 0;
  for (const task of claimed) {
    const userIds = recipients.get(task.id) ?? [];
    if (userIds.length === 0) continue;
    try {
      await notifyUsers(database, userIds, null, reminderNotification(task));
      reminded += 1;
    } catch (error) {
      console.error(`task reminder ${task.id} failed:`, error);
    }
  }
  return reminded;
}
