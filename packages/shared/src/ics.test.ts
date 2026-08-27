import { describe, expect, it } from "vitest";
import {
  IcsParseError,
  parseIcs,
  parseIcsContentLine,
  parseIcsDurationSeconds,
  unescapeIcsText,
  unfoldIcsLines,
} from "./ics";

/** Build a file with CRLF endings, the way every real exporter writes one. */
function icsFile(...lines: string[]): string {
  return `${["BEGIN:VCALENDAR", "VERSION:2.0", ...lines, "END:VCALENDAR"].join("\r\n")}\r\n`;
}

const STOCKHOLM = "Europe/Stockholm";

describe("unfoldIcsLines", () => {
  it("joins continuations that begin with a space or a tab", () => {
    const folded = "SUMMARY:A very long summary that had\r\n  to be folded\r\nUID:x\r\n\tmore";
    expect(unfoldIcsLines(folded)).toEqual([
      "SUMMARY:A very long summary that had to be folded",
      "UID:xmore",
    ]);
  });

  it("accepts bare LF and bare CR files, and strips a BOM", () => {
    expect(unfoldIcsLines("﻿A:1\nB:2")).toEqual(["A:1", "B:2"]);
    expect(unfoldIcsLines("A:1\rB:2")).toEqual(["A:1", "B:2"]);
  });
});

describe("parseIcsContentLine", () => {
  it("splits name, parameters and value", () => {
    expect(parseIcsContentLine("DTSTART;VALUE=DATE:20260830")).toEqual({
      name: "DTSTART",
      parameters: { VALUE: "DATE" },
      value: "20260830",
    });
  });

  it("does not split on a colon inside a quoted parameter", () => {
    const line = parseIcsContentLine('DTSTART;TZID="Odd:Zone;Name":20260830T190000');
    expect(line?.name).toBe("DTSTART");
    expect(line?.parameters.TZID).toBe("Odd:Zone;Name");
    expect(line?.value).toBe("20260830T190000");
  });

  it("upper-cases the property name so casing in the file does not matter", () => {
    expect(parseIcsContentLine("dtstart:20260830")?.name).toBe("DTSTART");
  });

  it("returns null for a line with no colon at all", () => {
    expect(parseIcsContentLine("NONSENSE")).toBeNull();
  });
});

describe("unescapeIcsText", () => {
  it("reverses the four TEXT escapes in one left-to-right pass", () => {
    expect(unescapeIcsText("Doors\\, then\\; show\\nSecond line")).toBe(
      "Doors, then; show\nSecond line",
    );
    // A literal backslash followed by a comma must NOT become an escaped comma.
    expect(unescapeIcsText("back\\\\,slash")).toBe("back\\,slash");
    expect(unescapeIcsText("upper\\Ncase")).toBe("upper\ncase");
  });
});

describe("parseIcsDurationSeconds", () => {
  it("reads weeks, days and clock parts", () => {
    expect(parseIcsDurationSeconds("PT1H30M")).toBe(5_400);
    expect(parseIcsDurationSeconds("P1D")).toBe(86_400);
    expect(parseIcsDurationSeconds("P1W")).toBe(604_800);
    expect(parseIcsDurationSeconds("-PT15M")).toBe(-900);
  });

  it("refuses anything that is not a duration", () => {
    expect(parseIcsDurationSeconds("P")).toBeNull();
    expect(parseIcsDurationSeconds("90 minutes")).toBeNull();
  });
});

describe("parseIcs — whole-file failures", () => {
  it("refuses a file that is not iCalendar", () => {
    expect(() => parseIcs("name,email\nA,a@b.c\n", { timeZone: "UTC" })).toThrow(IcsParseError);
  });

  it("refuses a calendar with no VEVENTs", () => {
    expect(() => parseIcs(icsFile("X-WR-CALNAME:Empty"), { timeZone: "UTC" })).toThrow(
      IcsParseError,
    );
  });
});

describe("parseIcs — the three DTSTART forms", () => {
  it("keeps an all-day entry as a bare day and steps the exclusive DTEND back", () => {
    const result = parseIcs(
      icsFile(
        "BEGIN:VEVENT",
        "UID:all-day@example.test",
        "DTSTART;VALUE=DATE:20260830",
        "DTEND;VALUE=DATE:20260901",
        "SUMMARY:Festival",
        "END:VEVENT",
      ),
      { timeZone: STOCKHOLM },
    );

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({
      uid: "all-day@example.test",
      title: "Festival",
      date: "2026-08-30",
      // 20260901 is EXCLUSIVE, so the entry's last day is the 31st.
      endDate: "2026-08-31",
      startTime: null,
      endTime: null,
    });
  });

  it("treats a one-day all-day entry's next-day DTEND as a single day", () => {
    const result = parseIcs(
      icsFile(
        "BEGIN:VEVENT",
        "UID:one-day@example.test",
        "DTSTART;VALUE=DATE:20260830",
        "DTEND;VALUE=DATE:20260831",
        "SUMMARY:Day off",
        "END:VEVENT",
      ),
      { timeZone: STOCKHOLM },
    );
    expect(result.entries[0]?.endDate).toBeNull();
  });

  it("re-expresses a UTC instant as the wall clock in the import's zone", () => {
    const result = parseIcs(
      icsFile(
        "BEGIN:VEVENT",
        "UID:utc@example.test",
        // 17:00Z on 30 August is CEST (+02:00) → 19:00 in Stockholm.
        "DTSTART:20260830T170000Z",
        "DTEND:20260830T200000Z",
        "SUMMARY:Show",
        "END:VEVENT",
      ),
      { timeZone: STOCKHOLM },
    );
    expect(result.entries[0]).toMatchObject({
      date: "2026-08-30",
      startTime: "19:00:00",
      endTime: "22:00:00",
      endDate: null,
    });
  });

  it("moves a TZID wall clock into the import's zone", () => {
    const result = parseIcs(
      icsFile(
        "BEGIN:VEVENT",
        "UID:tzid@example.test",
        // 19:00 in New York is 01:00 the NEXT day in Stockholm.
        "DTSTART;TZID=America/New_York:20260830T190000",
        "DTEND;TZID=America/New_York:20260830T210000",
        "SUMMARY:Call",
        "END:VEVENT",
      ),
      { timeZone: STOCKHOLM },
    );
    expect(result.entries[0]).toMatchObject({
      date: "2026-08-31",
      startTime: "01:00:00",
      endTime: "03:00:00",
    });
  });

  it("leaves a floating time exactly as written — that is what floating means", () => {
    const result = parseIcs(
      icsFile(
        "BEGIN:VEVENT",
        "UID:floating@example.test",
        "DTSTART:20260830T190000",
        "DTEND:20260830T210000",
        "SUMMARY:Rehearsal",
        "END:VEVENT",
      ),
      { timeZone: "America/New_York" },
    );
    expect(result.entries[0]).toMatchObject({ startTime: "19:00:00", endTime: "21:00:00" });
  });

  it("keeps the wall clock and says so when the TZID is not an IANA zone", () => {
    const result = parseIcs(
      icsFile(
        "BEGIN:VEVENT",
        "UID:outlook@example.test",
        'DTSTART;TZID="W. Europe Standard Time":20260830T190000',
        "SUMMARY:Outlook meeting",
        "END:VEVENT",
      ),
      { timeZone: STOCKHOLM },
    );
    expect(result.entries[0]?.startTime).toBe("19:00:00");
    expect(result.entries[0]?.caveat).toContain("W. Europe Standard Time");
  });
});

describe("parseIcs — the messy parts of a real file", () => {
  it("unfolds a long SUMMARY and unescapes its commas and semicolons", () => {
    const result = parseIcs(
      icsFile(
        "BEGIN:VEVENT",
        "UID:folded@example.test",
        "DTSTART;VALUE=DATE:20260830",
        "SUMMARY:Doors 19:00\\, support 20:00\\; headline 21:00 — a summary long e",
        " nough that a real exporter would have folded it right about here",
        "LOCATION:Debaser\\, Stockholm",
        "END:VEVENT",
      ),
      { timeZone: STOCKHOLM },
    );
    expect(result.entries[0]?.title).toBe(
      "Doors 19:00, support 20:00; headline 21:00 — a summary long enough that a real exporter would have folded it right about here",
    );
    expect(result.entries[0]?.location).toBe("Debaser, Stockholm");
  });

  it("ignores a VALARM's own properties instead of letting them land on the event", () => {
    const result = parseIcs(
      icsFile(
        "BEGIN:VEVENT",
        "UID:alarmed@example.test",
        "DTSTART:20260830T190000",
        "SUMMARY:Load-in",
        "BEGIN:VALARM",
        "TRIGGER:-PT15M",
        "SUMMARY:Reminder",
        "DESCRIPTION:Nag",
        "END:VALARM",
        "END:VEVENT",
      ),
      { timeZone: STOCKHOLM },
    );
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.title).toBe("Load-in");
  });

  it("ignores a VTIMEZONE block, RRULE and all", () => {
    const result = parseIcs(
      icsFile(
        "BEGIN:VTIMEZONE",
        "TZID:Europe/Stockholm",
        "BEGIN:DAYLIGHT",
        "DTSTART:19700329T020000",
        "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
        "END:DAYLIGHT",
        "END:VTIMEZONE",
        "BEGIN:VEVENT",
        "UID:after-tz@example.test",
        "DTSTART;VALUE=DATE:20260830",
        "SUMMARY:Only entry",
        "END:VEVENT",
      ),
      { timeZone: STOCKHOLM },
    );
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.uid).toBe("after-tz@example.test");
    expect(result.rejected).toHaveLength(0);
  });

  it("reads DURATION when there is no DTEND", () => {
    const result = parseIcs(
      icsFile(
        "BEGIN:VEVENT",
        "UID:duration@example.test",
        "DTSTART:20260830T220000",
        "DURATION:PT3H",
        "SUMMARY:Late set",
        "END:VEVENT",
      ),
      { timeZone: STOCKHOLM },
    );
    expect(result.entries[0]).toMatchObject({
      date: "2026-08-30",
      startTime: "22:00:00",
      endDate: "2026-08-31",
      endTime: "01:00:00",
    });
  });

  it("clamps an entry that runs to midnight back onto its own day", () => {
    const result = parseIcs(
      icsFile(
        "BEGIN:VEVENT",
        "UID:midnight@example.test",
        "DTSTART:20260830T220000",
        "DTEND:20260831T000000",
        "SUMMARY:Ends at midnight",
        "END:VEVENT",
      ),
      { timeZone: STOCKHOLM },
    );
    expect(result.entries[0]).toMatchObject({
      date: "2026-08-30",
      endDate: null,
      endTime: "23:59:59",
    });
  });

  it("titles an untitled entry rather than importing an empty name", () => {
    const result = parseIcs(
      icsFile(
        "BEGIN:VEVENT",
        "UID:untitled@example.test",
        "DTSTART;VALUE=DATE:20260830",
        "END:VEVENT",
      ),
      { timeZone: STOCKHOLM },
    );
    expect(result.entries[0]?.title).toBe("Busy");
  });
});

describe("parseIcs — what it refuses, one entry at a time", () => {
  it("rejects the unreadable entries and keeps the rest, numbered by file position", () => {
    const result = parseIcs(
      icsFile(
        "X-WR-CALNAME:Mixed bag",
        "BEGIN:VEVENT",
        "UID:no-start@example.test",
        "SUMMARY:No date",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "DTSTART;VALUE=DATE:20260830",
        "SUMMARY:No UID",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:repeat@example.test",
        "DTSTART:20260830T190000",
        "RRULE:FREQ=WEEKLY;COUNT=52",
        "SUMMARY:Weekly standup",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:gone@example.test",
        "DTSTART;VALUE=DATE:20260830",
        "STATUS:CANCELLED",
        "SUMMARY:Cancelled show",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:garbled@example.test",
        "DTSTART:not-a-date",
        "SUMMARY:Garbled",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:good@example.test",
        "DTSTART;VALUE=DATE:20260901",
        "SUMMARY:The one good entry",
        "END:VEVENT",
      ),
      { timeZone: STOCKHOLM },
    );

    expect(result.calendarName).toBe("Mixed bag");
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({ index: 5, uid: "good@example.test" });

    expect(result.rejected.map((rejection) => rejection.index)).toEqual([0, 1, 2, 3, 4]);
    expect(result.rejected[0]?.reason).toContain("No start date");
    expect(result.rejected[1]?.reason).toContain("No UID");
    expect(result.rejected[2]?.reason).toContain("repeats");
    expect(result.rejected[3]?.reason).toContain("Cancelled");
    expect(result.rejected[4]?.reason).toContain("not-a-date");
  });
});
