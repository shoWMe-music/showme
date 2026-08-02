import { describe, expect, it } from "vitest";
import { convertMinorUnits } from "./exchange";

describe("convertMinorUnits", () => {
  it("is a no-op for the same currency", () => {
    expect(convertMinorUnits(123_45n, "SEK", "SEK", "1.0000000000")).toBe(123_45n);
  });

  it("converts between equal-exponent currencies (EUR→SEK)", () => {
    // 100.00 EUR × 11.50 = 1150.00 SEK.
    expect(convertMinorUnits(10_000n, "EUR", "SEK", "11.5000000000")).toBe(115_000n);
  });

  it("rounds half away from zero", () => {
    // 1 minor unit × 1.5 = 1.5 → rounds to 2.
    expect(convertMinorUnits(1n, "SEK", "EUR", "1.5000000000")).toBe(2n);
    // Symmetric for a negative (a cost line).
    expect(convertMinorUnits(-1n, "SEK", "EUR", "1.5000000000")).toBe(-2n);
  });

  it("handles differing minor-unit exponents (SEK 2dp → JPY 0dp)", () => {
    // 100.00 SEK (10000 minor) × 15 (JPY per SEK) = 1500 JPY (1500 minor, 0dp).
    expect(convertMinorUnits(10_000n, "SEK", "JPY", "15.0000000000")).toBe(1500n);
    // JPY 0dp → SEK 2dp: 1500 JPY × (1/15) ≈ 100.00 SEK = 10000 minor.
    expect(convertMinorUnits(1500n, "JPY", "SEK", "0.0666666667")).toBe(10_000n);
  });
});
