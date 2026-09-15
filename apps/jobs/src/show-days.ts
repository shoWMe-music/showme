import { type Database, schema } from "@showme/db";
import { eventParticipantRecipients, notifyUsers } from "@showme/db/notify";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";

/**
 * SHOW DAYS — the clock's half of ClickUp `123qy9rng4z`.
 *
 * Ran: *"show day is not just a status but also marks the 24h of the event date
 * and after it the event moves to concluded"*. Two things happen on their own,
 * and this is the thing that does them:
 *
 *  1. when a confirmed show's local day BEGINS, everybody on the bill is told;
 *  2. when it ENDS, the show becomes `concluded`.
 *
 * THE STATUS "SHOW DAY" IS NOT WRITTEN ANYWHERE and nothing here writes it. It
 * is true for a local day and false either side of it, so it is derived where it
 * is drawn (`apps/web/src/lib/status.ts`). What a job is genuinely needed for is
 * the two EDGES — a bell that must ring once, and a status that must actually
 * change — because neither can be computed from the row after the fact.
 *
 * ## The whole subtlety is the word "local"
 *
 * These are the first sweeps in this app that are NOT duration-based. The reapers
 * next door all expire something a fixed interval after a UTC `created_at`, which
 * docs/timezones.md notes has no zone subtlety at all. A show day has nothing
 * but: it starts at midnight WHERE THE SHOW IS. A Sydney date is eleven hours
 * into its show day while Stockholm is still on the morning before, and a sweep
 * that compared dates in the server's zone would ring Sydney's bell half a day
 * late and conclude it half a day early.
 *
 * So the boundary is computed in Postgres against each row's own stamped zone:
 *
 *     (event_date)::timestamp     AT TIME ZONE timezone   -- local midnight, opening
 *     (event_date + 1)::timestamp AT TIME ZONE timezone   -- the next one, closing
 *
 * `AT TIME ZONE` applied to a bare `timestamp` reads it AS a wall clock in that
 * zone and returns the absolute instant — which is exactly the conversion
 * `@showme/time`'s `dayBounds` does in TypeScript, done where the rows are so it
 * does not cost a round trip per event. DST is handled by the database's own
 * zone data, so a show on a 23- or 25-hour day gets a 23- or 25-hour show day
 * rather than a fixed 24 that drifts an hour twice a year.
 *
 * An event with NO zone stamped falls back to UTC. That is the same assumption
 * `serialize/event.ts` makes when it has nothing better, and it is at worst a few
 * hours out — whereas skipping those rows would mean a show never concludes.
 */

/** Local midnight opening `event_date`, as an absolute instant. */
const showDayStart = sql`(${schema.events.eventDate})::timestamp AT TIME ZONE coalesce(${schema.events.timezone}, 'UTC')`;

/** The NEXT local midnight — the exclusive end of the show day. */
const showDayEnd = sql`(${schema.events.eventDate} + 1)::timestamp AT TIME ZONE coalesce(${schema.events.timezone}, 'UTC')`;

/**
 * `now` as something Postgres will compare against a `timestamptz`.
 *
 * A bare `Date` cannot go into a raw fragment: outside a typed column context the
 * driver has nothing to infer from and throws *"the string argument must be of
 * type string … received an instance of Date"* before the query is ever sent. The
 * ISO string plus an explicit cast says what the column comparison would have
 * said implicitly, and keeps the instant in UTC on the way through.
 */
function instant(at: Date) {
  return sql`${at.toISOString()}::timestamptz`;
}

/** The columns the sweep reads off a claimed event. Nothing here is money. */
interface ClaimedShowDay {
  id: string;
  title: string;
  eventDate: string | null;
  venueName: string | null;
}

/**
 * Claim every show day that has BEGUN and not yet been rung, in one statement,
 * and return what was claimed.
 *
 * The claim is the fire-once mechanism, copied deliberately from
 * `task-reminders.ts` rather than reinvented: `show_day_notified_at` is stamped
 * inside the same UPDATE whose WHERE requires it to be null, so a second sweep —
 * overlapping, retried, or simply the next one — finds nothing to take.
 *
 * The window is bounded at BOTH ends. Starting the show day is necessary but not
 * sufficient: without the upper bound, arming this column on a table full of past
 * events would ring the bell for every show the workspace has ever played, all at
 * once, the first time the job ran. A morning that is already over is not news.
 */
async function claimStartedShowDays(database: Database, now: Date): Promise<ClaimedShowDay[]> {
  return database
    .update(schema.events)
    .set({ showDayNotifiedAt: now })
    .where(
      and(
        eq(schema.events.status, "confirmed"),
        isNotNull(schema.events.eventDate),
        isNull(schema.events.showDayNotifiedAt),
        sql`${showDayStart} <= ${instant(now)}`,
        sql`${showDayEnd} > ${instant(now)}`,
      ),
    )
    .returning({
      id: schema.events.id,
      title: schema.events.title,
      eventDate: schema.events.eventDate,
      venueName: schema.events.venueName,
    });
}

/**
 * The bell's own words.
 *
 * Named by the VENUE where there is one, for the same reason a performer's
 * calendar is (ClickUp `123qy9rnfa4`): an operator titles a show after the act,
 * so "Marlo Vance — Album Release" tells the act nothing they do not know, and
 * the room is the fact they actually need this morning.
 *
 * `event.showday` puts it in the existing `events` notification category, which
 * is in-app by default and does not mail. That is the right dial: this is a
 * heads-up on a date already in the reader's calendar, not a thing they can lose
 * money by missing.
 */
function showDayNotification(event: ClaimedShowDay) {
  return {
    type: "event.showday",
    title: "Show day",
    body: event.venueName?.trim()
      ? `${event.title} is tonight at ${event.venueName.trim()}.`
      : `${event.title} is tonight.`,
    eventId: event.id,
    link: `/events/${event.id}`,
  };
}

/**
 * Ring the bell for every show day that has just begun. Returns how many EVENTS
 * were announced, not how many notifications were written — one show reaches
 * everybody on its bill.
 *
 * `actorUserId` is null: nobody did this, the clock did. `notifyUsers` excludes
 * the actor, and there is no actor to exclude.
 *
 * WHO HEARS IT: everybody participating in the event, via the same
 * `eventParticipantRecipients` rule the rest of the app uses for anything
 * event-wide — and NOT `operatorsOnly`. This is the one kind of event news where
 * the performer is the primary audience rather than a bystander: it is their
 * night. Nothing in the payload is party-scoped, so there is nothing here to
 * leak between the parties on a bill.
 *
 * Per-event try/catch so one undeliverable bell does not cost the rest of the run
 * theirs. A throw loses that one announcement for good, since the row is already
 * claimed — the same at-most-once trade migration 0028 argues for reminders, and
 * the right side of it: a doubled "tonight!" is worse than a missed one.
 */
export async function ringStartedShowDays(database: Database, now: Date): Promise<number> {
  const claimed = await claimStartedShowDays(database, now);
  if (claimed.length === 0) return 0;

  let rung = 0;
  for (const event of claimed) {
    try {
      const userIds = await eventParticipantRecipients(database, event.id, null);
      if (userIds.length === 0) continue;
      await notifyUsers(database, userIds, null, showDayNotification(event));
      rung += 1;
    } catch {
      // Swallowed on purpose — see the per-event note above.
    }
  }
  return rung;
}

/**
 * Conclude every confirmed show whose local day is fully over.
 *
 * `confirmed` and nothing else, which is the whole idempotency: the second sweep
 * finds the row already `concluded` and its WHERE no longer matches. No claim
 * column is needed because the status IS the record of having run.
 *
 * It deliberately does NOT touch `cancelled`, `draft`, `suggested`, `pending` or
 * `on_hold`. A show that was called off does not become a show that happened
 * because its date went by, and a date nobody ever confirmed concluding itself
 * would quietly assert a booking that never existed. Ran's sentence is about the
 * show-day path specifically — *"show day … and after it the event moves to
 * concluded"* — and a show day only ever belongs to a confirmed show.
 *
 * `updated_at` moves but `version` does not. The optimistic lock (decisions #8)
 * guards a human editing a row against another human editing it underneath them;
 * bumping it here would invalidate an open edit form for a change the editor
 * cannot disagree with, and the status they are looking at was going to be stale
 * either way.
 */
export async function concludeFinishedShowDays(database: Database, now: Date): Promise<number> {
  const concluded = await database
    .update(schema.events)
    .set({ status: "concluded", updatedAt: now })
    .where(
      and(
        eq(schema.events.status, "confirmed"),
        isNotNull(schema.events.eventDate),
        sql`${showDayEnd} <= ${instant(now)}`,
      ),
    )
    .returning({ id: schema.events.id });
  return concluded.length;
}
