import { describe, expect, it } from "vitest";
import { computeBudgetProjection, dealFigureDisagreement } from "./budget-planning";

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

  /**
   * MERCH IS ITS OWN TAKE — ClickUp `86cbcn1ue`, 2026-09-03: *"Bar and
   * merchandise can not be together."*
   *
   * Asserted at three points on purpose, because a merch figure that reached the
   * total but not the break-even would be worse than one that reached neither:
   * the sheet would show revenue arriving and still demand tickets to cover costs
   * it had already covered. That is the exact shape of the bug the bar row was
   * written to fix, one row along.
   */
  it("counts merch separately from the bar, in the total and in break-even", () => {
    const withoutMerch = computeBudgetProjection({
      ticketTiers: [{ unitAmount: major(200), quantity: 500 }],
      averageBarSpend: major(50),
      capacity: 400,
      otherRevenue: 0n,
      costs: [major(100000)],
    });
    const withMerch = computeBudgetProjection({
      ticketTiers: [{ unitAmount: major(200), quantity: 500 }],
      averageBarSpend: major(50),
      averageMerchSpend: major(25), // 25 a head across the 500 expected → 12 500
      capacity: 400,
      otherRevenue: 0n,
      costs: [major(100000)],
    });

    // Its own field on the projection, never folded into the bar's.
    expect(withoutMerch.merchRevenue).toBe(0n);
    expect(withMerch.merchRevenue).toBe(major(12500));
    expect(withMerch.barRevenue).toBe(withoutMerch.barRevenue);

    // It reaches the total…
    expect(withMerch.totalRevenue - withoutMerch.totalRevenue).toBe(major(12500));

    // …and every head now contributes it, so fewer tickets are needed. Merch is
    // per-head spend, so it raises the CONTRIBUTION rather than offsetting a
    // fixed cost: 200 + 50 of bar = 250 a head against 100 000 → 400; add 25 of
    // merch and it is 275 a head → 364.
    expect(withoutMerch.breakEvenTickets).toBe(400);
    expect(withMerch.breakEvenTickets).toBe(364);
  });

  /**
   * The payment provider charges on the tickets it sold, and it sold no merch.
   * Stated as a test because the fee is a percentage and the obvious wrong
   * implementation — taking it on `totalRevenue` — is invisible until a night
   * whose margin comes from the merch table.
   */
  it("never charges payment processing on the merch take", () => {
    const processing = { percentBasisPoints: 150, flatPerTicket: 0n };
    const base = {
      ticketTiers: [{ unitAmount: major(200), quantity: 500 }],
      averageBarSpend: 0n,
      capacity: 400,
      otherRevenue: 0n,
      costs: [],
      paymentProcessing: processing,
    };

    const withoutMerch = computeBudgetProjection(base);
    const withMerch = computeBudgetProjection({ ...base, averageMerchSpend: major(25) });

    expect(withMerch.paymentProcessingFees).toBe(withoutMerch.paymentProcessingFees);
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

    // The sponsorship is the only part that truly arrives without a ticket, so
    // it is the only part that offsets a fixed cost: 100 000 less 10 000 leaves
    // 90 000, over a contribution of 200 + 50 of bar a head → 360. The bar is
    // NOT subtracted up front — it turns up with the guests.
    expect(projection.breakEvenTickets).toBe(360);
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

  /**
   * THE PROPERTY THAT CATCHES THE WHOLE CLASS OF BUG (decisions #23).
   *
   * Break-even is a fact about the economics — price, per-head spend, costs. It
   * is NOT a fact about the forecast. So changing only the expected quantity, or
   * only the size of the room, must not move it.
   *
   * Both used to move it. Bar takings were counted at `capacity`, so a bigger
   * room lowered break-even; processing fees were counted at the planned ticket
   * count, so a bigger forecast raised it. Ran's prototype had the same fault in
   * a third place (a door-split performer fee frozen at the planned night), which
   * is how it reported 908 tickets where its own figures give 855.
   */
  it("does not move when only the forecast or the room size changes", () => {
    const base = {
      ticketTiers: [{ unitAmount: major(60), quantity: 1280 }],
      averageBarSpend: major(8),
      averageMerchSpend: major(4),
      capacity: 1600,
      otherRevenue: 0n,
      costs: [major(10500)],
      paymentProcessing: { percentBasisPoints: 150, flatPerTicket: major(0.3) },
    };

    const planned = computeBudgetProjection(base);
    const optimistic = computeBudgetProjection({
      ...base,
      ticketTiers: [{ unitAmount: major(60), quantity: 1400 }],
    });
    const cautious = computeBudgetProjection({
      ...base,
      ticketTiers: [{ unitAmount: major(60), quantity: 1000 }],
    });
    const biggerRoom = computeBudgetProjection({ ...base, capacity: 3000 });

    expect(optimistic.breakEvenTickets).toBe(planned.breakEvenTickets);
    expect(cautious.breakEvenTickets).toBe(planned.breakEvenTickets);
    expect(biggerRoom.breakEvenTickets).toBe(planned.breakEvenTickets);

    // 60 + 8 + 4 = 72 a head, less 1.5% of 60 and 0.30 flat = 1.20 → 70.80.
    // 10 500 of costs over 70.80 → 149 (ceil of 148.3).
    expect(planned.breakEvenTickets).toBe(149);
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
    // The fee is charged per ticket SOLD, so it comes off the contribution, not
    // off a lump counted at the planned 500: 5% of a 100.00 ticket leaves 95.00
    // a head against 20 000 → 211. Billing the planned night's whole 2 500 of
    // fees against a 211-ticket night is what the old figure of 225 did.
    expect(withFees.breakEvenTickets).toBe(211);
  });
});

/**
 * The "+ Add Field" rows on the design prototype's Revenue and Costs cards. The
 * prototype sums them into its totals (`customRevTotal` / `customCostTotal` in
 * `computeBudget`), so a planner that ignored them would disagree with the design
 * the moment an operator used one — and disagree about the profit, which is the
 * one figure the screen exists to state.
 */
describe("custom rows", () => {
  const base = {
    ticketTiers: [{ unitAmount: major(100), quantity: 500 }], // 50 000 of tickets
    averageBarSpend: 0n,
    capacity: 500,
    otherRevenue: 0n,
    costs: [major(20000)],
  };

  it("adds custom revenue rows to the total, and reports them back summed", () => {
    const projection = computeBudgetProjection({
      ...base,
      customRevenue: [major(5000), major(1500)], // a sponsorship and a grant
    });

    expect(projection.customRevenue).toBe(major(6500));
    expect(projection.totalRevenue).toBe(major(56500));
    expect(projection.profit).toBe(major(36500));
  });

  it("treats a custom revenue row as money in hand, so break-even falls", () => {
    const without = computeBudgetProjection(base);
    const with_ = computeBudgetProjection({ ...base, customRevenue: [major(5000)] });

    // 20 000 of costs over a 100.00 ticket → 200.
    expect(without.breakEvenTickets).toBe(200);
    // 5 000 of it is already covered by the sponsor → 15 000 left → 150.
    expect(with_.breakEvenTickets).toBe(150);
  });

  it("needs nothing new for a custom COST — it is one more element of `costs`", () => {
    const projection = computeBudgetProjection({
      ...base,
      costs: [major(20000), major(3000)], // the standard heading plus a custom row
    });

    expect(projection.enteredCosts).toBe(major(23000));
    expect(projection.totalCosts).toBe(major(23000));
    expect(projection.breakEvenTickets).toBe(230);
  });

  it("reads an absent list as no custom revenue rather than as a zero row", () => {
    const projection = computeBudgetProjection(base);

    expect(projection.customRevenue).toBe(0n);
    expect(projection.totalRevenue).toBe(major(50000));
  });

  it("matches the prototype: a custom revenue row moves profit by its own amount", () => {
    // The design prototype's Nils Frahm budget, before and after a 5 000
    // "Sponsorship" field: total revenue 76 800 → 81 800, profit 15 148 → 20 148.
    const inputs = {
      ticketTiers: [{ unitAmount: major(60), quantity: 1280 }],
      averageBarSpend: 0n,
      capacity: 1600,
      otherRevenue: 0n,
      costs: [major(50000), major(6500), major(4000)],
      paymentProcessing: { percentBasisPoints: 150, flatPerTicket: 0n },
    };

    const before = computeBudgetProjection(inputs);
    const after = computeBudgetProjection({ ...inputs, customRevenue: [major(5000)] });

    expect(before.totalRevenue).toBe(major(76800));
    expect(before.profit).toBe(major(15148));
    expect(after.totalRevenue).toBe(major(81800));
    expect(after.profit).toBe(major(20148));
  });
});

describe("a budget row that claims to be a deal's own figure", () => {
  it("says nothing when the row and the deal state the same money", () => {
    expect(dealFigureDisagreement(major(3000), major(3000))).toBeNull();
  });

  it("reports both figures when they have drifted apart", () => {
    // The row was written when the fee was 3 000; the deal has since been
    // renegotiated to 3 500. The settlement will move 3 500 — the operator is
    // forecasting 500 they will not keep.
    expect(dealFigureDisagreement(major(3000), major(3500))).toEqual({
      planned: major(3000),
      deal: major(3500),
    });
  });

  it("catches a disagreement smaller than the display would round away", () => {
    // 3 000.00 vs 3 000.49 both RENDER as "3,000" — the whole reason the
    // comparison is on integer minor units and never on formatted text.
    expect(dealFigureDisagreement(300000n, 300049n)).toEqual({
      planned: 300000n,
      deal: 300049n,
    });
  });

  it("stays silent when the deal states no figure of its own", () => {
    // A pure percentage split has no amount to disagree with, so there is
    // nothing to warn about — only something to compute at settlement.
    expect(dealFigureDisagreement(major(3000), null)).toBeNull();
    expect(dealFigureDisagreement(major(3000), undefined)).toBeNull();
  });

  it("treats a row left blank as a real disagreement, not as 'no opinion'", () => {
    // Blank parses to 0 everywhere in the planner (handoff §1), and a row
    // claiming to be a 3 000 deal's figure while forecasting nothing is exactly
    // the drift worth naming.
    expect(dealFigureDisagreement(0n, major(3000))).toEqual({
      planned: 0n,
      deal: major(3000),
    });
  });
});
