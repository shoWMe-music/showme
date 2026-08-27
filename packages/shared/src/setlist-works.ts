/**
 * Reading `setlists.items` — the one shape the performed-works report is built on.
 *
 * `items` is an untyped `jsonb` array (the API's body schema is literally
 * `z.unknown()`), so every entry is read defensively. The only shape that exists
 * today is `{ title, duration }` with the duration in seconds; everything else
 * here is a tolerated variant, and anything unreadable becomes a NULL duration
 * rather than an invented one.
 *
 * WHY IN `shared` AND NOT IN THE WEB APP, where this parsing started: two
 * consumers now have to agree about what the setlist says. The browser renders
 * the works into the CSV an operator downloads, and the API snapshots the same
 * works into the `performance_reports` row that records the filing. If those two
 * readings could drift, the file the society receives and the record of what was
 * sent would describe different sets — which is the one thing a filing record
 * exists to prevent.
 */

/** One performed work, carrying exactly as much as the setlist actually holds. */
export interface SetlistWork {
  /** 1-based running order, because a PRO report is ordered. */
  readonly position: number;
  readonly title: string;
  /** Null when the entry carried no length — never guessed. */
  readonly durationSeconds: number | null;
  /**
   * The act that performed it, or null when the profile behind the setlist has
   * no name to read. A society's report is per PERFORMANCE and a night can have
   * three acts on it, so the work has to say whose it was — without it a support
   * slot's songs would be filed under the headliner.
   */
  readonly performer: string | null;
}

function workTitle(item: unknown): string {
  if (typeof item === "string") return item;
  if (item && typeof item === "object") {
    const record = item as Record<string, unknown>;
    const title = record.title ?? record.name ?? record.song;
    if (typeof title === "string" && title.trim()) return title;
  }
  return "Untitled";
}

function workSeconds(item: unknown): number | null {
  if (!item || typeof item !== "object") return null;
  const record = item as Record<string, unknown>;
  const raw = record.duration ?? record.durationSeconds ?? record.seconds ?? record.length;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const clock = raw.match(/^(\d+):(\d{2})$/);
    if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
    const minutes = Number(raw);
    if (!Number.isNaN(minutes)) return Math.round(minutes * 60);
  }
  return null;
}

/** One act's jsonb entries as ordered, filing-ready works. */
export function parseSetlistWorks(
  items: readonly unknown[],
  performer: string | null = null,
): SetlistWork[] {
  return items.map((item, index) => ({
    position: index + 1,
    title: workTitle(item),
    durationSeconds: workSeconds(item),
    performer,
  }));
}

/**
 * Several performers' sets as ONE ordered running order.
 *
 * A filing is about the SHOW, not about one act on it (`performance_reports` is
 * keyed on the event), so a three-band night reports every work performed that
 * night. The sets are concatenated in the order given and the positions are
 * renumbered across the whole evening — 1..n for the performance, which is what
 * a society's running order means.
 */
export function mergeSetlistWorks(
  sets: readonly { readonly performer: string | null; readonly items: readonly unknown[] }[],
): SetlistWork[] {
  return sets
    .flatMap((set) => parseSetlistWorks(set.items, set.performer))
    .map((work, index) => ({ ...work, position: index + 1 }));
}

/** `mm:ss`, or the empty string when the entry carried no length. */
export function formatDurationClock(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds)) return "";
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** Total runtime, or null when NOT ONE entry carried a length. */
export function totalDurationSeconds(works: readonly SetlistWork[]): number | null {
  const known = works.filter((work) => work.durationSeconds != null);
  if (known.length === 0) return null;
  return known.reduce((sum, work) => sum + (work.durationSeconds ?? 0), 0);
}
