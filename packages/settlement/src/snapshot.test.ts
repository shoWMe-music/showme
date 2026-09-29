import { describe, expect, it } from "vitest";
import { type StoredBreakdown, samePartyFigures, sameStoredBreakdown } from "./snapshot";

const base = (over: Partial<StoredBreakdown> = {}): StoredBreakdown => ({
  participantId: "p1",
  entitlement: "23100",
  collected: "0",
  paid: "0",
  held: "0",
  net: "23100",
  ...over,
});

describe("have two snapshots of one party anything different to say", () => {
  it("sees a RESIDUAL SHARE move, which the route's own copy could not", () => {
    /*
     * QA sweep run 13. With the residual at 0, moving the operator cost split from an implicit
     * 50/50 to 70/30 produced a compute response carrying `residualBasisPoints: 7000 / 3000` while
     * the stored row kept `5000 / 5000` and `updated_at` never moved. The comparison listed seven
     * field names and the interface had fourteen.
     */
    const before = base({ residual: "0", residualBasisPoints: 5000 });
    const after = base({ residual: "0", residualBasisPoints: 7000 });
    expect(sameStoredBreakdown(before, after)).toBe(false);
    expect(sameStoredBreakdown(before, before)).toBe(true);
  });

  it("sees every OTHER field the old list skipped", () => {
    /*
     * The report named two of the seven. One assertion per field, because a comparison that misses
     * one field is the same defect as a comparison that misses two — and `entitlement` is asserted
     * NOT to change in each, so nothing here passes for the wrong reason.
     */
    const cases: Partial<StoredBreakdown>[] = [
      { commissionEarned: "500" },
      { deductibles: "1200" },
      { residual: "9900" },
      { residualBasisPoints: 3000 },
      { prepaid: "5000" },
      { prepaidCounterpartyIds: ["p2"] },
      { deductibleLines: [{ label: "PRO fee", amount: "300" }] },
    ];
    for (const change of cases) {
      const key = Object.keys(change)[0];
      expect(sameStoredBreakdown(base(), base(change)), `field ${key}`).toBe(false);
    }
  });

  it("still sees the fields it always saw — THE CONTROL", () => {
    // So the failures above are the new coverage and not the function answering false to everything.
    for (const change of [
      { entitlement: "1" },
      { collected: "1" },
      { paid: "1" },
      { held: "1" },
      { net: "1" },
      { participantId: "p2" },
      { lines: [] },
      { ladder: { adjustedNet: "1", rows: [] } as unknown as StoredBreakdown["ladder"] },
    ]) {
      expect(sameStoredBreakdown(base(), base(change)), JSON.stringify(change)).toBe(false);
    }
    expect(sameStoredBreakdown(base(), base())).toBe(true);
  });

  it("treats an ABSENT optional field as its zero, so a legacy row is not rewritten", () => {
    /*
     * Every optional field on `SerializedBreakdown` documents itself as absent-means-none, because a
     * settlement finalized before the field existed is a legal record and is never rewritten to add
     * one. Comparing the raw objects would report every such row as changed — and since finalize
     * asks this same question, it would refuse to finalize all of them.
     */
    const legacy = base();
    const fresh = base({
      commissionEarned: "0",
      deductibles: "0",
      residual: "0",
      prepaid: "0",
      prepaidCounterpartyIds: [],
      deductibleLines: [],
    });
    expect(sameStoredBreakdown(legacy, fresh)).toBe(true);
    // And absent is NOT a zero for the one field that is not money — a solo operator's share is the
    // whole thing and has no fraction to report, so absent must not equal 0 basis points.
    expect(sameStoredBreakdown(base(), base({ residualBasisPoints: 0 }))).toBe(false);
  });

  it("compares the prepaid counterparties as a SET, not as a sequence", () => {
    // Who the early money came from is the fact; the order two reconciles happen to list them in is
    // not a change to the settlement.
    expect(
      sameStoredBreakdown(
        base({ prepaidCounterpartyIds: ["a", "b"] }),
        base({ prepaidCounterpartyIds: ["b", "a"] }),
      ),
    ).toBe(true);
    expect(
      sameStoredBreakdown(
        base({ prepaidCounterpartyIds: ["a", "b"] }),
        base({ prepaidCounterpartyIds: ["a", "c"] }),
      ),
    ).toBe(false);
  });

  it("compares NESTED rows by value, not by key order", () => {
    /*
     * The claim the comparison is built on, and until now only a comment. `computed` comes back out
     * of a `jsonb` column, which does not preserve key order — so a stringify would report every
     * stored row as changed the first time Postgres handed the keys back differently, which is an
     * infinite "the figures moved" and a settlement that can never be finalized.
     *
     * Worth a test of its own because the comparison is hand-written: it used `node:util`'s
     * `isDeepStrictEqual` for an afternoon, and that import turned out to break the web app (a Node
     * builtin in a package Vite bundles for the browser). The replacement has to keep this property.
     */
    const line = { dealId: "d1", amount: "100", dealTotal: "200" };
    const reordered = { amount: "100", dealTotal: "200", dealId: "d1" };
    expect(Object.keys(line)).not.toEqual(Object.keys(reordered));
    expect(
      sameStoredBreakdown(base({ lines: [line] as never }), base({ lines: [reordered] as never })),
    ).toBe(true);
  });

  it("sees a nested row gain or lose a key", () => {
    // The other half of a by-value compare: same values, different SHAPE, is a change. Without the
    // key count a subset would read as equal.
    expect(
      sameStoredBreakdown(
        base({ lines: [{ dealId: "d1", amount: "100" }] as never }),
        base({ lines: [{ dealId: "d1", amount: "100", bonus: "5" }] as never }),
      ),
    ).toBe(false);
    // And ORDER within an array IS meaningful — the lines are the explanation, in order.
    expect(
      sameStoredBreakdown(
        base({ lines: [{ dealId: "a" }, { dealId: "b" }] as never }),
        base({ lines: [{ dealId: "b" }, { dealId: "a" }] as never }),
      ),
    ).toBe(false);
  });

  it("answers false for an UNWRITTEN row", () => {
    // The UNSET case: `settlements.computed` is nullable, and a row with nothing in it has nothing
    // in common with a computed one.
    expect(sameStoredBreakdown(null, base())).toBe(false);
  });
});

/**
 * DID THIS PARTY'S OWN MONEY MOVE — QA sweep run 16.
 *
 * The roster's "Signed off · Figures changed since" badge was derived from `updated_at`, and the pool
 * LADDER is stored inside every party's breakdown — so an unrelated cost edit told every signed party
 * their figures had changed. Measured: Priya Sound on a flat SEK 4,000 guarantee, entitlement and net
 * unmoved, badge lit.
 */
describe("samePartyFigures — the ladder is the night's, not the party's", () => {
  const withLadder = (ladder: Record<string, string>, over: Partial<StoredBreakdown> = {}) =>
    base({ ladder, ...over } as Partial<StoredBreakdown>);

  it("ignores a ladder that moved while the party's own figures did not", () => {
    const before = withLadder({ costs: "2650000", revenue: "5500000", adjustedNet: "2850000" });
    const after = withLadder({ costs: "2800000", revenue: "5500000", adjustedNet: "2700000" });
    // The row IS worth rewriting — this is the distinction, in one pair of assertions.
    expect(sameStoredBreakdown(before, after)).toBe(false);
    expect(samePartyFigures(before, after)).toBe(true);
  });

  /*
   * AND IT STILL SEES THE PARTY'S OWN MONEY MOVE. A comparison that ignored everything would close
   * the over-warning and un-warn every genuinely stale signature — which is the one irreversible
   * mistake available here, and the shape that has passed a naive test three times in this stretch.
   */
  it("sees an entitlement move, a net move and a deductible move", () => {
    const before = withLadder({ costs: "1" });
    expect(samePartyFigures(before, withLadder({ costs: "1" }, { entitlement: "40800" }))).toBe(
      false,
    );
    expect(samePartyFigures(before, withLadder({ costs: "1" }, { net: "40800" }))).toBe(false);
    expect(samePartyFigures(before, withLadder({ costs: "1" }, { deductibles: "500" }))).toBe(
      false,
    );
  });

  /*
   * `lines` STAYS IN. The composition of a party's own entitlement is theirs: a guarantee moved so
   * that it still loses to the door share leaves every total identical and changes what the settlement
   * SAYS to them — which is the reason the sibling comparison carries `lines` too.
   */
  it("sees the composition change even when every total is identical", () => {
    const before = withLadder({ costs: "1" }, {
      lines: [{ dealId: "d1", dealTotal: "23100", amount: "23100" }],
    } as Partial<StoredBreakdown>);
    const after = withLadder({ costs: "1" }, {
      lines: [{ dealId: "d1", dealTotal: "30000", amount: "23100" }],
    } as Partial<StoredBreakdown>);
    expect(samePartyFigures(before, after)).toBe(false);
  });

  it("treats an unwritten row as having nothing in common, like its sibling", () => {
    expect(samePartyFigures(null, base())).toBe(false);
  });
});
