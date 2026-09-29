import { describe, expect, it } from "vitest";
import { availabilityChipLabels } from "./useAvailabilityShare";

/**
 * A UNION IS NOT AN ANSWER UNLESS IT SAYS WHICH ROOM (QA sweep run 11).
 *
 * On "All rooms" a night counts as free if ANY room is, so the Friday of a sold-out 400-capacity
 * show appeared as a bare chip — the 80-cap back room was empty — and **Copy dates** copied it
 * into whatever the operator was pasting to a promoter.
 *
 * The room-scoped data was already correct in the same hook, three lines above the labels. Only
 * the sentence was a union.
 */
describe("availabilityChipLabels", () => {
  const MAIN = { name: "Main Room", availableDates: ["2026-10-17"] };
  const BACK = { name: "Back Room", availableDates: ["2026-10-16", "2026-10-17"] };

  it("names the rooms that are free when only some of them are", () => {
    // The sweep's own night: 16 Oct is sold in the Main Room and open in the Back Room.
    expect(availabilityChipLabels(["2026-10-16"], [MAIN, BACK], true)).toEqual([
      "Fri, 16 Oct 2026 — Back Room",
    ]);
  });

  it("leaves a night when EVERY room is free as a bare chip", () => {
    // Naming both rooms on the ordinary case is noise, and noise is how a reader learns to skim
    // past the one chip that carries a qualifier.
    expect(availabilityChipLabels(["2026-10-17"], [MAIN, BACK], true)).toEqual([
      "Sat, 17 Oct 2026",
    ]);
  });

  it("says nothing extra on a ROOM-scoped share — the heading already names it", () => {
    expect(availabilityChipLabels(["2026-10-16"], [BACK], false)).toEqual(["Fri, 16 Oct 2026"]);
  });

  it("says nothing extra when the venue has a single room", () => {
    /*
     * Covered by the all-rooms-free test rather than by a clause of its own, and a surviving
     * mutation is what established that: a date only reaches this list because some room is
     * free, so with one room that room is always all of them. The test stays because the CASE
     * is worth pinning — "— Back Room" under a heading that says Back Room is a tautology — but
     * the code has one rule for it rather than two.
     */
    expect(availabilityChipLabels(["2026-10-16"], [BACK], true)).toEqual(["Fri, 16 Oct 2026"]);
  });

  it("falls back to the bare chip rather than an empty dash when no room claims the night", () => {
    // Should not happen — the union is built from the rooms — but a chip reading "16 Oct — " is
    // worse than one reading "16 Oct", and the guard costs one comparison.
    expect(availabilityChipLabels(["2026-10-18"], [MAIN, BACK], true)).toEqual([
      "Sun, 18 Oct 2026",
    ]);
  });

  it("labels a whole list, keeping the order it was given", () => {
    expect(availabilityChipLabels(["2026-10-16", "2026-10-17"], [MAIN, BACK], true)).toEqual([
      "Fri, 16 Oct 2026 — Back Room",
      "Sat, 17 Oct 2026",
    ]);
  });
});
