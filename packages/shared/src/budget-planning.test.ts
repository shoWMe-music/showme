import { describe, expect, it } from "vitest";
import { computeBudgetProjection } from "./budget-planning";

/** €/SEK 1.00 → 100 minor units. */
const major = (value: number) => BigInt(Math.round(value * 100));

describe("budget projection", () => {
  it("weights the average ticket price by how many sell, not by how many tiers exist", () => {
    // 900 at 250 and 100 at 100 → 235.00 average, NOT the 175.00 an unweighted
    // mean of the two prices would give.
    const projection = computeBudgetProjection({
      ticketTiers: [
        { unitAmount: major(250), quantity: 900 },
        { unitAmount: major(100), quantity: 100 },
      ],
      averageBarSpend: 0n,
      capacity: 1000,
      otherRevenue: 0n,
      costs: [],
    });

    expect(projection.ticketsSold).toBe(1000);
    expect(projection.ticketRevenue).toBe(major(235000));
    expect(projection.averageTicketPrice).toBe(major(235));
  });

  // The bug this module exists to fix: the screen divided total costs by the
  // ticket price and ignored the bar entirely, so it asked for tickets that
  // were already paid for.
  it("counts non-ticket revenue against the costs it offsets", () => {
    const inputs = {
      ticketTiers: [{ unitAmount: major(200), quantity: 500 }],
      averageBarSpend: major(50),
      capacity: 400, // 20 000 of bar take
      otherRevenue: major(10000), // a sponsor
      costs: [major(100000)],
    };

    const projection = computeBudgetProjection(inputs);

    // 100 000 of costs, less 20 000 of bar and 10 000 of sponsorship, leaves
    // 70 000 for tickets at 200 → 350.
    expect(projection.breakEvenTickets).toBe(350);
    // Ignoring the bar and the sponsor would have demanded 500.
    expect(projection.breakEvenTickets).toBeLessThan(500);
  });

  it("rounds a part ticket up to a whole one", () => {
    const projection = computeBudgetProjection({
      ticketTiers: [{ unitAmount: major(30), quantity: 100 }],
      averageBarSpend: 0n,
      capacity: 100,
      otherRevenue: 0n,
      costs: [major(1000)], // 1000 / 30 = 33.33
    });

    expect(projection.breakEvenTickets).toBe(34);
  });

  it("is zero when the show is already covered without selling a ticket", () => {
    const projection = computeBudgetProjection({
      ticketTiers: [{ unitAmount: major(100), quantity: 50 }],
      averageBarSpend: 0n,
      capacity: 100,
      otherRevenue: major(9000), // a fee that already covers everything
      costs: [major(5000)],
    });

    expect(projection.breakEvenTickets).toBe(0);
  });

  it("is zero rather than infinite when no ticket has a price", () => {
    const projection = computeBudgetProjection({
      ticketTiers: [{ unitAmount: 0n, quantity: 0 }],
      averageBarSpend: 0n,
      capacity: 0,
      otherRevenue: 0n,
      costs: [major(5000)],
    });

    expect(projection.breakEvenTickets).toBe(0);
    expect(projection.averageTicketPrice).toBe(0n);
  });

  it("reports profit, margin and the per-guest figures", () => {
    const projection = computeBudgetProjection({
      ticketTiers: [{ unitAmount: major(100), quantity: 100 }],
      averageBarSpend: major(20),
      capacity: 100,
      otherRevenue: 0n,
      costs: [major(6000)],
    });

    expect(projection.totalRevenue).toBe(major(12000)); // 10 000 tickets + 2 000 bar
    expect(projection.profit).toBe(major(6000));
    expect(projection.marginPercent).toBeCloseTo(50, 5);
    expect(projection.revenuePerGuest).toBe(major(120));
    expect(projection.costPerGuest).toBe(major(60));
  });

  it("does not divide by zero when capacity is unset", () => {
    const projection = computeBudgetProjection({
      ticketTiers: [],
      averageBarSpend: major(50),
      capacity: 0,
      otherRevenue: 0n,
      costs: [],
    });

    expect(projection.barRevenue).toBe(0n);
    expect(projection.revenuePerGuest).toBe(0n);
  });
});
