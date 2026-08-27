/**
 * Reading an iCalendar file (RFC 5545) — the mirror of the export in
 * `apps/web/src/lib/calendarIcsExport.ts`, and pure in the same way: text in,
 * plain values out, no clock, no network, no database.
 *
 * A real `.ics` is messier than the one we write, so the four things that
 * actually break a naive reader are handled here rather than assumed away:
 *
 * 1. **Folding (§3.1).** A content line longer than 75 octets is split across
 *    physical lines and every continuation begins with a space or a tab. Unfold
 *    BEFORE looking at anything, or a long `SUMMARY` arrives cut in half and the
 *    tail of it looks like a property called `roducer`.
 * 2. **Line endings.** The spec says CRLF; files in the wild arrive with bare
 *    LF (and, from very old exporters, bare CR). All three are accepted.
 * 3. **Escaping (§3.3.11).** `\,` `\;` `\n` `\\` inside a TEXT value. Unescaped
 *    left to right in one pass, so `\\,` stays a literal backslash + comma
 *    rather than becoming an escape of its own.
 * 4. **Three forms of DTSTART, which mean three different things.** This is the
 *    part that silently corrupts data if it is fudged — see below.
 *
 * ── WHAT A DTSTART MEANS, AND WHAT WE STORE ─────────────────────────────────
 * `docs/timezones.md` draws the line this parser has to respect: an *instant* and
 * a *wall clock at a place* are different kinds of value. `calendar_items` stores
 * a bare `date` plus offset-free `time` columns — a wall clock — so every form
 * below is resolved into ONE frame, the `timeZone` passed in, before it is
 * stored. That frame is the importing user's zone, and it is reported back so the
 * screen can name it instead of leaving the reader to guess.
 *
 * | In the file | Kind | What we store |
 * |---|---|---|
 * | `DTSTART;VALUE=DATE:20260830` | a bare day, no zone exists | the day, verbatim; no times |
 * | `DTSTART:20260830T190000Z` | an absolute instant | that instant's wall clock **in `timeZone`** |
 * | `DTSTART;TZID=Europe/Berlin:20260830T190000` | a wall clock elsewhere | re-expressed as the wall clock **in `timeZone`** |
 * | `DTSTART:20260830T190000` | floating (§3.3.5 form 1) | verbatim — floating already means "19:00 wherever the reader is" |
 *
 * The floating row is what shoWMe's own export emits, so a file this app wrote
 * comes back through here unchanged, which is the point.
 *
 * An unrecognised `TZID` (Outlook writes `W. Europe Standard Time`, which is not
 * an IANA zone) is NOT a rejection: the wall clock in the file is kept exactly as
 * written and the entry carries a `caveat` saying so. Dropping a whole Outlook
 * calendar over a zone name would be a worse answer than keeping the hour the
 * user typed and telling them we could not place it.
 *
 * ── WHAT IS REFUSED, AND WHY ────────────────────────────────────────────────
 * Rejections are per-entry and carry a sentence, never a silent drop:
 * - **no `UID`** — nothing stable to recognise it by, so a second import of the
 *   same file could only duplicate it. The identity is the whole idempotency
 *   story (see `calendar_items_external_identity_idx`).
 * - **no or unreadable `DTSTART`** — an entry with no day is not a commitment.
 * - **`RRULE`/`RDATE`** — a repeat. Expanding a recurrence rule correctly (COUNT,
 *   UNTIL, BYDAY, EXDATE, DST) is a project; importing only the first occurrence
 *   would quietly lose the other fifty-one. Refused with that said out loud.
 * - **`STATUS:CANCELLED`** — a tombstone. Importing one would block a night for
 *   something that is not happening. shoWMe's own export emits these on purpose.
 */

/** One VEVENT this app can store, already resolved into the import's timezone. */
export interface IcsEntry {
  /** Position among the VEVENTs of the file, 0-based — so a verdict can be placed. */
  index: number;
  /** The file's `UID`, verbatim. This is the identity a re-import matches on. */
  uid: string;
  /** `SUMMARY`, unescaped. "Busy" when the file gives none — an entry is still a commitment. */
  title: string;
  /** First day, `yyyy-mm-dd`, in the import's timezone. */
  date: string;
  /** Last day INCLUSIVE, or null when it starts and ends on `date`. */
  endDate: string | null;
  /** Wall clock `HH:MM:SS` in the import's timezone; null for an all-day entry. */
  startTime: string | null;
  endTime: string | null;
  /** `LOCATION`, unescaped. */
  location: string | null;
  /** How the entry was read, when that is worth saying (an unplaceable TZID, a clamp). */
  caveat: string | null;
}

/** A VEVENT that will not be imported, and the sentence explaining it. */
export interface IcsRejection {
  index: number;
  uid: string | null;
  title: string | null;
  reason: string;
}

export interface IcsParseResult {
  /** `X-WR-CALNAME`, if the file names itself. */
  calendarName: string | null;
  entries: IcsEntry[];
  rejected: IcsRejection[];
}

/** The file is not something we can read at all — as opposed to an entry we cannot. */
export class IcsParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IcsParseError";
  }
}

/** What a non-owner sees, and what an untitled entry is. Matches the sync seam. */
const UNTITLED = "Busy";

/* ───────────────────────────────────────────────────────── lexing ────────── */

/**
 * §3.1 — physical lines to logical ones. A continuation starts with a single
 * space or HTAB, which is removed; everything after it belongs to the line above.
 */
export function unfoldIcsLines(text: string): string[] {
  const physical = text.replace(/^\uFEFF/, "").split(/\r\n|\r|\n/);
  const logical: string[] = [];
  for (const line of physical) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && logical.length > 0) {
      logical[logical.length - 1] += line.slice(1);
      continue;
    }
    if (line !== "") logical.push(line);
  }
  return logical;
}

export interface IcsContentLine {
  /** Upper-cased, so `dtstart` and `DTSTART` are one property. */
  name: string;
  /** Upper-cased parameter names → raw values (quotes stripped). */
  parameters: Record<string, string>;
  value: string;
}

/**
 * §3.1 — `NAME;PARAM=value;OTHER="a:b":the value`.
 *
 * The value begins at the first colon that is NOT inside a quoted parameter
 * value; a quoted parameter is exactly how a `TZID` containing a colon or a
 * semicolon is written, so scanning for the first `:` blindly mis-splits it.
 */
export function parseIcsContentLine(line: string): IcsContentLine | null {
  let quoted = false;
  let colon = -1;
  for (let position = 0; position < line.length; position += 1) {
    const character = line[position];
    if (character === '"') quoted = !quoted;
    else if (character === ":" && !quoted) {
      colon = position;
      break;
    }
  }
  if (colon === -1) return null;

  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);

  // Split the head on unquoted semicolons — same reason as the colon above.
  const pieces: string[] = [];
  let current = "";
  quoted = false;
  for (const character of head) {
    if (character === '"') {
      quoted = !quoted;
      continue;
    }
    if (character === ";" && !quoted) {
      pieces.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  pieces.push(current);

  const name = (pieces.shift() ?? "").trim().toUpperCase();
  if (!name) return null;

  const parameters: Record<string, string> = {};
  for (const piece of pieces) {
    const equals = piece.indexOf("=");
    if (equals === -1) continue;
    parameters[piece.slice(0, equals).trim().toUpperCase()] = piece.slice(equals + 1).trim();
  }

  return { name, parameters, value };
}

/** §3.3.11, in reverse. One left-to-right pass so `\\,` is a backslash and a comma. */
export function unescapeIcsText(value: string): string {
  let out = "";
  for (let position = 0; position < value.length; position += 1) {
    if (value[position] !== "\\") {
      out += value[position];
      continue;
    }
    const next = value[position + 1];
    position += 1;
    if (next === "n" || next === "N") out += "\n";
    else if (next === undefined) out += "\\";
    else out += next; // covers \, \; \\ and anything else an exporter escaped
  }
  return out;
}

/* ────────────────────────────────────────────────── date and time ────────── */

/** `2026-08-30` → `2026-08-29`. UTC arithmetic: a bare day has no zone to slip in. */
function shiftDay(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  if (!year || !month || !day) return isoDate;
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

interface WallClock {
  /** `yyyy-mm-dd` */
  date: string;
  /** `HH:MM:SS`, or null when the value was a bare DATE. */
  time: string | null;
}

/** A DTSTART/DTEND value, before any zone has been applied to it. */
interface RawDateTime extends WallClock {
  /** True for `…Z` — the wall clock above is UTC's, and must be re-expressed. */
  utc: boolean;
}

/** `20260830`, `20260830T190000`, `20260830T190000Z` — the three §3.3.4/§3.3.5 forms. */
function parseIcsDateTimeValue(value: string): RawDateTime | null {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(value.trim());
  if (!match) return null;
  const [, year, month, day, hour, minute, second, zulu] = match;
  return {
    date: `${year}-${month}-${day}`,
    time: hour ? `${hour}:${minute}:${second}` : null,
    utc: zulu === "Z",
  };
}

const timeZoneFormatters = new Map<string, Intl.DateTimeFormat | null>();

/** A cached `h23` formatter for a zone, or null when the runtime does not know it. */
function formatterFor(timeZone: string): Intl.DateTimeFormat | null {
  const cached = timeZoneFormatters.get(timeZone);
  if (cached !== undefined) return cached;
  let formatter: Intl.DateTimeFormat | null = null;
  try {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      // `hourCycle: "h23"`, never `hour12: false`: the latter renders midnight as
      // "24" in several ICU versions, turning `00:15` into `24:15` — a value
      // Postgres accepts into a `time` column and that then matches no window.
      hourCycle: "h23",
    });
  } catch {
    formatter = null;
  }
  timeZoneFormatters.set(timeZone, formatter);
  return formatter;
}

/** Is this a zone this runtime can actually place? */
export function isKnownTimeZone(timeZone: string): boolean {
  return formatterFor(timeZone) !== null;
}

/** What the clock in `timeZone` reads at this instant. */
function wallClockInTimeZone(instant: Date, timeZone: string): WallClock {
  const formatter = formatterFor(timeZone);
  if (!formatter) throw new Error(`unknown time zone: ${timeZone}`);
  const parts = formatter.formatToParts(instant);
  const field = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "00";
  return {
    date: `${field("year")}-${field("month")}-${field("day")}`,
    time: `${field("hour")}:${field("minute")}:${field("second")}`,
  };
}

/** The zone's offset from UTC at an instant, in milliseconds. */
function offsetAt(instant: Date, timeZone: string): number {
  const wall = wallClockInTimeZone(instant, timeZone);
  const [year, month, day] = wall.date.split("-").map(Number);
  const [hour, minute, second] = (wall.time ?? "00:00:00").split(":").map(Number);
  const asIfUtc = Date.UTC(
    year ?? 0,
    (month ?? 1) - 1,
    day ?? 1,
    hour ?? 0,
    minute ?? 0,
    second ?? 0,
  );
  return asIfUtc - instant.getTime();
}

/**
 * The instant at which the clock in `timeZone` reads this wall time — the inverse
 * of the formatter above, and the only way to move a time from one zone to
 * another without hand-rolling offset arithmetic.
 *
 * Two passes: guess by treating the wall clock as UTC, measure the zone's offset
 * at that guess, correct, then re-measure in case the correction crossed a DST
 * boundary. A wall clock that does not exist (02:30 on a spring-forward night)
 * settles on the instant after the jump, which is the conventional resolution.
 */
function instantFromWallClock(wall: { date: string; time: string }, timeZone: string): Date {
  const [year, month, day] = wall.date.split("-").map(Number);
  const [hour, minute, second] = wall.time.split(":").map(Number);
  const naive = Date.UTC(
    year ?? 0,
    (month ?? 1) - 1,
    day ?? 1,
    hour ?? 0,
    minute ?? 0,
    second ?? 0,
  );
  const firstOffset = offsetAt(new Date(naive), timeZone);
  const corrected = new Date(naive - firstOffset);
  const secondOffset = offsetAt(corrected, timeZone);
  return secondOffset === firstOffset ? corrected : new Date(naive - secondOffset);
}

/** A DTSTART/DTEND, resolved into the import's frame. */
interface ResolvedDateTime extends WallClock {
  caveat: string | null;
}

/**
 * Move one property's value into `timeZone`.
 *
 * A bare DATE and a floating DATE-TIME are already in whatever frame the reader
 * is in and are returned untouched — converting either would be inventing a fact
 * the file does not carry.
 */
function resolveDateTime(
  raw: RawDateTime,
  tzid: string | undefined,
  timeZone: string,
): ResolvedDateTime {
  if (raw.time === null) return { date: raw.date, time: null, caveat: null };

  if (raw.utc) {
    const wall = wallClockInTimeZone(instantFromUtcWallClock(raw), timeZone);
    return { ...wall, caveat: null };
  }

  if (!tzid) return { date: raw.date, time: raw.time, caveat: null };
  if (tzid === timeZone) return { date: raw.date, time: raw.time, caveat: null };
  if (!isKnownTimeZone(tzid)) {
    return {
      date: raw.date,
      time: raw.time,
      caveat: `Time zone "${tzid}" isn't one we recognise — the times were kept exactly as written.`,
    };
  }

  const instant = instantFromWallClock({ date: raw.date, time: raw.time }, tzid);
  return { ...wallClockInTimeZone(instant, timeZone), caveat: null };
}

/** A `…Z` value IS a UTC wall clock, so the instant follows without any zone lookup. */
function instantFromUtcWallClock(raw: RawDateTime): Date {
  const [year, month, day] = raw.date.split("-").map(Number);
  const [hour, minute, second] = (raw.time ?? "00:00:00").split(":").map(Number);
  return new Date(
    Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1, hour ?? 0, minute ?? 0, second ?? 0),
  );
}

/** §3.3.6 DURATION — `P1DT2H30M`. Returned in seconds; null if unreadable. */
export function parseIcsDurationSeconds(value: string): number | null {
  const match = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(
    value.trim(),
  );
  if (!match) return null;
  const [, sign, weeks, days, hours, minutes, seconds] = match;
  const total =
    Number(weeks ?? 0) * 604_800 +
    Number(days ?? 0) * 86_400 +
    Number(hours ?? 0) * 3_600 +
    Number(minutes ?? 0) * 60 +
    Number(seconds ?? 0);
  if (total === 0 && !/\d/.test(value)) return null;
  return sign === "-" ? -total : total;
}

/* ─────────────────────────────────────────────────────── the parse ───────── */

interface RawEvent {
  index: number;
  properties: Map<string, IcsContentLine>;
}

/**
 * Split the file into VEVENTs.
 *
 * Nested components matter: a `VALARM` inside a `VEVENT` carries its own
 * `DESCRIPTION` and `TRIGGER`, and letting those land on the event would give
 * every reminder-bearing entry the alarm's text. Depth is tracked so they don't.
 */
function readVEvents(lines: readonly string[]): {
  events: RawEvent[];
  calendarName: string | null;
} {
  const events: RawEvent[] = [];
  let calendarName: string | null = null;
  let current: RawEvent | null = null;
  let nestedDepth = 0;

  for (const line of lines) {
    const parsed = parseIcsContentLine(line);
    if (!parsed) continue;

    if (parsed.name === "BEGIN") {
      const component = parsed.value.trim().toUpperCase();
      if (current) nestedDepth += 1;
      else if (component === "VEVENT") current = { index: events.length, properties: new Map() };
      continue;
    }
    if (parsed.name === "END") {
      if (current && nestedDepth === 0) {
        events.push(current);
        current = null;
      } else if (nestedDepth > 0) {
        nestedDepth -= 1;
      }
      continue;
    }

    if (!current) {
      if (parsed.name === "X-WR-CALNAME")
        calendarName = unescapeIcsText(parsed.value).trim() || null;
      continue;
    }
    if (nestedDepth > 0) continue;
    // First wins. A duplicated property is malformed; taking the first is the
    // same choice every mainstream client makes.
    if (!current.properties.has(parsed.name)) current.properties.set(parsed.name, parsed);
  }

  return { events, calendarName };
}

/**
 * Read an `.ics` file into entries this app can store.
 *
 * `timeZone` is the frame every absolute or foreign-zoned time is resolved into —
 * the importing user's zone. It is required rather than defaulted, because
 * "whatever zone the server happens to run in" is exactly the bug
 * `docs/timezones.md` exists to prevent: Cloud Run is UTC and a laptop is not,
 * and the same file must not import differently in the two.
 */
export function parseIcs(text: string, options: { timeZone: string }): IcsParseResult {
  const timeZone = isKnownTimeZone(options.timeZone) ? options.timeZone : "UTC";
  const lines = unfoldIcsLines(text);

  if (!lines.some((line) => /^BEGIN:VCALENDAR\s*$/i.test(line))) {
    throw new IcsParseError("That file isn't a calendar — it has no BEGIN:VCALENDAR line.");
  }

  const { events, calendarName } = readVEvents(lines);
  if (events.length === 0) {
    throw new IcsParseError("That calendar file has no entries in it.");
  }

  const entries: IcsEntry[] = [];
  const rejected: IcsRejection[] = [];

  for (const event of events) {
    const read = readVEvent(event, timeZone);
    if ("reason" in read) rejected.push(read);
    else entries.push(read);
  }

  return { calendarName, entries, rejected };
}

function readVEvent(event: RawEvent, timeZone: string): IcsEntry | IcsRejection {
  const property = (name: string) => event.properties.get(name);
  const text = (name: string) => {
    const line = property(name);
    return line ? unescapeIcsText(line.value).trim() || null : null;
  };

  const uid = text("UID");
  const title = text("SUMMARY");
  const reject = (reason: string): IcsRejection => ({ index: event.index, uid, title, reason });

  if (!uid) {
    return reject("No UID — without one, importing this file twice would duplicate the entry.");
  }
  if (property("RRULE") || property("RDATE")) {
    return reject("It repeats. Only the first occurrence could be imported, so it was left out.");
  }
  if (text("STATUS")?.toUpperCase() === "CANCELLED") {
    return reject("Cancelled in the file — importing it would block a night for nothing.");
  }

  const startLine = property("DTSTART");
  if (!startLine) return reject("No start date.");
  const rawStart = parseIcsDateTimeValue(startLine.value);
  if (!rawStart) return reject(`Couldn't read the start date "${startLine.value.trim()}".`);

  const start = resolveDateTime(rawStart, startLine.parameters.TZID, timeZone);
  const caveats: string[] = [];
  if (start.caveat) caveats.push(start.caveat);

  const end = readEnd(event, rawStart, start, timeZone);
  if (end?.caveat) caveats.push(end.caveat);

  // Same rule the sync seam applies: an entry that ends where it starts carries a
  // null `endDate`, so `end_date > date` keeps meaning "this runs across days".
  let endDate = end && end.date > start.date ? end.date : null;
  let endTime = start.time === null ? null : (end?.time ?? null);

  // An entry running to midnight ends at the end of ITS day, not at the start of
  // the next. Taken literally a 22:00–24:00 gig spans two days, and a two-day
  // span blocks both of them whole — the availability rule cannot describe the
  // middle of a range with one pair of times. One clamp, one day back.
  if (endTime === "00:00:00" && endDate !== null && endDate === shiftDay(start.date, 1)) {
    endDate = null;
    endTime = "23:59:59";
  }

  return {
    index: event.index,
    uid,
    title: title || UNTITLED,
    date: start.date,
    endDate,
    startTime: start.time,
    endTime,
    location: text("LOCATION"),
    caveat: caveats.length > 0 ? caveats.join(" ") : null,
  };
}

/**
 * Where the entry ends: `DTEND`, or `DTSTART` + `DURATION`, or nothing.
 *
 * An all-day `DTEND` is EXCLUSIVE (§3.6.1) — `20260830`–`20260831` is ONE day —
 * so it steps back to the last day the entry actually covers. Getting this
 * backwards is the classic off-by-one that makes a one-day entry occupy two.
 *
 * Nothing at all returns null, and the caller then stores a start with no end.
 * `lib/availability.ts` reads an unknown extent as the whole day on purpose:
 * over-blocking costs an enquiry, under-blocking double-books a night.
 */
function readEnd(
  event: RawEvent,
  rawStart: RawDateTime,
  start: ResolvedDateTime,
  timeZone: string,
): ResolvedDateTime | null {
  const endLine = event.properties.get("DTEND");
  if (endLine) {
    const rawEnd = parseIcsDateTimeValue(endLine.value);
    if (!rawEnd) return null;
    if (rawEnd.time === null) {
      // Exclusive, and only meaningful when it is actually after the start.
      const lastDay = shiftDay(rawEnd.date, -1);
      return { date: lastDay > start.date ? lastDay : start.date, time: null, caveat: null };
    }
    return resolveDateTime(rawEnd, endLine.parameters.TZID, timeZone);
  }

  const durationLine = event.properties.get("DURATION");
  if (!durationLine) return null;
  const seconds = parseIcsDurationSeconds(durationLine.value);
  if (seconds === null || seconds <= 0) return null;

  if (rawStart.time === null) {
    // A whole-day duration is a count of days, and the last one is inclusive.
    const days = Math.max(1, Math.round(seconds / 86_400));
    return { date: shiftDay(start.date, days - 1), time: null, caveat: null };
  }

  // Add the duration in the frame the start is already expressed in. `Date.UTC`
  // is arithmetic on the wall clock here, not a zone conversion: both ends are
  // wall-clock values in the same zone, so a DST jump between them is a change
  // the file did not describe and must not be invented.
  const [year, month, day] = start.date.split("-").map(Number);
  const [hour, minute, second] = (start.time ?? "00:00:00").split(":").map(Number);
  const moved = new Date(
    Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1, hour ?? 0, minute ?? 0, second ?? 0) +
      seconds * 1000,
  );
  const pad = (value: number) => String(value).padStart(2, "0");
  return {
    date: `${moved.getUTCFullYear()}-${pad(moved.getUTCMonth() + 1)}-${pad(moved.getUTCDate())}`,
    time: `${pad(moved.getUTCHours())}:${pad(moved.getUTCMinutes())}:${pad(moved.getUTCSeconds())}`,
    caveat: null,
  };
}
