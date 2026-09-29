import { dealEntitlementDetailed } from "@showme/settlement";
import { describe, expect, it } from "vitest";
import {
  type BudgetLineForDoor,
  type Deal,
  doorForecastFrom,
  performerFeeOf,
  rentalOf,
  stillMovingBecause,
  ticketSplitOf,
} from "./useBudgetSeed";

/**
 * 400 tickets at 30.00 → a 12 000.00 door, with 2 000.00 of costs against it, so
 * the ADJUSTED NET the settlement divides is 10 000.00. All minor units.
 *
 * The two figures are deliberately different. A fixture where the door and the
 * split base coincide cannot fail on the one mistake these tests exist to catch —
 * deriving a performer fee from the box office when the settlement will pay a
 * share of what is left after costs.
 */
const DOOR = {
  ticketRevenue: 1_200_000n,
  totalRevenue: 1_200_000n,
  splitBase: 1_000_000n,
  ticketsSold: 400,
};
const ON_THE_BILL = new Set(["PERF"]);

const dealWith = (over: Partial<Deal>): Deal => ({
  id: "d1",
  name: "Headline booking",
  type: "performance",
  status: "confirmed",
  parties: [{ participantId: "PERF", roleInDeal: "payee" }],
  ...over,
});

describe("the planner's performer fee", () => {
  /**
   * THE POINT OF THE WHOLE EXERCISE. The planner forecasts what
   * `reconcile()` will later compute, so it runs the engine's own function rather
   * than a second formula. Ran's prototype is the counter-example: its planner
   * split gross tickets while its settlement split adjusted net, both called it
   * 70%, and on his own demo night they differed by about €2 300.
   */
  it("agrees with the settlement engine, because it IS the settlement engine", () => {
    const deal = dealWith({
      structure: "guarantee_vs_door",
      guaranteeAmount: "500000", // 5 000.00
      splitBasisPoints: 7000,
    });

    const seeded = performerFeeOf(deal, ON_THE_BILL, DOOR);
    const settled = dealEntitlementDetailed(
      {
        dealId: "d1",
        structure: "guarantee_vs_door",
        payeeParticipantIds: ["PERF"],
        guaranteeAmount: 500_000n,
        splitBasisPoints: 7000,
      },
      { splitBase: DOOR.splitBase, grossRevenue: DOOR.totalRevenue },
      DOOR.ticketsSold,
    );

    expect(seeded?.amount).toBe(settled.amount.toString());
    // 70% of the 10 000 adjusted net, which beats the 5 000 floor. It is NOT
    // 840 000 — that would be 70% of the 12 000 box office, the very figure the
    // settlement would then refuse to pay.
    expect(seeded?.amount).toBe("700000");
  });

  it("takes the guarantee when the door does not reach it, and says which won", () => {
    const fee = performerFeeOf(
      dealWith({
        structure: "guarantee_vs_door",
        guaranteeAmount: "1000000", // 10 000.00 — more than 70% of this door
        splitBasisPoints: 7000,
      }),
      ON_THE_BILL,
      DOOR,
    );

    expect(fee?.amount).toBe("1000000");
    expect(fee?.dealName).toContain("the guarantee beats");
  });

  /**
   * The fault this replaces, and the one Ran's prototype still has: a figure
   * derived once and then treated as fixed. A forecast that sells more must move
   * the fee, or the sheet is quietly describing a different night.
   */
  it("moves with the ticket forecast instead of standing still", () => {
    const deal = dealWith({ structure: "door_split", splitBasisPoints: 6000 });

    const modest = performerFeeOf(deal, ON_THE_BILL, {
      ticketRevenue: 600_000n,
      totalRevenue: 600_000n,
      splitBase: 400_000n, // the same 2 000 of costs against a smaller night
      ticketsSold: 200,
    });
    const busy = performerFeeOf(deal, ON_THE_BILL, DOOR);

    expect(modest?.amount).toBe("240000"); // 60% of the 4 000 left
    expect(busy?.amount).toBe("600000"); // 60% of the 10 000 left
  });

  it("seeds nothing from a percentage deal before the sheet has a door", () => {
    const fee = performerFeeOf(
      dealWith({ structure: "door_split", splitBasisPoints: 6000 }),
      ON_THE_BILL,
      { ticketRevenue: 0n, totalRevenue: 0n, splitBase: 0n, ticketsSold: 0 },
    );
    // A confident zero would read as "this act is owed nothing", which is a
    // statement the planner has no basis for until a tier exists.
    expect(fee).toBeNull();
  });

  it("leaves a flat guarantee exactly as it was", () => {
    const fee = performerFeeOf(
      dealWith({ structure: "guarantee", guaranteeAmount: "750000" }),
      ON_THE_BILL,
      DOOR,
    );
    expect(fee?.amount).toBe("750000");
    expect(fee?.dealName).toBe("Headline booking");
  });
});

/**
 * THE FEE COMES FROM THE DRAFT DEAL, NOT FROM CONFIRMATION (ClickUp `123qy9rnwud`,
 * Ran, 2026-09-21).
 *
 * The suite above is entirely `status: "confirmed"` — every fixture, by way of
 * `dealWith`'s default — which is exactly why the old rule could be reversed
 * without a single test noticing. It was the rule with the most reasoning written
 * about it and the least coverage under it.
 *
 * What Ran asked for, in his words: *"they need to make the budgeting before
 * anyone agrees to the deal ... Confirmation of the deal doesn't matter for the
 * budget planner. Confirmation of the deal only makes it that it becomes locked."*
 */
describe("a deal nobody has signed yet", () => {
  it("reads into the planner, because that is what the operator is deciding with", () => {
    const fee = performerFeeOf(
      dealWith({
        status: "draft",
        structure: "guarantee_vs_door",
        guaranteeAmount: "500000",
        splitBasisPoints: 7000,
      }),
      ON_THE_BILL,
      DOOR,
    );

    // The same 700 000 the confirmed deal above produces, from the same engine.
    // The status changes what the SENTENCE says, never the arithmetic — an offer
    // you cannot price is an offer you cannot assess.
    expect(fee?.amount).toBe("700000");
    expect(fee?.pending).toBe(true);
  });

  it("says nothing once the offer is withdrawn", () => {
    const fee = performerFeeOf(
      dealWith({ status: "cancelled", structure: "guarantee", guaranteeAmount: "750000" }),
      ON_THE_BILL,
      DOOR,
    );
    // The one status that forecasts no night. `reconcile()` filters the same
    // `ne(status, 'cancelled')`, so the planner and the settlement drop the same
    // deals.
    expect(fee).toBeNull();
  });

  it("marks a confirmed deal as settled rather than offered", () => {
    const fee = performerFeeOf(
      dealWith({ structure: "guarantee", guaranteeAmount: "750000" }),
      ON_THE_BILL,
      DOOR,
    );
    expect(fee?.pending).toBe(false);
  });

  /**
   * Ran's follow-on: *"when the operator edits the offered deal terms while it is
   * pending, the budget re-seeds from the new terms rather than holding a stale
   * figure."*
   *
   * It holds because nothing is stored — the fee is a pure function of the deal
   * and the sheet, recomputed every render. This test is what would go red if
   * somebody ever "optimised" that into a cached or written figure, which is the
   * change the long note at the top of `useBudgetSeed` argues against.
   */
  it("follows the offered terms when they move, holding no stale figure", () => {
    const offered = dealWith({
      status: "draft",
      structure: "guarantee",
      guaranteeAmount: "300000",
    });
    const raised = { ...offered, guaranteeAmount: "450000" };

    expect(performerFeeOf(offered, ON_THE_BILL, DOOR)?.amount).toBe("300000");
    expect(performerFeeOf(raised, ON_THE_BILL, DOOR)?.amount).toBe("450000");
  });
});

/**
 * THE BARS ANSWER TO THE SAME DEALS THE FEE DOES.
 *
 * Two drawings of one agreement on one screen. A Costs card paying 70% of the
 * door away, beside a split card showing the operators keeping all of it, is the
 * planner contradicting itself on the question it was opened to answer — so the
 * card moved to draft deals in the same change, and this is the test that pins
 * the pair together.
 */
describe("the ticket-revenue split card", () => {
  const splitDeal = (over: Partial<Deal>) =>
    dealWith({
      structure: "door_split",
      splitBasisPoints: 6000,
      parties: [{ participantId: "PERF", roleInDeal: "payee", share: { splitBasisPoints: 10000 } }],
      ...over,
    });

  it("draws an unconfirmed deal, and says on the badge that it is only proposed", () => {
    const split = ticketSplitOf([splitDeal({ status: "draft" })], ON_THE_BILL, DOOR);

    expect(split.shares).toHaveLength(1);
    expect(split.badge).toBe("Door Split · proposed");
    expect(split.summary).toContain("Nobody has confirmed these terms yet");
  });

  it("drops the qualifier once every side has signed", () => {
    const split = ticketSplitOf([splitDeal({})], ON_THE_BILL, DOOR);

    expect(split.badge).toBe("Door Split");
    expect(split.summary).not.toContain("Nobody has confirmed");
  });

  it("draws nothing at all for a withdrawn offer", () => {
    const split = ticketSplitOf([splitDeal({ status: "cancelled" })], ON_THE_BILL, DOOR);

    expect(split.shares).toEqual([]);
    expect(split.badge).toBeNull();
    // The whole door stays with the operators, which is the truth once the offer
    // is gone — not a zero-width bar for somebody who is no longer on the deal.
    expect(split.operatorRemainderMinor).toBe(DOOR.ticketRevenue);
  });
});

/**
 * THE ROOM IS CHARGED ONCE, IN THE DEAL THAT STATES IT.
 *
 * The rental fee is offered to the operator under an editable "Venue cost"
 * heading. Until 2026-09-22 it was offered as a bare amount, and accepting it
 * wrote a `budget_lines` row with no `deal_id` — which the settlement reads as
 * ordinary external cash, on top of the rental deal it settles off the top in its
 * own right. The room came off the night twice, and a percentage act was paid a
 * share of what was left after paying for it twice.
 *
 * Carrying the deal id is what lets the row be written as THAT DEAL'S FIGURE, and
 * `routes/settlement.ts` drops such a row at its boundary (pinned there by
 * "excludes a deal's own figure from the planned pool").
 */
describe("the seeded venue cost", () => {
  const rental = (over: Partial<Deal> = {}): Deal => ({
    id: "rent-1",
    name: "Room hire",
    type: "rental",
    guaranteeAmount: "2000000",
    ...over,
  });

  it("names the deal it came from, not just the figure", () => {
    expect(rentalOf([rental()])).toEqual({ amount: "2000000", dealId: "rent-1" });
  });

  /**
   * The shape test, and the reason this function asks about `type`/`structure`
   * rather than about the amount: a performance guarantee is a `guaranteeAmount`
   * too, and reading the first deal that has one would bill the room to the act.
   */
  it("never mistakes a performance guarantee for the room", () => {
    const performance = dealWith({ structure: "guarantee", guaranteeAmount: "750000" });
    expect(rentalOf([performance])).toBeNull();
    // …and finds the rental past it in a mixed list.
    expect(rentalOf([performance, rental()])?.dealId).toBe("rent-1");
  });

  /**
   * A RENTAL YOU ARE OWED IS NOT A COST OF YOUR BOOK (QA sweep run 10, QA10-11).
   *
   * On a room hire the host is PAID for, the host's own private book opened at
   * `TOTAL COSTS SEK 5,000 · PROFIT / LOSS −SEK 5,000` — a loss for money coming in. The old
   * reasoning was *"the rental fee is the rental fee whoever collects it"*, which is true of the
   * NIGHT and false of a book. §25.7.1 is what made it ordinary rather than rare: a rental now names
   * who owes it, and a room one co-operator lets to another is the normal shape.
   */
  it("keeps a rental the reader is OWED out of their costs", () => {
    const owed: Deal = {
      id: "room",
      name: "Room hire — they pay me",
      type: "rental",
      status: "confirmed",
      guaranteeAmount: "500000",
      parties: [
        { participantId: "part-them", roleInDeal: "payer" },
        { participantId: "part-me", roleInDeal: "payee" },
      ],
    };
    expect(rentalOf([owed], ["part-me"])).toBeNull();
  });

  it("still offers a rental the reader OWES", () => {
    const owing: Deal = {
      id: "room",
      name: "Room hire — I pay them",
      type: "rental",
      status: "confirmed",
      guaranteeAmount: "500000",
      parties: [
        { participantId: "part-me", roleInDeal: "payer" },
        { participantId: "part-them", roleInDeal: "payee" },
      ],
    };
    expect(rentalOf([owing], ["part-me"])).toEqual({ amount: "500000", dealId: "room" });
  });

  it("keeps out a rental where the reader is ONE OF SEVERAL payees", () => {
    // Owed a share is still owed, not charged. A surviving mutation (`every` where `some` belongs)
    // is what turned this from an assumption into a test.
    const shared: Deal = {
      id: "room",
      name: "Room hire split two ways",
      type: "rental",
      status: "confirmed",
      guaranteeAmount: "500000",
      parties: [
        { participantId: "part-them", roleInDeal: "payer" },
        { participantId: "part-me", roleInDeal: "payee" },
        { participantId: "part-other", roleInDeal: "payee" },
      ],
    };
    expect(rentalOf([shared], ["part-me"])).toBeNull();
  });

  it("still offers it when the reader is on BOTH ends", () => {
    // Somebody who owes the rental owes it whatever else they are on the deal.
    const bothEnds: Deal = {
      id: "room",
      name: "Room hire I owe and partly collect",
      type: "rental",
      status: "confirmed",
      guaranteeAmount: "500000",
      parties: [
        { participantId: "part-me", roleInDeal: "payer" },
        { participantId: "part-me", roleInDeal: "payee" },
      ],
    };
    expect(rentalOf([bothEnds], ["part-me"])).toEqual({ amount: "500000", dealId: "room" });
  });

  it("still offers a rental whose payee is not on the bill at all", () => {
    /*
     * The case the old comment was protecting and which still holds: there is no "venue" participant
     * role, so a room hired from a venue that is not on the event names no payee the reader shares.
     * Requiring a payee match would have seeded nothing on the commonest event of all.
     */
    const offPlatform: Deal = {
      id: "room",
      name: "Room hire from a venue not on shoWMe",
      type: "rental",
      status: "confirmed",
      guaranteeAmount: "500000",
      parties: [{ participantId: "part-me", roleInDeal: "payer" }],
    };
    expect(rentalOf([offPlatform], ["part-me"])).toEqual({ amount: "500000", dealId: "room" });
  });

  it("is read from an unsigned rental, like every other deal on the sheet", () => {
    expect(rentalOf([rental({ status: "draft" })])?.amount).toBe("2000000");
  });

  it("says nothing once the rental is withdrawn", () => {
    expect(rentalOf([rental({ status: "cancelled" })])).toBeNull();
  });

  /** A rental stating no figure is a room with no price on it — nothing to offer. */
  it("skips a rental that states no figure and takes the next one that does", () => {
    const priceless = rental({ id: "rent-0", guaranteeAmount: null });
    expect(rentalOf([priceless, rental()])?.dealId).toBe("rent-1");
    expect(rentalOf([priceless])).toBeNull();
  });
});

/**
 * THE ADJUSTED NET A PERCENTAGE DEAL IS MEASURED AGAINST.
 *
 * This lived inside the hook and therefore had no tests at all — proved by
 * mutation: reverting the rental rule to `status === "confirmed"` left every test
 * in this file green. It is the arithmetic the whole screen rests on, so it is a
 * function now and these are the rules it keeps.
 */
describe("the door forecast", () => {
  const TIERS = [{ id: "ga", name: "General Admission", price: 250, max: 400, est: 400 }];
  const rentalDeal = (status: string): Deal => ({
    id: "rent-1",
    name: "Room hire",
    type: "rental",
    status,
    guaranteeAmount: "2000000", // 20 000.00
  });

  it("takes the event's tiers when the sheet has no ticket rows of its own", () => {
    const door = doorForecastFrom([], [], TIERS);
    expect(door.ticketRevenue).toBe(10_000_000n); // 400 × 250.00
    expect(door.ticketsSold).toBe(400);
    expect(door.splitBase).toBe(10_000_000n);
  });

  it("lets a door somebody TYPED AS ONE FIGURE suppress the event's tiers", () => {
    // No `details` means no unit x count breakdown: the row is the whole door under a
    // name of the operator's choosing, and seeding the event's tiers beside it would
    // count the same money twice. The same rule as `mergeTicketTierSeeds` and as
    // `statesItsOwnDoor` in the settlement.
    const sheet: BudgetLineForDoor[] = [{ kind: "revenue", amount: "8000000" }];
    expect(doorForecastFrom([], sheet, TIERS).ticketRevenue).toBe(8_000_000n);
  });

  /**
   * A TIER TYPED ON EVENT DETAILS IS PART OF THE DOOR THE DEAL DIVIDES
   * (QA sweep run 7, QA7-2).
   *
   * This read `fromSheet > 0n ? fromSheet : fromEventTiers`, so the moment the sheet had
   * any ticket row the event's tiers stopped counting — while the planner's own ticket
   * TABLE rendered both additively and the settlement merged them the same way. Measured:
   * the card said `TICKET REVENUE SEK 93,000` and derived the fee from SEK 83,000, quoting
   * *"the deal pays SEK 50,000"*; `settlement/compute` then paid SEK 60,000.
   */
  /**
   * THE FORECAST AND THE SETTLEMENT QUOTE ONE FEE (QA sweep run 10, QA10-1 — decisions §25.7.1).
   *
   * The engine stopped taking a named-payer rental off the top on 2026-09-28 and this forecast did
   * not follow it for an hour. On the sweep's own night — SEK 120,000 of tickets, SEK 15,000 of
   * costs, a 70% act deal and a SEK 5,000 room hire the CO-HOST owes the host — the planner quoted
   * the act SEK 70,000 and the settlement paid SEK 73,500. The gap is SEK 3,500, the exact figure
   * §25.7.1's hand-check names as the act's movement, and it surfaced only after terms had been
   * agreed against the forecast.
   *
   * The numbers below are the split BASE rather than the fee, which is what this function returns;
   * `packages/settlement/src/reconcile.test.ts` holds the other end of the same night, and the two
   * now call one predicate (`rentalComesOffTheTop`) so they cannot drift again.
   */
  describe("whose rental the pool actually pays (§25.7.1)", () => {
    const HOST = "part-host";
    const CO_HOST = "part-co";
    const VENUE = "part-venue";
    const operators = new Set([HOST, CO_HOST]);
    const sheet: BudgetLineForDoor[] = [
      { kind: "revenue", amount: "12000000", details: { unitPrice: 400, quantity: 300 } },
      { kind: "cost", amount: "1500000" },
    ];
    const roomHire = (payer: string, payee: string): Deal => ({
      id: "room",
      name: "Room hire",
      type: "rental",
      status: "confirmed",
      guaranteeAmount: "500000", // 5 000.00
      parties: [
        { participantId: payer, roleInDeal: "payer" },
        { participantId: payee, roleInDeal: "payee" },
      ],
    });

    it("leaves the base alone when a co-operator owes it — a transfer, not a cost of the night", () => {
      const door = doorForecastFrom([roomHire(CO_HOST, HOST)], sheet, [], operators);
      // 120 000 − 15 000, and NOT less the room: the act is not a party to that agreement.
      expect(door.splitBase).toBe(10_500_000n);
    });

    it("still takes a VENUE rental off the top, which is #24.1's own case", () => {
      // The payee is outside the pool, so the show is paying for its room and everyone dividing
      // the night shares it. The boundary, and the reason the predicate tests both ends.
      const door = doorForecastFrom([roomHire(HOST, VENUE)], sheet, [], operators);
      expect(door.splitBase).toBe(10_000_000n);
    });

    it("takes a rental that names nobody off the top", () => {
      const noPayer: Deal = {
        id: "room",
        name: "Room hire",
        type: "rental",
        status: "confirmed",
        guaranteeAmount: "500000",
      };
      expect(doorForecastFrom([noPayer], sheet, [], operators).splitBase).toBe(10_000_000n);
    });

    it("charges the act's own four-wall room hire to the act, not to the base", () => {
      // Payer outside the pool, payee inside it. The shape a surviving mutation found on the
      // engine side; the same answer has to come out here.
      const door = doorForecastFrom([roomHire("part-act", HOST)], sheet, [], operators);
      expect(door.splitBase).toBe(10_500_000n);
    });
  });

  describe("a tier the sheet does not carry yet", () => {
    /** What the planner writes for a tier: an amount WITH its unit x count breakdown. */
    const sheetTier = (
      amount: string,
      details: { unitAmount?: string; quantity?: number; tierId?: string },
      label?: string,
    ): BudgetLineForDoor => ({ kind: "revenue", amount, details, ...(label ? { label } : {}) });

    it("adds it to the sheet's own rows rather than replacing them", () => {
      // The sweep's night: SEK 65,000 + SEK 18,000 on the sheet, and a SEK 10,000 tier
      // added on Event Details. 83,000 + 10,000 = 93,000, which is what the screen said.
      const door = doorForecastFrom(
        [],
        [
          sheetTier("6500000", { unitAmount: "25000", quantity: 260 }, "Advance"),
          sheetTier("1800000", { unitAmount: "30000", quantity: 60 }, "Walk-up"),
        ],
        [{ id: "early", name: "QA7 Early bird", price: 250, max: 50, est: 40 }],
      );
      expect(door.ticketRevenue).toBe(9_300_000n);
      // And the count agrees with the money: 260 + 60 + 40.
      expect(door.ticketsSold).toBe(360);
    });

    it("counts it ONCE when the sheet already carries it, matched on the tier id", () => {
      // The planner writes `details.tierId` precisely so a RENAME cannot make one tier
      // look like two — the rule `1dcc396` fixed for the table.
      const door = doorForecastFrom(
        [],
        [sheetTier("1000000", { unitAmount: "25000", quantity: 40, tierId: "early" }, "Renamed")],
        [{ id: "early", name: "QA7 Early bird", price: 250, max: 50, est: 40 }],
      );
      expect(door.ticketRevenue).toBe(1_000_000n);
      expect(door.ticketsSold).toBe(40);
    });

    it("counts it once when the sheet carries it under the same NAME and no id", () => {
      // Rows written before the id was carried through. The name is the fallback, and
      // without it those events would double their door.
      const door = doorForecastFrom(
        [],
        [sheetTier("1000000", { unitAmount: "25000", quantity: 40 }, "QA7 Early bird")],
        [{ id: "early", name: "  qa7 early bird ", price: 250, max: 50, est: 40 }],
      );
      expect(door.ticketRevenue).toBe(1_000_000n);
    });

    it("reaches the THRESHOLD base too, not only the ticket figure", () => {
      // `totalRevenue` had the same either/or, so a sheet holding any revenue row at all
      // dropped the unwritten tier from what a threshold bonus is measured against (#23.3).
      const door = doorForecastFrom(
        [],
        [
          sheetTier("6500000", { unitAmount: "25000", quantity: 260 }, "Advance"),
          { kind: "revenue", amount: "500000", details: { basis: "other_revenue" } },
        ],
        [{ id: "early", name: "QA7 Early bird", price: 250, max: 50, est: 40 }],
      );
      // 65,000 sheet tickets + 5,000 sponsorship + 10,000 unwritten tier.
      expect(door.totalRevenue).toBe(8_000_000n);
      // The ticket figure is the door alone — the sponsorship is not box office.
      expect(door.ticketRevenue).toBe(7_500_000n);
    });
  });

  /**
   * THE DOUBLE COUNT THIS PAIR EXISTS TO PREVENT. The room is settled off the top
   * as a rental deal; the "Venue cost" the planner offers for the same room is
   * written carrying that deal's id, and a cost line with a `dealId` is not the
   * night's external cash — the engine drops it at its boundary. Counted in both
   * places, a 20 000 room takes 40 000 off what the act is paid a share of.
   */
  it("charges a rental once, even with the planner's own Venue cost row on the sheet", () => {
    const venueCostRow: BudgetLineForDoor[] = [
      { kind: "cost", amount: "2000000", dealId: "rent-1" },
    ];
    const door = doorForecastFrom([rentalDeal("confirmed")], venueCostRow, TIERS);
    expect(door.splitBase).toBe(8_000_000n); // 10 000 000 − the room, ONCE
  });

  /**
   * And an unlinked cost row of the same size is a DIFFERENT charge — some other
   * venue expense the operator entered — so it comes off as well. The link is what
   * separates the two, which is exactly why the seed now carries it.
   */
  it("still subtracts a cost row that names no deal", () => {
    const separateCharge: BudgetLineForDoor[] = [{ kind: "cost", amount: "500000" }];
    const door = doorForecastFrom([rentalDeal("confirmed")], separateCharge, TIERS);
    expect(door.splitBase).toBe(7_500_000n); // 10 000 000 − 20 000 room − 5 000 charge
  });

  /**
   * The engine settles every rental that is not cancelled, signed or not
   * (`routes/settlement.ts`, `ne(status, 'cancelled')`). A planner that only
   * deducted a CONFIRMED one promised a share of money the settlement had already
   * given the room.
   */
  it("takes an unsigned rental off the top, exactly as the engine does", () => {
    expect(doorForecastFrom([rentalDeal("draft")], [], TIERS).splitBase).toBe(8_000_000n);
  });

  it("gives a withdrawn rental's money back to the night", () => {
    expect(doorForecastFrom([rentalDeal("cancelled")], [], TIERS).splitBase).toBe(10_000_000n);
  });
});

/**
 * WHY TERMS CAN STILL MOVE, COUNTED RATHER THAN ASSUMED (QA sweep run 7, QA7-9).
 *
 * The card said "Nobody has confirmed these terms yet" whenever the DEAL was not
 * `confirmed` — and a deal is not confirmed until every party signs, so the sentence
 * appeared over a deal the operator had already signed, contradicted by the same screen's
 * Deals tab.
 */
describe("stillMovingBecause", () => {
  const party = (roleInDeal: string, confirmedAt: string | null) => ({
    participantId: `p-${roleInDeal}-${confirmedAt ?? "no"}`,
    roleInDeal,
    confirmedAt,
  });
  const deal = (parties: ReturnType<typeof party>[]) =>
    ({ id: "d1", name: "Door split", type: "performance", parties }) as Parameters<
      typeof stillMovingBecause
    >[0];

  it("says nobody when nobody has", () => {
    expect(stillMovingBecause(deal([party("payer", null), party("payee", null)]))).toBe(
      "Nobody has confirmed these terms yet, so they can still move.",
    );
  });

  it("counts the one signature the old sentence denied", () => {
    // The measured case: the operator signed, the act had not.
    expect(
      stillMovingBecause(deal([party("payer", "2026-09-28T04:31:52Z"), party("payee", null)])),
    ).toBe("One of two parties has signed, so they can still move.");
  });

  it("counts a bigger bill in figures", () => {
    expect(
      stillMovingBecause(
        deal([
          party("payer", "2026-09-28T04:31:52Z"),
          party("payee", "2026-09-28T05:00:00Z"),
          party("split_member", null),
        ]),
      ),
    ).toBe("2 of 3 parties have signed, so they can still move.");
  });

  it("claims no count when every line is signed but the deal has not frozen", () => {
    // A moment mid-write, not a state worth describing — so it says the true and useful
    // half and asserts nothing about who has signed.
    expect(
      stillMovingBecause(
        deal([party("payer", "2026-09-28T04:31:52Z"), party("payee", "2026-09-28T05:00:00Z")]),
      ),
    ).toBe("These terms can still move until the agreement freezes.");
  });

  it("falls back to 'nobody' on a deal with no parties at all", () => {
    expect(stillMovingBecause(deal([]))).toContain("Nobody has confirmed");
  });
});

/**
 * WHICH DOOR THE NOTE SENDS THE READER TO (QA sweep run 11, QA11-17).
 *
 * The planner's derived-fee row said *"the settlement takes this figure from the deal — change it
 * there"* on a confirmed agreement, and the API answers 409: `movedSignedTerms` refuses, naming
 * reopen. The note branched on `pending` — `deal.status !== "confirmed"` — and the figures seal at
 * the FIRST SIGNATURE (`657cb70`), which is a different boundary. So the OTHER branch was wrong
 * too: an offer nobody had confirmed, with one party signed, was told "change the terms and this
 * moves with it".
 */
describe("the planner knows when a fee is sealed", () => {
  const signedAt = "2026-09-28T23:57:56.361Z";

  it("is not sealed while nobody has signed — the case editing a sent deal exists for", () => {
    const fee = performerFeeOf(
      dealWith({
        status: "draft",
        agreementStatus: "sent",
        guaranteeAmount: "500000",
        parties: [
          { participantId: "PERF", roleInDeal: "payee" },
          { participantId: "OP", roleInDeal: "payer" },
        ],
      }),
      ON_THE_BILL,
      DOOR,
    );
    expect(fee?.sealed).toBe(false);
    expect(fee?.pending).toBe(true);
  });

  it("is SEALED on one signature, while the deal is still an offer", () => {
    // The case `pending` cannot see, and the reason this is a separate flag rather than a
    // rename: both are true at once and they mean different things.
    const fee = performerFeeOf(
      dealWith({
        status: "draft",
        agreementStatus: "sent",
        guaranteeAmount: "500000",
        parties: [
          { participantId: "PERF", roleInDeal: "payee", confirmedAt: signedAt },
          { participantId: "OP", roleInDeal: "payer" },
        ],
      }),
      ON_THE_BILL,
      DOOR,
    );
    expect(fee?.sealed).toBe(true);
    expect(fee?.pending).toBe(true);
  });

  it("is sealed on a confirmed agreement — the sweep's own row", () => {
    const fee = performerFeeOf(
      dealWith({
        status: "confirmed",
        agreementStatus: "confirmed",
        guaranteeAmount: "500000",
        parties: [{ participantId: "PERF", roleInDeal: "payee", confirmedAt: signedAt }],
      }),
      ON_THE_BILL,
      DOOR,
    );
    expect(fee?.sealed).toBe(true);
    expect(fee?.pending).toBe(false);
  });
});
