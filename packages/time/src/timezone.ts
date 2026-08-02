import { DateTime } from "luxon";

/**
 * Time-zone helpers (decisions #10, docs/timezones.md). shoWMe stores a scheduled
 * local time as **wall-clock + an IANA zone**, never a pre-baked UTC instant, so a
 * DST rule change or reschedule can't silently shift "20:00 local". These helpers
 * are the DST-correct bridge between the two representations — always via a real tz
 * library (Luxon), never the JS `Date`'s implicit local zone.
 */

/**
 * Resolve a wall-clock local time in a zone to the absolute UTC instant it denotes.
 * `localDateTime` is an offset-free ISO string (e.g. `2026-07-15T20:00`). DST is
 * handled by Luxon: a nonexistent spring-forward local time is shifted forward by
 * the gap rather than throwing (docs/timezones.md edge cases).
 */
export function resolveLocalToInstant(localDateTime: string, ianaZone: string): Date {
  const resolved = DateTime.fromISO(localDateTime, { zone: ianaZone });
  if (!resolved.isValid) {
    throw new Error(
      `Cannot resolve "${localDateTime}" in "${ianaZone}": ${resolved.invalidReason ?? "invalid"}`,
    );
  }
  return resolved.toJSDate();
}

/**
 * A coarse country (ISO 3166-1 alpha-2) → IANA default zone. Used to snapshot
 * `events.timezone` from the venue's country when a finer lat/lng lookup is absent
 * (docs/timezones.md). Countries that span multiple zones get their most common
 * one; unknown countries fall back to UTC.
 */
const COUNTRY_ZONE: Record<string, string> = {
  SE: "Europe/Stockholm",
  NO: "Europe/Oslo",
  DK: "Europe/Copenhagen",
  FI: "Europe/Helsinki",
  DE: "Europe/Berlin",
  GB: "Europe/London",
  IE: "Europe/Dublin",
  FR: "Europe/Paris",
  ES: "Europe/Madrid",
  IT: "Europe/Rome",
  NL: "Europe/Amsterdam",
  US: "America/New_York",
};

export function zoneForCountry(country: string): string {
  return COUNTRY_ZONE[country.trim().toUpperCase()] ?? "UTC";
}

/** The UTC instants bounding a local calendar day: `[start, end)`. */
export interface DayBounds {
  readonly start: Date;
  readonly end: Date;
}

/**
 * The UTC instants bounding a local calendar `date` (`YYYY-MM-DD`) in a zone.
 * `start` is that day's local midnight; `end` is the next day's local midnight
 * (exclusive). On a normal day the span is 24h; across a DST transition it is 23h
 * or 25h — which is exactly why the boundary is computed in the zone, not by
 * adding a fixed 24h offset.
 */
export function dayBounds(date: string, ianaZone: string): DayBounds {
  const start = DateTime.fromISO(date, { zone: ianaZone }).startOf("day");
  if (!start.isValid) {
    throw new Error(
      `Cannot compute day bounds for "${date}" in "${ianaZone}": ${start.invalidReason ?? "invalid"}`,
    );
  }
  const end = start.plus({ days: 1 });
  return { start: start.toJSDate(), end: end.toJSDate() };
}
