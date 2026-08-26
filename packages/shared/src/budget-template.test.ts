import { describe, expect, it } from "vitest";
import { readBudgetTemplatePayload } from "./budget-template";

describe("budget template payload", () => {
  const saved = {
    ticketTiers: [{ name: "General Admission", unitAmount: "6000", quantity: 1280 }],
    averageBarSpend: "500",
    capacity: 1600,
    otherRevenue: "100000",
    customRevenue: [{ label: "Sponsorship", amount: "500000" }],
    costs: [{ label: "Performer fee", amount: "5000000" }],
    paymentProcessing: { percentBasisPoints: 150, flatPerTicket: "50" },
  };

  it("reads a template back exactly as it was saved", () => {
    expect(readBudgetTemplatePayload(saved)).toEqual(saved);
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
