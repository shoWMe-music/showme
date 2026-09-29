import { describe, expect, it } from "vitest";
import { type StoredBreakdown, sameStoredBreakdown } from "./snapshot";

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

  it("answers false for an UNWRITTEN row", () => {
    // The UNSET case: `settlements.computed` is nullable, and a row with nothing in it has nothing
    // in common with a computed one.
    expect(sameStoredBreakdown(null, base())).toBe(false);
  });
});
