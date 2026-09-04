/**
 * Date formatting — the module ~19 screens read a day through.
 *
 * The suite exists because of the bug in the third case below, and it lived in
 * `apps/api` for a while because that was the only package with a vitest runner.
 * `apps/web` has its own now (`vitest.config.ts`), so it sits beside the module
 * it covers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  dayKey,
  formatAmount,
  formatDate,
  formatDay,
  formatDayWithWeekday,
  formatFileSize,
  formatMoney,
  formatMoneyExact,
  formatMonthYear,
  formatTime,
  parseDayLocal,
  relativeTime,
} from "./format";

describe("parseDayLocal", () => {
  it("reads a `date` column as a LOCAL day, never UTC midnight", () => {
    // `new Date("2026-09-13")` is UTC midnight, which prints as the 12th west of
    // Greenwich. Every event date in the app is a bare `date` column.
    expect(formatDay("2026-09-13")).toBe("13 Sept 2026");
    expect(dayKey("2026-09-13")).toBe("2026-09-13");
  });

  it("reads an offset-free wall clock as local and keeps its time", () => {
    // decisions #10 — event times travel as `yyyy-mm-ddThh:mm` with no zone.
    expect(formatDate("2026-09-13T19:00", { hour: "2-digit", minute: "2-digit" })).toContain(
      "19:00",
    );
  });

  it("does NOT flatten a zoned instant onto local midnight", () => {
    // The regression this file was written for: an UNANCHORED day pattern also
    // matched the head of a full ISO timestamp, so a zoned instant took the
    // local-midnight branch — throwing the clock away and naming the UTC day.
    expect(parseDayLocal("2026-09-13T22:30:00.000Z")?.getUTCHours()).toBe(22);
    expect(
      formatDate("2026-09-13T22:30:00.000Z", { hour: "2-digit", minute: "2-digit" }),
    ).not.toContain("00:00");
    expect(parseDayLocal("2026-01-01T00:30:00+02:00")?.getUTCHours()).toBe(22);
  });

  it("returns null for junk rather than an Invalid Date", () => {
    expect(parseDayLocal("nonsense")).toBeNull();
    expect(formatDay("nonsense")).toBe("—");
    expect(dayKey(null)).toBeNull();
  });

  /**
   * The anchor has two ends, and only one of them was the reported bug. A pattern
   * anchored at the start but not the end would accept `2026-09-13-garbage` and
   * silently name a day the caller never wrote.
   */
  it("rejects a day with anything trailing it", () => {
    expect(parseDayLocal("2026-09-13-and-then-some")).toBeNull();
    expect(parseDayLocal("2026-09-13T19:00 (Stockholm)")).toBeNull();
  });

  /**
   * decisions #10: an event time travels with NO zone and means the wall clock at
   * the venue. Shifting it into the reader's zone would move a 19:00 doors time.
   * `getHours()` is local, so this asserts the clock survived the parse intact.
   */
  it("keeps an offset-free wall clock exactly as written, whatever the reader's zone", () => {
    const parsed = parseDayLocal("2026-09-13T19:00");
    expect(parsed?.getHours()).toBe(19);
    expect(parsed?.getMinutes()).toBe(0);
    expect(parsed?.getDate()).toBe(13);
    expect(parseDayLocal("2026-09-13T19:00:30.250")?.getSeconds()).toBe(0);
  });

  /**
   * `dayKey` reads its own output. A round trip that lost a day would put an
   * event on the wrong calendar cell — and the `?date=` link would then open that
   * wrong cell, so the mistake would look self-consistent.
   */
  it("round-trips a day through dayKey without drifting", () => {
    for (const day of ["2026-01-01", "2026-06-30", "2026-12-31", "2026-03-29"]) {
      expect(dayKey(parseDayLocal(day))).toBe(day);
    }
  });

  /**
   * A `Date` at 23:30 local names TODAY. Reading `toISOString()` instead would
   * name tomorrow east of Greenwich, which is the same class of bug as the one
   * above, arrived at from the other direction.
   */
  it("keys a late-evening Date to the local day, not the UTC one", () => {
    expect(dayKey(new Date(2026, 8, 13, 23, 30))).toBe("2026-09-13");
    expect(dayKey(new Date(2026, 8, 13, 0, 30))).toBe("2026-09-13");
  });
});

describe("the app's ONE date format — day first, month named, year always", () => {
  /**
   * Day-first because the product is European (decisions #17) and "09/13" is
   * ambiguous to the reader it was written for; the year because a booking
   * calendar holds next year's shows beside this year's. Both halves were a
   * reported bug (ClickUp 86cbaxud0), so both are pinned.
   */
  it("puts the day first, names the month and always carries the year", () => {
    expect(formatDay("2026-09-13")).toBe("13 Sept 2026");
    expect(formatDay("2026-01-02")).toBe("2 Jan 2026");
    expect(formatDay("2027-11-30")).toBe("30 Nov 2027");
  });

  it("never renders a month-first date", () => {
    // The failure mode is US ordering: "Sept 13, 2026" or "09/13/2026".
    expect(formatDay("2026-09-13")).not.toMatch(/^\w+\s+\d/);
    expect(formatDay("2026-09-13")).not.toContain("/");
  });

  it("leads with the weekday when the reader is being asked to act on the date", () => {
    expect(formatDayWithWeekday("2026-11-02")).toBe("Mon, 2 Nov 2026");
  });

  it("heads a calendar with the month spelled out", () => {
    expect(formatMonthYear("2026-09-13")).toBe("September 2026");
    expect(formatMonthYear(new Date(2026, 0, 15))).toBe("January 2026");
    expect(formatMonthYear(null)).toBe("—");
  });

  it("prints the clock in 24-hour form", () => {
    expect(formatTime("2026-09-13T19:00")).toBe("19:00");
    expect(formatTime("2026-09-13T09:05")).toBe("09:05");
    expect(formatTime(null)).toBe("—");
  });

  /** Every formatter has to answer something for a null, and "—" is that answer. */
  it("renders an em dash for an absent date rather than an empty cell", () => {
    for (const render of [formatDay, formatDayWithWeekday, formatMonthYear, formatTime]) {
      expect(render(null)).toBe("—");
      expect(render(undefined)).toBe("—");
      expect(render("")).toBe("—");
    }
    expect(formatDate(null)).toBe("—");
  });
});

describe("money — minor units in, major units out", () => {
  /**
   * Amounts cross the API as STRINGS of minor units (packages/db money.md),
   * because a bigint cannot survive JSON. Every one of these helpers therefore has
   * to divide by 100, and a helper that forgot would be off by two orders of
   * magnitude on a settlement.
   */
  it("divides minor units by 100 and rounds to whole units", () => {
    expect(formatMoney("150000", "EUR")).toBe("€1,500");
    expect(formatMoney(150000, "EUR")).toBe("€1,500");
    expect(formatMoney("0", "EUR")).toBe("€0");
  });

  it("keeps the currency it was given rather than defaulting silently", () => {
    expect(formatMoney("150000", "SEK")).toContain("1,500");
    expect(formatMoney("150000", "SEK")).not.toContain("€");
    expect(formatMoney("150000", "GBP")).toBe("£1,500");
  });

  /**
   * `formatMoney` rounds, so two different amounts can print the same text —
   * harmless in a total, and a self-contradiction in a sentence contrasting two
   * figures. That is the whole reason `formatMoneyExact` exists.
   */
  it("shows the minor unit only where a rounded collision would contradict the copy", () => {
    // Two amounts 9 cents apart that both print as €1,500 once rounded.
    expect(formatMoney("150040", "EUR")).toBe("€1,500");
    expect(formatMoney("150049", "EUR")).toBe("€1,500");
    expect(formatMoneyExact("150040", "EUR")).toBe("€1,500.40");
    expect(formatMoneyExact("150049", "EUR")).toBe("€1,500.49");
    expect(formatMoneyExact("5", "EUR")).toBe("€0.05");
  });

  /**
   * A number under the WRONG symbol is worse than a number under none, which is
   * why callers with an unknown denomination must reach for `formatAmount`
   * instead of letting a currency default in.
   */
  it("formats an amount with no symbol when the denomination isn't known", () => {
    expect(formatAmount("150000")).toBe("1,500");
    expect(formatAmount(null)).toBe("0");
    expect(formatAmount("150000")).not.toMatch(/[€$£]/);
  });

  /** Junk from the API must not reach a settlement screen as "€NaN". */
  it("renders a non-numeric or absent amount as zero, never NaN", () => {
    expect(formatMoney("not a number", "EUR")).toBe("€0");
    expect(formatMoney(null, "EUR")).toBe("€0");
    expect(formatMoney(Number.POSITIVE_INFINITY, "EUR")).toBe("€0");
    expect(formatAmount("not a number")).toBe("0");
    expect(formatMoneyExact(undefined, "EUR")).toBe("€0.00");
  });

  it("keeps a negative amount negative — a settlement line can owe", () => {
    expect(formatMoney("-150000", "EUR")).toContain("1,500");
    expect(formatMoney("-150000", "EUR")).toMatch(/-|\(/);
  });
});

describe("formatFileSize — decimal units, matching what the uploader's OS showed", () => {
  it("counts in decimal units, not binary ones", () => {
    expect(formatFileSize(999)).toBe("999 B");
    expect(formatFileSize(1000)).toBe("1.0 KB");
    expect(formatFileSize(1_000_000)).toBe("1.0 MB");
    expect(formatFileSize(1_000_000_000)).toBe("1.0 GB");
  });

  /** One decimal below ten, none above — "8.4 MB" reads; "8.42 MB" is noise. */
  it("shows one decimal below ten and rounds above it", () => {
    expect(formatFileSize(8_420_000)).toBe("8.4 MB");
    expect(formatFileSize(412_000)).toBe("412 KB");
  });

  /** Empty, not "0 B" — an unknown size should render as nothing at all. */
  it("returns nothing for an unknown or impossible size", () => {
    expect(formatFileSize(null)).toBe("");
    expect(formatFileSize(undefined)).toBe("");
    expect(formatFileSize(-1)).toBe("");
    expect(formatFileSize(Number.NaN)).toBe("");
    expect(formatFileSize(0)).toBe("0 B");
  });

  /** GB is the last unit — a terabyte stays in GB rather than falling off the list. */
  it("stops at GB rather than running past the end of the units", () => {
    expect(formatFileSize(2_000_000_000_000)).toBe("2000 GB");
  });
});

describe("relativeTime", () => {
  const now = new Date("2026-09-13T12:00:00.000Z");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("names the age in the largest unit that still reads as a number", () => {
    expect(relativeTime("2026-09-13T11:59:30.000Z")).toBe("just now");
    expect(relativeTime("2026-09-13T11:55:00.000Z")).toBe("5m ago");
    expect(relativeTime("2026-09-13T09:00:00.000Z")).toBe("3h ago");
    expect(relativeTime("2026-09-10T12:00:00.000Z")).toBe("3d ago");
  });

  /** "" rather than "NaN ago" — a bad timestamp renders as nothing. */
  it("returns nothing for an unparseable timestamp", () => {
    expect(relativeTime("nonsense")).toBe("");
    expect(relativeTime("")).toBe("");
  });
});
