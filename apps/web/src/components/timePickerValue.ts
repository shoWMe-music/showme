/**
 * Pure wall-clock arithmetic for the in-app time picker. Deliberately free of
 * `Date`: a schedule time is an OFFSET-FREE wall clock ("19:00" on the event's
 * own day, anchored by the event's timezone — decisions #10). The moment such a
 * string becomes a `Date` it acquires the READER's zone, and that is exactly how
 * a stored time slides an hour or a whole day. So everything here is integer
 * arithmetic on minutes-since-midnight and string slicing on `hh:mm`.
 */

export const MINUTES_PER_HOUR = 60;
export const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;
export const MAXIMUM_HOUR = 23;
export const MAXIMUM_MINUTE = 59;

/**
 * How far one Up/Down press moves the minute segment.
 *
 * Five, not one. Every wall clock this app has ever stored sits on a :00 or :30
 * boundary (the seeded events' door/start/end/curfew times and the calendar
 * appointments), because doors, load-in, soundcheck and curfew are agreed in
 * round numbers — so a 1-minute step would mean twelve presses to cross the
 * half-hour that people actually use. It is an INCREMENT, never a constraint:
 * the segments accept any typed minute, and the API's own contract
 * (`/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/`, `apps/api/src/routes/schedule.ts`)
 * allows 19:07, so 19:07 must remain typeable.
 */
export const MINUTE_STEP = 5;
/** PageUp/PageDown on the minute segment — a quarter hour. */
export const MINUTE_PAGE_STEP = 15;
/** PageUp/PageDown on the hour segment — a quarter of the day. */
export const HOUR_PAGE_STEP = 6;

/** Fold any minute count back into 00:00–23:59. Negative values included, which
 * `%` alone gets wrong in JavaScript. */
export function wrapWithinDay(minutes: number): number {
  return ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

/** `hh:mm` (or the `hh:mm:ss` Postgres hands back) → minutes since midnight.
 * Anything else, including an empty field, is `null` — "no time chosen yet". */
export function parseWallClock(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > MAXIMUM_HOUR || minute > MAXIMUM_MINUTE) return null;
  return hour * MINUTES_PER_HOUR + minute;
}

/** Minutes since midnight → the zero-padded `hh:mm` an input expects. */
export function formatWallClock(minutes: number): string {
  const wrapped = wrapWithinDay(minutes);
  const hour = Math.floor(wrapped / MINUTES_PER_HOUR);
  const minute = wrapped % MINUTES_PER_HOUR;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/**
 * Move the minutes by `delta`, snapping onto the |delta| grid on the way.
 *
 * From a typed 19:07, Up gives 19:10 rather than 19:12 — one press pulls an odd
 * minute back onto the round grid, which is where the next press should start.
 * A time already on the grid just moves one whole step.
 */
export function stepMinutes(minutes: number, delta: number): number {
  const size = Math.abs(delta);
  const snapped =
    delta > 0 ? (Math.floor(minutes / size) + 1) * size : (Math.ceil(minutes / size) - 1) * size;
  return wrapWithinDay(snapped);
}

/** Move the HOUR segment only: the minutes are untouched and the hour wraps
 * 23 → 00 within the same day, the way a native segmented field behaves. */
export function stepHours(minutes: number, delta: number): number {
  const hour = Math.floor(minutes / MINUTES_PER_HOUR);
  const minute = minutes % MINUTES_PER_HOUR;
  const nextHour = (((hour + delta) % 24) + 24) % 24;
  return nextHour * MINUTES_PER_HOUR + minute;
}

/** Replace the hour, keeping the minutes. */
export function withHour(minutes: number, hour: number): number {
  return hour * MINUTES_PER_HOUR + (minutes % MINUTES_PER_HOUR);
}

/** Replace the minutes, keeping the hour. */
export function withMinute(minutes: number, minute: number): number {
  return Math.floor(minutes / MINUTES_PER_HOUR) * MINUTES_PER_HOUR + minute;
}

/**
 * Split a `yyyy-mm-ddThh:mm` stamp into its two halves by POSITION, never by
 * parsing. `day` is `yyyy-mm-dd`, `time` is `hh:mm`; either is `""` when the
 * field is empty or half-filled.
 */
export function splitLocalDateTime(value: string): { day: string; time: string } {
  const match = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?/.exec(value);
  if (!match) return { day: "", time: "" };
  return { day: match[1] ?? "", time: match[2] ?? "" };
}

/** Re-join the two halves. A `datetime-local` input rejects a value missing
 * either half, so a dayless or timeless pair is reported as "not a value yet". */
export function joinLocalDateTime(day: string, time: string): string {
  if (!day || !time) return "";
  return `${day}T${time}`;
}
