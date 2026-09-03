import { describe, expect, it } from "vitest";
import { readBudgetTemplatePayload } from "./budget-template";

describe("budget template payload", () => {
  const saved = {
    ticketTiers: [{ name: "General Admission", unitAmount: "6000", quantity: 1280 }],
    averageBarSpend: "500",
    averageMerchSpend: "250",
    capacity: 1600,
    otherRevenue: "100000",
    customRevenue: [{ label: "Sponsorship", amount: "500000" }],
    costs: [{ label: "Performer fee", amount: "5000000" }],
    paymentProcessing: { percentBasisPoints: 150, flatPerTicket: "50" },
  };

  it("reads a template back exactly as it was saved", () => {
    expect(readBudgetTemplatePayload(saved)).toEqual(saved);
  });

  /**
   * A template SAVED BEFORE bar and merch were split (ClickUp `86cbcn1ue`) states
   * no merch figure at all. It must still load, and it must load as **zero merch**
   * rather than as an absent field — every other amount in this reader degrades to
   * "0" for the same reason, which is that the planner multiplies these figures
   * and `undefined * heads` is how a budget acquires a NaN.
   *
   * Zero is also the only honest reading: the old combined row recorded one
   * per-head number covering both takes, and there is no way to recover from it
   * how much of it was merch. Inventing a share would put money on the sheet that
   * nobody entered.
   */
  it("reads a template saved before the merch split as zero merch, not as a missing field", () => {
    const { averageMerchSpend: _dropped, ...preSplit } = saved;
    const payload = readBudgetTemplatePayload(preSplit);

    expect(payload.averageMerchSpend).toBe("0");
    // And nothing else moved: the bar figure it WAS saved with is untouched.
    expect(payload.averageBarSpend).toBe("500");
  });

  it("degrades an unreadable payload to empty fields, never to invented figures", () => {
    for (const rubbish of [null, undefined, "not an object", 42, []]) {
      const payload = readBudgetTemplatePayload(rubbish);

      expect(payload.ticketTiers).toEqual([]);
      expect(payload.costs).toEqual([]);
      expect(payload.customRevenue).toEqual([]);
      expect(payload.capacity).toBe(0);
      expect(payload.otherRevenue).toBe("0");
      expect(payload.paymentProcessing).toBeUndefined();
    }
  });

  it("refuses an amount that is not minor units, because BigInt() would throw on it", () => {
    const payload = readBudgetTemplatePayload({
      ...saved,
      otherRevenue: "1,5", // a decimal comma from a hand-edited row
      costs: [{ label: "Venue cost", amount: "40.00" }],
    });

    expect(payload.otherRevenue).toBe("0");
    expect(payload.costs[0]?.amount).toBe("0");
    expect(() => BigInt(payload.otherRevenue)).not.toThrow();
  });

  it("drops a nameless row rather than loading a blank line", () => {
    const payload = readBudgetTemplatePayload({
      ...saved,
      costs: [
        { label: "", amount: "100" },
        { label: "Venue cost", amount: "400" },
      ],
    });

    expect(payload.costs).toEqual([{ label: "Venue cost", amount: "400" }]);
  });

  it("omits the processing assumption when the saved budget named no provider", () => {
    const { paymentProcessing, ...withoutProvider } = saved;

    expect(readBudgetTemplatePayload(withoutProvider).paymentProcessing).toBeUndefined();
  });

  it("truncates a fractional capacity — a template cannot seat half a guest", () => {
    expect(readBudgetTemplatePayload({ ...saved, capacity: 1600.7 }).capacity).toBe(1600);
  });
});
