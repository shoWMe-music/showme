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
   * THE AVERAGE ROUNDS, because `divideRounded` says it does (QA7-23).
   *
   * Its docstring promised "round half away from zero" over a plain BigInt division,
   * which truncates — and the function's NAME promised the same thing, so the code was
   * the odd one out of three. The error is at most one minor unit, which is why it sat
   * unnoticed, and it is not confined to the displayed figure: the average feeds
   * `contributionPerHead`, so truncating it low pushes break-even a fraction high.
   */
  it("rounds a half-minor-unit average UP rather than truncating it", () => {
    // 5000 + 5001 over two tickets is 5000.5 exactly — the one case where the two
    // behaviours differ by a whole minor unit.
    const projection = computeBudgetProjection({
      ticketTiers: [
        { unitAmount: 5000n, quantity: 1 },
        { unitAmount: 5001n, quantity: 1 },
      ],
      averageBarSpend: 0n,
      capacity: 2,
      otherRevenue: 0n,
      costs: [],
    });

    expect(projection.ticketRevenue).toBe(10001n);
    expect(projection.averageTicketPrice).toBe(5001n);
  });

  it("rounds a half away from zero on a negative average too, not toward it", () => {
    // Symmetry is the reason the arithmetic runs on magnitudes: −5000.5 must land on
    // −5001, the same distance from zero as +5000.5 lands from it the other way.
    const projection = computeBudgetProjection({
      ticketTiers: [
        { unitAmount: -5000n, quantity: 1 },
        { unitAmount: -5001n, quantity: 1 },
      ],
      averageBarSpend: 0n,
      capacity: 2,
      otherRevenue: 0n,
      costs: [],
    });

    expect(projection.averageTicketPrice).toBe(-5001n);
  });

  it("leaves a fraction below the half alone, and an exact division untouched", () => {
    // 5000.4 stays 5000: rounding is not ceiling, which is the other way this could
    // have been "fixed" wrongly.
    const low = computeBudgetProjection({
      ticketTiers: [
        { unitAmount: 5000n, quantity: 4 },
        { unitAmount: 5002n, quantity: 1 },
      ],
      averageBarSpend: 0n,
      capacity: 5,
      otherRevenue: 0n,
      costs: [],
    });
    expect(low.ticketRevenue).toBe(25002n);
    expect(low.averageTicketPrice).toBe(5000n);

    const exact = computeBudgetProjection({
      ticketTiers: [{ unitAmount: 5000n, quantity: 3 }],
      averageBarSpend: 0n,
      capacity: 3,
      otherRevenue: 0n,
      costs: [],
    });
    expect(exact.averageTicketPrice).toBe(5000n);
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

  /**
   * A DERIVED PERFORMER FEE IS NOT A FIXED COST (QA sweep run 2 and run 3).
   *
   * The solve treated every entered cost as fixed. On a percentage deal the fee is a
   * share of the door with a guarantee under it, so it shrinks as the attendance being
   * solved for falls — and freezing it at the PLANNED attendance asks the sheet to
   * cover a fee that attendance would never incur. Measured on Open Mic: 65 tickets
   * where the true answer is 42. Run 1 measured 427 of a 400-seat room.
   */
  describe("a fee that moves with the door", () => {
    // Open Mic, exactly as measured: Door 60 x SEK 80 + Advance 25 x SEK 60 = 6,300
    // over 85 tickets, so ~SEK 74.12 a head. One SEK 1,000 cost, 1.5% processing,
    // and a guarantee-vs-door deal at SEK 2,000 / 70%, worth SEK 3,710 at the plan.
    const openMic = {
      ticketTiers: [
        { unitAmount: major(80), quantity: 60 },
        { unitAmount: major(60), quantity: 25 },
      ],
      averageBarSpend: 0n,
      capacity: 80,
      otherRevenue: 0n,
      paymentProcessing: { percentBasisPoints: 150, flatPerTicket: 0n },
      costs: [major(1000), major(3710)],
    };

    it("solves with the fee falling as the attendance falls", () => {
      const projection = computeBudgetProjection({
        ...openMic,
        attendanceDependentCosts: [
          { plannedMinor: major(3710), guaranteeMinor: major(2000), splitBasisPoints: 7000 },
        ],
      });

      /*
       * 42 — AND RUN 2'S ORIGINAL 42 WAS RIGHT AFTER ALL (QA sweep run 7, QA7-1).
       *
       * This assertion was `48` with a long argument for it: *"70% of a 3,046 door is
       * 2,132, so the SHARE governs there, not the floor"*. That reasoning is sound and
       * its BASE was `decisions.md` #23.1 — the gross door — which **#24.1 reversed a
       * fortnight before either was written**. A percentage divides the ADJUSTED NET.
       *
       * Re-solved on the current rule, by hand: average price SEK 74.11, one SEK 1,000
       * fixed cost, 1.5% processing (SEK 1.11 a head).
       *
       *   adjusted net at N = 74.11N − 1,000 − 1.11N = 73.00N − 1,000
       *   the act's share    = max(2,000, 0.70 × (73.00N − 1,000))
       *   covered when        73.00N ≥ 1,000 + that share
       *
       * At N = 42 the share is 0.70 × (3,066 − 1,000) = SEK 1,446, so the SEK 2,000
       * GUARANTEE governs — which is what run 2 assumed and what the door base made
       * look wrong. 73.00 × 42 = 3,066 ≥ 3,000. At 41: 2,993 < 3,000. So **42**.
       *
       * The lesson is the one `CLAUDE.md` now carries: an assertion that carries a
       * reason is making a claim about the code, and this one was arguing for the
       * retired rule in careful detail.
       */
      expect(projection.breakEvenTickets).toBe(42);
    });

    it("still reports 65 when the fee is genuinely fixed", () => {
      // The same sheet with the fee typed in by hand is a fixed cost, and 65 is then
      // the right answer — the old number was not wrong arithmetic, it was the wrong
      // model of one row.
      const projection = computeBudgetProjection(openMic);

      expect(projection.breakEvenTickets).toBe(65);
    });

    it("leaves every other figure on the sheet alone", () => {
      const withRule = computeBudgetProjection({
        ...openMic,
        attendanceDependentCosts: [
          { plannedMinor: major(3710), guaranteeMinor: major(2000), splitBasisPoints: 7000 },
        ],
      });
      const withoutRule = computeBudgetProjection(openMic);

      // Only break-even is solved for a different attendance; the planned figures are
      // the planned figures.
      expect(withRule.totalCosts).toBe(withoutRule.totalCosts);
      expect(withRule.totalRevenue).toBe(withoutRule.totalRevenue);
      expect(withRule.profit).toBe(withoutRule.profit);
    });

    it("answers beyond capacity rather than capping at the room", () => {
      // Run 1's shape: a break-even the room cannot reach is a real answer and the
      // one an operator most needs to see.
      const projection = computeBudgetProjection({
        ticketTiers: [{ unitAmount: major(100), quantity: 400 }],
        averageBarSpend: 0n,
        capacity: 400,
        otherRevenue: 0n,
        costs: [major(25000), major(20000)],
        attendanceDependentCosts: [{ plannedMinor: major(20000), splitBasisPoints: 5000 }],
      });

      /*
       * 250, in a 400-seat room — still the shape this test is for (an answer inside
       * capacity here, and the one beyond it asserted below), but on #24.1's base.
       *
       * Half the DOOR left SEK 50 a head against SEK 25,000: 500 tickets. Half the
       * ADJUSTED NET means the operator recovers the 25,000 first and the act takes
       * half of what is above it, so the night is covered at 250:
       *   100N ≥ 25,000 + 0.5 × (100N − 25,000)  →  50N ≥ 12,500  →  N = 250.
       */
      expect(projection.breakEvenTickets).toBe(250);
    });

    it("still breaks even on a 100% share, because the share is of what is LEFT", () => {
      /*
       * This asserted **no break-even** on the reasoning that *"100% of the door to the
       * act … brings in nothing the show keeps"*. True of the door; not true of the
       * adjusted net (#24.1), and that difference is the whole of QA7-1.
       *
       * 100% of `revenue − costs` means the operator recovers the SEK 5,000 first and the
       * act takes everything above it. Below 50 tickets the adjusted net is negative, so
       * the share is nothing and the night is short of its 5,000; at exactly 50 the costs
       * are covered and the act takes zero. So the night stops LOSING money at 50 and
       * never profits — which is a break-even, and is what an operator needs to see. The
       * old answer hid a real number behind "never".
       */
      const projection = computeBudgetProjection({
        ticketTiers: [{ unitAmount: major(100), quantity: 100 }],
        averageBarSpend: 0n,
        capacity: 100,
        otherRevenue: 0n,
        costs: [major(5000), major(10000)],
        attendanceDependentCosts: [{ plannedMinor: major(10000), splitBasisPoints: 10000 }],
      });

      expect(projection.breakEvenTickets).toBe(50);
      expect(projection.breakEvenReachable).toBe(true);
    });

    it("solves on the adjusted net when the SHARE governs, standing revenue and fees included", () => {
      /*
       * THE CASE THAT MAKES EVERY TERM OF THE BASE LOAD-BEARING (QA7-1, corrected by QA8-3).
       *
       * The Open Mic fixture above is governed by its guarantee, so the base can be wrong in
       * several ways and the answer does not move. Here there is no floor at all, there IS a
       * standing revenue and a per-ticket processing fee, and the share governs throughout.
       *
       * THIS TEST PINNED THE DEFECT, and it is worth saying how. It asserted **51** and
       * listed *"dropping the processing fee 52"* among the wrong answers — 52 being the
       * right one. The derivation below it was internally consistent and its PREMISE was
       * wrong: it subtracted the 1.5% from the base the split divides. Payment processing is
       * a planner RATE, never a budget line, so the engine never deducts it before a split
       * and neither does the headline fee on the same card. Written in the same commit as
       * the defect, it made the defect invisible — the third time in this loop that a test's
       * stated REASON was the thing to check.
       *
       * SEK 200 a ticket, SEK 10,000 of sponsorship, 1.5% processing (SEK 3 a head),
       * SEK 20,000 of production, and half of what is left to the act:
       *
       *   adjusted net at N = 10,000 + 200N − 20,000 = 200N − 10,000   (no processing)
       *   the act takes       0.5 × that
       *   covered when        10,000 + 200N ≥ 20,000 + 0.5(200N − 10,000) + 3N
       *                   →   97N ≥ 5,000  →  N = 51.55  →  52
       *
       * Checked at the boundary: at 51 the adjusted net is SEK 200, the act takes SEK 100,
       * and the night is SEK 47 short; at 52 the net is SEK 400, the act takes SEK 200, and
       * the night is SEK 50 up.
       *
       * The wrong bases still answer differently — the gross door 104, and dropping the
       * sponsorship 0 — which is what makes this a check. The processing term moves it by a
       * single ticket, which is also a correction to QA7-1's own docstring: it claimed the
       * base *"cannot move the number"* on the share arm because the adjusted net at
       * break-even is ~0. The net is ~0 either way, but the base changes the COEFFICIENT
       * (98.5 against 97 a head here), so the crossing does move — just not far.
       */
      const projection = computeBudgetProjection({
        ticketTiers: [{ unitAmount: major(200), quantity: 300 }],
        averageBarSpend: 0n,
        capacity: 300,
        otherRevenue: major(10000),
        paymentProcessing: { percentBasisPoints: 150, flatPerTicket: 0n },
        costs: [major(20000), major(30000)],
        attendanceDependentCosts: [{ plannedMinor: major(30000), splitBasisPoints: 5000 }],
      });

      expect(projection.breakEvenTickets).toBe(52);
      expect(projection.breakEvenReachable).toBe(true);
    });

    it("reports NO break-even on a 100% split once processing is charged (QA8-3)", () => {
      /*
       * RUN 8's OWN SCREEN, to the krona. Two seeded ticket lines plus a tier — SEK 93,000
       * over 360 tickets — SEK 33,000 of costs, the 1.5% processing default, and 100% of the
       * adjusted net to the act.
       *
       * It printed **BREAK-EVEN TICKETS 130** beside **PROFIT / LOSS −SEK 1,395**, and the
       * chart caption agreed with the 130. The reason is arithmetic rather than a boundary:
       * with the variable cost inside the base the split divides,
       *
       *     costs(N) = fixed + 1.00×(revenue(N) − fixed − v·N) + v·N  =  revenue(N)
       *
       * so `revenue − costs >= 0` is satisfied at the first attendance where the share arm
       * governs, and the loop returns it. Not a shifted answer — a fabricated one.
       *
       * The truth is that there is no break-even at all: an act taking 100% of
       * revenue-less-fixed-costs leaves the operator paying the processing fee out of
       * nothing, so the night loses `v·N` at every attendance. `breakEvenReachable` is how
       * the card says that, and the P&L it sits beside has always agreed.
       */
      const projection = computeBudgetProjection({
        ticketTiers: [
          { unitAmount: major(65000 / 260), quantity: 260 },
          { unitAmount: major(18000 / 60), quantity: 60 },
          { unitAmount: major(250), quantity: 40 },
        ],
        averageBarSpend: 0n,
        capacity: 400,
        otherRevenue: 0n,
        paymentProcessing: { percentBasisPoints: 150, flatPerTicket: 0n },
        // The fee row is one of the ENTERED costs — the sheet's TOTAL COSTS of SEK 94,395 is
        // 33,000 + 60,000 + 1,395 — and `trulyFixedCosts` is what is left once the moving row
        // is taken back out. Passing only the 33,000 makes that term negative, which is a
        // fixture that tests nothing (it cost a first run of this test).
        costs: [major(33000), major(60000)],
        attendanceDependentCosts: [{ plannedMinor: major(60000), splitBasisPoints: 10_000 }],
      });

      expect(projection.ticketsSold).toBe(360);
      expect(projection.breakEvenReachable).toBe(false);
      // `0` is "never" here, and `breakEvenReachable` is what separates it from "none
      // needed" — the sheet has SEK 33,000 to cover, so nothing is already covered.
      expect(projection.breakEvenTickets).toBe(0);
      // And the loss the card showed beside the fabricated 130 is still there, which is the
      // half of the screen that was right all along.
      expect(projection.profit < 0n).toBe(true);
    });

    it("answers beyond capacity when the fee has a GUARANTEE under it", () => {
      /*
       * The beyond-capacity case the assertion above used to carry. A floor the door
       * cannot reach is what pushes break-even past the room: SEK 30,000 of guarantee and
       * SEK 10,000 of production against SEK 100 a head is 400 tickets in a 200-seat room,
       * and the share never overtakes the floor on the way.
       */
      const projection = computeBudgetProjection({
        ticketTiers: [{ unitAmount: major(100), quantity: 200 }],
        averageBarSpend: 0n,
        capacity: 200,
        otherRevenue: 0n,
        costs: [major(10000), major(30000)],
        attendanceDependentCosts: [
          { plannedMinor: major(30000), guaranteeMinor: major(30000), splitBasisPoints: 5000 },
        ],
      });

      expect(projection.breakEvenTickets).toBe(400);
      expect(projection.breakEvenTickets).toBeGreaterThan(200);
    });
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
    /*
     * NULL, not `0n` — and this assertion used to read `0n` for a reason worth keeping:
     * the guard was `attendees > 0n ? attendees : 1n`, so the figure was `revenue / 1`,
     * and on THIS fixture the revenue is zero too. The old expectation was accidentally
     * right, exactly the way QA10-6's caption was accidentally right at a 50/50 split.
     * Put revenue on the same sheet and the old code answered "revenue per guest = all of
     * the revenue" (QA10-17). Null is the only answer a reader cannot misread.
     */
    expect(projection.revenuePerGuest).toBeNull();
    expect(projection.costPerGuest).toBeNull();
  });

  it("names a per-head figure only when heads are planned", () => {
    // The shape the sweep actually read: a sheet with money on it and nobody coming.
    const projection = computeBudgetProjection({
      ticketTiers: [],
      averageBarSpend: 0n,
      capacity: 0,
      otherRevenue: major(100000),
      costs: [major(40000)],
    });

    expect(projection.totalRevenue).toBe(major(100000));
    expect(projection.revenuePerGuest).toBeNull();
    expect(projection.costPerGuest).toBeNull();
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

/**
 * PER GUEST vs FLAT.
 *
 * The prototype puts this on every other-revenue row as a control; ours had it
 * hardcoded. The case that could not be expressed at all is a bar MINIMUM — "the
 * venue guarantees 40,000 over the bar whatever the room does" — which is an
 * ordinary deal term, and typing it as a per-head rate made it scale with
 * attendance, the one thing a guarantee does not do.
 *
 * Break-even is where it bites, not the total: a flat row covers fixed costs
 * from the first ticket, a per-head row only as guests arrive.
 */
describe("the basis of a revenue row", () => {
  const base = {
    ticketTiers: [{ unitAmount: major(100), quantity: 500 }],
    capacity: 1000,
    otherRevenue: 0n,
    averageMerchSpend: 0n,
    costs: [major(30000)],
  };

  it("defaults to what each row has always meant", () => {
    // No basis given: bar per head, other revenue flat — so nothing recomputes
    // for a budget written before the field existed.
    const projection = computeBudgetProjection({
      ...base,
      averageBarSpend: major(10),
      otherRevenue: major(5000),
    });
    expect(projection.barRevenue).toBe(major(10) * 500n); // per head, times attendance
    expect(projection.standingRevenue).toBe(major(5000)); // other revenue, taken once
    expect(projection.perHeadRevenue).toBe(major(10));
  });

  it("takes a flat bar minimum once, however many come", () => {
    const flat = computeBudgetProjection({
      ...base,
      averageBarSpend: major(40000),
      barBasis: "flat",
    });
    expect(flat.barRevenue).toBe(major(40000));
    // And it is STANDING revenue, so it does not ride on the contribution.
    expect(flat.standingRevenue).toBe(major(40000));
    expect(flat.perHeadRevenue).toBe(0n);
  });

  it("moves break-even, which is the half a total would hide", () => {
    // The same 40,000 of bar money, read the two ways, against 30,000 of cost.
    // Flat: it covers the costs outright, so the door only has to cover nothing.
    const flat = computeBudgetProjection({
      ...base,
      averageBarSpend: major(40000),
      barBasis: "flat",
    });
    expect(flat.breakEvenTickets).toBe(0);

    // Per head at 80.00 a guest: contribution is 100 + 80 = 180, so 30,000 of
    // fixed cost needs ceil(30000 / 180) = 167 guests.
    const perGuest = computeBudgetProjection({
      ...base,
      averageBarSpend: major(80),
      barBasis: "per_guest",
    });
    expect(perGuest.breakEvenTickets).toBe(167);
  });

  it("lets other revenue be a per-head figure too", () => {
    const projection = computeBudgetProjection({
      ...base,
      averageBarSpend: 0n,
      otherRevenue: major(7),
      otherRevenueBasis: "per_guest",
    });
    expect(projection.totalRevenue).toBe(major(100) * 500n + major(7) * 500n);
    expect(projection.standingRevenue).toBe(0n);
    expect(projection.perHeadRevenue).toBe(major(7));
  });
});

/**
 * ZERO IS TWO ANSWERS (QA sweep run 5's QA5-7, run 4's QA4-10 before it).
 *
 * The screen printed `BREAK-EVEN TICKETS 0` directly above a chart captioned
 * *"Revenue never passes total cost inside 420 capacity."* — which reads as the
 * opposite of what the engine meant. `breakEvenTickets` is `0` both when no
 * attendance can make the night stop losing money and when there is nothing left to
 * cover, so the reason has to travel as its own field.
 */
describe("breakEvenReachable", () => {
  it("is true with a real crossing, and the count is the crossing", () => {
    const projection = computeBudgetProjection({
      ticketTiers: [{ unitAmount: major(250), quantity: 300 }],
      averageBarSpend: 0n,
      capacity: 400,
      otherRevenue: 0n,
      costs: [major(50000)],
    });
    expect(projection.breakEvenReachable).toBe(true);
    expect(projection.breakEvenTickets).toBe(200);
  });

  it("is TRUE at zero tickets when the standing revenue already covers the costs", () => {
    // The honest zero: nothing is left to cover, so none are needed. This is the case
    // a bare "No break-even" would have been wrong about.
    const projection = computeBudgetProjection({
      ticketTiers: [{ unitAmount: major(250), quantity: 100 }],
      averageBarSpend: 0n,
      capacity: 400,
      otherRevenue: major(20000),
      costs: [major(10000)],
    });
    expect(projection.breakEvenTickets).toBe(0);
    expect(projection.breakEvenReachable).toBe(true);
  });

  it("is FALSE when every extra guest loses money", () => {
    // A non-positive contribution per head: a free ticket with a fee on it brings
    // nothing and costs something, so no attendance crosses. The engine's own comment
    // says 0 says so — and this is the zero the screen was printing as a count.
    const projection = computeBudgetProjection({
      ticketTiers: [{ unitAmount: 0n, quantity: 300 }],
      averageBarSpend: 0n,
      capacity: 400,
      otherRevenue: 0n,
      costs: [major(50000)],
      paymentProcessing: { percentBasisPoints: 0, flatPerTicket: major(5) },
    });
    expect(projection.contributionPerHead).toBeLessThanOrEqual(0n);
    expect(projection.breakEvenTickets).toBe(0);
    expect(projection.breakEvenReachable).toBe(false);
  });
});
