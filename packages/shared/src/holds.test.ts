import { describe, expect, it } from "vitest";
import {
  type HoldSibling,
  competingHoldIds,
  computeDeclinePromotion,
  computeRankShift,
  rankForHoldJoiningQueue,
} from "./holds";

/** Sort updates by id so tests don't depend on iteration order. */
function sortById<T extends { id: string }>(items: T[]): T[] {
  return [...items].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
}

describe("computeRankShift", () => {
  it("promotes id-1 from rank 1 to rank 2 (id-2 takes rank 1)", () => {
    const siblings: HoldSibling[] = [
      { id: "id-1", holdRank: 1 },
      { id: "id-2", holdRank: 2 },
      { id: "id-3", holdRank: 3 },
    ];
    const result = computeRankShift({ siblings, targetId: "id-1", oldRank: 1, newRank: 2 });
    expect(sortById(result)).toEqual(
      sortById([
        { id: "id-1", holdRank: 2 },
        { id: "id-2", holdRank: 1 },
      ]),
    );
  });

  it("demotes id-1 from 1 to 3", () => {
    const siblings: HoldSibling[] = [
      { id: "id-1", holdRank: 1 },
      { id: "id-2", holdRank: 2 },
      { id: "id-3", holdRank: 3 },
    ];
    const result = computeRankShift({ siblings, targetId: "id-1", oldRank: 1, newRank: 3 });
    expect(sortById(result)).toEqual(
      sortById([
        { id: "id-1", holdRank: 3 },
        { id: "id-2", holdRank: 1 },
        { id: "id-3", holdRank: 2 },
      ]),
    );
  });

  it("promotes id-3 from 3 to 1", () => {
    const siblings: HoldSibling[] = [
      { id: "id-1", holdRank: 1 },
      { id: "id-2", holdRank: 2 },
      { id: "id-3", holdRank: 3 },
    ];
    const result = computeRankShift({ siblings, targetId: "id-3", oldRank: 3, newRank: 1 });
    expect(sortById(result)).toEqual(
      sortById([
        { id: "id-3", holdRank: 1 },
        { id: "id-1", holdRank: 2 },
        { id: "id-2", holdRank: 3 },
      ]),
    );
  });

  it("returns an empty diff when moving to the same rank", () => {
    const siblings: HoldSibling[] = [
      { id: "id-1", holdRank: 1 },
      { id: "id-2", holdRank: 2 },
      { id: "id-3", holdRank: 3 },
    ];
    const result = computeRankShift({ siblings, targetId: "id-2", oldRank: 2, newRank: 2 });
    expect(result).toEqual([]);
  });

  it("is idempotent — feeding the output back produces an empty diff", () => {
    const siblings: HoldSibling[] = [
      { id: "id-1", holdRank: 1 },
      { id: "id-2", holdRank: 2 },
      { id: "id-3", holdRank: 3 },
    ];
    const first = computeRankShift({ siblings, targetId: "id-1", oldRank: 1, newRank: 3 });
    const updated: HoldSibling[] = siblings.map((sibling) => {
      const update = first.find((entry) => entry.id === sibling.id);
      return update ? { ...sibling, holdRank: update.holdRank } : sibling;
    });
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
  it("promotes the lower hold when all are auto-on", () => {
    const siblings: HoldSibling[] = [
      { id: "id-1", holdRank: 1 },
      { id: "id-3", holdRank: 3 },
    ];
    const result = computeDeclinePromotion({ siblings, removedRank: 2 });
    expect(result).toEqual([{ id: "id-3", holdRank: 2 }]);
  });

  it("keeps an auto-off hold frozen (gap stays open)", () => {
    const siblings: HoldSibling[] = [
      { id: "id-1", holdRank: 1, holdAutoPromote: true },
      { id: "id-3", holdRank: 3, holdAutoPromote: false },
    ];
    const result = computeDeclinePromotion({ siblings, removedRank: 2 });
    expect(result).toEqual([]);
  });

  it("treats undefined auto-promote as on", () => {
    const siblings: HoldSibling[] = [
      { id: "id-1", holdRank: 1 },
      { id: "id-3", holdRank: 3 },
    ];
    const result = computeDeclinePromotion({ siblings, removedRank: 2 });
    expect(result).toEqual([{ id: "id-3", holdRank: 2 }]);
  });

  it("shifts every higher auto-on hold down when the lowest rank is removed", () => {
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

  it("leaves ranks below the removed rank untouched", () => {
    const siblings: HoldSibling[] = [
      { id: "id-1", holdRank: 1 },
      { id: "id-2", holdRank: 2 },
    ];
    const result = computeDeclinePromotion({ siblings, removedRank: 3 });
    expect(result).toEqual([]);
  });

  it("makes an auto-on hold jump over a frozen auto-off hold to fill the gap", () => {
    const siblings: HoldSibling[] = [
      { id: "id-1", holdRank: 1, holdAutoPromote: true },
      { id: "id-3", holdRank: 3, holdAutoPromote: false },
      { id: "id-4", holdRank: 4, holdAutoPromote: true },
    ];
    const result = computeDeclinePromotion({ siblings, removedRank: 2 });
    expect(sortById(result)).toEqual(sortById([{ id: "id-4", holdRank: 2 }]));
  });

  it("compacts a longer chain around a frozen auto-off hold", () => {
    // Before: 1 on, 2 (removed), 3 off, 4 on, 5 on → 1 stays, 3 stays, 4→2, 5→4.
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

  it("skips two frozen ranks side by side", () => {
    // Before: 1 on, 2 (removed), 3 off, 4 off, 5 on → 1 stays, 3/4 stay, 5→2.
    const siblings: HoldSibling[] = [
      { id: "id-1", holdRank: 1, holdAutoPromote: true },
      { id: "id-3", holdRank: 3, holdAutoPromote: false },
      { id: "id-4", holdRank: 4, holdAutoPromote: false },
      { id: "id-5", holdRank: 5, holdAutoPromote: true },
    ];
    const result = computeDeclinePromotion({ siblings, removedRank: 2 });
    expect(sortById(result)).toEqual(sortById([{ id: "id-5", holdRank: 2 }]));
  });
});

describe("competingHoldIds", () => {
  it("returns every sibling id (caller pre-filters the target)", () => {
    const result = competingHoldIds({
      siblings: [
        { id: "id-2", holdRank: 2 },
        { id: "id-3", holdRank: 3 },
      ],
    });
    expect(result.sort()).toEqual(["id-2", "id-3"]);
  });

  it("returns an empty array for empty input", () => {
    expect(competingHoldIds({ siblings: [] })).toEqual([]);
  });
});

/**
 * THE TIE THAT NO SCREEN COULD BREAK (QA sweep run 5, QA5-4).
 *
 * A hold placed against a typed venue name is in no queue, so its placement writes
 * no rank; attaching the venue afterwards drops it into a queue that already has a
 * first. `holdRank ?? 1` then reads two holds as 1st, and "Promote to 1st" is
 * disabled on both because each already believes it is there.
 */
describe("rankForHoldJoiningQueue", () => {
  it("puts an unranked hold at the back of the queue it just joined", () => {
    expect(
      rankForHoldJoiningQueue({
        holdRank: null,
        siblings: [
          { id: "nordic", holdRank: 1 },
          { id: "second", holdRank: 2 },
        ],
      }),
    ).toBe(3);
  });

  it("writes nothing for a lone hold — NULL is the first hold, by design", () => {
    // Writing a 1 here would file a rank change for a move nobody made, and every
    // reader already answers 1 for NULL.
    expect(rankForHoldJoiningQueue({ holdRank: null, siblings: [] })).toBeNull();
  });

  it("leaves a hold that already has a rank alone", () => {
    // Its position is somebody's decision. Re-deriving it here would undo a
    // promotion the moment the venue or the date was edited for any other reason.
    expect(
      rankForHoldJoiningQueue({ holdRank: 1, siblings: [{ id: "other", holdRank: 2 }] }),
    ).toBeNull();
    expect(
      rankForHoldJoiningQueue({ holdRank: 3, siblings: [{ id: "other", holdRank: 1 }] }),
    ).toBeNull();
  });

  it("counts a sibling's own NULL rank as the 1st it is displayed as", () => {
    // The existing lone hold keeps NULL; the joiner must land behind it, not on it.
    expect(
      rankForHoldJoiningQueue({
        holdRank: null,
        siblings: [{ id: "lone", holdRank: 0 as unknown as number }],
      }),
    ).toBe(2);
  });

  it("is idempotent — feeding its own answer back writes nothing", () => {
    const first = rankForHoldJoiningQueue({
      holdRank: null,
      siblings: [{ id: "nordic", holdRank: 1 }],
    });
    expect(first).toBe(2);
    expect(
      rankForHoldJoiningQueue({ holdRank: first, siblings: [{ id: "nordic", holdRank: 1 }] }),
    ).toBeNull();
  });
});
