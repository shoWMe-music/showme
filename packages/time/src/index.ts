// Time-zone helpers (decisions #10, docs/timezones.md): the DST-correct bridge
// between a stored wall-clock local time (local datetime + IANA zone) and an
// absolute UTC instant. Shared by the API (serialize/resolve) and the jobs
// reapers (local-time reminders). Always via Luxon, never JS `Date`'s implicit zone.
export {
  resolveLocalToInstant,
  zoneForCountry,
  dayBounds,
  type DayBounds,
} from "./timezone";
