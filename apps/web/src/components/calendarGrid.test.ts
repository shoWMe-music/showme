/**
 * The calendar's date arithmetic.
 *
 * All of it is pure and none of it was asserted, which is a bad combination for
 * code whose bugs are invisible: a grid that starts on the wrong weekday, a range
 * that ends a day short, or a step that jumps a month while the reader is looking
 * at one day all render as a perfectly plausible calendar. The cases below are
 * chosen for the boundaries that hide those — month ends, week-straddles, leap
 * years, and the DST changeovers, where naive day arithmetic silently repeats or
 * skips a date.
 *
 * The suite runs under `TZ=Europe/Stockholm` (vitest.config.ts), so the March and
 * October DST transitions are real here rather than hypothetical.
 */
import { describe, expect, it } from "vitest";
import {
  type CalendarView,
  buildMonthGrid,
  buildWeekGrid,
  dayKey,
  dayTitle,
  monthTitle,
  queryRange,
  startOfWeek,
  stepByView,
  trimTrailingWeeks,
  viewRange,
  viewTitle,
  weekTitle,
} from "./calendarGrid";

/** A local-midnight Date for a `yyyy-mm-dd`, so no test writes month-index maths. */
function day(key: string): Date {
  const [year, month, date] = key.split("-").map(Number);
  return new Date(year ?? 0, (month ?? 1) - 1, date ?? 1);
}

describe("dayKey", () => {
  it("keys a Date by its LOCAL day, so no cell is off by one", () => {
    expect(dayKey(new Date(2026, 8, 13))).toBe("2026-09-13");
    expect(dayKey(new Date(2026, 8, 13, 23, 59))).toBe("2026-09-13");
    expect(dayKey(new Date(2026, 0, 1, 0, 0))).toBe("2026-01-01");
  });

  it("zero-pads, so keys sort and compare as strings", () => {
    expect(dayKey(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(dayKey(new Date(2026, 10, 9))).toBe("2026-11-09");
  });
});

describe("buildMonthGrid — Monday-first, whole weeks", () => {
  it("always returns six whole weeks, whatever the month's shape", () => {
    for (const month of ["2026-02-01", "2026-09-01", "2024-02-01", "2026-08-01"]) {
      expect(buildMonthGrid(day(month))).toHaveLength(42);
    }
  });

  /**
   * Monday-first is the European convention the product is built for
   * (decisions #17). `getDay()` is Sunday-first, so this is the one line in the
   * module where an off-by-one shifts the whole grid a day sideways.
   */
  it("starts on the Monday on or before the first of the month", () => {
    // 1 September 2026 is a Tuesday, so the grid opens on Monday 31 August.
    expect(buildMonthGrid(day("2026-09-01"))[0]?.key).toBe("2026-08-31");
    // 1 February 2026 is a Sunday — the worst case, six leading spill days.
    expect(buildMonthGrid(day("2026-02-01"))[0]?.key).toBe("2026-01-26");
  });

  it("opens on the first itself when the month begins on a Monday", () => {
    // 1 June 2026 is a Monday: no spill at all on the leading edge.
    expect(buildMonthGrid(day("2026-06-01"))[0]?.key).toBe("2026-06-01");
  });

  it("marks spill days as outside the month and the rest as inside", () => {
    const grid = buildMonthGrid(day("2026-09-15"));
    expect(grid.filter((cell) => cell.inMonth)).toHaveLength(30);
    expect(grid[0]?.inMonth).toBe(false);
    expect(grid.find((cell) => cell.key === "2026-09-01")?.inMonth).toBe(true);
    expect(grid.find((cell) => cell.key === "2026-09-30")?.inMonth).toBe(true);
  });

  it("counts a leap February as 29 days and a common one as 28", () => {
    expect(buildMonthGrid(day("2024-02-10")).filter((cell) => cell.inMonth)).toHaveLength(29);
    expect(buildMonthGrid(day("2026-02-10")).filter((cell) => cell.inMonth)).toHaveLength(28);
  });

  /**
   * The grid is built by mutating one cursor with `setDate(+1)`. Across a spring
   * DST jump that is exactly where a naive implementation repeats a day, so the
   * keys must still be 42 distinct, consecutive dates.
   */
  it("advances one calendar day at a time across a DST change", () => {
    for (const month of ["2026-03-01", "2026-10-01"]) {
      const keys = buildMonthGrid(day(month)).map((cell) => cell.key);
      expect(new Set(keys).size).toBe(42);
      expect([...keys].sort()).toEqual(keys);
    }
  });

  it("is a fresh Date per cell, so a caller mutating one cannot corrupt the grid", () => {
    const grid = buildMonthGrid(day("2026-09-01"));
    grid[0]?.date.setFullYear(1999);
    expect(grid[1]?.date.getFullYear()).toBe(2026);
  });
});

describe("trimTrailingWeeks — no empty sixth row", () => {
  it("drops a trailing week that is entirely spill", () => {
    // September 2026 fits in five weeks; the sixth is all October.
    const trimmed = trimTrailingWeeks(buildMonthGrid(day("2026-09-01")));
    expect(trimmed).toHaveLength(35);
    expect(trimmed.at(-1)?.key).toBe("2026-10-04");
  });

  it("keeps all six weeks when the month genuinely needs them", () => {
    // 1 August 2026 is a Saturday and August has 31 days, so the 31st lands alone
    // in a sixth week. That week is NOT spill and must survive the trim.
    const trimmed = trimTrailingWeeks(buildMonthGrid(day("2026-08-01")));
    expect(trimmed).toHaveLength(42);
    expect(trimmed.find((cell) => cell.key === "2026-08-31")?.inMonth).toBe(true);
  });

  it("trims a February that starts on a Sunday to five weeks", () => {
    // 1 February 2026 is a Sunday, so the 28th falls on a Saturday in week five
    // and the sixth week is entirely March.
    expect(trimTrailingWeeks(buildMonthGrid(day("2026-02-01")))).toHaveLength(35);
  });

  /**
   * A month can be drawn in four weeks only when it is exactly 28 days AND starts
   * on a Monday. The floor of four rows keeps the grid from changing height for
   * anything else, which would make the page jump as the reader pages through.
   */
  it("never trims below four weeks", () => {
    for (const month of ["2026-02-01", "2026-09-01", "2026-06-01", "2024-02-01"]) {
      const trimmed = trimTrailingWeeks(buildMonthGrid(day(month)));
      expect(trimmed.length).toBeGreaterThanOrEqual(28);
      expect(trimmed.length % 7).toBe(0);
    }
  });
});

describe("startOfWeek / buildWeekGrid", () => {
  it("finds the Monday of the week containing the date", () => {
    // 13 September 2026 is a Sunday — the case a Sunday-first assumption gets
    // wrong by a full week rather than by a day.
    expect(dayKey(startOfWeek(day("2026-09-13")))).toBe("2026-09-07");
    expect(dayKey(startOfWeek(day("2026-09-07")))).toBe("2026-09-07");
    expect(dayKey(startOfWeek(day("2026-09-08")))).toBe("2026-09-07");
  });

  it("returns local midnight, not the time it was handed", () => {
    const start = startOfWeek(new Date(2026, 8, 9, 17, 45));
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
  });

  it("builds seven consecutive days from that Monday", () => {
    expect(buildWeekGrid(day("2026-09-13")).map((cell) => cell.key)).toEqual([
      "2026-09-07",
      "2026-09-08",
      "2026-09-09",
      "2026-09-10",
      "2026-09-11",
      "2026-09-12",
      "2026-09-13",
    ]);
  });

  /**
   * On a week that straddles a boundary `inMonth` keeps its month-grid meaning —
   * "belongs to the reference's month" — so it is true on one side and false on
   * the other. Asserted because it is the surprising half of the contract.
   */
  it("marks the far side of a month boundary as out of month", () => {
    const cells = buildWeekGrid(day("2026-10-01"));
    expect(cells.find((cell) => cell.key === "2026-09-30")?.inMonth).toBe(false);
    expect(cells.find((cell) => cell.key === "2026-10-01")?.inMonth).toBe(true);
  });

  it("stays seven distinct days across a DST change", () => {
    for (const inWeek of ["2026-03-29", "2026-10-25"]) {
      const keys = buildWeekGrid(day(inWeek)).map((cell) => cell.key);
      expect(new Set(keys).size).toBe(7);
    }
  });
});

describe("stepByView — the arrows move what the reader is looking at", () => {
  it("steps a month at a time in month view, landing on the first", () => {
    expect(dayKey(stepByView("month", day("2026-09-15"), 1))).toBe("2026-10-01");
    expect(dayKey(stepByView("month", day("2026-09-15"), -1))).toBe("2026-08-01");
  });

  it("rolls the year over at both ends", () => {
    expect(dayKey(stepByView("month", day("2026-12-10"), 1))).toBe("2027-01-01");
    expect(dayKey(stepByView("month", day("2026-01-10"), -1))).toBe("2025-12-01");
  });

  /**
   * Stepping a month from the 31st is where date arithmetic classically slips:
   * `new Date(2026, 0 + 1, 31)` is 3 March. Anchoring on the 1st is what avoids
   * it, so this pins the behaviour rather than the implementation.
   */
  it("does not skip a short month when stepping from the 31st", () => {
    expect(dayKey(stepByView("month", day("2026-01-31"), 1))).toBe("2026-02-01");
  });

  it("steps seven days in week view and one in day view", () => {
    expect(dayKey(stepByView("week", day("2026-09-13"), 1))).toBe("2026-09-20");
    expect(dayKey(stepByView("week", day("2026-09-13"), -1))).toBe("2026-09-06");
    expect(dayKey(stepByView("day", day("2026-09-13"), 1))).toBe("2026-09-14");
    expect(dayKey(stepByView("day", day("2026-09-30"), 1))).toBe("2026-10-01");
  });

  it("goes nowhere on a zero step, in every view", () => {
    for (const view of ["month", "week", "day"] as CalendarView[]) {
      const stepped = stepByView(view, day("2026-09-01"), 0);
      expect(dayKey(stepped)).toBe("2026-09-01");
    }
  });
});

describe("viewRange — the inclusive span on screen", () => {
  it("spans exactly the month, first to last", () => {
    expect(viewRange("month", day("2026-09-15"))).toEqual({
      from: "2026-09-01",
      to: "2026-09-30",
    });
    // February's last day is the classic off-by-one; both lengths asserted.
    expect(viewRange("month", day("2026-02-15")).to).toBe("2026-02-28");
    expect(viewRange("month", day("2024-02-15")).to).toBe("2024-02-29");
    expect(viewRange("month", day("2026-12-15")).to).toBe("2026-12-31");
  });

  it("spans Monday to Sunday in week view", () => {
    expect(viewRange("week", day("2026-09-13"))).toEqual({
      from: "2026-09-07",
      to: "2026-09-13",
    });
  });

  it("is the same day at both ends in day view", () => {
    expect(viewRange("day", day("2026-09-13"))).toEqual({
      from: "2026-09-13",
      to: "2026-09-13",
    });
  });
});

describe("queryRange — deliberately wider than the view", () => {
  /**
   * The fetch window is whole months, not the visible days. A week straddling a
   * boundary needs both months, and the availability-share modal reads the same
   * feed over a window of the sharer's choosing — narrowing the fetch to the seven
   * visible days would quietly starve it.
   */
  it("widens a straddling week to cover both months in full", () => {
    expect(queryRange("week", day("2026-10-01"))).toEqual({
      from: "2026-09-01",
      to: "2026-10-31",
    });
  });

  it("widens a single day to its whole month", () => {
    expect(queryRange("day", day("2026-09-13"))).toEqual({
      from: "2026-09-01",
      to: "2026-09-30",
    });
  });

  it("leaves a month view alone — it is already whole months", () => {
    expect(queryRange("month", day("2026-09-15"))).toEqual(viewRange("month", day("2026-09-15")));
  });

  it("always covers at least everything the view shows", () => {
    for (const view of ["month", "week", "day"] as CalendarView[]) {
      for (const reference of ["2026-01-01", "2026-02-28", "2026-09-13", "2026-12-31"]) {
        const visible = viewRange(view, day(reference));
        const fetched = queryRange(view, day(reference));
        expect(fetched.from <= visible.from).toBe(true);
        expect(fetched.to >= visible.to).toBe(true);
      }
    }
  });
});

describe("the headings, which all read through lib/format", () => {
  it("titles a month with the month spelled out and the year", () => {
    expect(monthTitle(day("2026-09-15"))).toBe("September 2026");
  });

  it("says a month and year once for a week inside one month", () => {
    expect(weekTitle(day("2026-09-13"))).toBe("7 – 13 September 2026");
  });

  it("spells both sides out for a week across a month boundary", () => {
    // Monday 28 September – Sunday 4 October 2026: the year still prints once.
    expect(weekTitle(day("2026-10-01"))).toBe("28 Sept – 4 Oct 2026");
  });

  it("spells both sides in full for a week across a year boundary", () => {
    // Monday 28 December 2026 – Sunday 3 January 2027.
    expect(weekTitle(day("2026-12-30"))).toBe("28 Dec 2026 – 3 Jan 2027");
  });

  it("leads a day heading with the weekday", () => {
    expect(dayTitle(day("2026-11-02"))).toBe("Mon, 2 Nov 2026");
  });

  it("routes viewTitle to the heading for the current view", () => {
    const reference = day("2026-09-13");
    expect(viewTitle("month", reference)).toBe(monthTitle(reference));
    expect(viewTitle("week", reference)).toBe(weekTitle(reference));
    expect(viewTitle("day", reference)).toBe(dayTitle(reference));
  });
});
