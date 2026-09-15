import { dealEntitlementDetailed } from "@showme/settlement";
import { describe, expect, it } from "vitest";
import { type Deal, performerFeeOf } from "./useBudgetSeed";

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
