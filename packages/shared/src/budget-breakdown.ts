/**
 * "Where the money comes from / where it goes" — the two bar lists on the Budget
 * Planner (Revenue Sources, Cost Breakdown).
 *
 * Two different percentages, and conflating them is the bug this module exists to
 * prevent. `percentOfTotal` is the FACT — this heading is 81% of what the show
 * costs — and it is what the row prints. `percentOfLargest` is the DRAWING: the
 * biggest bar fills the track and the rest are drawn in proportion to it, so a
 * list of small slices is still readable instead of seven hairlines. Using the
 * printed percentage as the bar width would make every modest cost invisible;
 * using the drawn one as the label would be a lie.
 *
 * Framework-agnostic (CLAUDE.md), bigint minor units in, integers out.
 */

export interface BreakdownSlice {
  readonly label: string;
  readonly amount: bigint;
  /** The row's colour, decided by the screen and passed straight through. */
  readonly color: string;
}

export interface BreakdownRow {
  readonly label: string;
  readonly amount: bigint;
  /** This slice as a percentage of the whole, rounded. What the row prints. */
  readonly percentOfTotal: number;
  /** This slice against the biggest one, rounded. How wide the bar is drawn. */
  readonly percentOfLargest: number;
  readonly color: string;
}

/**
 * Rows for every slice that has an amount, biggest first is NOT imposed — the
 * caller's order is the operator's order, and reordering the cost headings under
 * them on every keystroke would make the list impossible to read while typing.
 *
 * A zero slice is dropped rather than drawn empty: a cost nobody budgeted is not a
 * cost of nothing, it is a cost that is not in this budget.
 */
export function computeBreakdown(slices: readonly BreakdownSlice[], total: bigint): BreakdownRow[] {
  const present = slices.filter((slice) => slice.amount > 0n);
  const largest = present.reduce(
    (biggest, slice) => (slice.amount > biggest ? slice.amount : biggest),
    1n,
  );
  return present.map((slice) => ({
    label: slice.label,
    amount: slice.amount,
    percentOfTotal: total > 0n ? Math.round((Number(slice.amount) / Number(total)) * 100) : 0,
    percentOfLargest: Math.round((Number(slice.amount) / Number(largest)) * 100),
    color: slice.color,
  }));
}
