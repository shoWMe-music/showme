import { describe, expect, it } from "vitest";
import { formatCalendarDay, formatClockTime, pluralise } from "./calendar-day";

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

describe("formatClockTime", () => {
  it("drops the seconds Postgres serves", () => {
    expect(formatClockTime("19:00:00")).toBe("19:00");
    expect(formatClockTime("20:30:00")).toBe("20:30");
  });

  it("leaves a time that is already minute-precise alone", () => {
    expect(formatClockTime("19:00")).toBe("19:00");
  });

  it("pads a single-digit hour so a column of times lines up", () => {
    expect(formatClockTime("9:05:00")).toBe("09:05");
  });

  /*
   * NOT PARSED. A wall clock has no zone (decisions #10), so this must be the same string for every
   * reader — which a `Date` round-trip is not. Asserted by the one property a zone conversion could
   * not keep: the hour never moves.
   */
  it("returns the same hour whatever zone the reader is in", () => {
    for (const value of ["00:15:00", "23:45:00", "12:00:00"]) {
      expect(formatClockTime(value).slice(0, 2)).toBe(value.slice(0, 2));
    }
  });

  it("returns nothing for an absent time, and the value itself for one it cannot read", () => {
    expect(formatClockTime(null)).toBe("");
    expect(formatClockTime(undefined)).toBe("");
    expect(formatClockTime("")).toBe("");
    // Somebody else's to explain — blanking it would hide it.
    expect(formatClockTime("doors at nine")).toBe("doors at nine");
  });
});

describe("pluralise", () => {
  it("agrees with its count", () => {
    expect(pluralise(1, "item")).toBe("1 item");
    expect(pluralise(2, "item")).toBe("2 items");
    expect(pluralise(0, "item")).toBe("0 items");
  });

  it("takes an irregular plural rather than guessing one", () => {
    expect(pluralise(1, "entry", "entries")).toBe("1 entry");
    expect(pluralise(3, "entry", "entries")).toBe("3 entries");
  });

  /*
   * IT DOES NOT FORMAT THE NUMBER. The first draft used `toLocaleString()` and this machine's locale
   * made it "1 200 tickets" with a non-breaking space — a plural rule whose output depends on where it
   * runs. A caller that wants grouping formats the number before handing it over.
   */
  it("leaves the number exactly as given, whatever the locale", () => {
    expect(pluralise(1200, "ticket")).toBe("1200 tickets");
  });

  /*
   * A NEGATIVE COUNT IS PLURAL. Nothing produces one today, but a count can go negative through a bug
   * and "−1 ticket" reads as a deliberate singular — `Math.abs(count) === 1` would hide exactly that.
   */
  it("keeps a negative count plural", () => {
    expect(pluralise(-1, "ticket")).toBe("-1 tickets");
  });
});
