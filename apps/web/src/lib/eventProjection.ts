/**
 * WHAT A NIGHT IS PROJECTED TO TAKE AND COST — the rule behind Financial Projections.
 *
 * It is one subtraction over the event's ledger, and the two things it deliberately does
 * NOT do are the reason it lives in its own file with tests rather than inside the screen.
 *
 * **It reads the shared ledger only.** An event can carry a second book — a private
 * margin book, which exists only where there is a co-operator to keep it from
 * (`ensureEventBudgets`), which the confidentiality filter shows to nobody else, and
 * which `copyBudgetOnce` never copies into the settlement. Summing every book a reader
 * happens to see made this screen answer a different number for each co-host of the same
 * night, and deducted costs the settlement refuses to read. The ledger is the night's
 * book; this is a view over the night, so it is the ledger it reads.
 *
 * **It stops before the deals.** What the acts take is not a budget line — it is derived
 * from the deals, per reader, against a door forecast (`useBudgetSeed.performerFeeOf`),
 * and the Budget Planner does that work. So the figure here is revenue minus BUDGETED
 * costs, before anybody on the bill is paid, and every label over it says so. It used to
 * be called "Net Profit": on a door-split night where the acts take the whole adjusted
 * net, that printed SEK 50,000 profit at a 60 % margin for a night whose planner said
 * −SEK 1,245 and whose settlement left the operator SEK 0 (QA sweep, 2026-09-27).
 */

/** One budget as the screen receives it — only the fields the rule reads. */
export interface ProjectionBudget {
  scope: string;
  lines: { kind: string; amount: string }[];
}

export interface EventProjectionFigures {
  /** False when the event has no ledger yet — every figure renders as "—". */
  hasBudget: boolean;
  revenueMinor: number;
  costMinor: number;
  /** Revenue minus budgeted costs. BEFORE the deals pay anybody on the bill. */
  beforeDealsMinor: number;
  /** Fraction (0..1) of revenue, or null when there is no revenue to divide by. */
  margin: number | null;
}

const NOTHING: EventProjectionFigures = {
  hasBudget: false,
  revenueMinor: 0,
  costMinor: 0,
  beforeDealsMinor: 0,
  margin: null,
};

/**
 * Sum the event's LEDGER into a projection.
 *
 * **A SHARED BUDGET ROW IS NOT A PLAN — its LINES are** (QA sweep run 9 QA9-11, still holding as
 * QA10-12).
 *
 * This used to count any shared budget as a ledger, on reasoning that was sound when it was written:
 * *"this night is planned and currently adds up to nothing is a different statement from this night
 * has no plan, and only the second one should render as —."* Both statements are still different; what
 * changed is that the row no longer tells them apart. `GET /events/:id/budgets` **provisions** a
 * shared budget on read (`ensureEventBudgets`, deliberate and documented), and the Projections screen
 * fires that GET once per event — so **the act of measuring coverage creates it**. Measured across two
 * sweeps: the KPI read *"5 events budgeted"* where four had a line anybody had typed, and three of the
 * rows in the table were empty budgets a page load had made.
 *
 * The consequence was not only the count. `isPartial` was false for any host who had ever opened the
 * screen, so `partialCoverageNote` and `noBudgetDescription` — the sentences that exist to say a total
 * covers a subset — were dead code.
 *
 * So "has a ledger" is now "has a shared budget with at least one line". A budget whose lines sum to
 * zero still counts: somebody wrote those lines, which is exactly the distinction the original
 * reasoning was protecting, and the only case it now loses is the one it could no longer see.
 */
export function projectFromBudgets(
  budgets: readonly ProjectionBudget[] | undefined,
): EventProjectionFigures {
  const ledger = budgets?.filter((budget) => budget.scope === "shared") ?? [];
  if (!ledger.some((budget) => budget.lines.length > 0)) return NOTHING;

  let revenueMinor = 0;
  let costMinor = 0;
  for (const budget of ledger) {
    for (const line of budget.lines) {
      const amount = Number(line.amount);
      if (!Number.isFinite(amount)) continue;
      if (line.kind === "revenue") revenueMinor += amount;
      else if (line.kind === "cost") costMinor += amount;
    }
  }

  const beforeDealsMinor = revenueMinor - costMinor;
  return {
    hasBudget: true,
    revenueMinor,
    costMinor,
    beforeDealsMinor,
    margin: revenueMinor > 0 ? beforeDealsMinor / revenueMinor : null,
  };
}

/**
 * Statuses a forecast has nothing to say about.
 *
 * `cancelled` only. A withdrawn night forecasts no night — the same
 * `ne(status, 'cancelled')` the settlement engine and the planner's own fee derivation
 * read. A `draft` stays in: a night being planned is exactly what a pipeline is for, and
 * dropping it would hide the events this screen exists to weigh.
 */
export function forecastsNothing(status: string): boolean {
  return status.toLowerCase() === "cancelled";
}
