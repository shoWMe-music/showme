/** Pure, presentational-friendly helpers for the two month calendars. No React,
 * no data fetching — just date arithmetic so the grid components stay dumb. */

export const WEEKDAYS_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** A single cell in a Monday-first month grid. */
export interface MonthCell {
  date: Date;
  /** `yyyy-mm-dd` key, handy for marked-date lookups. */
  key: string;
  /** Whether the cell belongs to the reference month (vs. spill from siblings). */
  inMonth: boolean;
}

/** `yyyy-mm-dd` for a Date, in local time (matches how day keys are compared). */
export function dayKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Build a Monday-first grid (always whole weeks) covering `reference`'s month. */
export function buildMonthGrid(reference: Date): MonthCell[] {
  const year = reference.getFullYear();
  const month = reference.getMonth();
  const first = new Date(year, month, 1);
  // getDay(): 0=Sun..6=Sat → shift so Monday=0.
  const leadingBlanks = (first.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - leadingBlanks);

  const cells: MonthCell[] = [];
  const cursor = new Date(start);
  // Six weeks covers every possible month layout.
  for (let index = 0; index < 42; index += 1) {
    cells.push({
      date: new Date(cursor),
      key: dayKey(cursor),
      inMonth: cursor.getMonth() === month,
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return cells;
}

/** Trim trailing all-spill weeks so short months don't render an empty 6th row. */
export function trimTrailingWeeks(cells: MonthCell[]): MonthCell[] {
  const weeks: MonthCell[][] = [];
  for (let index = 0; index < cells.length; index += 7) {
    weeks.push(cells.slice(index, index + 7));
  }
  const kept = weeks.filter((week, index) => index < 4 || week.some((cell) => cell.inMonth));
  return kept.flat();
}

export function monthTitle(reference: Date): string {
  return reference.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}
