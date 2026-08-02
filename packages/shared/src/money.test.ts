import { describe, expect, it } from "vitest";
import {
  addMoney,
  allocate,
  applyBasisPoints,
  majorToMinor,
  minorToDecimalString,
  money,
  moneyToJson,
  subtractMoney,
  sumMoney,
} from "./money";

describe("Money arithmetic", () => {
  it("adds and subtracts within a currency", () => {
    expect(addMoney(money(1000n, "EUR"), money(500n, "EUR"))).toEqual(money(1500n, "EUR"));
    expect(subtractMoney(money(1000n, "EUR"), money(500n, "EUR"))).toEqual(money(500n, "EUR"));
  });

  it("throws on a currency mismatch", () => {
    expect(() => addMoney(money(1000n, "EUR"), money(1000n, "SEK"))).toThrow(/mismatch/i);
    expect(() => sumMoney([money(1n, "EUR"), money(1n, "SEK")], "EUR")).toThrow(/mismatch/i);
  });
});

describe("allocate — largest remainder", () => {
  it("distributes exactly with no lost units", () => {
    expect(allocate(100n, [1n, 1n, 1n])).toEqual([34n, 33n, 33n]);
    expect(allocate(100n, [1n, 1n, 1n]).reduce((a, b) => a + b, 0n)).toBe(100n);
  });

  it("splits by weight and always totals the input", () => {
    expect(allocate(1000n, [50n, 50n])).toEqual([500n, 500n]);
    const uneven = allocate(1001n, [1n, 1n, 1n]);
    expect(uneven.reduce((a, b) => a + b, 0n)).toBe(1001n);
  });

  it("handles negative totals symmetrically", () => {
    expect(allocate(-100n, [1n, 1n, 1n])).toEqual([-34n, -33n, -33n]);
  });
});

describe("basis points", () => {
  it("takes a percentage in minor units, rounded half-up", () => {
    expect(applyBasisPoints(1000n, 4000)).toBe(400n); // 40% of €10.00
    expect(applyBasisPoints(333n, 5000)).toBe(167n); // 50% of 333 → 166.5 → 167
  });
});

describe("currency-aware conversion", () => {
  it("parses major to minor units by exponent", () => {
    expect(majorToMinor("10.00", "EUR")).toBe(1000n);
    expect(majorToMinor("10", "EUR")).toBe(1000n);
    expect(majorToMinor("1000", "JPY")).toBe(1000n); // exponent 0
    expect(majorToMinor("1.5", "KWD")).toBe(1500n); // exponent 3
    expect(majorToMinor("-2.50", "EUR")).toBe(-250n);
  });

  it("renders minor units back to a decimal string", () => {
    expect(minorToDecimalString(money(1000n, "EUR"))).toBe("10.00");
    expect(minorToDecimalString(money(1000n, "JPY"))).toBe("1000");
    expect(minorToDecimalString(money(-250n, "EUR"))).toBe("-2.50");
  });

  it("serializes to a string at the JSON boundary", () => {
    expect(moneyToJson(money(1000n, "EUR"))).toEqual({ amount: "1000", currency: "EUR" });
  });
});
