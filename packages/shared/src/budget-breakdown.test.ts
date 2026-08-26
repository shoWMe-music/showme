import { describe, expect, it } from "vitest";
import { computeBreakdown } from "./budget-breakdown";

const major = (value: number) => BigInt(Math.round(value * 100));
const slice = (label: string, amount: number) => ({ label, amount: major(amount), color: "#000" });

describe("budget breakdown rows", () => {
  const rows = computeBreakdown(
    [slice("Performer fee", 50000), slice("Production cost", 6500), slice("Venue cost", 4000)],
    major(61652),
  );

  it("prints each slice as a share of the whole", () => {
    expect(rows.map((row) => row.percentOfTotal)).toEqual([81, 11, 6]);
  });

  it("draws bars against the biggest slice, so small ones stay visible", () => {
    // 6 500 of 50 000 is 13% of the largest bar, not the 11% of total it prints.
    expect(rows[0]?.percentOfLargest).toBe(100);
    expect(rows[1]?.percentOfLargest).toBe(13);
    expect(rows[1]?.percentOfTotal).toBe(11);
  });

  it("keeps the caller's order rather than sorting under the operator's cursor", () => {
    const unsorted = computeBreakdown([slice("Small", 10), slice("Large", 900)], major(910));
    expect(unsorted.map((row) => row.label)).toEqual(["Small", "Large"]);
  });

  it("drops slices nobody budgeted", () => {
    const sparse = computeBreakdown(
      [slice("Marketing cost", 0), slice("Venue cost", 100)],
      major(100),
    );
    expect(sparse.map((row) => row.label)).toEqual(["Venue cost"]);
  });

  it("returns nothing rather than dividing by zero on an empty budget", () => {
    expect(computeBreakdown([slice("Venue cost", 0)], 0n)).toEqual([]);
  });

  it("reports zero percent when a slice exists but the total does not", () => {
    // Costs with no revenue against them: the bars still draw, the shares are 0.
    const rowsWithoutTotal = computeBreakdown([slice("Venue cost", 400)], 0n);
    expect(rowsWithoutTotal[0]?.percentOfTotal).toBe(0);
    expect(rowsWithoutTotal[0]?.percentOfLargest).toBe(100);
  });
});
