/**
 * THE RUN OF SHOW AS A TEMPLATE — the starting point Ran wrote out, and a saved
 * schedule in both directions (ClickUp `123qy9rpvfq`).
 *
 * Pure and React-free: every interesting case here is a clock (a curfew after
 * midnight, an event with no times at all, a template landing on a different night),
 * and those are worth pinning in a test rather than clicking through.
 *
 * ## A saved schedule stores TIME OF DAY
 *
 * Not instants: a run of show reused on another night is useless as absolute dates.
 * Not offsets from doors either, though that was the other candidate — a venue has a
 * routine about the CLOCK (*"we always open at 19:00"*), and clock times need no
 * anchor to apply, so a template works on an event that has no doors time yet.
 *
 * `dayOffset` is the part that is not optional. A 01:00 curfew belongs to the day
 * AFTER the show, and a bare `HH:MM` would place it twelve hours before doors on the
 * same date — silently, and on the one row nobody checks twice. The card already draws
 * a day pill for exactly this, so the concept is not new; storing it keeps a 01:00
 * curfew at 01:00 the following morning wherever the template lands.
 */

/** One row of a stored `schedule` template. Mirrors the API's Zod schema. */
export interface ScheduleTemplateItem {
  label: string;
  category: "production" | "crew";
  /** Offset-free wall clock, `HH:MM` on a 24-hour clock (decisions #10). */
  time: string;
  /** 0 = the show day, 1 = after midnight. */
  dayOffset: 0 | 1;
}

export interface ScheduleTemplatePayload {
  items: ScheduleTemplateItem[];
}

/** What the card hands to the editor — the API's own `NewScheduleItem` shape. */
export interface ScheduleDraft {
  localDateTime: string | null;
  label: string;
  category: "production" | "crew";
}

/** The event facts a starting point is built from. All optional: most nights have some. */
export interface ScheduleAnchor {
  /** `yyyy-mm-dd`. Without it there is no day to hang times on. */
  eventDate: string | null;
  doorTime: string | null;
  startTime: string | null;
  endTime: string | null;
  curfew: string | null;
}

/**
 * RAN'S STARTING POINT, in his order and his words.
 *
 * *"Get it"* is read as **"Get in"**: the load-in sequence is get in, then load in, and
 * "get it" is not a row anybody puts on a run of show. Recorded rather than silently
 * corrected — if he meant something else, this line is where to fix it.
 *
 * `fromDoors` is minutes relative to doors, used ONLY for the rows the event itself
 * knows nothing about. Doors, show, end and curfew take the event's real values when it
 * has them (see `startingPointDrafts`), because a starting point that contradicted the
 * times already on the screen would be worse than no starting point.
 *
 * The offsets are a conventional club load-in, and they are a suggestion by
 * construction: every row lands in an editable field.
 */
export const DEFAULT_RUN_OF_SHOW: readonly {
  label: string;
  category: "production" | "crew";
  fromDoors: number;
  /** Which event column supplies the time when the event has one. */
  anchor?: "doorTime" | "startTime" | "endTime" | "curfew";
}[] = [
  { label: "Get in", category: "crew", fromDoors: -300 },
  { label: "Load in", category: "crew", fromDoors: -270 },
  { label: "Line Check", category: "production", fromDoors: -210 },
  { label: "Sound Check", category: "production", fromDoors: -180 },
  { label: "Dinner", category: "crew", fromDoors: -90 },
  { label: "Doors Open", category: "production", fromDoors: 0, anchor: "doorTime" },
  { label: "Show Time", category: "production", fromDoors: 60, anchor: "startTime" },
  { label: "End Time", category: "production", fromDoors: 240, anchor: "endTime" },
  { label: "Curfew", category: "production", fromDoors: 300, anchor: "curfew" },
  { label: "Closing time", category: "crew", fromDoors: 360 },
];

/** Doors when the event has not said — 19:00, the hour a club opens. */
const FALLBACK_DOORS_MINUTES = 19 * 60;

/** `"19:30"` → 1170. Null for anything that is not a wall clock. */
function minutesOfDay(time: string | null | undefined): number | null {
  if (!time) return null;
  const match = /^(\d{2}):(\d{2})/.exec(time);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** 1170 → `"19:30"`. Wraps past midnight and reports how many days it carried. */
function clockFromMinutes(total: number): { time: string; dayOffset: number } {
  const dayOffset = Math.floor(total / 1440);
  const withinDay = ((total % 1440) + 1440) % 1440;
  const hours = String(Math.floor(withinDay / 60)).padStart(2, "0");
  const minutes = String(withinDay % 60).padStart(2, "0");
  return { time: `${hours}:${minutes}`, dayOffset };
}

/** `2026-10-14` + 1 → `2026-10-15`. Local dates, so no timezone can shift the day. */
function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) return date;
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

/**
 * The starting point for this event, ready to insert.
 *
 * Returns `[]` with no event date: there is no day to hang ten times on, and inserting
 * ten dateless rows would be a list of labels pretending to be a schedule.
 */
export function startingPointDrafts(anchor: ScheduleAnchor): ScheduleDraft[] {
  const eventDate = anchor.eventDate;
  if (!eventDate) return [];
  const doorsMinutes = minutesOfDay(anchor.doorTime) ?? FALLBACK_DOORS_MINUTES;

  return DEFAULT_RUN_OF_SHOW.map((row) => {
    // The event's own time wins wherever it has one; the offset is the fallback.
    const own = row.anchor ? minutesOfDay(anchor[row.anchor]) : null;
    /*
     * A time the event states is a time on SOME day, and which day is not in the
     * column: a 01:00 curfew is tomorrow. Anything earlier in the clock than doors is
     * therefore the following morning — the same rule the offsets get for free by
     * being arithmetic.
     */
    const minutes =
      own === null ? doorsMinutes + row.fromDoors : own < doorsMinutes ? own + 1440 : own;
    const { time, dayOffset } = clockFromMinutes(minutes);
    return {
      label: row.label,
      category: row.category,
      localDateTime: `${addDays(eventDate, dayOffset)}T${time}`,
    };
  });
}

/**
 * Turn the schedule on screen into a stored template.
 *
 * An item with no time is dropped rather than stored timeless: a template's whole job
 * is to put times on a night, and a row that carries none would come back as an
 * unschedulable label. The event's own date decides what counts as "the next day".
 */
export function scheduleTemplateFromItems(
  items: readonly { localDateTime?: string | null; label: string; category?: string | null }[],
  eventDate: string | null,
): ScheduleTemplatePayload {
  const templateItems: ScheduleTemplateItem[] = [];
  for (const item of items) {
    const stamp = item.localDateTime;
    if (!stamp) continue;
    const [datePart, timePart] = stamp.split("T");
    const time = timePart?.slice(0, 5);
    if (!time || minutesOfDay(time) === null) continue;
    // Anything on a later date than the show is "after midnight" — capped at one day,
    // which is as far as a run of show reaches.
    const dayOffset = eventDate && datePart && datePart > eventDate ? 1 : 0;
    templateItems.push({
      label: item.label,
      category: item.category === "crew" ? "crew" : "production",
      time,
      dayOffset,
    });
  }
  return { items: templateItems };
}

/** Read a stored payload back, ignoring anything that is not a usable row. */
export function readScheduleTemplatePayload(payload: unknown): ScheduleTemplatePayload {
  const items = (payload as { items?: unknown })?.items;
  if (!Array.isArray(items)) return { items: [] };
  const usable: ScheduleTemplateItem[] = [];
  for (const raw of items) {
    const row = raw as Partial<ScheduleTemplateItem>;
    if (typeof row.label !== "string" || row.label === "") continue;
    if (typeof row.time !== "string" || minutesOfDay(row.time) === null) continue;
    usable.push({
      label: row.label,
      category: row.category === "crew" ? "crew" : "production",
      time: row.time,
      dayOffset: row.dayOffset === 1 ? 1 : 0,
    });
  }
  return { items: usable };
}

/** Apply a stored template to an event's date. `[]` when there is no date to apply it to. */
export function draftsFromScheduleTemplate(
  payload: ScheduleTemplatePayload,
  eventDate: string | null,
): ScheduleDraft[] {
  if (!eventDate) return [];
  return payload.items.map((item) => ({
    label: item.label,
    category: item.category,
    localDateTime: `${addDays(eventDate, item.dayOffset)}T${item.time}`,
  }));
}
