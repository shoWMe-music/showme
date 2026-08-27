/**
 * Unit tests for the web app's date formatting.
 *
 * They live in `apps/api` because that is where a vitest runner exists:
 * `apps/web`'s own `test` script is Playwright, so the web app has NO unit
 * suite at all. That gap is why the bug below shipped — shared formatting logic
 * that ~19 screens depend on, with nothing able to assert a single case of it.
 * Worth giving `apps/web` a vitest project of its own and moving this there.
 */
import { describe, expect, it } from "vitest";
import { dayKey, formatDate, formatDay, parseDayLocal } from "../../web/src/lib/format";

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
});
