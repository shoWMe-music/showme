/**
 * iCalendar (RFC 5545) export — pure text assembly, no app types, no DOM except
 * the one download helper at the bottom.
 *
 * WHY this is written out by hand rather than pulled from a library: the export
 * is a handful of VEVENTs with no recurrence, no attendees and no alarms, and
 * the parts that actually bite (CRLF, 75-OCTET folding, TEXT escaping, and
 * DATE-vs-DATE-TIME) are exactly the parts a library would hide. They are
 * written here so they can be read and tested.
 *
 * The three rules that decide whether a file opens everywhere:
 *
 * 1. **Every line ends CRLF** (§3.1). A bare LF file is rejected outright by
 *    some parsers and silently mangled by others.
 * 2. **Content lines fold at 75 octets**, not characters (§3.1) — a fold is
 *    `CRLF` followed by one space, and a multi-byte UTF-8 sequence must never
 *    be split across the fold or the file stops being valid UTF-8.
 * 3. **A date is not an instant.** `events.event_date` is an offset-free SQL
 *    `date`: the show is "on the 30th", not "at 00:00Z on the 30th". Those go
 *    out as `DTSTART;VALUE=DATE:` with a next-day exclusive `DTEND` (§3.6.1).
 *    Emitting a UTC timestamp instead lands every show a day early for anyone
 *    west of Greenwich.
 *
 * Times on `calendar_items` are equally offset-free (`time` columns with no
 * zone alongside a `date`), so they go out as **floating** local date-times —
 * `DTSTART:20260830T190000`, no `Z`, no `TZID` (§3.3.5 form 1). A floating time
 * means "19:00 wherever the reader is", which is the honest rendering of a wall
 * clock the database never anchored to a zone. Inventing a zone here would be
 * making up data.
 */

/** RFC 5545 §3.1 — the only line break iCalendar recognises. */
const CRLF = "\r\n";

/** §3.1: a content line is at most 75 octets before folding. */
const MAX_LINE_OCTETS = 75;

/** UID host part. Only has to be stable and globally unique-ish (§3.8.4.7). */
const UID_DOMAIN = "showme.music";

export type IcsEventStatus = "TENTATIVE" | "CONFIRMED" | "CANCELLED";

export interface IcsEntry {
  /**
   * Stable identifier — becomes the VEVENT UID. Re-exporting the same entry
   * therefore UPDATES it in the importing calendar instead of duplicating it,
   * which is why it must be the row id and never a generated value.
   */
  id: string;
  /** `yyyy-mm-dd`, local to the entry. Never an instant. */
  date: string;
  /** Local wall-clock `HH:mm` / `HH:mm:ss`. Absent ⇒ the entry is all-day. */
  startTime?: string;
  endTime?: string;
  summary: string;
  description?: string;
  status: IcsEventStatus;
}

export interface IcsCalendarOptions {
  /** Shown as the calendar's name by clients that honour `X-WR-CALNAME`. */
  calendarName: string;
  /** Injectable "now" for DTSTAMP so a test can assert exact bytes. */
  now?: Date;
}

/**
 * §3.3.11 TEXT escaping. Order matters: backslash first, or the escapes we add
 * below get escaped a second time. A literal newline becomes `\n`; a CR is
 * dropped into the same `\n` rather than being emitted raw (a raw CR inside a
 * value would look like the start of a fold).
 */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/**
 * §3.1 line folding, counted in OCTETS of the UTF-8 encoding.
 *
 * The continuation lines carry a leading space that counts toward their own 75,
 * so the first piece may take 75 octets and every later piece only 74. The
 * backtrack off `10xxxxxx` continuation bytes is what stops a fold landing in
 * the middle of a multi-byte character.
 */
export function foldIcsLine(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= MAX_LINE_OCTETS) return line;

  const decoder = new TextDecoder();
  const pieces: string[] = [];
  let start = 0;
  let budget = MAX_LINE_OCTETS;

  while (start < bytes.length) {
    let end = Math.min(start + budget, bytes.length);
    // Walk back off any UTF-8 continuation byte so a character stays whole.
    while (end > start + 1 && end < bytes.length && ((bytes[end] ?? 0) & 0xc0) === 0x80) {
      end -= 1;
    }
    pieces.push(decoder.decode(bytes.subarray(start, end)));
    start = end;
    budget = MAX_LINE_OCTETS - 1; // the leading space of a continuation line
  }

  return pieces.join(`${CRLF} `);
}

/** `2026-08-30` → `20260830` (§3.3.4 DATE). */
export function icsDateValue(dayKey: string): string {
  return dayKey.replace(/-/g, "");
}

/** The day after `dayKey`, as `yyyy-mm-dd`. Used for the exclusive all-day DTEND. */
export function nextDayKey(dayKey: string): string {
  const [year, month, day] = dayKey.split("-").map(Number);
  // UTC arithmetic on a bare calendar date: no zone is involved either side, and
  // a local-time Date would shift the day across a DST boundary.
  const stepped = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, (day ?? 1) + 1));
  return stepped.toISOString().slice(0, 10);
}

/** `20:30` / `20:30:00` → `203000`. Returns null for anything unrecognisable. */
function icsTimeValue(time: string): string | null {
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(time.trim());
  if (!match) return null;
  return `${match[1]}${match[2]}${match[3] ?? "00"}`;
}

/** `2026-08-30` + `19:00` → `20260830T190000` — a FLOATING local date-time. */
export function icsFloatingDateTime(dayKey: string, time: string): string | null {
  const timeValue = icsTimeValue(time);
  return timeValue ? `${icsDateValue(dayKey)}T${timeValue}` : null;
}

/** §3.3.5 form 2 — the UTC date-time DTSTAMP requires. */
export function icsUtcTimestamp(instant: Date): string {
  return `${instant.toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`;
}

/**
 * The DTSTART/DTEND pair for one entry.
 *
 * All-day (no start time): `VALUE=DATE`, and DTEND is the NEXT day because the
 * all-day DTEND is exclusive (§3.6.1) — same-day DTEND is the classic
 * off-by-one that makes a one-day event vanish in Outlook.
 *
 * Timed: floating date-times. An end at or before the start is read as crossing
 * midnight (a 22:00–02:00 show is one night, not a negative duration), so it
 * lands on the following day. With no end time at all we emit DTSTART only —
 * §3.6.1 defines that as ending at the same instant, which is truthful. A
 * default duration would be fabricated.
 */
function dateLines(entry: IcsEntry): string[] {
  const start = entry.startTime ? icsFloatingDateTime(entry.date, entry.startTime) : null;
  if (!start) {
    return [
      `DTSTART;VALUE=DATE:${icsDateValue(entry.date)}`,
      `DTEND;VALUE=DATE:${icsDateValue(nextDayKey(entry.date))}`,
    ];
  }

  const lines = [`DTSTART:${start}`];
  const rawEnd = entry.endTime ? icsTimeValue(entry.endTime) : null;
  if (rawEnd) {
    const startValue = start.slice(9);
    const endDay = rawEnd <= startValue ? nextDayKey(entry.date) : entry.date;
    lines.push(`DTEND:${icsDateValue(endDay)}T${rawEnd}`);
  }
  return lines;
}

/** One VEVENT. UID / DTSTAMP / DTSTART are the three properties §3.6.1 requires. */
function eventLines(entry: IcsEntry, stamp: string): string[] {
  const lines = [
    "BEGIN:VEVENT",
    `UID:${entry.id}@${UID_DOMAIN}`,
    `DTSTAMP:${stamp}`,
    ...dateLines(entry),
    `SUMMARY:${escapeIcsText(entry.summary)}`,
  ];
  if (entry.description) lines.push(`DESCRIPTION:${escapeIcsText(entry.description)}`);
  lines.push(`STATUS:${entry.status}`, "END:VEVENT");
  return lines;
}

/** Assemble a complete VCALENDAR. The returned string is CRLF-terminated throughout. */
export function buildIcsCalendar(entries: IcsEntry[], options: IcsCalendarOptions): string {
  const stamp = icsUtcTimestamp(options.now ?? new Date());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//shoWMe//Calendar Export//EN",
    "CALSCALE:GREGORIAN",
    // PUBLISH = "here is my calendar", as opposed to REQUEST (an invitation the
    // reader is expected to answer). An export is never an invitation.
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(options.calendarName)}`,
    ...entries.flatMap((entry) => eventLines(entry, stamp)),
    "END:VCALENDAR",
  ];
  // Trailing CRLF included: §3.1 makes it a line TERMINATOR, not a separator.
  return `${lines.map(foldIcsLine).join(CRLF)}${CRLF}`;
}

/** `showme-calendar-2026-08-01-to-2026-08-31.ics` — the range is in the name so
 * a folder of exports stays readable. */
export function icsFileName(from: string, to: string): string {
  return from === to ? `showme-calendar-${from}.ics` : `showme-calendar-${from}-to-${to}.ics`;
}

/**
 * Hand the file to the user. A Blob + a synthetic anchor click is the only way
 * a browser writes to disk without a server round-trip, and the object URL is
 * revoked on the next tick rather than synchronously — revoking in the same
 * frame cancels the download in some browsers.
 */
export function downloadIcsFile(fileName: string, contents: string): void {
  const blob = new Blob([contents], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
