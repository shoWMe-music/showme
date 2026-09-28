import { dealEntitlementDetailed } from "@showme/settlement";
import { describe, expect, it } from "vitest";
import {
  type BudgetLineForDoor,
  type Deal,
  doorForecastFrom,
  performerFeeOf,
  rentalOf,
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
    expect(rentalOf([performance, rental()])?.dealId).toBe("rent-1");
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
