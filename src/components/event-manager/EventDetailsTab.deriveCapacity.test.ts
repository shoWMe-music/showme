/**
 * Unit tests for deriveDefaultCapacityForRooms.
 *
 * Bug ref (C5 — ClickUp triage): Event capacity should default from the
 * selected Room/Stage's capacity (summed when multiple rooms are picked).
 * Manual capacity edits must override the derived value, but that policy
 * lives in the component — this helper is the pure derivation step.
 */
import { describe, it, expect } from "vitest";
import { deriveDefaultCapacityForRooms } from "./EventDetailsTab";

const subs = [
  { name: "Main Stage", capacity: 800 },
  { name: "Club Room", capacity: 250 },
  { name: "Garden", capacity: 1200 },
  { name: "Lounge" /* no capacity */ },
];

describe("deriveDefaultCapacityForRooms", () => {
  it("returns 0 when no rooms are selected", () => {
    expect(deriveDefaultCapacityForRooms([], subs)).toBe(0);
  });

  it("returns the matching sub-venue's capacity for a single selection", () => {
    expect(deriveDefaultCapacityForRooms(["Main Stage"], subs)).toBe(800);
  });

  it("sums capacities for multiple selected rooms", () => {
    expect(deriveDefaultCapacityForRooms(["Main Stage", "Club Room"], subs)).toBe(1050);
  });

  it("ignores rooms without a known capacity", () => {
    expect(deriveDefaultCapacityForRooms(["Lounge"], subs)).toBe(0);
    expect(deriveDefaultCapacityForRooms(["Lounge", "Club Room"], subs)).toBe(250);
  });

  it("ignores selected names that don't match any sub-venue", () => {
    expect(deriveDefaultCapacityForRooms(["Phantom Stage"], subs)).toBe(0);
    expect(deriveDefaultCapacityForRooms(["Phantom Stage", "Garden"], subs)).toBe(1200);
  });

  it("handles empty sub-venue list gracefully", () => {
    expect(deriveDefaultCapacityForRooms(["Main Stage"], [])).toBe(0);
  });
});
