/**
 * The unavailability marking maths — the pure half of `useMarkUnavailable`.
 *
 * `applyDaySelection` is the whole of "Done marking": it takes what is stored,
 * the nights just picked, and toggles each one. Blocking is the easy direction.
 * **Freeing is where the difficulty is**, because storage is RANGES, not days —
 * so freeing one night can trim a range, split it in two, or delete it outright,
 * and the ranges either side have to survive with their own reasons intact.
 *
 * None of this had a test until now: `apps/web` had no unit runner (86cbazcf3),
 * and range arithmetic that silently loses a night is precisely the kind of bug
 * a person only finds by being double-booked.
 *
 * IMPORTED FROM `unavailabilityRanges`, not from the hook. Reaching these two
 * functions through the hook pulled in `AuthProvider` -> `auth/firebase.ts`,
 * which calls `initializeApp()` at module scope — so this file threw
 * `auth/invalid-api-key` on every CI run, where the web env vars do not exist,
 * and had been red on `main` since at least 2026-09-05 for that reason alone.
 */
import { describe, expect, it } from "vitest";
import {
  type UnavailabilityBlock,
  applyDaySelection,
  applyDaySelectionForRoom,
  collapseDays,
} from "./unavailabilityRanges";

/** Ranges as `start..end (reason)`, so a failure reads as dates and not objects. */
const shape = (blocks: UnavailabilityBlock[]) =>
  blocks.map((block) => `${block.startDate}..${block.endDate} (${block.reason ?? "—"})`);

describe("applyDaySelection — blocking", () => {
  it("turns a picked night into a one-day block carrying the reason", () => {
    expect(shape(applyDaySelection([], ["2026-09-13"], "Private hire"))).toEqual([
      "2026-09-13..2026-09-13 (Private hire)",
    ]);
  });

  it("collapses consecutive picks into one range", () => {
    const blocks = applyDaySelection([], ["2026-09-13", "2026-09-14", "2026-09-15"], "Refit");
    expect(shape(blocks)).toEqual(["2026-09-13..2026-09-15 (Refit)"]);
  });

  it("keeps a gap as two ranges rather than swallowing the night between", () => {
    const blocks = applyDaySelection([], ["2026-09-13", "2026-09-15"], "Refit");
    expect(shape(blocks)).toEqual([
      "2026-09-13..2026-09-13 (Refit)",
      "2026-09-15..2026-09-15 (Refit)",
    ]);
  });

  it("extends an existing range when the night beside it is picked", () => {
    const existing: UnavailabilityBlock[] = [
      { startDate: "2026-09-13", endDate: "2026-09-14", reason: "Refit" },
    ];
    expect(shape(applyDaySelection(existing, ["2026-09-15"], "Refit"))).toEqual([
      "2026-09-13..2026-09-15 (Refit)",
    ]);
  });

  /** Two adjacent ranges with DIFFERENT reasons must not be merged — the reason
   *  is the operator's record of why, and merging would destroy one of them. */
  it("does not merge adjacent ranges that carry different reasons", () => {
    const existing: UnavailabilityBlock[] = [
      { startDate: "2026-09-13", endDate: "2026-09-13", reason: "Refit" },
    ];
    expect(shape(applyDaySelection(existing, ["2026-09-14"], "Private hire"))).toEqual([
      "2026-09-13..2026-09-13 (Refit)",
      "2026-09-14..2026-09-14 (Private hire)",
    ]);
  });
});

describe("applyDaySelection — freeing, which is the hard direction", () => {
  const week: UnavailabilityBlock[] = [
    { startDate: "2026-09-13", endDate: "2026-09-19", reason: "Refit" },
  ];

  it("trims the range when the night freed is at its start", () => {
    expect(shape(applyDaySelection(week, ["2026-09-13"], null))).toEqual([
      "2026-09-14..2026-09-19 (Refit)",
    ]);
  });

  it("trims the range when the night freed is at its end", () => {
    expect(shape(applyDaySelection(week, ["2026-09-19"], null))).toEqual([
      "2026-09-13..2026-09-18 (Refit)",
    ]);
  });

  /**
   * THE CASE MOST LIKELY TO BE WRONG. Freeing a night in the middle has to leave
   * TWO ranges, both keeping the reason. An implementation that trims from an end
   * would silently free half the week.
   */
  it("splits the range in two when the night freed is in the middle", () => {
    expect(shape(applyDaySelection(week, ["2026-09-16"], null))).toEqual([
      "2026-09-13..2026-09-15 (Refit)",
      "2026-09-17..2026-09-19 (Refit)",
    ]);
  });

  it("removes a one-night block entirely", () => {
    const single: UnavailabilityBlock[] = [
      { startDate: "2026-09-13", endDate: "2026-09-13", reason: "Refit" },
    ];
    expect(applyDaySelection(single, ["2026-09-13"], null)).toEqual([]);
  });

  it("frees several nights at once, splitting into as many ranges as it takes", () => {
    expect(shape(applyDaySelection(week, ["2026-09-15", "2026-09-17"], null))).toEqual([
      "2026-09-13..2026-09-14 (Refit)",
      "2026-09-16..2026-09-16 (Refit)",
      "2026-09-18..2026-09-19 (Refit)",
    ]);
  });

  /**
   * The reason belongs to the nights that REMAIN blocked. Freeing a night must
   * not blank the surrounding range's reason — the operator wrote it once and
   * removing a different night is not a retraction.
   */
  it("keeps the surviving range's own reason, not the one passed for blocking", () => {
    const blocks = applyDaySelection(week, ["2026-09-16"], "something else entirely");
    expect(blocks.every((block) => block.reason === "Refit")).toBe(true);
  });
});

describe("applyDaySelection — a mixed selection", () => {
  /**
   * One "Done marking" can block and free in the same write — that is what makes
   * a click able to toggle. Both halves have to land together.
   */
  it("blocks the free nights and frees the blocked ones in a single pass", () => {
    const existing: UnavailabilityBlock[] = [
      { startDate: "2026-09-13", endDate: "2026-09-14", reason: "Refit" },
    ];
    // 13 is blocked (frees it); 16 is not (blocks it).
    expect(
      shape(applyDaySelection(existing, ["2026-09-13", "2026-09-16"], "Private hire")),
    ).toEqual(["2026-09-14..2026-09-14 (Refit)", "2026-09-16..2026-09-16 (Private hire)"]);
  });

  it("is a no-op for an empty selection", () => {
    const existing: UnavailabilityBlock[] = [
      { startDate: "2026-09-13", endDate: "2026-09-14", reason: "Refit" },
    ];
    expect(shape(applyDaySelection(existing, [], null))).toEqual([
      "2026-09-13..2026-09-14 (Refit)",
    ]);
  });

  /** Toggling the same night twice through two writes returns to the start. */
  it("round-trips: block a night, then free it, and nothing is left behind", () => {
    const blocked = applyDaySelection([], ["2026-09-13"], "Refit");
    expect(applyDaySelection(blocked, ["2026-09-13"], null)).toEqual([]);
  });

  /**
   * Month and year boundaries: the day arithmetic steps by calendar date, so
   * 30 September → 1 October has to be treated as consecutive, not as a gap.
   */
  it("collapses across a month boundary", () => {
    expect(shape(applyDaySelection([], ["2026-09-30", "2026-10-01"], "Refit"))).toEqual([
      "2026-09-30..2026-10-01 (Refit)",
    ]);
  });

  it("collapses across a year boundary", () => {
    expect(shape(applyDaySelection([], ["2026-12-31", "2027-01-01"], "Refit"))).toEqual([
      "2026-12-31..2027-01-01 (Refit)",
    ]);
  });
});

describe("collapseDays", () => {
  it("returns nothing for no days", () => {
    expect(collapseDays([], () => null)).toEqual([]);
  });

  it("breaks a run wherever the reason changes, even on consecutive days", () => {
    const reasons = new Map([
      ["2026-09-13", "Refit"],
      ["2026-09-14", "Refit"],
      ["2026-09-15", "Private hire"],
    ]);
    expect(shape(collapseDays([...reasons.keys()], (day) => reasons.get(day) ?? null))).toEqual([
      "2026-09-13..2026-09-14 (Refit)",
      "2026-09-15..2026-09-15 (Private hire)",
    ]);
  });
});

/**
 * ── ONE ROOM AT A TIME (ClickUp 86cbceux0) ─────────────────────────────────
 *
 * `applyDaySelection` is keyed by DAY, which stops being enough once a night can
 * be shut in one room and open in another — expanded to a flat day map, the two
 * rooms overwrite each other. `applyDaySelectionForRoom` partitions first.
 *
 * These are the cases that partition exists for, and every one of them passes
 * trivially if you forget the partition and just call the day-keyed function.
 */
describe("marking one room", () => {
  const BACK = "back-room-id";
  const MAIN = "main-room-id";

  it("shuts the room it is scoped to, and nothing else", () => {
    const next = applyDaySelectionForRoom([], ["2026-09-14"], null, BACK);
    expect(next).toEqual([
      { startDate: "2026-09-14", endDate: "2026-09-14", reason: null, stageId: BACK },
    ]);
  });

  it("leaves another room's block completely alone", () => {
    const existing = [
      { startDate: "2026-09-14", endDate: "2026-09-14", reason: "Refit", stageId: MAIN },
    ];
    const next = applyDaySelectionForRoom(existing, ["2026-09-14"], null, BACK);

    // The same night, now shut in BOTH rooms — separately, each keeping its own
    // reason. A day-keyed write would have overwritten one with the other.
    expect(next).toHaveLength(2);
    expect(next.find((b) => b.stageId === MAIN)).toMatchObject({ reason: "Refit" });
    expect(next.find((b) => b.stageId === BACK)).toMatchObject({ reason: null });
  });

  it("frees a night in one room without freeing it in the other", () => {
    const existing = [
      { startDate: "2026-09-14", endDate: "2026-09-14", reason: null, stageId: MAIN },
      { startDate: "2026-09-14", endDate: "2026-09-14", reason: null, stageId: BACK },
    ];
    // Picking an already-blocked night frees it — for THIS room only.
    const next = applyDaySelectionForRoom(existing, ["2026-09-14"], null, BACK);
    expect(next).toHaveLength(1);
    expect(next[0]?.stageId).toBe(MAIN);
  });

  it("treats the whole venue as its own scope, either way round", () => {
    const wholePlace = [
      { startDate: "2026-09-14", endDate: "2026-09-14", reason: "Closed", stageId: null },
    ];
    // Shutting a room does not disturb the building-wide block…
    const afterRoom = applyDaySelectionForRoom(wholePlace, ["2026-09-14"], null, BACK);
    expect(afterRoom).toHaveLength(2);
    // …and editing the building does not disturb the room's.
    const both = [
      ...wholePlace,
      { startDate: "2026-09-14", endDate: "2026-09-14", reason: null, stageId: BACK },
    ];
    const afterVenue = applyDaySelectionForRoom(both, ["2026-09-14"], null, null);
    expect(afterVenue).toHaveLength(1);
    expect(afterVenue[0]?.stageId).toBe(BACK);
  });

  it("still trims and splits ranges correctly inside one room", () => {
    // The range maths is unchanged — this proves the partition did not break it.
    const existing = [
      { startDate: "2026-09-13", endDate: "2026-09-19", reason: "Refit", stageId: BACK },
    ];
    const next = applyDaySelectionForRoom(existing, ["2026-09-16"], null, BACK);
    expect(next.map((b) => `${b.startDate}..${b.endDate}`)).toEqual([
      "2026-09-13..2026-09-15",
      "2026-09-17..2026-09-19",
    ]);
    expect(next.every((b) => b.stageId === BACK)).toBe(true);
  });
});
