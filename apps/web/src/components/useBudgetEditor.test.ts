import { describe, expect, it } from "vitest";
import { type TicketTierDraft, mergeTicketTierSeeds } from "./useBudgetEditor";

/**
 * THE BUG THIS FILE EXISTS FOR (QA sweep 2026-09-26, run 2, BLOCKER).
 *
 * The seed was all-or-nothing and the flush is per-row, so editing one of an
 * event's two tiers wrote that row, flipped the seed to "the budget has tiers
 * now" and deleted the other one — SEK 4,800 of a SEK 6,300 door, lost to the
 * settlement as well as to the screen.
 *
 * A hook cannot be rendered here (this repo has no testing-library — the same
 * reason `realtimeLifecycle.ts` is a pure module), so the merge is a pure
 * function and this is the test that can fail on it.
 */

const tier = (id: string, name: string): TicketTierDraft => ({
  id,
  name,
  price: "80",
  quantity: "60",
});

describe("mergeTicketTierSeeds", () => {
  it("keeps the event's other tiers after one of them has been written", () => {
    // The exact shape that lost the money: Door entry written, Advance still
    // only a seed.
    const merged = mergeTicketTierSeeds(
      [tier("line-1", "Door entry")],
      [tier("new:event-a", "Door entry"), tier("new:event-b", "Advance")],
    );

    expect(merged.map((row) => row.name)).toEqual(["Door entry", "Advance"]);
    // The written row is the server's, not the seed's — the seed must not
    // overwrite a figure the operator has already stored.
    expect(merged[0]?.id).toBe("line-1");
    expect(merged[1]?.id).toBe("new:event-b");
  });

  it("withdraws a seed only for the tier the budget actually holds", () => {
    const merged = mergeTicketTierSeeds(
      [tier("line-1", "Advance")],
      [tier("new:event-a", "Door entry"), tier("new:event-b", "Advance")],
    );

    expect(merged.map((row) => row.id)).toEqual(["line-1", "new:event-a"]);
  });

  it("matches on the trimmed, case-insensitive name, the only identity a write keeps", () => {
    const merged = mergeTicketTierSeeds(
      [tier("line-1", "  door entry ")],
      [tier("new:event-a", "Door Entry")],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]?.id).toBe("line-1");
  });

  it("is the event's list when the budget holds nothing yet", () => {
    const eventTiers = [tier("new:event-a", "Door entry"), tier("new:event-b", "Advance")];

    expect(mergeTicketTierSeeds([], eventTiers)).toEqual(eventTiers);
  });

  it("is the budget's list when the event lists no tiers", () => {
    const serverTiers = [tier("line-1", "General Admission")];

    expect(mergeTicketTierSeeds(serverTiers, [])).toEqual(serverTiers);
  });

  it("is empty when neither has anything, so the caller can seed its blank row", () => {
    expect(mergeTicketTierSeeds([], [])).toEqual([]);
  });
});
