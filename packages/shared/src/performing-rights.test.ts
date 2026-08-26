import { describe, expect, it } from "vitest";
import {
  type PerformingRightsRate,
  estimatePerformingRightsFee,
  findPerformingRightsRate,
  isProCode,
} from "./performing-rights";

const major = (value: number) => BigInt(Math.round(value * 100));

/** A configured Swedish tariff — the shape a `performing_rights_rates` row loads as. */
const swedishTariff: PerformingRightsRate = {
  country: "SE",
  proCode: "stim",
  proName: "STIM",
  rateBasisPoints: 750,
  sourceUrl: "https://www.stim.se/en/tariffs",
  sourceNote: "Live concert tariff, 2026",
};

describe("performing-rights fee estimate — no configured tariff", () => {
  it("takes the planning rate off ticket revenue", () => {
    const estimate = estimatePerformingRightsFee(major(76800));

    expect(estimate.fee).toBe(major(4608)); // 6% of 76 800
    expect(estimate.rateBasisPoints).toBe(600);
    expect(estimate.basis).toBe("ticket_revenue");
  });

  /**
   * The point of the whole module: the number goes out carrying the fact that it
   * is nobody's tariff. If this ever stops being `planning_default` without a
   * tariff row behind it, the screen is presenting a guess as a quote.
   */
  it("declares that no territory tariff and no PRO stand behind it", () => {
    const estimate = estimatePerformingRightsFee(major(1000));

    expect(estimate.tariffSource).toBe("planning_default");
    expect(estimate.proCode).toBeNull();
    expect(estimate.proName).toBeNull();
    expect(estimate.country).toBeNull();
  });

  it("is zero when no ticket has been priced", () => {
    expect(estimatePerformingRightsFee(0n).fee).toBe(0n);
  });

  /**
   * A KNOWN territory with NO configured rate is a different situation from an
   * unplaceable event, and the difference is the whole reason an admin would go
   * and configure France. The estimate keeps the country and still refuses to
   * dress 6% up as a tariff.
   */
  it("keeps the country but stays a planning default when that country is unconfigured", () => {
    const estimate = estimatePerformingRightsFee(major(1000), { country: "FR", rate: null });

    expect(estimate.country).toBe("FR");
    expect(estimate.tariffSource).toBe("planning_default");
    expect(estimate.rateBasisPoints).toBe(600);
    expect(estimate.proName).toBeNull();
  });

  /** A country we cannot spell is not a country. Better null than a bad stamp. */
  it("discards a country that is not an alpha-2 code", () => {
    expect(estimatePerformingRightsFee(0n, { country: "Sweden", rate: null }).country).toBeNull();
    expect(estimatePerformingRightsFee(0n, { country: "", rate: null }).country).toBeNull();
  });
});

describe("performing-rights fee estimate — a configured territory tariff", () => {
  it("charges the territory's rate and names the society behind it", () => {
    const estimate = estimatePerformingRightsFee(major(76800), {
      country: "SE",
      rate: swedishTariff,
    });

    expect(estimate.fee).toBe(major(5760)); // 7.5% of 76 800
    expect(estimate.rateBasisPoints).toBe(750);
    expect(estimate.tariffSource).toBe("territory_tariff");
    expect(estimate.country).toBe("SE");
    expect(estimate.proCode).toBe("stim");
    expect(estimate.proName).toBe("STIM");
    expect(estimate.sourceNote).toBe("Live concert tariff, 2026");
  });

  /**
   * A society with no filing code of record is still a society. France's rate
   * carries `none` and the name "SACEM" — the card must print SACEM, not fall
   * back to the planning default because the enum is short.
   */
  it("is a real tariff even where the filing enum has no code for the society", () => {
    const estimate = estimatePerformingRightsFee(major(1000), {
      country: "FR",
      rate: {
        country: "FR",
        proCode: "none",
        proName: "SACEM",
        rateBasisPoints: 850,
        sourceUrl: null,
        sourceNote: null,
      },
    });

    expect(estimate.tariffSource).toBe("territory_tariff");
    expect(estimate.proName).toBe("SACEM");
    expect(estimate.proCode).toBe("none");
  });

  it("charges nothing on a zero rate, and says a tariff said so", () => {
    const estimate = estimatePerformingRightsFee(major(50000), {
      country: "SE",
      rate: { ...swedishTariff, rateBasisPoints: 0 },
    });

    expect(estimate.fee).toBe(0n);
    expect(estimate.tariffSource).toBe("territory_tariff");
  });
});

describe("findPerformingRightsRate", () => {
  const rates = [swedishTariff, { ...swedishTariff, country: "de", proCode: "gema" as const }];

  it("matches on the normalized alpha-2 code, whichever case either side is in", () => {
    expect(findPerformingRightsRate("se", rates)).toBe(swedishTariff);
    expect(findPerformingRightsRate(" SE ", rates)).toBe(swedishTariff);
    expect(findPerformingRightsRate("DE", rates)?.proCode).toBe("gema");
  });

  it("returns null for an unconfigured, unknown or absent country", () => {
    expect(findPerformingRightsRate("FR", rates)).toBeNull();
    expect(findPerformingRightsRate(null, rates)).toBeNull();
    expect(findPerformingRightsRate("Sweden", rates)).toBeNull();
  });
});

describe("isProCode", () => {
  it("accepts the four filing codes and nothing else", () => {
    expect(isProCode("stim")).toBe(true);
    expect(isProCode("none")).toBe(true);
    expect(isProCode("sacem")).toBe(false);
    expect(isProCode("STIM")).toBe(false);
  });
});
