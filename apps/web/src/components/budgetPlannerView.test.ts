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
import { type PartitionableCostRow, splitCostRows } from "./budgetPlannerView";

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
