/**
 * The Budget Planner's arithmetic, ported from the design prototype's
 * `computeBudget` ("shoWMe All View", Budget screen).
 *
 * Framework-agnostic on purpose (CLAUDE.md): the planner screen renders these
 * figures, it does not derive them. Everything here is in MINOR units as bigint
 * (money.md) except the two ratios, which are unitless.
 *
 * These are PLANNING figures — an operator's estimate of whether a show washes
 * its face. They are not settlement: nothing here is authoritative, no FX is
 * locked, and no entitlement is created. Settlement math lives in
 * `packages/settlement` and reads the recorded lines, not these projections.
 */

/** One ticket tier as the planner holds it: a price and how many are expected. */
export interface TicketTier {
  readonly unitAmount: bigint;
  readonly quantity: number;
}

export interface BudgetInputs {
  readonly ticketTiers: readonly TicketTier[];
  /** Average spend per head at the bar, times the heads below. */
  readonly averageBarSpend: bigint;
  readonly capacity: number;
  /** Revenue that is neither ticketing nor bar (sponsorship, a fee, a grant). */
  readonly otherRevenue: bigint;
  readonly costs: readonly bigint[];
}

export interface BudgetProjection {
  readonly ticketRevenue: bigint;
  readonly barRevenue: bigint;
  readonly totalRevenue: bigint;
  readonly totalCosts: bigint;
  readonly profit: bigint;
  /** Tickets expected to sell across every tier. */
  readonly ticketsSold: number;
  /**
   * The QUANTITY-WEIGHTED average ticket price — total ticket revenue divided by
   * tickets sold, not the mean of the tier prices. Two tiers at 250 and 100 are
   * not a 175 average when 900 of the first sell and 100 of the second; taking
   * the unweighted mean flatters a cheap tier nobody buys and moves break-even
   * by hundreds of tickets.
   */
  readonly averageTicketPrice: bigint;
  /**
   * How many tickets must sell before the show stops losing money.
   *
   * Non-ticket revenue is subtracted from the costs it offsets rather than being
   * ignored: a bar take and a sponsorship are money in hand before a single
   * ticket sells, so they lower the bar rather than leaving it where it was.
   * Dividing total costs by the ticket price — which is what this screen did
   * before — overstates the count by however much the bar was expected to bring.
   */
  readonly breakEvenTickets: number;
  /** Profit as a percentage of revenue. Zero when there is no revenue. */
  readonly marginPercent: number;
  readonly revenuePerGuest: bigint;
  readonly costPerGuest: bigint;
}

function sum(values: readonly bigint[]): bigint {
  return values.reduce((total, value) => total + value, 0n);
}

/** Round half away from zero, so a break-even of 100.5 tickets needs 101. */
function divideRounded(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) return 0n;
  return numerator / denominator;
}

export function computeBudgetProjection(inputs: BudgetInputs): BudgetProjection {
  const ticketRevenue = sum(
    inputs.ticketTiers.map((tier) => tier.unitAmount * BigInt(Math.trunc(tier.quantity))),
  );
  const ticketsSold = inputs.ticketTiers.reduce(
    (total, tier) => total + Math.trunc(tier.quantity),
    0,
  );
  const barRevenue = inputs.averageBarSpend * BigInt(Math.trunc(inputs.capacity));
  const totalRevenue = ticketRevenue + barRevenue + inputs.otherRevenue;
  const totalCosts = sum(inputs.costs);
  const profit = totalRevenue - totalCosts;

  const averageTicketPrice =
    ticketsSold > 0 ? divideRounded(ticketRevenue, BigInt(ticketsSold)) : 0n;

  // What ticket sales still have to cover once the money that arrives regardless
  // of them is counted. Already covered → nothing left to break even on.
  const uncovered = totalCosts - barRevenue - inputs.otherRevenue;
  let breakEvenTickets = 0;
  if (averageTicketPrice > 0n && uncovered > 0n) {
    const whole = uncovered / averageTicketPrice;
    const exact = whole * averageTicketPrice === uncovered;
    breakEvenTickets = Number(exact ? whole : whole + 1n); // a part ticket is a whole ticket
  }

  const marginPercent = totalRevenue > 0n ? (Number(profit) / Number(totalRevenue)) * 100 : 0;
  const guests = BigInt(Math.max(Math.trunc(inputs.capacity), 1));

  return {
    ticketRevenue,
    barRevenue,
    totalRevenue,
    totalCosts,
    profit,
    ticketsSold,
    averageTicketPrice,
    breakEvenTickets,
    marginPercent,
    revenuePerGuest: totalRevenue / guests,
    costPerGuest: totalCosts / guests,
  };
}
