import { describe, expect, it } from "vitest";
import { formatDurationClock, parseDurationText, parseSetlistWorks } from "./setlist-works";

/**
 * The authoring field and the filing reader have to agree about what a typed
 * length MEANS, so the two directions are tested against each other rather than
 * each against a hand-written table.
 */
describe("parseDurationText — a song length as a person types it", () => {
  it("reads the clock form, and round-trips through the formatter", () => {
    expect(parseDurationText("3:45")).toBe(225);
    expect(parseDurationText("0:07")).toBe(7);
    expect(parseDurationText("12:30")).toBe(750);
    for (const seconds of [7, 225, 750, 3600]) {
      expect(parseDurationText(formatDurationClock(seconds))).toBe(seconds);
    }
  });

  it("reads a bare number as MINUTES, decimal comma included", () => {
    expect(parseDurationText("4")).toBe(240);
    expect(parseDurationText("3.5")).toBe(210);
    expect(parseDurationText("3,5")).toBe(210);
  });

  it("is null for empty and for nonsense — never zero, which would be a claim", () => {
    expect(parseDurationText("")).toBeNull();
    expect(parseDurationText("   ")).toBeNull();
    expect(parseDurationText("about four")).toBeNull();
    expect(parseDurationText("-2")).toBeNull();
    // 90 seconds is not a minute value, so `1:90` is rejected rather than
    // silently read as 2:30.
    expect(parseDurationText("1:90")).toBeNull();
  });

  it("is the same reading the stored jsonb gets", () => {
    const [work] = parseSetlistWorks([{ title: "Ember", duration: "3:45" }]);
    expect(work?.durationSeconds).toBe(parseDurationText("3:45"));
  });
});
