import { describe, expect, it } from "vitest";
import { type TicketTierDraft, mergeTicketTierSeeds, preferredBudget } from "./useBudgetEditor";

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

/** A stored tier row: has a breakdown, and remembers which event tier it is. */
const tier = (id: string, name: string, originTierId?: string): TicketTierDraft => ({
  id,
  name,
  price: "80",
  quantity: "60",
  hasBreakdown: true,
  ...(originTierId != null ? { originTierId } : {}),
});

/** An event tier as the seed offers it, keyed by its own id. */
const seedOf = (originTierId: string, name: string): TicketTierDraft => ({
  id: `new:event-${originTierId}`,
  name,
  price: "80",
  quantity: "60",
  originTierId,
});

/** A door somebody typed as one figure: no breakdown, no origin. */
const handTyped = (id: string, name: string): TicketTierDraft => ({
  id,
  name,
  price: "25000",
  quantity: "1",
  hasBreakdown: false,
});

describe("mergeTicketTierSeeds", () => {
  it("keeps the event's other tiers after one of them has been written", () => {
    // The exact shape that lost the money: Door entry written, Advance still
    // only a seed.
    const merged = mergeTicketTierSeeds(
      [tier("line-1", "Door entry")],
      [seedOf("a", "Door entry"), seedOf("b", "Advance")],
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
      [seedOf("a", "Door entry"), seedOf("b", "Advance")],
    );

    expect(merged.map((row) => row.id)).toEqual(["line-1", "new:event-a"]);
  });

  it("matches on the trimmed, case-insensitive name, the only identity a write keeps", () => {
    const merged = mergeTicketTierSeeds(
      [tier("line-1", "  door entry ")],
      [seedOf("a", "Door Entry")],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]?.id).toBe("line-1");
  });

  it("is the event's list when the budget holds nothing yet", () => {
    const eventTiers = [seedOf("a", "Door entry"), seedOf("b", "Advance")];

    expect(mergeTicketTierSeeds([], eventTiers)).toEqual(eventTiers);
  });

  it("is the budget's list when the event lists no tiers", () => {
    const serverTiers = [tier("line-1", "General Admission")];

    expect(mergeTicketTierSeeds(serverTiers, [])).toEqual(serverTiers);
  });

  it("is empty when neither has anything, so the caller can seed its blank row", () => {
    expect(mergeTicketTierSeeds([], [])).toEqual([]);
  });

  /**
   * THE SEAM THE FIRST VERSION OF THIS FIX OPENED (QA sweep run 3, 2026-09-26).
   *
   * Matching on the name alone meant renaming a written tier counted it twice: the
   * row under its new name, and the event's tier seeded again beside it. SEK 6,300
   * settled at SEK 7,800, and `copyBudgetOnce` wrote the phantom into the budget
   * permanently. A name is what a person edits; an id is what a row is.
   */
  it("does not re-seed a renamed tier — the id is the identity, not the label", () => {
    const merged = mergeTicketTierSeeds(
      [tier("line-1", "Door entry, cash only", "openmic-door")],
      [seedOf("openmic-door", "Door entry")],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]?.id).toBe("line-1");
  });

  it("still matches by name for rows written before the id was stored", () => {
    // `details.tierId` is absent on every line written before it existed, so the
    // name has to go on working for those.
    const merged = mergeTicketTierSeeds(
      [tier("line-1", "Door entry")],
      [seedOf("openmic-door", "Door entry")],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]?.id).toBe("line-1");
  });

  /**
   * The planner's half of `statesItsOwnDoor` in `settlement-lines.ts`. It was only
   * on the API side, so the settlement read a hand-typed door correctly while the
   * planner showed it PLUS both event tiers — SEK 57,000 on a SEK 25,000 night.
   */
  it("shows no event tiers beside a door somebody typed as one figure", () => {
    const merged = mergeTicketTierSeeds(
      [handTyped("line-1", "Door, as actually counted")],
      [seedOf("t1", "Door entry"), seedOf("t2", "Advance")],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]?.name).toBe("Door, as actually counted");
  });

  it("does not let a tier added in the planner suppress the event's tiers", () => {
    // A row added here has a breakdown but no origin — it is an extra tier, not a
    // restatement of the whole door, so the event's tiers still belong on the sheet.
    const merged = mergeTicketTierSeeds(
      [tier("line-1", "Guest list upgrade")],
      [seedOf("t1", "Door entry")],
    );

    expect(merged.map((row) => row.name)).toEqual(["Guest list upgrade", "Door entry"]);
  });

  /**
   * Remove on a seeded row had nothing to delete, so the next re-seed put it
   * straight back and the control looked dead — pressed twice, nothing happened.
   */
  it("keeps a dismissed seed off the sheet", () => {
    const merged = mergeTicketTierSeeds(
      [],
      [seedOf("t1", "Door entry"), seedOf("t2", "Advance")],
      new Set(["new:event-t1"]),
    );

    expect(merged.map((row) => row.name)).toEqual(["Advance"]);
  });
});

/**
 * WHICH BOOK OPENS (QA sweep run 3, r3:173).
 *
 * The scope switch was component state: *"My budget"* reverted to *"Shared ledger"*
 * on every reload, and there was no `?budgetScope=` to link either one by. The shared
 * ledger stays the default — on a screen where two books must never be confused, the
 * one everybody can see is the safe one to open — but a link can now name the other.
 */
describe("preferredBudget", () => {
  const shared = { id: "s", scope: "shared" } as Parameters<typeof preferredBudget>[0][number];
  const mine = { id: "m", scope: "private" } as Parameters<typeof preferredBudget>[0][number];

  it("opens the shared ledger by default", () => {
    expect(preferredBudget([mine, shared])?.id).toBe("s");
    expect(preferredBudget([mine, shared], undefined)?.id).toBe("s");
    expect(preferredBudget([mine, shared], "shared")?.id).toBe("s");
  });

  it("opens the private book when the link asked for it", () => {
    expect(preferredBudget([shared, mine], "mine")?.id).toBe("m");
  });

  it("falls back to the shared ledger when there is no private book to open", () => {
    expect(preferredBudget([shared], "mine")?.id).toBe("s");
    expect(preferredBudget([], "mine")).toBeUndefined();
  });
});
