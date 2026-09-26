import { describe, expect, it } from "vitest";
import { isInHoldPool } from "./HoldPlacement";

/**
 * TWO HOLDS ON ONE NIGHT IN ONE ROOM BOTH READ "1st" (QA sweep run 2 and run 3).
 *
 * The count this predicate feeds decides whether the wizard writes a rank at all:
 * `placeOnHold` skips the rank route when it believes there are no competitors, and
 * `hold_rank` NULL is read as 1st by every reader. So the old rule — count only
 * holds with NO venue — did not merely mislabel a screen. Two holds pinned to the
 * same venue each saw zero competitors, neither wrote a rank, and both were
 * genuinely first in the database.
 *
 * The comment justifying that rule said the wizard could not pin a venue. It grew a
 * venue and room picker and sends both on create.
 */

const hold = (venueProfileId: string | null, stageId: string | null, hostProfileId = "host-1") => ({
  venueProfileId,
  stageId,
  hostProfileId,
});

describe("isInHoldPool", () => {
  const bigRoom = { venueProfileId: "venue-1", stageId: "room-big", hostProfileId: "host-1" };

  it("counts another hold in the same venue and room", () => {
    expect(isInHoldPool(hold("venue-1", "room-big"), bigRoom)).toBe(true);
  });

  it("does not count a hold in another room of the same venue", () => {
    // Ran's rule: a clash is relative to a physical space. Two rooms is not a clash.
    expect(isInHoldPool(hold("venue-1", "room-small"), bigRoom)).toBe(false);
  });

  it("does not count a hold at another venue", () => {
    expect(isInHoldPool(hold("venue-2", "room-big"), bigRoom)).toBe(false);
  });

  it("counts a hold by ANOTHER operator in the same room", () => {
    // The room is the thing being competed for, so whose pencil it is does not
    // matter — this is what makes a venue-pinned pool different from an unpinned one.
    expect(isInHoldPool(hold("venue-1", "room-big", "host-2"), bigRoom)).toBe(true);
  });

  it("matches a venue with no room against the venue's own roomless pool", () => {
    const venueOnly = { venueProfileId: "venue-1", stageId: null, hostProfileId: "host-1" };
    expect(isInHoldPool(hold("venue-1", null), venueOnly)).toBe(true);
    expect(isInHoldPool(hold("venue-1", "room-big"), venueOnly)).toBe(false);
  });

  describe("an unpinned hold", () => {
    const unpinned = { venueProfileId: null, stageId: null, hostProfileId: "host-1" };

    it("queues with its own host's unpinned holds", () => {
      expect(isInHoldPool(hold(null, null, "host-1"), unpinned)).toBe(true);
    });

    it("does NOT queue with another host's unpinned holds (decisions #20)", () => {
      // There is no room for two operators to be competing for, so inflating the
      // ranks on offer with a stranger's pencil would demote them for nothing.
      expect(isInHoldPool(hold(null, null, "host-2"), unpinned)).toBe(false);
    });

    it("does not queue with a hold pinned to a venue", () => {
      expect(isInHoldPool(hold("venue-1", "room-big", "host-1"), unpinned)).toBe(false);
    });
  });
});
