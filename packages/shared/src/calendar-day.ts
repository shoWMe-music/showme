/**
 * A STORED CALENDAR DAY, AS A READER READS IT — `2026-10-16` → `16 Oct 2026`.
 *
 * The API composes prose for notifications, event notes and change notices, and it was
 * interpolating the stored string straight into it: *"They asked about 2026-10-16."* (QA sweep run
 * 13). `apps/web/src/components/eventHistory.ts` has stated the rule in a comment since part 30 —
 * *"the raw `yyyy-mm-dd` … is the one date shape a reader has to decode rather than read"* — and a
 * comment that states a rule is a test that never runs. Nine call sites across three API files were
 * doing it; the sweep found one.
 *
 * Here and not in `apps/web/src/lib/format.ts` because the WRITER is the API: a notification body is
 * composed once, on the server, and stored. The web's `formatDay` stays where it is and keeps its
 * own job, which is formatting a date the browser was handed.
 *
 * ── Why the month table rather than `Intl` ──────────────────────────────────────────────────────
 * A stored `date` column is a calendar day with no instant and no zone. `new Date("2026-10-16")`
 * is UTC midnight, and formatting THAT in the process's local zone moves the day backwards for
 * every reader west of Greenwich — a booking request for the 16th read as the 15th. Pinning `Intl`
 * to `timeZone: "UTC"` is the other correct answer and is what `apps/api/src/lib/email-templates.ts`
 * does for its long form (`formatEventDate`, "Saturday 12 September 2026"); a table cannot be got
 * wrong by a later edit, needs no parse, and gives the same three-letter month on every runtime and
 * ICU build. The two live side by side on purpose: different readers, different shapes.
 */
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/**
 * `2026-10-16` → `16 Oct 2026`. Anything that is not a calendar day comes back UNCHANGED rather
 * than as a dash: these strings go into prose the reader cannot re-read from the source, so a
 * surprising value is better shown than silently replaced by "—".
 */
export function formatCalendarDay(value: string | null | undefined): string {
  if (!value) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value;
  const [, year, month, day] = match;
  const monthName = MONTHS[Number(month) - 1];
  if (!monthName) return value;
  return `${Number(day)} ${monthName} ${year}`;
}
