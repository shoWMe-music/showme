import { STANDING_PARTICIPANT_STATUSES } from "@showme/auth";
import type { Database } from "@showme/db";
import { schema } from "@showme/db";
import { WHOLE_VENUE, isDateTaken, occupiedDates } from "@showme/shared";
import { and, eq, gte, inArray, isNotNull, isNull, lte, ne, or } from "drizzle-orm";

/**
 * WHEN IS A PROFILE BUSY — one answer, computed from two sources.
 *
 * The product rule is the user's: an imported calendar entry "blocks availability
 * for the times they are there, unless the user marks it as available anyway".
 * That is TIME-ranged. `profile_unavailability` — the only busy state that
 * existed — is DATE-ranged and has no time columns at all, so a 09:00–09:30
 * coffee had nowhere to live that did not blank out a whole bookable night.
 *
 * THE SHAPE CHOSEN: leave `profile_unavailability` exactly as it is (the
 * DELIBERATE, hand-made "I am not bookable" statement) and COMPUTE the imported
 * half from `calendar_items` at read time. Two sources, unioned here, in one
 * place both the public and the in-app read call.
 *
 * WHY NOT the two alternatives:
 *
 * - **Add nullable `start_time`/`end_time` to `profile_unavailability`.** One busy
 *   concept in one table is genuinely attractive, but on its own it changes
 *   nothing: the table would still be empty of imported entries unless something
 *   WROTE them there, which is the materialize option below wearing a different
 *   hat. It also widens the shape of a table whose whole write path is a wholesale
 *   `PUT` replace, and it would put times on manual blocks nobody asked for.
 *
 * - **Materialize imports into `profile_unavailability` on sync.** Rejected, and
 *   not on taste. (1) The only write route is `PUT /profiles/:id/unavailability`,
 *   which DELETES every row for the profile and re-inserts the body — so the next
 *   time a user edits their blocked dates by hand, every materialized import
 *   silently disappears, and the calendar keeps insisting they are free. (2) It
 *   duplicates state that already exists one table over, so every sync has to reap
 *   the rows it wrote last time or a cancelled meeting keeps you unbookable
 *   forever. (3) "Available anyway" would have to delete a derived row and then
 *   remember not to recreate it. Computing has none of these: delete the calendar
 *   entry and the block is gone; flip the flag and the block lifts; re-sync and
 *   nothing needs reaping. The `WHERE` is the rule.
 *
 * WHAT COUNTS AS BUSY, and the all-day vs timed split the user's wording implies:
 * an entry that names both a start and an end occupies exactly those hours and the
 * day stays bookable around them; an entry that does not — an all-day offsite, a
 * holiday, a multi-day festival — takes the whole day, or every day it spans.
 *
 * A half-open entry (a start with no end) is treated as ALL-DAY on purpose. The
 * two ways to be wrong are not symmetric: over-blocking costs an enquiry the user
 * can still answer, under-blocking books a show on top of an existing commitment.
 * An unknown extent gets the safe reading.
 */

/** A whole-day block, inclusive at both ends. `yyyy-mm-dd`. */
export interface BusyDateRange {
  startDate: string;
  endDate: string;
}

/** Hours taken on one day. Times are wall-clock `HH:MM:SS`, as stored. */
export interface BusyTimeWindow {
  date: string;
  startTime: string;
  endTime: string;
}

/**
 * Everything that makes a profile unbookable, split by how precise it is.
 * Deliberately carries NO title, reason, provider or id — see `routes/public.ts`
 * for what that withholding is for.
 */
export interface BusyTime {
  dateRanges: BusyDateRange[];
  timeWindows: BusyTimeWindow[];
}

/** The columns the rule below actually reads — so callers can pass plain rows. */
export interface BusyCandidateItem {
  type: string;
  date: string;
  endDate: string | null;
  startTime: string | null;
  endTime: string | null;
  blocksAvailability: boolean;
}

/**
 * The rule, as a pure function: what one calendar entry does to availability.
 * Returns a whole-day range, an hours window, or nothing at all.
 *
 * Only `external` entries are ingested. A shoWMe-authored task or note is a
 * REMINDER, not an occupied window — "call the promoter back" does not make you
 * unbookable — and quietly turning every note anyone ever wrote into a booking
 * blocker is not a feature the user asked for.
 */
export function busyFromCalendarItem(
  item: BusyCandidateItem,
): { kind: "range"; range: BusyDateRange } | { kind: "window"; window: BusyTimeWindow } | null {
  if (item.type !== "external") return null;
  if (!item.blocksAvailability) return null;

  const lastDay = item.endDate ?? item.date;
  // Spanning more than one day is all-day by construction: the hours on the
  // middle days are not described by a single start/end pair.
  const spansDays = lastDay !== item.date;
  if (spansDays || !item.startTime || !item.endTime) {
    return { kind: "range", range: { startDate: item.date, endDate: lastDay } };
  }
  return {
    kind: "window",
    window: { date: item.date, startTime: item.startTime, endTime: item.endTime },
  };
}

/** Fold a batch of calendar rows into the two busy shapes, sorted and deduped. */
export function busyFromCalendarItems(items: readonly BusyCandidateItem[]): BusyTime {
  const dateRanges: BusyDateRange[] = [];
  const timeWindows: BusyTimeWindow[] = [];
  for (const item of items) {
    const busy = busyFromCalendarItem(item);
    if (!busy) continue;
    if (busy.kind === "range") dateRanges.push(busy.range);
    else timeWindows.push(busy.window);
  }
  return { dateRanges: sortRanges(dateRanges), timeWindows: sortWindows(timeWindows) };
}

function sortRanges(ranges: BusyDateRange[]): BusyDateRange[] {
  return dedupe(ranges, (range) => `${range.startDate}|${range.endDate}`).sort(
    (left, right) =>
      left.startDate.localeCompare(right.startDate) || left.endDate.localeCompare(right.endDate),
  );
}

function sortWindows(windows: BusyTimeWindow[]): BusyTimeWindow[] {
  return dedupe(windows, (window) => `${window.date}|${window.startTime}|${window.endTime}`).sort(
    (left, right) =>
      left.date.localeCompare(right.date) || left.startTime.localeCompare(right.startTime),
  );
}

function dedupe<T>(rows: T[], key: (row: T) => string): T[] {
  const seen = new Map<string, T>();
  for (const row of rows) seen.set(key(row), row);
  return [...seen.values()];
}

/**
 * Coalesce inclusive date ranges that overlap or sit next to each other.
 *
 * Needed the moment a second busy source exists: a hand-made block across a
 * refit week and a show booked inside it are two true statements about the same
 * nights, and publishing both makes a reader work out the union themselves.
 * Worse, a consumer computing FREE nights as the complement of this list — which
 * is what the public availability page does — double-counts the overlap.
 *
 * Touching ranges are joined as well as overlapping ones: 1st–3rd followed by
 * the 4th is one unbroken stretch of four nights, and saying it twice invites
 * the reader to think there is a free night between them.
 */
export function mergeDateRanges(ranges: readonly BusyDateRange[]): BusyDateRange[] {
  const sorted = [...ranges].sort(
    (left, right) =>
      left.startDate.localeCompare(right.startDate) || left.endDate.localeCompare(right.endDate),
  );
  const merged: BusyDateRange[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    // `<=` on the day AFTER the running end, so abutting ranges join too.
    if (last && range.startDate <= dayAfter(last.endDate)) {
      if (range.endDate > last.endDate) last.endDate = range.endDate;
      continue;
    }
    merged.push({ ...range });
  }
  return merged;
}

/** `yyyy-mm-dd` + one day, over UTC so no local zone can shift the date. */
function dayAfter(date: string): string {
  const at = new Date(`${date}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + 1);
  return at.toISOString().slice(0, 10);
}

/** An optional inclusive window to narrow the read to. Both bounds `yyyy-mm-dd`. */
export interface BusyRangeFilter {
  from?: string;
  to?: string;
}

/**
 * The union, read from Postgres: hand-made blocks plus imported entries.
 *
 * The access predicate is folded into the SQL (api-conventions: the `WHERE` IS
 * the rule) and it is deliberately narrow — imported entries count for a profile
 * only when they are OWNED BY that profile (`owner_profile_id`). A person's own
 * `owner_user_id` calendar never leaks into a profile's availability, which
 * matters most for someone who holds several profiles: a private lunch must not
 * mark all of them unbookable, and it must not become visible to the co-members
 * of any of them.
 */
export async function readProfileBusyTime(
  database: Database,
  profileId: string,
  filter: BusyRangeFilter = {},
): Promise<BusyTime> {
  const manual = await database
    .select({
      startDate: schema.profileUnavailability.startDate,
      endDate: schema.profileUnavailability.endDate,
    })
    .from(schema.profileUnavailability)
    .where(
      and(
        eq(schema.profileUnavailability.profileId, profileId),
        // WHOLE-PROFILE BLOCKS ONLY (ClickUp 86cbceux0).
        //
        // This function answers "is this PROFILE bookable", and its two callers
        // are the public availability page and the profile's own availability
        // read. Neither has a room to ask about — `BusyTime` carries dates and
        // hours, and no room column, because a stranger reading a venue's public
        // page is asking whether the building can have them.
        //
        // So a room-scoped block must not appear here. Including it would let a
        // refit in the Back Room tell the world the venue is shut, which is the
        // exact failure this column was added to stop — turning away bookings the
        // Main Room could take. The per-room question is answered where rooms
        // exist: the conflict route, through `occupiedDates`.
        isNull(schema.profileUnavailability.stageId),
        // Two inclusive ranges overlap iff each starts on or before the other ends.
        filter.to ? lte(schema.profileUnavailability.startDate, filter.to) : undefined,
        filter.from ? gte(schema.profileUnavailability.endDate, filter.from) : undefined,
      ),
    );

  const imported = await database
    .select({
      type: schema.calendarItems.type,
      date: schema.calendarItems.date,
      endDate: schema.calendarItems.endDate,
      startTime: schema.calendarItems.startTime,
      endTime: schema.calendarItems.endTime,
      blocksAvailability: schema.calendarItems.blocksAvailability,
    })
    .from(schema.calendarItems)
    .where(
      and(
        eq(schema.calendarItems.ownerProfileId, profileId),
        eq(schema.calendarItems.type, "external"),
        eq(schema.calendarItems.blocksAvailability, true),
        // `end_date` is null for a single-day entry, so the range's last day is
        // COALESCE(end_date, date) — expressed as an OR so the index on
        // (owner_profile_id, date) still drives the scan.
        filter.to ? lte(schema.calendarItems.date, filter.to) : undefined,
        filter.from
          ? or(
              gte(schema.calendarItems.date, filter.from),
              and(
                isNotNull(schema.calendarItems.endDate),
                gte(schema.calendarItems.endDate, filter.from),
              ),
            )
          : undefined,
      ),
    );

  const fromImports = busyFromCalendarItems(imported);
  return {
    dateRanges: sortRanges([...manual, ...fromImports.dateRanges]),
    timeWindows: fromImports.timeWindows,
  };
}

/**
 * NIGHTS ALREADY SOLD — the third busy source, and the one a stranger most needs.
 *
 * ClickUp 86cbceux0, third checkbox: "the system does not mark dates unavailable
 * for the specific Venue profile / Room automatically when events are created."
 * Measured 2026-09-19: a venue with a CONFIRMED show on a date reported that date
 * as free on `/public/profiles/:slug/availability`, because the read above knows
 * only about hand-made blocks and imported entries. A promoter reading the page
 * was being invited to ask for a night that was already gone.
 *
 * SEPARATE FUNCTION, NOT A THIRD QUERY INSIDE `readProfileBusyTime`. The in-app
 * read (`GET /profiles/:id/availability`) feeds the calendar's "Mark unavailable"
 * control, whose write is a WHOLESALE `PUT` replace of `profile_unavailability`.
 * Fold derived dates into that read and the next save writes them back as real
 * rows — the exact materialize-and-drift failure the comment at the top of this
 * file rejects, arrived at by accident. So the caller says which question it is
 * asking, out loud, and only the public route asks this one.
 *
 * WHAT COUNTS, and why it is not "any event":
 *
 * - **`isDateTaken`** (`@showme/shared`) decides which statuses take a night, so
 *   the public page, the booking warning and the share link cannot drift apart.
 *   A night an act has ACCEPTED is gone even though nothing is confirmed yet.
 * - **A venue is busy only when it has nowhere left to put a show** — one room
 *   sold out of three leaves the venue bookable, and `occupiedDates` already owns
 *   that rule, including the harder half: a booking with no room recorded fills
 *   EVERY room, because nobody can say which one is still free.
 * - **A performer is busy on any night they are playing.** No room math: they can
 *   only be in one place, so every taken event they stand on takes the night.
 *
 * It reveals that a night is gone, never what is in it — the same withholding the
 * shape above is built around, and strictly less than the titled, dated shows the
 * public profile already lists.
 */
export async function readProfileBookedDates(
  database: Database,
  profileId: string,
  filter: BusyRangeFilter = {},
): Promise<BusyDateRange[]> {
  const dateWindow = and(
    isNotNull(schema.events.eventDate),
    filter.from ? gte(schema.events.eventDate, filter.from) : undefined,
    filter.to ? lte(schema.events.eventDate, filter.to) : undefined,
  );

  // The two ways a profile's night gets taken, in one round trip: shows AT this
  // venue, and shows this profile is standing ON. A profile can be both.
  const [atThisVenue, standingOn, rooms] = await Promise.all([
    database
      .select({
        eventDate: schema.events.eventDate,
        venueProfileId: schema.events.venueProfileId,
        stageId: schema.events.stageId,
        status: schema.events.status,
      })
      .from(schema.events)
      .where(and(eq(schema.events.venueProfileId, profileId), dateWindow)),
    database
      .selectDistinct({
        eventDate: schema.events.eventDate,
        status: schema.events.status,
      })
      .from(schema.events)
      .innerJoin(schema.eventParticipants, eq(schema.eventParticipants.eventId, schema.events.id))
      .where(
        and(
          eq(schema.eventParticipants.profileId, profileId),
          // Being INVITED to a night does not take it — only an answer does, and
          // `STANDING_PARTICIPANT_STATUSES` is the same set authorization uses
          // for "is really on this bill".
          inArray(schema.eventParticipants.status, [...STANDING_PARTICIPANT_STATUSES]),
          // SHOWS AT THIS PROFILE'S OWN VENUE ARE NOT ASKED ABOUT HERE.
          //
          // A venue hosting its own event is also a PARTICIPANT on it, so without
          // this the host's own row walks its show straight past the room math
          // above and shuts the building. Measured live 2026-09-19 against The
          // Lantern Hall: one confirmed show in the Main Room reported the whole
          // venue unavailable while the Back Room stood empty — the precise
          // failure the room model exists to prevent, reintroduced through the
          // back door. Those events are already counted, correctly, by
          // `atThisVenue`; this branch is only for nights spent somewhere else.
          or(isNull(schema.events.venueProfileId), ne(schema.events.venueProfileId, profileId)),
          dateWindow,
        ),
      ),
    database
      .select({ id: schema.stages.id })
      .from(schema.stages)
      .where(eq(schema.stages.venueProfileId, profileId)),
  ]);

  const busy = occupiedDates(
    { venueProfileId: profileId, room: WHOLE_VENUE },
    rooms.map((room) => room.id),
    atThisVenue.map((event) => ({
      date: event.eventDate,
      venueProfileId: event.venueProfileId,
      stageId: event.stageId,
      occupies: isDateTaken(event.status),
    })),
  );

  for (const event of standingOn) {
    if (event.eventDate && isDateTaken(event.status)) busy.add(event.eventDate.slice(0, 10));
  }

  // One whole day each — an event has no end date, and the shape above is ranges.
  return [...busy].sort().map((date) => ({ startDate: date, endDate: date }));
}
