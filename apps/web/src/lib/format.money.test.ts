import { describe, expect, it } from "vitest";
import { absoluteMinor, formatAmount, formatMoney, formatMoneyExact } from "./format";

/**
 * A CURRENCY'S MINOR UNIT IS NOT ALWAYS A HUNDREDTH (QA sweep run 3, 2026-09-26).
 *
 * These helpers divided by 100 whatever the currency, so a JPY event printed its
 * line items at JP¥240,000 and the waterfall beneath them at JP¥6,800 — the same
 * money, at 1% of itself. The settlement engine was right the whole time; only the
 * screen was wrong, which is the most convincing way for money to be wrong.
 */
describe("formatMoney", () => {
  it("scales a two-decimal currency by a hundred", () => {
    expect(formatMoney("660000", "SEK")).toContain("6,600");
  });

  it("does not scale a currency with no minor unit", () => {
    // 240000 minor units of JPY is ¥240,000, not ¥2,400.
    expect(formatMoney("240000", "JPY")).toContain("240,000");
  });

  it("scales a three-decimal currency by a thousand", () => {
    // KWD has 1,000 fils to the dinar — the failure in the other direction.
    expect(formatMoney("240000", "KWD")).toContain("240");
    expect(formatMoney("240000", "KWD")).not.toContain("2,400");
  });

  it("assumes two decimals for a code it does not know, rather than throwing", () => {
    // `currencyExponent` throws on an unknown code; a render path must not.
    expect(() => formatMoney("10000", "ZZZ")).not.toThrow();
  });

  it("falls back to EUR on an empty code without crashing", () => {
    expect(() => formatMoney("10000", "")).not.toThrow();
  });
});

describe("formatMoneyExact", () => {
  it("shows the decimals a two-decimal currency has", () => {
    expect(formatMoneyExact("660050", "SEK")).toContain("6,600.50");
  });

  it("shows no decimals in a currency that has none", () => {
    const yen = formatMoneyExact("240000", "JPY");
    expect(yen).toContain("240,000");
    expect(yen).not.toContain(".00");
  });

  it("shows three decimals in a three-decimal currency", () => {
    expect(formatMoneyExact("240500", "KWD")).toContain("240.500");
  });
});

describe("formatAmount", () => {
  it("assumes hundredths when the denomination is genuinely unknown", () => {
    expect(formatAmount("660000")).toBe("6,600");
  });

  it("uses the currency's own exponent when the caller knows it", () => {
    expect(formatAmount("240000", "JPY")).toBe("240,000");
  });
});

/**
 * THE MAGNITUDE, FOR A LABEL THAT ALREADY NAMES THE DIRECTION (QA7-28).
 *
 * "You owe −SEK 45,000" reads as a credit. The sign comes off the raw minor units,
 * because a formatted amount is free to put its minus anywhere the locale likes.
 */
describe("absoluteMinor", () => {
  it("strips the sign from a negative amount", () => {
    expect(absoluteMinor("-4500000")).toBe("4500000");
  });

  it("leaves a positive amount exactly as it was", () => {
    expect(absoluteMinor("2700000")).toBe("2700000");
  });

  it("keeps a zero as a zero rather than a signed one", () => {
    expect(absoluteMinor("-0")).toBe("0");
  });

  it("is exact past the safe-integer ceiling", () => {
    // 2^53 is where a float starts losing whole minor units. BigInt does not.
    expect(absoluteMinor("-9007199254740993")).toBe("9007199254740993");
  });

  it("returns anything that is not an integer string untouched", () => {
    // The formatters already have a story for junk; this must not throw on the way.
    expect(absoluteMinor("")).toBe("");
    expect(absoluteMinor("SEK 45,000")).toBe("SEK 45,000");
  });
});
