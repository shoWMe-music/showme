import { describe, expect, it } from "vitest";
import { estimatePerformingRightsFee } from "./performing-rights";

const major = (value: number) => BigInt(Math.round(value * 100));

describe("performing-rights fee estimate", () => {
  it("takes the planning rate off ticket revenue", () => {
    const estimate = estimatePerformingRightsFee(major(76800));

    expect(estimate.fee).toBe(major(4608)); // 6% of 76 800
    expect(estimate.rateBasisPoints).toBe(600);
    expect(estimate.basis).toBe("ticket_revenue");
  });

  /**
   * The point of the whole module: the number goes out carrying the fact that it
   * is nobody's tariff. If this ever stops being `planning_default` without a
   * tariff table behind it, the screen is presenting a guess as a quote.
   */
  it("declares that no territory tariff and no PRO stand behind it", () => {
    const estimate = estimatePerformingRightsFee(major(1000));

    expect(estimate.tariffSource).toBe("planning_default");
    expect(estimate.proCode).toBeNull();
  });

  it("is zero when no ticket has been priced", () => {
    expect(estimatePerformingRightsFee(0n).fee).toBe(0n);
  });
});
