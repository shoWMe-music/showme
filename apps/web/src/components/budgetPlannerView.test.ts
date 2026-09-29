/**
 * `splitCostRows` — which of the six standing cost headings the Budget Planner
 * draws.
 *
 * This is the module's OWN logic, and the only part of it that can be asserted
 * cheaply. `budgetPlannerViewFrom` takes a whole `BudgetEditor` (participants,
 * deals, budgets, and some thirty callbacks), and the arithmetic it presents is
 * `@showme/shared`'s — `computeBudgetProjection`, `computeBreakdown`,
 * `computeBreakEvenChart`, each already covered where it lives. What is left here
 * is a unit boundary and this partition. Testing the partition is worth it; standing
 * up a fake editor to re-assert somebody else's maths is not.
 *
 * The partition earns a suite because it decides what an operator can SEE. Get it
 * wrong one way and the screen is six rows of chrome for a show with two real costs
 * (reported 2026-08-31, "too big", "no delete buttons"); get it wrong the other and
 * a heading someone entered a figure into vanishes with the figure still in it.
 *
 * Nothing here can move the settlement. A heading with no figure has no
 * `budget_lines` row, and `ensureSettlementLines` copies that table — so hiding one
 * is invisible to `reconcile()` by construction. That is why this is a display test
 * and not a money test.
 */
import { describe, expect, it } from "vitest";
import {
  type PartitionableCostRow,
  breakEvenKpi,
  carryRevealedHeading,
  costsAreIncomplete,
  costsIncompleteNoteFor,
  roundToDisplayUnit,
  splitCostRows,
  ticketSplitDisplay,
} from "./budgetPlannerView";

/** The six headings the planner always offers, as the editor hands them over. */
const STANDING_HEADINGS: PartitionableCostRow[] = [
  { label: "Performer fee", value: "" },
  { label: "Production", value: "" },
  { label: "Staff", value: "" },
  { label: "Marketing", value: "" },
  { label: "Venue", value: "" },
  { label: "Other", value: "" },
];

const labelsOf = (rows: PartitionableCostRow[]) => rows.map((row) => row.label);

describe("splitCostRows", () => {
  it("collapses every standing heading nobody has used", () => {
    const { budgeted, unused } = splitCostRows(STANDING_HEADINGS, []);
    expect(budgeted).toEqual([]);
    expect(labelsOf(unused)).toEqual([
      "Performer fee",
      "Production",
      "Staff",
      "Marketing",
      "Venue",
      "Other",
    ]);
  });

  it("keeps a heading the moment it carries a figure", () => {
    const rows = STANDING_HEADINGS.map((row) =>
      row.label === "Production" ? { ...row, value: "2500" } : row,
    );
    const { budgeted, unused } = splitCostRows(rows, []);
    expect(labelsOf(budgeted)).toEqual(["Production"]);
    expect(labelsOf(unused)).not.toContain("Production");
  });

  /**
   * A figure of zero is a decision — "this show has no marketing spend" — and a
   * decision the operator typed must not be tidied away as an unused heading.
   */
  it("treats a typed zero as a used heading, not an empty one", () => {
    const { budgeted } = splitCostRows([{ label: "Marketing", value: "0" }], []);
    expect(labelsOf(budgeted)).toEqual(["Marketing"]);
  });

  /** Whitespace is nothing typed. A row of spaces is still an unused heading. */
  it("treats a whitespace-only figure as empty", () => {
    const { unused } = splitCostRows([{ label: "Staff", value: "   " }], []);
    expect(labelsOf(unused)).toEqual(["Staff"]);
  });

  /**
   * The performer fee is read off the deal rather than typed, so it has no value
   * of its own and would otherwise collapse — taking the one cost the show
   * definitely has off the screen.
   */
  it("keeps a heading whose figure comes from a deal, even with nothing typed", () => {
    const rows: PartitionableCostRow[] = [
      {
        label: "Performer fee",
        value: "",
        readFromDeal: { dealNames: ["Marlo Vega — guarantee"] },
      },
      { label: "Staff", value: "" },
    ];
    const { budgeted, unused } = splitCostRows(rows, []);
    expect(labelsOf(budgeted)).toEqual(["Performer fee"]);
    expect(labelsOf(unused)).toEqual(["Staff"]);
  });

  /**
   * A custom row is one the operator created by name in "+ Add Field". It was
   * never a standing heading, so there is no chip to put it back with — collapsing
   * it would make it unreachable, which is a delete that lies about itself.
   */
  it("never collapses a row the operator added themselves", () => {
    const rows: PartitionableCostRow[] = [
      { label: "Backline hire", value: "", isCustom: true },
      { label: "Venue", value: "" },
    ];
    const { budgeted, unused } = splitCostRows(rows, []);
    expect(labelsOf(budgeted)).toEqual(["Backline hire"]);
    expect(labelsOf(unused)).toEqual(["Venue"]);
  });

  it("shows a heading the operator asked back this session, still empty", () => {
    const { budgeted, unused } = splitCostRows(STANDING_HEADINGS, ["Staff"]);
    expect(labelsOf(budgeted)).toEqual(["Staff"]);
    expect(labelsOf(unused)).toHaveLength(5);
  });

  /**
   * THE BUG THIS RULE WAS WRITTEN FOR. A standing heading's KEY changes underneath
   * it — `new:Staff cost` until it has a figure, the `budget_lines` id afterwards,
   * `new:` again once cleared. Tracked by key, a heading revealed, filled and then
   * cleared came back as a blank row nobody had asked for, because the revealed set
   * still held a key the row no longer had. The label is the one thing that does
   * not move, so the round trip has to survive all three states.
   */
  it("tracks a revealed heading by label, across the key changing underneath it", () => {
    const revealed = ["Staff"];

    const empty = splitCostRows([{ label: "Staff", value: "" }], revealed);
    expect(labelsOf(empty.budgeted)).toEqual(["Staff"]);

    const filled = splitCostRows([{ label: "Staff", value: "1200" }], revealed);
    expect(labelsOf(filled.budgeted)).toEqual(["Staff"]);

    // Cleared again: still revealed, so still on screen — NOT re-collapsed and not
    // duplicated back in as a second blank row.
    const cleared = splitCostRows([{ label: "Staff", value: "" }], revealed);
    expect(labelsOf(cleared.budgeted)).toEqual(["Staff"]);
    expect(cleared.unused).toEqual([]);
  });

  it("puts every row in exactly one of the two lists, and loses none", () => {
    const rows: PartitionableCostRow[] = [
      { label: "Performer fee", value: "", readFromDeal: { dealNames: ["A deal"] } },
      { label: "Production", value: "900" },
      { label: "Staff", value: "" },
      { label: "Marketing", value: "" },
      { label: "Backline hire", value: "", isCustom: true },
    ];
    const { budgeted, unused } = splitCostRows(rows, ["Marketing"]);

    expect(budgeted.length + unused.length).toBe(rows.length);
    expect([...labelsOf(budgeted), ...labelsOf(unused)].sort()).toEqual(labelsOf(rows).sort());
    expect(labelsOf(unused)).toEqual(["Staff"]);
  });

  it("keeps the editor's order within each list", () => {
    const { unused } = splitCostRows(STANDING_HEADINGS, []);
    expect(labelsOf(unused)).toEqual(labelsOf(STANDING_HEADINGS));
  });

  it("does not mutate the rows it was handed", () => {
    const rows = STANDING_HEADINGS.map((row) => ({ ...row }));
    const snapshot = JSON.stringify(rows);
    splitCostRows(rows, ["Staff"]);
    expect(JSON.stringify(rows)).toBe(snapshot);
  });

  it("copes with no rows at all", () => {
    expect(splitCostRows([], [])).toEqual({ budgeted: [], unused: [] });
  });

  /**
   * The revealed set is a session thing and the cost rows come from the server, so
   * they go out of step routinely — a heading revealed on one budget, then another
   * budget selected. A stale label must simply not match anything.
   */
  it("ignores a revealed label that no row carries", () => {
    const { budgeted, unused } = splitCostRows(
      [{ label: "Staff", value: "" }],
      ["A heading from another budget"],
    );
    expect(budgeted).toEqual([]);
    expect(labelsOf(unused)).toEqual(["Staff"]);
  });
});

/**
 * A CO-PROMOTER MUST NOT BE SHOWN A PROFIT THAT IS NOT THERE (QA sweep run 3).
 *
 * The performer fee is derived from the deals list and that list is scoped per
 * reader, so a co-host who is not a `deal_party` sees the shared ledger minus the
 * fee. The planner totalled what it could see and printed the difference as
 * profit: the host read a SEK 1,245 loss and the co-host, same ledger, same
 * minute, a SEK 40,255 profit at a "48.5% margin". Those tiles are now withheld,
 * and this is the sentence that stands in their place.
 */
/**
 * THE WITHHOLDING IS THE SHARED LEDGER'S (QA sweep run 9 QA9-5, restated as QA10-11).
 *
 * A hidden deal means the NIGHT costs more than the sheet can see, so a shared ledger must not
 * compute a profit — QA4-5, and it stands. A private book is a different ledger: its costs are the
 * rows its owner typed, and the shared ledger's performer fee is not one of them. Withholding its
 * margin printed a sentence untrue of the page it was on — *"what the night costs is higher than the
 * total above"*, where the total above was the operator's own SEK 4,000.
 *
 * The asymmetry is the proof: the HOST's private book on the same event always DID print a margin,
 * because the host can see the deal, so the only operator whose private book could never show one was
 * the co-promoter — the operator the private book exists for.
 */
describe("costsAreIncomplete — and which book is asking", () => {
  it("still withholds on a SHARED ledger with a hidden deal", () => {
    expect(costsAreIncomplete(1)).toBe(true);
    expect(costsAreIncomplete(1, false)).toBe(true);
    expect(costsIncompleteNoteFor(1, false)).not.toBeNull();
  });

  it("does not withhold in a PRIVATE book, whatever is hidden on the shared one", () => {
    expect(costsAreIncomplete(1, true)).toBe(false);
    expect(costsAreIncomplete(9, true)).toBe(false);
    expect(costsIncompleteNoteFor(3, true)).toBeNull();
  });

  it("is unchanged when nothing is hidden, in either book", () => {
    // The positive control on both sides: the rule only ever fired on a hidden deal.
    expect(costsAreIncomplete(0, false)).toBe(false);
    expect(costsAreIncomplete(0, true)).toBe(false);
  });
});

describe("costsIncompleteNoteFor", () => {
  it("says nothing when the reader can see every deal", () => {
    expect(costsIncompleteNoteFor(0)).toBeNull();
  });

  it("reads as English for a single hidden deal", () => {
    const note = costsIncompleteNoteFor(1);
    expect(note).toContain("One of this event's deals is not shown to you");
    expect(note).toContain("without it.");
    // The bug this guards against is a screen that says "1 deals are".
    expect(note).not.toContain("1 of this event's deals");
  });

  it("counts and pluralises more than one", () => {
    const note = costsIncompleteNoteFor(3);
    expect(note).toContain("3 of this event's deals are not shown to you");
    expect(note).toContain("without them.");
  });

  it("says the total is a floor, and names what was withheld", () => {
    const note = costsIncompleteNoteFor(2) ?? "";
    expect(note).toContain("higher than the total above");
    expect(note).toContain("Profit, margin and break-even");
  });
});

/**
 * NOBODY HOLDS 111% OF A QUANTITY (QA sweep run 2 and run 3, 2026-09-26).
 *
 * On a guarantee-vs-door night whose takings fall short, the engine pays the
 * guarantee — which can exceed the whole door. The card divided it by the door
 * anyway and printed "111% performer", with NO operator row at all, because the
 * remainder was negative and the row was drawn only when positive. The one fact the
 * operator needed — this night loses money on the door — was the one it hid.
 */
describe("ticketSplitDisplay", () => {
  const participants = [
    { id: "p1", label: "Marlo Vance", roleLabel: "Performer" },
    { id: "p2", label: "Neon Tide", roleLabel: "Support" },
  ];
  const money = (amount: bigint) => `SEK ${(Number(amount) / 100).toLocaleString("en-IE")}`;

  it("drops the percentages when a guarantee exceeds the door, and keeps the amounts", () => {
    // The measured case: SEK 2,000 guarantee against SEK 1,800 of tickets.
    const display = ticketSplitDisplay(
      {
        doorMinor: 180_000n,
        shares: [{ participantId: "p1", amountMinor: 200_000n, basisPoints: 11_111 }],
        operatorRemainderMinor: -20_000n,
        badge: "Guarantee vs Door · proposed",
        summary: "The guarantee beats the door.",
      },
      participants,
      money,
    );

    const performer = display.rows.find((row) => row.key === "p1");
    expect(performer?.percentLabel).toBeNull();
    expect(performer?.amount).toBe("SEK 2,000");
    // Never the impossible figure, in any field the screen reads.
    expect(display.composition).not.toContain("111");
    expect(display.rows.every((row) => row.percentLabel !== "111%")).toBe(true);
  });

  it("shows the operators' negative line rather than omitting it", () => {
    const display = ticketSplitDisplay(
      {
        doorMinor: 180_000n,
        shares: [{ participantId: "p1", amountMinor: 200_000n, basisPoints: 11_111 }],
        operatorRemainderMinor: -20_000n,
        badge: null,
        summary: null,
      },
      participants,
      money,
    );

    const operators = display.rows.find((row) => row.key === "operators");
    expect(operators).toBeDefined();
    expect(operators?.isShortfall).toBe(true);
    expect(operators?.amount).toBe("SEK -200");
  });

  it("still draws no operators' row when a deal takes the whole door exactly", () => {
    // The seeded album release does this at 100% — a zero-width bar labelled "the
    // operators" reads as an error rather than as nothing.
    const display = ticketSplitDisplay(
      {
        doorMinor: 100_000n,
        shares: [{ participantId: "p1", amountMinor: 100_000n, basisPoints: 10_000 }],
        operatorRemainderMinor: 0n,
        badge: null,
        summary: null,
      },
      participants,
      money,
    );

    expect(display.rows.map((row) => row.key)).toEqual(["p1"]);
    expect(display.rows[0]?.percentLabel).toBe("100%");
  });

  /**
   * WHAT THE CARD IS A SHARE OF (QA sweep run 2, still reproducing in run 3).
   *
   * The bars divide the BOX OFFICE; the deal is paid out of the adjusted net. On Open
   * Mic the card said Marlo Vance took SEK 4,410 while the Costs row below it and the
   * settlement one click away both paid SEK 3,710 — 18.9% overstated, on one screen at
   * one moment, with no caption. The settlement screen has always carried the
   * qualifier; the planner carried it only in a source comment.
   */
  describe("the payout caption", () => {
    const door = {
      doorMinor: 630_000n,
      shares: [{ participantId: "p1", amountMinor: 441_000n, basisPoints: 7000 }],
      operatorRemainderMinor: 189_000n,
      badge: "Guarantee vs Door",
      summary: "70% of the door.",
    };

    it("names the figure actually paid when costs make it smaller", () => {
      const display = ticketSplitDisplay(door, participants, money, 371_000n);

      expect(display.payoutCaption).toContain("Box office only, before costs and rental");
      expect(display.payoutCaption).toContain("SEK 3,710");
    });

    it("qualifies the card without a second figure when the two agree", () => {
      const display = ticketSplitDisplay(door, participants, money, 441_000n);

      expect(display.payoutCaption).toBe("Box office only, before costs and rental.");
    });

    it("says nothing when no deal states a fee to compare against", () => {
      expect(ticketSplitDisplay(door, participants, money, null).payoutCaption).toBeNull();
      expect(ticketSplitDisplay(door, participants, money).payoutCaption).toBeNull();
    });
  });

  it("keeps percentages on an ordinary split that fits inside the door", () => {
    const display = ticketSplitDisplay(
      {
        doorMinor: 100_000n,
        shares: [
          { participantId: "p1", amountMinor: 42_000n, basisPoints: 4_200 },
          { participantId: "p2", amountMinor: 28_000n, basisPoints: 2_800 },
        ],
        operatorRemainderMinor: 30_000n,
        badge: null,
        summary: null,
      },
      participants,
      money,
    );

    expect(display.rows.map((row) => row.percentLabel)).toEqual(["42%", "28%", "30%"]);
    expect(display.rows.find((row) => row.key === "operators")?.isShortfall).toBeUndefined();
  });
});

/**
 * A REVEALED HEADING LEFT THE TABLE ON THE FIRST KEYSTROKE (QA sweep run 3, r3:178).
 *
 * Reveals are keyed by label, so naming a revealed "Other" un-revealed it and
 * `splitCostRows` collapsed the row into a chip under its new name, mid-edit.
 */
describe("carryRevealedHeading", () => {
  it("keeps a renamed heading on the sheet", () => {
    const revealed = carryRevealedHeading(["Other"], "Other", "Piano tuning");
    expect(revealed).toEqual(["Piano tuning"]);

    const row = {
      key: "new:Other",
      label: "Piano tuning",
      value: "",
      isCustom: false,
      readFromDeal: undefined,
    };
    expect(splitCostRows([row], revealed).budgeted).toHaveLength(1);
    // The mutation check: without carrying it, the same row collapses.
    expect(splitCostRows([row], ["Other"]).unused).toHaveLength(1);
  });

  it("leaves a heading nobody revealed alone", () => {
    expect(carryRevealedHeading(["Marketing"], "Other", "Piano tuning")).toEqual(["Marketing"]);
  });

  it("touches only the heading that moved", () => {
    expect(carryRevealedHeading(["Staff", "Other", "Venue"], "Other", "Piano")).toEqual([
      "Staff",
      "Piano",
      "Venue",
    ]);
  });
});

/**
 * TWO CORRECT NUMBERS AND A THIRD THAT CONTRADICTS THEM (QA sweep run 2, r2:480).
 *
 * `TOTAL REVENUE SEK 6,300 · TOTAL COSTS SEK 4,805 · PROFIT / LOSS SEK 1,496`, each
 * rounding right on its own and the card still failing the only arithmetic a reader
 * does on it.
 */
describe("roundToDisplayUnit", () => {
  it("makes the headline subtraction hold", () => {
    const revenue = 630_000n;
    const costs = 480_450n; // 4,804.50 → prints 4,805
    const shownRevenue = roundToDisplayUnit(revenue, 100);
    const shownCosts = roundToDisplayUnit(costs, 100);

    expect(shownCosts).toBe(480_500n);
    expect(shownRevenue - shownCosts).toBe(149_500n); // prints 1,495 — and 6300-4805 is 1495
    // The exact profit is what used to be printed, and what did not add up.
    expect(revenue - costs).toBe(149_550n); // prints 1,496
  });

  it("rounds half away from zero, in both directions", () => {
    expect(roundToDisplayUnit(150n, 100)).toBe(200n);
    expect(roundToDisplayUnit(149n, 100)).toBe(100n);
    expect(roundToDisplayUnit(-150n, 100)).toBe(-200n);
    expect(roundToDisplayUnit(-149n, 100)).toBe(-100n);
  });

  it("leaves a currency with no minor unit alone", () => {
    // JPY: the minor unit IS the unit, so there is nothing to round away.
    expect(roundToDisplayUnit(240_001n, 1)).toBe(240_001n);
    // KWD has three, so the card's whole-dinar figure moves by up to 500 fils.
    expect(roundToDisplayUnit(1_500n, 1000)).toBe(2_000n);
  });
});

/**
 * THE NOTE AND THE WITHHOLDING CANNOT DISAGREE — QA sweep run 4, QA4-5.
 *
 * The screen promised *"Profit, margin and break-even are left out rather than
 * calculated without it"* and drew the break-even chart immediately below the
 * sentence, with a crossing point computed off a partial cost total: SEK 34,770
 * against the host's SEK 119,770 on the same night, so the co-promoter read "passes
 * total cost at 131 tickets" where the host read "never passes inside 400 capacity".
 *
 * The cause was two readings of one condition, written in two places, neither
 * consulted by the chart. `costsAreIncomplete` is now the single one, and this is the
 * invariant: whenever the note is shown, break-even is withheld — the note IS the
 * explanation for the absence, so a note with a chart under it is a contradiction
 * rather than an oversight.
 */
describe("costsAreIncomplete — the note and the withholding are one decision", () => {
  it("says nothing is missing when every deal is visible", () => {
    expect(costsAreIncomplete(0)).toBe(false);
    expect(costsIncompleteNoteFor(0)).toBeNull();
  });

  it("agrees with the note for every count that has one", () => {
    for (const hidden of [1, 2, 3, 17]) {
      expect(costsAreIncomplete(hidden)).toBe(true);
      expect(costsIncompleteNoteFor(hidden)).not.toBeNull();
    }
  });

  it("never shows the note without withholding the figures it explains", () => {
    for (const hidden of [0, 1, 2, 3]) {
      const note = costsIncompleteNoteFor(hidden);
      // The implication in both directions: the note exists exactly when the
      // figures are withheld. A chart under that sentence is the bug.
      expect(note !== null).toBe(costsAreIncomplete(hidden));
      if (note) expect(note).toContain("break-even");
    }
  });
});

/**
 * A CROSSING THE ROOM CANNOT REACH IS NOT A TARGET (QA sweep run 11).
 *
 * The tile read `breakEvenReachable`, which is `breakEvenTickets > 0 || uncovered <= 0` — and
 * the scan that produces those tickets deliberately runs to FOUR TIMES capacity so the figure
 * exists at all. So a 400-seat room crossing at 407 printed **BREAK-EVEN TICKETS 407** directly
 * above the chart's own caption *"Revenue never passes total cost inside 400 capacity"*. Two
 * definitions of reachable on one screen, and `break-even-chart.ts` had warned about this exact
 * reading in a comment.
 */
describe("breakEvenKpi", () => {
  it("says No break-even when the crossing lies beyond this room", () => {
    expect(breakEvenKpi("beyond_this_room", 407)).toBe("No break-even");
  });

  it("prints the count when the crossing is inside it", () => {
    expect(breakEvenKpi("on_chart", 131)).toBe(131);
  });

  it("prints ZERO when the standing revenue already paid — the one count that looks like none", () => {
    // QA5-7's ruling, and the reason this is not simply "hide any zero".
    expect(breakEvenKpi("covered_before_doors", 0)).toBe(0);
  });

  it("does not second-guess the chart's answer with the ticket count", () => {
    // The figure is real even when the room cannot reach it — the CSV exports it — so the
    // coverage is what decides, never the number. A tile reading the number would be the bug.
    expect(breakEvenKpi("beyond_this_room", 1)).toBe("No break-even");
  });
});
