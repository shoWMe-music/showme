/**
 * THE PROJECTION RULE — and the two ways it used to be wrong on the same screen.
 *
 * Both were found by driving the app (QA sweep, 2026-09-27) on one night: Projections
 * said SEK 50,000 profit at a 60 % margin where the Budget Planner, reading the same
 * ledger, said −SEK 1,245 and the settlement left the operator SEK 0.
 */
import { describe, expect, it } from "vitest";
import { forecastsNothing, projectFromBudgets } from "./eventProjection";

const line = (kind: string, amount: string) => ({ kind, amount });

describe("projectFromBudgets", () => {
  it("sums the ledger's revenue and costs", () => {
    const figures = projectFromBudgets([
      { scope: "shared", lines: [line("revenue", "8300000"), line("cost", "3300000")] },
    ]);
    expect(figures).toEqual({
      hasBudget: true,
      revenueMinor: 8300000,
      costMinor: 3300000,
      beforeDealsMinor: 5000000,
      margin: 5000000 / 8300000,
    });
  });

  it("ignores a private book entirely", () => {
    // The private book is a co-operator's own margin line: the settlement never reads it,
    // the other operator cannot see it, and summing it made this screen answer a
    // different number for each co-host of the same night.
    const figures = projectFromBudgets([
      { scope: "shared", lines: [line("revenue", "7500000")] },
      { scope: "private", lines: [line("cost", "500000")] },
    ]);
    expect(figures.costMinor).toBe(0);
    expect(figures.beforeDealsMinor).toBe(7500000);
  });

  it("has no projection at all when there is no ledger", () => {
    expect(projectFromBudgets(undefined).hasBudget).toBe(false);
    expect(projectFromBudgets([]).hasBudget).toBe(false);
    // A private book on its own is not a ledger — the night still has no plan the
    // settlement would ever read.
    expect(projectFromBudgets([{ scope: "private", lines: [line("cost", "1")] }]).hasBudget).toBe(
      false,
    );
  });

  /**
   * THIS TEST ASSERTED THE OPPOSITE, and the reasoning it carried was right when written (QA9-11,
   * still holding as QA10-12).
   *
   * It read: *"'Planned, and currently adds up to nothing' is a different statement from 'not
   * planned', and only the second should render as —."* Both statements are still different. What
   * changed underneath it is that an empty shared budget no longer means the first one:
   * `GET /events/:id/budgets` **provisions** a shared budget on read, and the Projections screen fires
   * that read once per event — so the act of measuring coverage created the row. The KPI said *"5
   * events budgeted"* where four had a line anybody had typed.
   *
   * The distinction survives where it can still be drawn: a ledger whose lines sum to zero counts,
   * because somebody wrote those lines. That is the next test.
   */
  it("does not count an empty shared budget as a plan — a page load can create one", () => {
    const figures = projectFromBudgets([{ scope: "shared", lines: [] }]);
    expect(figures.hasBudget).toBe(false);
    expect(figures.margin).toBeNull();
  });

  it("counts a ledger whose lines sum to zero — somebody wrote them", () => {
    const zeroed = projectFromBudgets([
      { scope: "shared", lines: [line("revenue", "50000"), line("cost", "50000")] },
    ]);
    expect(zeroed.hasBudget).toBe(true);
    expect(zeroed.beforeDealsMinor).toBe(0);
  });

  it("drops a line whose amount is not a number rather than poisoning the total", () => {
    const figures = projectFromBudgets([
      { scope: "shared", lines: [line("revenue", "1000"), line("revenue", "not-money")] },
    ]);
    expect(figures.revenueMinor).toBe(1000);
  });
});

describe("forecastsNothing", () => {
  it("drops a cancelled night and keeps everything else", () => {
    expect(forecastsNothing("cancelled")).toBe(true);
    expect(forecastsNothing("Cancelled")).toBe(true);
    // A draft is the pipeline this screen exists to weigh.
    for (const status of ["draft", "suggested", "pending", "confirmed", "on_hold", "concluded"]) {
      expect(forecastsNothing(status)).toBe(false);
    }
  });
});
