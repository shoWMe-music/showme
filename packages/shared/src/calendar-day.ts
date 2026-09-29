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

/**
 * A WALL-CLOCK TIME AS A PERSON READS IT — `"19:00:00"` → `"19:00"` (QA sweep run 15).
 *
 * Postgres serves a `time` column with its seconds, and the public profile preview printed them
 * verbatim: *"Doors 19:00:00 · Show 20:00:00"* on the screen that promises *"This is exactly what
 * anyone visiting /… sees"*.
 *
 * SLICED, NEVER PARSED, and that is the whole reason this is three lines rather than a
 * `toLocaleTimeString`. These are offset-free wall clocks (decisions #10): the door opens at 19:00
 * where the room is, and handing the string to a `Date` re-interprets it in the READER's zone, which
 * moves a Stockholm door time for anybody looking from London. `eventHistory.ts` already slices for
 * exactly this reason, and web's own `formatTime` — which does parse — returns "—" for a bare time
 * because `parseDayLocal` cannot read one.
 *
 * Here rather than in either app because `apps/marketing` had grown TWO private copies (`clockTime`
 * in `profile.ts`, `formatTime` in `event.ts`) and the web preview had none, which is three call
 * sites for one rule: the review gate's own threshold.
 *
 * Anything that is not a recognisable clock comes back UNCHANGED rather than as a dash — a value this
 * cannot read is somebody else's to explain, and blanking it would hide it.
 */
export function formatClockTime(value: string | null | undefined): string {
  if (!value) return "";
  const match = /^(\d{1,2}:\d{2})/.exec(value);
  if (!match?.[1]) return value;
  // A single-digit hour from a hand-written value reads as "9:00"; pad it so a column of times lines
  // up, which is the one thing seconds were not doing wrong.
  const [hour, minute] = match[1].split(":");
  return `${(hour ?? "").padStart(2, "0")}:${minute}`;
}
