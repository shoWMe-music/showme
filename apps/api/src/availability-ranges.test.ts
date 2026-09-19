import { describe, expect, it } from "vitest";
import { mergeDateRanges } from "./lib/availability";

/**
 * Coalescing the busy list (ClickUp 86cbceux0).
 *
 * The public availability page publishes this list and its readers compute FREE
 * nights as the complement of it, so the expensive mistakes are the ones that
 * leave a hole: a gap invented between two stretches that actually touch, or an
 * end date shortened by a range that sorted late. Both are pinned here.
 */
describe("merging busy ranges", () => {
  it("leaves ranges that do not touch alone", () => {
    expect(
      mergeDateRanges([
        { startDate: "2026-08-01", endDate: "2026-08-02" },
        { startDate: "2026-08-10", endDate: "2026-08-11" },
      ]),
    ).toEqual([
      { startDate: "2026-08-01", endDate: "2026-08-02" },
      { startDate: "2026-08-10", endDate: "2026-08-11" },
    ]);
  });

  it("joins overlapping ranges", () => {
    expect(
      mergeDateRanges([
        { startDate: "2026-08-01", endDate: "2026-08-05" },
        { startDate: "2026-08-03", endDate: "2026-08-09" },
      ]),
    ).toEqual([{ startDate: "2026-08-01", endDate: "2026-08-09" }]);
  });

  it("joins ranges that merely abut — there is no free night between them", () => {
    // A refit to the 3rd and a show on the 4th is four unbroken nights. Reported
    // as two entries, a reader looking for the gap finds one that is not there.
    expect(
      mergeDateRanges([
        { startDate: "2026-08-01", endDate: "2026-08-03" },
        { startDate: "2026-08-04", endDate: "2026-08-04" },
      ]),
    ).toEqual([{ startDate: "2026-08-01", endDate: "2026-08-04" }]);
  });

  it("crosses a month end, where naive +1 day arithmetic breaks", () => {
    expect(
      mergeDateRanges([
        { startDate: "2026-08-30", endDate: "2026-08-31" },
        { startDate: "2026-09-01", endDate: "2026-09-01" },
      ]),
    ).toEqual([{ startDate: "2026-08-30", endDate: "2026-09-01" }]);
  });

  it("swallows a range wholly inside another without shortening it", () => {
    // The regression this pins: taking the later range's end unconditionally
    // would cut 2026-08-20 back to 2026-08-04 and publish 16 nights as free.
    expect(
      mergeDateRanges([
        { startDate: "2026-08-01", endDate: "2026-08-20" },
        { startDate: "2026-08-03", endDate: "2026-08-04" },
      ]),
    ).toEqual([{ startDate: "2026-08-01", endDate: "2026-08-20" }]);
  });

  it("does not care what order it is handed", () => {
    expect(
      mergeDateRanges([
        { startDate: "2026-08-10", endDate: "2026-08-11" },
        { startDate: "2026-08-01", endDate: "2026-08-02" },
        { startDate: "2026-08-02", endDate: "2026-08-04" },
      ]),
    ).toEqual([
      { startDate: "2026-08-01", endDate: "2026-08-04" },
      { startDate: "2026-08-10", endDate: "2026-08-11" },
    ]);
  });

  it("handles nothing at all", () => {
    expect(mergeDateRanges([])).toEqual([]);
  });
});
