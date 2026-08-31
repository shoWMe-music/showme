/**
 * The MAJOR ↔ MINOR unit boundary — the one place the Budget Planner's factor of
 * a hundred lives (money.md), and the one place it could quietly go missing.
 *
 * It sits in `lib/` rather than inside `useBudgetEditor` for a reason worth
 * stating: these are pure string functions, and `useBudgetEditor` is a React hook
 * that drags in the generated API client, the design system and TanStack Query.
 * Nothing that has to be unit-tested should be reachable only through that. See
 * `apps/api/src/money-units.test.ts` — the tests live in `apps/api` because that
 * is where a vitest runner exists, and they can only import this file because it
 * is free of React.
 */

/**
 * A typed decimal shifted two places left and rounded HALF-UP, as an integer
 * string — the one conversion behind both minor units and basis points (money.md).
 *
 * DONE IN THE STRING, NEVER THROUGH A FLOAT. `Math.round(4.015 * 100)` is 401,
 * not 402, because 4.015 is not representable in binary and the product comes out
 * as 401.49999999999994. That is a whole minor unit lost on a figure the operator
 * can see themselves typing, in the one screen whose output has to satisfy
 * `Σ net = 0` exactly. Measured against the live stack on 2026-08-27: typing
 * 4.015 into a cost row stored `401`.
 *
 * The digits are shifted by moving where the point sits, and the FIRST DROPPED
 * DIGIT decides the rounding — so nothing here depends on binary floating point.
 * A negative figure rounds away from zero (−0.005 → −1), which is what half-up
 * means in accounting; the planner's fields are non-negative in practice.
 *
 * Anything that is not a finite number reads as "0", exactly as before — an
 * unparseable field is not a figure, and refusing to write it would leave the
 * operator with no way to clear a row.
 *
 * A COMMA IS A DECIMAL POINT. The planner's amount fields are `inputMode="decimal"`
 * TEXT inputs, not `type="number"`, so a Swedish or German keypad puts a comma in
 * front of this function for real — and until 2026-08-31 `"4,015"` came out as
 * `"0"`, silently clearing the row on a product whose first market writes money
 * that way. Daniel chose the Nordic reading: one comma is always the decimal
 * separator, never a thousands group. `"4,015"` is 4.015, not four thousand.
 *
 * The trade is deliberate and worth naming: a US-style `"1,234"` now reads as
 * 1.234 rather than 1234. Two or more commas produce two or more points and fall
 * through to the "not a figure" answer above rather than being guessed at, which
 * is the safe end of that trade — a cleared row is visible, a figure a thousand
 * times too small is not.
 */
export function shiftedTwoPlaces(value: string): string {
  const trimmed = value.trim().replace(",", ".");
  if (trimmed === "" || !Number.isFinite(Number(trimmed))) return "0";
  // Exponent notation is folded into the point's position rather than evaluated,
  // so a template or a CSV carrying `1.5e3` stays exact too.
  const match = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(trimmed);
  if (!match) return "0";
  const [, sign, whole = "", fraction = "", exponent = "0"] = match;
  const digits = `${whole}${fraction}`;
  const pointAt = whole.length + Number(exponent) + 2;
  // A point at or left of the first digit means the whole figure is a fraction:
  // pad in front so there is always one kept digit to round into.
  const padded = pointAt <= 0 ? `${"0".repeat(1 - pointAt)}${digits}` : digits.padEnd(pointAt, "0");
  const keep = pointAt <= 0 ? 1 : pointAt;
  const kept = BigInt(padded.slice(0, keep));
  const rounded = padded.charAt(keep) >= "5" ? kept + 1n : kept;
  return rounded === 0n ? "0" : `${sign === "-" ? "-" : ""}${rounded}`;
}

/**
 * Money crosses the wire as a whole number of MINOR units in a string (money.md)
 * because a JS number loses precision past 2^53. The planner's fields are major
 * units, so these two are the only places the factor of 100 lives.
 */
export function toMinorUnits(major: string): string {
  return shiftedTwoPlaces(major);
}

export function toMajorUnits(minor: string): string {
  const parsed = Number(minor);
  // An unreadable amount is unknown, not zero — surfacing it as a literal "0"
  // puts a figure in front of the operator that nobody entered.
  if (!Number.isFinite(parsed)) return "";
  return (parsed / 100).toString();
}

/**
 * Percentages are integer BASIS POINTS on the wire (money.md) — 1.5% is 150, never
 * a float. The planner's field is a percentage, so these two are the only places
 * the factor of 100 lives for rates, exactly as `toMinorUnits` is for money.
 */
export function toBasisPoints(percent: string): number {
  return Number(shiftedTwoPlaces(percent));
}

export function toPercentText(basisPoints: number): string {
  return (basisPoints / 100).toString();
}
