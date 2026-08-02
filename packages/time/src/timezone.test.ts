import { describe, expect, it } from "vitest";
import { dayBounds, resolveLocalToInstant, zoneForCountry } from "./timezone";

describe("resolveLocalToInstant", () => {
  it("resolves a summer (DST) local time at the +02:00 offset for Stockholm", () => {
    // Central European Summer Time: Stockholm is UTC+2 in July.
    const instant = resolveLocalToInstant("2026-07-15T12:00", "Europe/Stockholm");
    expect(instant.getUTCHours()).toBe(10);
    expect(instant.getUTCFullYear()).toBe(2026);
    expect(instant.getUTCMonth()).toBe(6); // July (0-indexed)
    expect(instant.getUTCDate()).toBe(15);
  });

  it("resolves a winter (standard time) local time at the +01:00 offset for Stockholm", () => {
    // Central European Time: Stockholm is UTC+1 in January.
    const instant = resolveLocalToInstant("2026-01-15T12:00", "Europe/Stockholm");
    expect(instant.getUTCHours()).toBe(11);
  });

  it("gives the same summer/winter wall time two different UTC instants (DST-correct)", () => {
    const summer = resolveLocalToInstant("2026-07-15T20:00", "Europe/Stockholm");
    const winter = resolveLocalToInstant("2026-01-15T20:00", "Europe/Stockholm");
    expect(summer.getUTCHours()).toBe(18);
    expect(winter.getUTCHours()).toBe(19);
  });

  it("handles a nonexistent spring-forward local time without throwing", () => {
    // 2026-03-29 02:00 → 03:00 in the EU; 02:30 local does not exist. Luxon shifts
    // it forward across the gap rather than failing.
    const instant = resolveLocalToInstant("2026-03-29T02:30", "Europe/Stockholm");
    expect(Number.isNaN(instant.getTime())).toBe(false);
  });

  it("throws on an invalid zone", () => {
    expect(() => resolveLocalToInstant("2026-07-15T12:00", "Not/AZone")).toThrow();
  });
});

describe("zoneForCountry", () => {
  it("maps known countries to their IANA default", () => {
    expect(zoneForCountry("SE")).toBe("Europe/Stockholm");
    expect(zoneForCountry("DE")).toBe("Europe/Berlin");
    expect(zoneForCountry("GB")).toBe("Europe/London");
    expect(zoneForCountry("US")).toBe("America/New_York");
  });

  it("is case- and whitespace-insensitive", () => {
    expect(zoneForCountry("se")).toBe("Europe/Stockholm");
    expect(zoneForCountry(" gb ")).toBe("Europe/London");
  });

  it("falls back to UTC for an unknown country", () => {
    expect(zoneForCountry("ZZ")).toBe("UTC");
  });
});

describe("dayBounds", () => {
  it("spans exactly 24h across a normal day", () => {
    const { start, end } = dayBounds("2026-07-15", "Europe/Stockholm");
    const spanHours = (end.getTime() - start.getTime()) / (60 * 60 * 1000);
    expect(spanHours).toBe(24);
  });

  it("anchors the day boundary to the zone, not UTC", () => {
    // Local midnight in Stockholm summer (+02:00) is 22:00 UTC the previous day.
    const { start } = dayBounds("2026-07-15", "Europe/Stockholm");
    expect(start.getUTCHours()).toBe(22);
    expect(start.getUTCDate()).toBe(14);
  });

  it("spans 23h across the spring-forward DST day", () => {
    const { start, end } = dayBounds("2026-03-29", "Europe/Stockholm");
    const spanHours = (end.getTime() - start.getTime()) / (60 * 60 * 1000);
    expect(spanHours).toBe(23);
  });
});
