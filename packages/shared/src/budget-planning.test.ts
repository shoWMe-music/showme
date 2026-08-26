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

describe("payment processing fees", () => {
  // The provider's cut is percentage + per-ticket because that is how the rails
  // price. 1 000 tickets at 60.00 = 60 000 of ticket revenue; 1.50% of that is
  // 900.00, and 0.50 on each of the 1 000 tickets is another 500.00.
  it("charges a percentage of ticket revenue plus a flat amount per ticket", () => {
    const projection = computeBudgetProjection({
      ticketTiers: [{ unitAmount: major(60), quantity: 1000 }],
      averageBarSpend: 0n,
      capacity: 1000,
      otherRevenue: 0n,
      costs: [major(50000)],
      paymentProcessing: { percentBasisPoints: 150, flatPerTicket: major(0.5) },
    });

    expect(projection.paymentProcessingFees).toBe(major(1400));
    expect(projection.enteredCosts).toBe(major(50000));
    expect(projection.totalCosts).toBe(major(51400));
    expect(projection.profit).toBe(major(8600));
  });

  it("leaves the bar and other revenue out of the percentage", () => {
    // Only the tickets pass through a payment provider; a cash bar and a sponsor's
    // bank transfer do not, so a 10% rate here is 10% of the 10 000 of tickets.
    const projection = computeBudgetProjection({
      ticketTiers: [{ unitAmount: major(100), quantity: 100 }],
      averageBarSpend: major(50),
      capacity: 100, // 5 000 of bar
      otherRevenue: major(20000),
      costs: [],
      paymentProcessing: { percentBasisPoints: 1000, flatPerTicket: 0n },
    });

    expect(projection.paymentProcessingFees).toBe(major(1000));
  });

  it("is zero, not absent, when the operator has named no provider", () => {
    const projection = computeBudgetProjection({
      ticketTiers: [{ unitAmount: major(100), quantity: 100 }],
      averageBarSpend: 0n,
      capacity: 100,
      otherRevenue: 0n,
      costs: [major(2000)],
    });

    expect(projection.paymentProcessingFees).toBe(0n);
    expect(projection.totalCosts).toBe(projection.enteredCosts);
  });

  it("pushes break-even up, because a fee is a cost tickets have to cover", () => {
    const withoutFees = computeBudgetProjection({
      ticketTiers: [{ unitAmount: major(100), quantity: 500 }],
      averageBarSpend: 0n,
      capacity: 500,
      otherRevenue: 0n,
      costs: [major(20000)],
    });
    const withFees = computeBudgetProjection({
      ticketTiers: [{ unitAmount: major(100), quantity: 500 }],
      averageBarSpend: 0n,
      capacity: 500,
      otherRevenue: 0n,
      costs: [major(20000)],
      paymentProcessing: { percentBasisPoints: 500, flatPerTicket: 0n },
    });

    expect(withoutFees.breakEvenTickets).toBe(200);
    // 20 000 of costs + 2 500 of fees, over a 100.00 ticket → 225.
    expect(withFees.breakEvenTickets).toBe(225);
  });
});
