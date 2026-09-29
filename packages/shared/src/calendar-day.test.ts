import { describe, expect, it } from "vitest";
import { formatCalendarDay } from "./calendar-day";

describe("a stored calendar day as a reader reads it", () => {
  it("turns the stored shape into the one every other surface shows", () => {
    // QA sweep run 13: "They asked about 2026-10-16." in a notification body.
    expect(formatCalendarDay("2026-10-16")).toBe("16 Oct 2026");
    expect(formatCalendarDay("2026-01-01")).toBe("1 Jan 2026");
    expect(formatCalendarDay("2026-12-31")).toBe("31 Dec 2026");
  });

  it("drops the leading zero from the day and keeps all four digits of the year", () => {
    // "05 Oct" is the machine's shape too. The BOUNDARY on both ends of the month table.
    expect(formatCalendarDay("2026-10-05")).toBe("5 Oct 2026");
    expect(formatCalendarDay("2026-02-29")).toBe("29 Feb 2026");
  });

  it("does not move the day, whatever zone the process runs in", () => {
    /*
     * THE REASON THIS IS A TABLE AND NOT `new Date(...)`. A stored `date` is a calendar day with no
     * instant: parsing it gives UTC midnight, and formatting that in a zone behind Greenwich moves
     * it to the previous day — a request for the 16th read as the 15th. Asserted by running the
     * same input under a westward TZ, which is what a developer laptop actually is.
     */
    const original = process.env.TZ;
    try {
      process.env.TZ = "America/Los_Angeles";
      expect(formatCalendarDay("2026-10-16")).toBe("16 Oct 2026");
      process.env.TZ = "Pacific/Kiritimati";
      expect(formatCalendarDay("2026-10-16")).toBe("16 Oct 2026");
    } finally {
      process.env.TZ = original;
    }
  });

  it("reads a timestamp's date part, since some callers hold one", () => {
    expect(formatCalendarDay("2026-10-16T21:30:00Z")).toBe("16 Oct 2026");
  });

  it("returns an unparseable value UNCHANGED, not a dash", () => {
    /*
     * These strings land in prose the reader cannot re-read from the source, so a surprising value
     * is better shown than replaced. The FALLBACK CHAIN and the UNSET case in one place.
     */
    expect(formatCalendarDay("someday")).toBe("someday");
    expect(formatCalendarDay("2026-13-01")).toBe("2026-13-01");
    expect(formatCalendarDay("")).toBe("");
    expect(formatCalendarDay(null)).toBe("");
    expect(formatCalendarDay(undefined)).toBe("");
  });
});
