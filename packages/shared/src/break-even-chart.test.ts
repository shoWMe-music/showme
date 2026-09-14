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

  it("draws total cost flat only when nothing about it moves with the door", () => {
    // This fixture names no payment provider, so there is genuinely no per-ticket
    // charge and the line really is flat. That is a property of THESE inputs, not
    // of cost in general — see the next test.
    const [, leftY] = pointAt(chart.costPoints, 0);
    const [, rightY] = pointAt(chart.costPoints, 1);
    expect(leftY).toBe(rightY);
  });

  /**
   * The line used to be flat unconditionally (decisions #23), and this fixture is
   * the one that shows why that was wrong: a provider taking a cut of every
   * ticket is a cost that rises with attendance, so the cost line has a slope and
   * the crossing moves accordingly.
   */
  it("slopes total cost when the provider charges per ticket", () => {
    const sloped = computeBudgetProjection({
      ticketTiers: [{ unitAmount: major(100), quantity: 500 }],
      averageBarSpend: 0n,
      capacity: 1000,
      otherRevenue: 0n,
      costs: [major(20000)],
      paymentProcessing: { percentBasisPoints: 500, flatPerTicket: 0n }, // 5% of 100.00 = 5.00
    });
    const slopedChart = computeBreakEvenChart({ projection: sloped, capacity: 1000 });

    const [, leftY] = pointAt(slopedChart.costPoints, 0);
    const [, rightY] = pointAt(slopedChart.costPoints, 1);

    // Up the page is a smaller y, so a rising cost line ENDS higher than it starts.
    expect(rightY).toBeLessThan(leftY);
    // 100.00 a head less the 5.00 cut = 95.00 against 20 000 → 211.
    expect(slopedChart.breakEvenTickets).toBe(211);
  });

  /**
   * The bar arrives with the guests, so it belongs to the revenue line's SLOPE.
   * It used to sit on the intercept, which drew a show as already holding its
   * whole bar take before the doors opened.
   */
  it("puts only standing revenue on the intercept, and the bar in the slope", () => {
    const common = {
      ticketTiers: [{ unitAmount: major(100), quantity: 500 }],
      capacity: 1000,
      otherRevenue: major(1000), // a sponsorship — this one really is standing
      costs: [major(20000)],
    };
    const withBar = computeBreakEvenChart({
      projection: computeBudgetProjection({ ...common, averageBarSpend: major(50) }),
      capacity: 1000,
    });
    const noBar = computeBreakEvenChart({
      projection: computeBudgetProjection({ ...common, averageBarSpend: 0n }),
      capacity: 1000,
    });

    // In the SLOPE: 100 a head needs 190 tickets to clear 19 000; 100 + 50 needs 127.
    // (Pixel positions are not comparable across the two — a taller revenue line
    //  rescales the whole chart — so the crossing is what the assertion reads.)
    expect(noBar.breakEvenTickets).toBe(190);
    expect(withBar.breakEvenTickets).toBe(127);

    // NOT on the intercept. Only the 1 000 sponsorship starts on the axis, which
    // is 0.6% of this chart's scale — hard against the bottom. Had the bar's
    // 50 000 sat there too it would start ~31% up the plot.
    const plotTop = 10;
    const plotBottom = plotTop + (withBar.height - 20);
    const [, interceptY] = pointAt(withBar.revenuePoints, 0);
    expect(interceptY).toBeGreaterThan(plotBottom - (plotBottom - plotTop) * 0.05);
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

/**
 * The money scale and the forecast guide — the two things the chart gained when
 * it was ported to the design's own viewBox.
 *
 * Both are read off the returned object rather than off a rendered SVG, because
 * the component draws exactly what it is handed. What a rendering test could
 * still catch — and these deliberately cannot — is the label overlapping the
 * line it belongs to; that is what the screenshot pass is for.
 */
describe("the money scale and the planned-tickets guide", () => {
  const projection = computeBudgetProjection({
    ticketTiers: [{ unitAmount: major(100), quantity: 500 }],
    averageBarSpend: 0n,
    capacity: 1000,
    otherRevenue: 0n,
    costs: [major(20000)],
  });
  const chart = computeBreakEvenChart({ projection, capacity: 1000 });

  it("rules the scale at nothing, half and the top — in that order up the page", () => {
    expect(chart.gridLines).toHaveLength(3);
    const [zero, half, top] = chart.gridLines;

    expect(zero?.amount).toBe(0n);
    expect(half?.amount).toBe(top?.amount ? top.amount / 2n : -1n);
    // Up the page is a SMALLER y. A scale that climbs while its rules climb too
    // would be drawn upside down, and an `amount` assertion alone cannot see it.
    expect(half?.y).toBeLessThan(zero?.y ?? 0);
    expect(top?.y).toBeLessThan(half?.y ?? 0);
  });

  it("puts the zero rule on the same baseline the lines are measured from", () => {
    // The scale and the plot must share an origin. If they drift, every figure
    // read off the chart is wrong by a constant nobody would notice.
    const [, revenueStartY] = pointAt(chart.revenuePoints, 0);
    expect(chart.gridLines[0]?.y).toBe(revenueStartY); // standing revenue is 0 here
  });

  it("places the forecast guide at the share of the room actually planned", () => {
    // 500 of 1,000 — the guide belongs at the midpoint of the drawn area.
    const [leftX] = pointAt(chart.revenuePoints, 0);
    const [rightX] = pointAt(chart.revenuePoints, 1);
    expect(chart.plannedX).toBeCloseTo((leftX + rightX) / 2, 5);
  });

  it("omits the guide rather than pinning it to the edge when the plan overfills the room", () => {
    // A plan bigger than the capacity being drawn has no honest position. Clamping
    // it to the right edge would draw a sold-out forecast that was never made.
    const overfull = computeBreakEvenChart({ projection, capacity: 400 });
    expect(overfull.plannedX).toBeNull();
  });

  it("omits the guide when nothing has been planned yet", () => {
    const empty = computeBudgetProjection({
      ticketTiers: [],
      averageBarSpend: 0n,
      capacity: 1000,
      otherRevenue: 0n,
      costs: [major(20000)],
    });
    expect(computeBreakEvenChart({ projection: empty, capacity: 1000 }).plannedX).toBeNull();
  });
});

/**
 * The profit and loss wedges.
 *
 * The case worth protecting is the one with NO crossing: "already profitable at
 * the door" and "cannot break even in this room" both report `hasBreakEven:
 * false`, and colouring off that flag would paint one of them the exact opposite
 * of the truth.
 */
describe("the wedges between the two lines", () => {
  const build = (costs: bigint, quantity = 500) =>
    computeBreakEvenChart({
      projection: computeBudgetProjection({
        ticketTiers: [{ unitAmount: major(100), quantity }],
        averageBarSpend: 0n,
        capacity: 1000,
        otherRevenue: 0n,
        costs: [costs],
      }),
      capacity: 1000,
    });

  it("draws both wedges when the lines cross inside the room", () => {
    const chart = build(major(20000)); // breaks even at 200 of 1,000
    expect(chart.hasBreakEven).toBe(true);
    // A triangle each: three vertices, meeting at the crossing.
    expect(chart.lossAreaPoints?.split(" ")).toHaveLength(3);
    expect(chart.profitAreaPoints?.split(" ")).toHaveLength(3);
    const crossing = `${chart.breakEvenX},${chart.breakEvenY}`;
    expect(chart.lossAreaPoints).toContain(crossing);
    expect(chart.profitAreaPoints).toContain(crossing);
  });

  it("shades the whole width RED when the room cannot cover the costs", () => {
    const chart = build(major(500000)); // 5,000 tickets of room needed; there are 1,000
    expect(chart.hasBreakEven).toBe(false);
    expect(chart.profitAreaPoints).toBeNull();
    expect(chart.lossAreaPoints?.split(" ")).toHaveLength(4);
  });

  it("shades the whole width GREEN when the show is ahead before it opens", () => {
    // No costs at all: revenue starts level and only climbs, so there is no
    // crossing — and calling that a loss is the bug this test exists for.
    const chart = build(0n);
    expect(chart.hasBreakEven).toBe(false);
    expect(chart.lossAreaPoints).toBeNull();
    expect(chart.profitAreaPoints?.split(" ")).toHaveLength(4);
  });
});
