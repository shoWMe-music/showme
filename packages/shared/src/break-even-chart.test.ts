import { describe, expect, it } from "vitest";
import { computeBreakEvenChart } from "./break-even-chart";
import { computeBudgetProjection } from "./budget-planning";

const major = (value: number) => BigInt(Math.round(value * 100));

/** The `[x, y]` of one point in a `x,y x,y` pair string. */
function pointAt(points: string, index: number): [number, number] {
  const [x, y] = (points.split(" ")[index] ?? "").split(",").map(Number);
  return [x ?? Number.NaN, y ?? Number.NaN];
}

describe("break-even chart geometry", () => {
  const projection = computeBudgetProjection({
    ticketTiers: [{ unitAmount: major(100), quantity: 500 }],
    averageBarSpend: 0n,
    capacity: 1000,
    otherRevenue: 0n,
    costs: [major(20000)], // 200 tickets to break even
  });
  const chart = computeBreakEvenChart({ projection, capacity: 1000 });

  it("draws revenue rising from the intercept to a sold-out house", () => {
    const [startX] = pointAt(chart.revenuePoints, 0);
    const [endX, endY] = pointAt(chart.revenuePoints, 1);
    const [, startY] = pointAt(chart.revenuePoints, 0);

    expect(startX).toBe(8); // the left padding
    expect(endX).toBe(chart.width - 8);
    // Up the page is a smaller y, so a rising line ENDS higher than it starts.
    expect(endY).toBeLessThan(startY);
  });

  it("draws total cost as a flat line, because none of it moves with the door", () => {
    const [, leftY] = pointAt(chart.costPoints, 0);
    const [, rightY] = pointAt(chart.costPoints, 1);
    expect(leftY).toBe(rightY);
  });

  it("puts the marker where the two lines actually cross", () => {
    // 200 of 1 000 tickets = a fifth of the way across the plot area.
    const plotWidth = chart.width - 16;
    expect(chart.breakEvenX).toBeCloseTo(8 + plotWidth * 0.2, 6);
    expect(chart.hasBreakEven).toBe(true);
    expect(chart.breakEvenTickets).toBe(200);
  });

  it("reports the KPI band's ticket count rather than rounding the crossing again", () => {
    // 1 000 of costs over a 30.00 ticket is 33.33 tickets: the band says 34 (a
    // part ticket is a whole ticket) and the chart footer must not say 33.
    const partial = computeBudgetProjection({
      ticketTiers: [{ unitAmount: major(30), quantity: 100 }],
      averageBarSpend: 0n,
      capacity: 100,
      otherRevenue: 0n,
      costs: [major(1000)],
    });
    const partialChart = computeBreakEvenChart({ projection: partial, capacity: 100 });

    expect(partial.breakEvenTickets).toBe(34);
    expect(partialChart.breakEvenTickets).toBe(34);
  });

  it("hides the marker when the show is already covered before the doors open", () => {
    const covered = computeBudgetProjection({
      ticketTiers: [{ unitAmount: major(100), quantity: 100 }],
      averageBarSpend: 0n,
      capacity: 100,
      otherRevenue: major(9000), // a fee that covers the lot
      costs: [major(5000)],
    });
    const coveredChart = computeBreakEvenChart({ projection: covered, capacity: 100 });

    expect(coveredChart.hasBreakEven).toBe(false);
  });

  it("hides the marker when the room is too small to break even in", () => {
    const hopeless = computeBudgetProjection({
      ticketTiers: [{ unitAmount: major(10), quantity: 100 }],
      averageBarSpend: 0n,
      capacity: 100,
      otherRevenue: 0n,
      costs: [major(50000)], // 5 000 tickets in a 100-cap room
    });
    const hopelessChart = computeBreakEvenChart({ projection: hopeless, capacity: 100 });

    expect(hopelessChart.hasBreakEven).toBe(false);
  });

  it("still slopes the revenue line off a price typed before a quantity", () => {
    const halfTyped = computeBudgetProjection({
      ticketTiers: [{ unitAmount: major(40), quantity: 0 }],
      averageBarSpend: 0n,
      capacity: 500,
      otherRevenue: 0n,
      costs: [major(4000)],
    });
    const halfTypedChart = computeBreakEvenChart({
      projection: halfTyped,
      capacity: 500,
      fallbackTicketPrice: major(40),
    });

    const [, startY] = pointAt(halfTypedChart.revenuePoints, 0);
    const [, endY] = pointAt(halfTypedChart.revenuePoints, 1);
    expect(endY).toBeLessThan(startY);
  });

  it("draws something rather than dividing by zero on an empty budget", () => {
    const empty = computeBudgetProjection({
      ticketTiers: [],
      averageBarSpend: 0n,
      capacity: 0,
      otherRevenue: 0n,
      costs: [],
    });
    const emptyChart = computeBreakEvenChart({ projection: empty, capacity: 0 });

    expect(emptyChart.capacity).toBe(1000); // the assumed axis
    expect(emptyChart.hasBreakEven).toBe(false);
    for (const coordinate of [
      ...emptyChart.revenuePoints.split(/[ ,]/),
      ...emptyChart.costPoints.split(/[ ,]/),
    ]) {
      expect(Number.isFinite(Number(coordinate))).toBe(true);
    }
  });
});
