/**
 * MAJOR → MINOR unit conversion — the rounding helper behind the Budget Planner.
 *
 * `shiftedTwoPlaces` decides what whole minor units a typed figure becomes, on
 * the one screen whose output must satisfy `Σ net = 0`, and it was the site of a
 * real bug (`Math.round(Number("4.015") * 100)` is 401, not 402).
 *
 * The conversions live in `lib/moneyUnits.ts` rather than inside
 * `useBudgetEditor` precisely so they can be asserted without React, TanStack
 * Query, the design system and the generated API client coming along.
 */
import { describe, expect, it } from "vitest";
import { shiftedTwoPlaces, toBasisPoints, toMinorUnits } from "./moneyUnits";

describe("shiftedTwoPlaces — the float traps", () => {
  /**
   * The reason the function exists. Each of these is a figure an operator can
   * watch themselves type, where the IEEE-754 product lands just under the .5 and
   * `Math.round` silently loses a whole minor unit. The second column is what the
   * float route returns, and it is what shipped before.
   */
  it("rounds the classic half-up offenders the float route gets wrong", () => {
    expect(shiftedTwoPlaces("4.015")).toBe("402"); // Math.round route: 401
    expect(shiftedTwoPlaces("1.005")).toBe("101"); // Math.round route: 100
    expect(shiftedTwoPlaces("8.165")).toBe("817"); // Math.round route: 816
    // Not every tie is a trap — these two land the right side of .5 even in
    // binary. They are here so a regression that breaks ordinary ties is caught
    // by the same test as one that breaks the pathological ones.
    expect(shiftedTwoPlaces("0.615")).toBe("62");
    expect(shiftedTwoPlaces("2.675")).toBe("268");
    expect(shiftedTwoPlaces("1.115")).toBe("112");
  });

  it("is exact where a float has already lost the digits", () => {
    // Past 2^53 a JS number cannot hold the figure at all: the float route
    // answers 1.2345678901234568e+21. Money is bigint minor units precisely so
    // that this stays a matter of digits rather than of magnitude.
    expect(shiftedTwoPlaces("12345678901234567890.99")).toBe("1234567890123456789099");
    // …including when the carry has to propagate the whole way up.
    expect(shiftedTwoPlaces("99999999999999999999.995")).toBe("10000000000000000000000");
  });

  it("rounds a negative away from zero — half-up as accounting means it", () => {
    expect(shiftedTwoPlaces("-0.005")).toBe("-1");
    expect(shiftedTwoPlaces("-4.015")).toBe("-402");
    expect(shiftedTwoPlaces("-1.005")).toBe("-101");
    // A negative that rounds to nothing is "0", never "-0" — a signed zero would
    // be a `BigInt("-0")` waiting to happen at the call site.
    expect(shiftedTwoPlaces("-0.004")).toBe("0");
    expect(shiftedTwoPlaces("-0")).toBe("0");
  });

  it("keeps only the first dropped digit as the tie-breaker", () => {
    // 1.2345 → 123 and 1.2355 → 124: the decision is made on the third decimal
    // alone, so a long tail neither drags a value up nor holds it down.
    expect(shiftedTwoPlaces("1.2345")).toBe("123");
    expect(shiftedTwoPlaces("1.2355")).toBe("124");
    expect(shiftedTwoPlaces("1.0049999999")).toBe("100");
    expect(shiftedTwoPlaces("1.999999")).toBe("200");
    expect(shiftedTwoPlaces("9.999")).toBe("1000");
  });

  it("reads an unparseable field as 0 rather than refusing the write", () => {
    // The documented contract: an operator must always be able to clear a row.
    expect(shiftedTwoPlaces("")).toBe("0");
    expect(shiftedTwoPlaces("   ")).toBe("0");
    expect(shiftedTwoPlaces("abc")).toBe("0");
    expect(shiftedTwoPlaces("NaN")).toBe("0");
    expect(shiftedTwoPlaces("Infinity")).toBe("0");
    expect(shiftedTwoPlaces("-Infinity")).toBe("0");
    // Hexadecimal passes `Number.isFinite` (16) and is still refused, because the
    // regex is the real parser. A typed money field is decimal or it is nothing.
    expect(shiftedTwoPlaces("0x10")).toBe("0");
    // A decimal comma USED to land here, reading as 0 and silently clearing the
    // row. It no longer does — the parser learned the Nordic reading on
    // 2026-08-31, which is the change this line was left inviting. The comma
    // cases moved to their own block below; what stays unparseable is a figure
    // with more than one separator, which is genuinely ambiguous.
    expect(shiftedTwoPlaces("1,234,567")).toBe("0");
  });

  it("accepts the shapes a typed field actually produces", () => {
    expect(shiftedTwoPlaces("  4.015  ")).toBe("402"); // surrounding space
    expect(shiftedTwoPlaces("+4.015")).toBe("402"); // an explicit plus
    expect(shiftedTwoPlaces("004.015")).toBe("402"); // leading zeros
    expect(shiftedTwoPlaces(".5")).toBe("50"); // no whole part
    expect(shiftedTwoPlaces("5.")).toBe("500"); // no fraction
    expect(shiftedTwoPlaces("0.00")).toBe("0");
    expect(shiftedTwoPlaces("10")).toBe("1000");
  });

  it("folds exponent notation into the point rather than evaluating it", () => {
    // A pasted CSV or a template can carry `1.5e3`; the shift is still done in
    // the string, so the exactness survives.
    expect(shiftedTwoPlaces("1.5e3")).toBe("150000");
    expect(shiftedTwoPlaces("1.23456e2")).toBe("12346");
    // Below a minor unit the whole figure rounds away, including at the tie.
    expect(shiftedTwoPlaces("5e-3")).toBe("1");
    expect(shiftedTwoPlaces("1e-3")).toBe("0");
    expect(shiftedTwoPlaces("1e-5")).toBe("0");
    expect(shiftedTwoPlaces("0.0000001")).toBe("0");
  });

  it("has one seam at the edge of the double range, and it fails closed", () => {
    // The finite guard is `Number(trimmed)`, so the ceiling is the DOUBLE's, not
    // the string's: 1e308 is shifted exactly into a 311-digit integer, and 1e309
    // — one power of ten further — is Infinity to `Number` and reads as "0".
    // Both are far outside any money this product handles, and "0" is the same
    // fail-closed answer every other unparseable field gets. Recorded so the
    // discontinuity is a known one rather than a surprise.
    expect(shiftedTwoPlaces("1e308")).toBe(`1${"0".repeat(310)}`);
    expect(shiftedTwoPlaces("1e309")).toBe("0");
  });
});

describe("a decimal comma, because the first market types one", () => {
  // Until 2026-08-31 every one of these returned "0" and silently cleared the
  // row. The planner's amount fields are `inputMode="decimal"` TEXT inputs, so a
  // Nordic keypad's comma really does reach this function.
  it("reads a comma as the decimal point", () => {
    // 402, not 401 — the same answer "4.015" gets. A float would say 401 here,
    // which is the bug this whole module exists to avoid; the comma must not be
    // a second way back into it.
    expect(shiftedTwoPlaces("4,015")).toBe("402");
    expect(shiftedTwoPlaces("4,5")).toBe("450");
    expect(shiftedTwoPlaces("4,50")).toBe("450");
    expect(shiftedTwoPlaces("1,005")).toBe("101");
    expect(shiftedTwoPlaces("0,01")).toBe("1");
    expect(shiftedTwoPlaces("-0,005")).toBe("-1");
  });

  it("gives a comma and a full stop the same answer", () => {
    const pairs: ReadonlyArray<readonly [string, string]> = [
      ["4,015", "4.015"],
      ["1250,00", "1250.00"],
      ["0,615", "0.615"],
    ];
    for (const [comma, point] of pairs) {
      expect(shiftedTwoPlaces(comma)).toBe(shiftedTwoPlaces(point));
    }
  });

  it("refuses a thousands-grouped figure rather than guessing at it", () => {
    // The deliberate trade: one comma is ALWAYS the decimal point, so a
    // US-style "1,234" is 1.234 — not 1234. Two or more commas make two or more
    // points, which is not a figure, so the row clears instead of being read a
    // thousand times too small. A cleared row is visible; a wrong figure is not.
    expect(shiftedTwoPlaces("1,234")).toBe("123");
    expect(shiftedTwoPlaces("1,234,567")).toBe("0");
    expect(shiftedTwoPlaces("1.234,56")).toBe("0");
  });
});

describe("the two callers of it", () => {
  it("toMinorUnits is the conversion verbatim — money.md's wire shape", () => {
    // A string, because a JS number loses precision past 2^53 and the wire
    // carries whole minor units.
    expect(toMinorUnits("4.015")).toBe("402");
    expect(toMinorUnits("1250")).toBe("125000");
    expect(toMinorUnits("")).toBe("0");
  });

  it("toBasisPoints is the same conversion as an integer — 1.5% is 150", () => {
    expect(toBasisPoints("1.5")).toBe(150);
    expect(toBasisPoints("2.375")).toBe(238); // the same half-up, on a rate
    expect(toBasisPoints("100")).toBe(10000);
    expect(toBasisPoints("")).toBe(0);
    expect(toBasisPoints("nonsense")).toBe(0);
  });
});
