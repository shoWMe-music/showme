/** Pure, presentational-friendly helpers for the two month calendars. No React,
 * no data fetching — just date arithmetic so the grid components stay dumb.
 *
 * Every heading it builds is printed by the shared formatters in `lib/format`,
 * so a calendar title reads the same as the same date anywhere else in the app. */

import { formatDate, formatDay, formatDayWithWeekday, formatMonthYear } from "../lib/format";

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
  return formatMonthYear(reference);
}

/** Which span of days the Calendar screen is showing. */
export type CalendarView = "month" | "week" | "day";

/** Monday-first start of the week containing `reference`, at local midnight. */
export function startOfWeek(reference: Date): Date {
  const weekdayFromMonday = (reference.getDay() + 6) % 7;
  return new Date(
    reference.getFullYear(),
    reference.getMonth(),
    reference.getDate() - weekdayFromMonday,
  );
}

/** The seven Monday-first cells of the week containing `reference`. `inMonth`
 * keeps its month-grid meaning ("belongs to the reference's month"), which for a
 * week straddling a month boundary is true on one side and false on the other. */
export function buildWeekGrid(reference: Date): MonthCell[] {
  const start = startOfWeek(reference);
  const cells: MonthCell[] = [];
  for (let index = 0; index < 7; index += 1) {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
    cells.push({ date, key: dayKey(date), inMonth: date.getMonth() === reference.getMonth() });
  }
  return cells;
}

/** Move the anchor date by one unit of the current view. The `<` / `>` buttons
 * must step what the reader is LOOKING at — stepping a month while a single day
 * is on screen would jump the reader somewhere they never asked to go. */
export function stepByView(view: CalendarView, reference: Date, offset: number): Date {
  if (view === "month") {
    return new Date(reference.getFullYear(), reference.getMonth() + offset, 1);
  }
  const days = view === "week" ? 7 * offset : offset;
  return new Date(reference.getFullYear(), reference.getMonth(), reference.getDate() + days);
}

/** The inclusive `yyyy-mm-dd` span a view puts on screen. */
export function viewRange(view: CalendarView, reference: Date): { from: string; to: string } {
  if (view === "day") {
    const key = dayKey(reference);
    return { from: key, to: key };
  }
  if (view === "week") {
    const cells = buildWeekGrid(reference);
    return { from: cells[0]?.key ?? dayKey(reference), to: cells[6]?.key ?? dayKey(reference) };
  }
  const year = reference.getFullYear();
  const month = reference.getMonth();
  return {
    from: dayKey(new Date(year, month, 1)),
    to: dayKey(new Date(year, month + 1, 0)),
  };
}

/** The window to ASK the API for: the whole month(s) the view touches. Wider than
 * the view on purpose — a week straddles two months, and the availability-share
 * modal reads the same feed over a window of the sharer's choosing, so narrowing
 * the fetch to the seven visible days would quietly starve it. */
export function queryRange(view: CalendarView, reference: Date): { from: string; to: string } {
  const range = viewRange(view, reference);
  const first = new Date(`${range.from}T00:00:00`);
  const last = new Date(`${range.to}T00:00:00`);
  return {
    from: dayKey(new Date(first.getFullYear(), first.getMonth(), 1)),
    to: dayKey(new Date(last.getFullYear(), last.getMonth() + 1, 0)),
  };
}

/** "17 – 23 August 2026", collapsing the repeated month/year: a week inside one
 * month says it once; a week across a boundary spells both sides out. */
export function weekTitle(reference: Date): string {
  const cells = buildWeekGrid(reference);
  const first = cells[0]?.date ?? reference;
  const last = cells[6]?.date ?? reference;
  if (first.getFullYear() !== last.getFullYear()) {
    return `${formatDay(dayKey(first))} – ${formatDay(dayKey(last))}`;
  }
  if (first.getMonth() !== last.getMonth()) {
    // The year is printed once, at the end, so the shared day format is asked
    // for without it — the one shape `formatDate` exists to serve.
    const dayAndMonth = (date: Date) =>
      formatDate(dayKey(date), { day: "numeric", month: "short" });
    return `${dayAndMonth(first)} – ${dayAndMonth(last)} ${last.getFullYear()}`;
  }
  return `${first.getDate()} – ${last.getDate()} ${monthTitle(first)}`;
}

/** "Thu, 20 Aug 2026" — the app's date, with the weekday the day view is about. */
export function dayTitle(reference: Date): string {
  return formatDayWithWeekday(dayKey(reference));
}

/** The screen heading for the current view. */
export function viewTitle(view: CalendarView, reference: Date): string {
  if (view === "week") return weekTitle(reference);
  if (view === "day") return dayTitle(reference);
  return monthTitle(reference);
}
