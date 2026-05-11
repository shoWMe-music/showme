import { describe, it, expect } from "vitest";
import {
  computeRankShift,
  computeDeclinePromotion,
  competingHoldIds,
  type HoldSibling,
} from "./holdRankLogic";

/**
 * Helper — sort updates by id so tests don't depend on iteration order.
 */
function sortById<T extends { id: string }>(arr: T[]): T[] {
  return [...arr].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

describe("computeRankShift", () => {
  it("Ori's example — promote id-1 from rank 1 to rank 2", () => {
    const siblings: HoldSibling[] = [
      { id: "id-1", holdRank: 1 },
      { id: "id-2", holdRank: 2 },
      { id: "id-3", holdRank: 3 },
    ];
    const result = computeRankShift({
      siblings,
      targetId: "id-1",
      oldRank: 1,
      newRank: 2,
    });
    // id-1 → 2, id-2 → 1, id-3 unchanged (omitted).
    expect(sortById(result)).toEqual(
      sortById([
        { id: "id-1", holdRank: 2 },
        { id: "id-2", holdRank: 1 },
      ]),
    );
  });

  it("demote — move id-1 from 1 to 3", () => {
    const siblings: HoldSibling[] = [
      { id: "id-1", holdRank: 1 },
      { id: "id-2", holdRank: 2 },
      { id: "id-3", holdRank: 3 },
    ];
    const result = computeRankShift({
      siblings,
      targetId: "id-1",
      oldRank: 1,
      newRank: 3,
    });
    expect(sortById(result)).toEqual(
      sortById([
        { id: "id-1", holdRank: 3 },
        { id: "id-2", holdRank: 1 },
        { id: "id-3", holdRank: 2 },
      ]),
    );
  });

  it("promote — move id-3 from 3 to 1", () => {
    const siblings: HoldSibling[] = [
      { id: "id-1", holdRank: 1 },
      { id: "id-2", holdRank: 2 },
      { id: "id-3", holdRank: 3 },
    ];
    const result = computeRankShift({
      siblings,
      targetId: "id-3",
      oldRank: 3,
      newRank: 1,
    });
    expect(sortById(result)).toEqual(
      sortById([
        { id: "id-3", holdRank: 1 },
        { id: "id-1", holdRank: 2 },
        { id: "id-2", holdRank: 3 },
      ]),
    );
  });

  it("no-op — moving to the same rank returns empty diff", () => {
    const siblings: HoldSibling[] = [
      { id: "id-1", holdRank: 1 },
      { id: "id-2", holdRank: 2 },
      { id: "id-3", holdRank: 3 },
    ];
    const result = computeRankShift({
      siblings,
      targetId: "id-2",
      oldRank: 2,
      newRank: 2,
    });
    expect(result).toEqual([]);
  });

  it("idempotency — feeding the output back produces empty diff", () => {
    const siblings: HoldSibling[] = [
      { id: "id-1", holdRank: 1 },
      { id: "id-2", holdRank: 2 },
      { id: "id-3", holdRank: 3 },
    ];
    const first = computeRankShift({
      siblings,
      targetId: "id-1",
      oldRank: 1,
      newRank: 3,
    });
    // Apply first result to siblings.
    const updated: HoldSibling[] = siblings.map((s) => {
      const u = first.find((f) => f.id === s.id);
      return u ? { ...s, holdRank: u.holdRank } : s;
    });
    // Now id-1 is at rank 3; running the same op (3→3) must be a no-op.
    const second = computeRankShift({
      siblings: updated,
      targetId: "id-1",
      oldRank: 3,
      newRank: 3,
    });
    expect(second).toEqual([]);
  });
});

describe("computeDeclinePromotion", () => {
  it("all auto-promote on (default) — removed rank 2 from [{1},{3}] promotes id-3 to 2", () => {
    const siblings: HoldSibling[] = [
      { id: "id-1", holdRank: 1 },
      { id: "id-3", holdRank: 3 },
    ];
    const result = computeDeclinePromotion({ siblings, removedRank: 2 });
    expect(result).toEqual([{ id: "id-3", holdRank: 2 }]);
  });

  it("auto-promote OFF on the lower hold — id-3 keeps rank 3, gap at 2", () => {
    const siblings: HoldSibling[] = [
      { id: "id-1", holdRank: 1, holdAutoPromote: true },
      { id: "id-3", holdRank: 3, holdAutoPromote: false },
    ];
    const result = computeDeclinePromotion({ siblings, removedRank: 2 });
    expect(result).toEqual([]);
  });

  it("auto-promote default (undefined treated as on) — same as on", () => {
    const siblings: HoldSibling[] = [
      { id: "id-1", holdRank: 1 },
      { id: "id-3", holdRank: 3 }, // undefined → treated as on
    ];
    const result = computeDeclinePromotion({ siblings, removedRank: 2 });
    expect(result).toEqual([{ id: "id-3", holdRank: 2 }]);
  });

  it("removed lowest rank — every higher hold (auto-on) shifts down by one", () => {
    const siblings: HoldSibling[] = [
      { id: "id-2", holdRank: 2 },
      { id: "id-3", holdRank: 3 },
      { id: "id-4", holdRank: 4 },
    ];
    const result = computeDeclinePromotion({ siblings, removedRank: 1 });
    expect(sortById(result)).toEqual(
      sortById([
        { id: "id-2", holdRank: 1 },
        { id: "id-3", holdRank: 2 },
        { id: "id-4", holdRank: 3 },
      ]),
    );
  });

  it("ranks below the removed rank are untouched", () => {
    const siblings: HoldSibling[] = [
      { id: "id-1", holdRank: 1 },
      { id: "id-2", holdRank: 2 },
    ];
    const result = computeDeclinePromotion({ siblings, removedRank: 3 });
    expect(result).toEqual([]);
  });

  it("auto-off rank-3 stays put; auto-on rank-4 jumps over it to fill the empty rank-2", () => {
    // User-specified rule: if rank 3 is auto-off and rank 2 is removed,
    // rank 4 (auto-on) should become rank 2 — it skips over rank 3.
    const siblings: HoldSibling[] = [
      { id: "id-1", holdRank: 1, holdAutoPromote: true },
      { id: "id-3", holdRank: 3, holdAutoPromote: false },
      { id: "id-4", holdRank: 4, holdAutoPromote: true },
    ];
    const result = computeDeclinePromotion({ siblings, removedRank: 2 });
    // id-1 stays at 1 (already lowest). id-3 stays at 3 (auto-off, frozen).
    // id-4 → 2 (next available auto-on rank, skipping the frozen 3).
    expect(sortById(result)).toEqual(
      sortById([{ id: "id-4", holdRank: 2 }]),
    );
  });

  it("longer chain — frozen auto-off keeps its number, higher auto-on holds compact around it", () => {
    // Before: 1 on, 2 (removed), 3 off, 4 on, 5 on
    // After:  1 stays, 3 stays (frozen), 4 → 2, 5 → 4
    const siblings: HoldSibling[] = [
      { id: "id-1", holdRank: 1, holdAutoPromote: true },
      { id: "id-3", holdRank: 3, holdAutoPromote: false },
      { id: "id-4", holdRank: 4, holdAutoPromote: true },
      { id: "id-5", holdRank: 5, holdAutoPromote: true },
    ];
    const result = computeDeclinePromotion({ siblings, removedRank: 2 });
    expect(sortById(result)).toEqual(
      sortById([
        { id: "id-4", holdRank: 2 },
        { id: "id-5", holdRank: 4 },
      ]),
    );
  });

  it("two frozen ranks side by side — auto-on holds skip both", () => {
    // Before: 1 on, 2 (removed), 3 off, 4 off, 5 on
    // After:  1 stays, 3 stays, 4 stays, 5 → 2
    const siblings: HoldSibling[] = [
      { id: "id-1", holdRank: 1, holdAutoPromote: true },
      { id: "id-3", holdRank: 3, holdAutoPromote: false },
      { id: "id-4", holdRank: 4, holdAutoPromote: false },
      { id: "id-5", holdRank: 5, holdAutoPromote: true },
    ];
    const result = computeDeclinePromotion({ siblings, removedRank: 2 });
    expect(sortById(result)).toEqual(
      sortById([{ id: "id-5", holdRank: 2 }]),
    );
  });
});

describe("competingHoldIds", () => {
  it("returns every sibling id (caller pre-filters)", () => {
    const result = competingHoldIds({
      siblings: [
        { id: "id-2", holdRank: 2 },
        { id: "id-3", holdRank: 3 },
      ],
    });
    expect(result.sort()).toEqual(["id-2", "id-3"]);
  });

  it("empty input returns empty array", () => {
    expect(competingHoldIds({ siblings: [] })).toEqual([]);
  });
});
