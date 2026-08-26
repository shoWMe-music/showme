import type { Database } from "@showme/db";
import { schema } from "@showme/db";
import { and, eq, gte, isNotNull, lte, or } from "drizzle-orm";

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
