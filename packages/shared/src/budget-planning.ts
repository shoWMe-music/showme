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

import { applyBasisPoints } from "./money";

/** One ticket tier as the planner holds it: a price and how many are expected. */
export interface TicketTier {
  readonly unitAmount: bigint;
  readonly quantity: number;
}

/**
 * What the operator expects their ticketing/payment provider to keep: a slice of
 * ticket revenue plus a flat charge on every ticket sold. Both halves, because
 * that is how the rails actually price (Stripe, Mollie and every ticketing agent
 * quote "x% + y per transaction") and a percentage alone understates a cheap
 * ticket badly.
 *
 * An ASSUMPTION, not a cost line, and the distinction is load-bearing. Nobody has
 * paid this money; it is the operator's guess at what a provider will take if the
 * show sells the way this budget says. It therefore never becomes a `budget_lines`
 * row: `reconcile()` reads cost lines as cash somebody actually fronted, and an
 * estimated fee posted there would lower the settlement pool by money that never
 * moved. It shapes the projection on this screen and stops at its edge.
 *
 * Deliberately NOT shoWMe's own platform fee. Who bears the provider's cut is a
 * payments-layer question (docs/payments.md), still open — see docs/money.md's
 * deferred FX decision. This models only what the operator types.
 */
export interface PaymentProcessingAssumption {
  /**
   * Basis points of TICKET revenue — money.md: percentages are integer basis
   * points, never a float. 150 = 1.50%.
   */
  readonly percentBasisPoints: number;
  /** A flat charge per ticket sold, in minor units. */
  readonly flatPerTicket: bigint;
}

export interface BudgetInputs {
  readonly ticketTiers: readonly TicketTier[];
  /** Average spend per head at the bar, times the heads below. */
  readonly averageBarSpend: bigint;
  readonly capacity: number;
  /** Revenue that is neither ticketing nor bar (sponsorship, a fee, a grant). */
  readonly otherRevenue: bigint;
  /**
   * Free-form revenue rows the operator named themselves ("+ Add Field" on the
   * design prototype's Revenue card) — a merch guarantee, a bar minimum, a city
   * grant. Amounts only; the labels belong to the screen and the breakdown list,
   * never to the arithmetic.
   *
   * A separate field from `otherRevenue` rather than folded into it because the
   * two are different promises: `otherRevenue` is the ONE standing row the
   * planner always shows, and Revenue Sources prints each custom row under its
   * own name. Folding them would make a 40 000 sponsorship and a 5 000 grant
   * indistinguishable the moment the screen tried to break the total down.
   *
   * Costs need no equivalent — `costs` is already a flat array, so a custom cost
   * row is simply one more element in it.
   */
  readonly customRevenue?: readonly bigint[];
  readonly costs: readonly bigint[];
  /** Absent when the operator has not said what their provider charges. */
  readonly paymentProcessing?: PaymentProcessingAssumption;
}

export interface BudgetProjection {
  readonly ticketRevenue: bigint;
  readonly barRevenue: bigint;
  /** The custom revenue rows summed, so the total stays decomposable. Zero without any. */
  readonly customRevenue: bigint;
  readonly totalRevenue: bigint;
  /** The costs the operator typed, before any derived fee. */
  readonly enteredCosts: bigint;
  /** The provider's expected cut, derived from `paymentProcessing`. Zero without it. */
  readonly paymentProcessingFees: bigint;
  /** `enteredCosts` + `paymentProcessingFees` — what the show is projected to cost. */
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
  const customRevenue = sum(inputs.customRevenue ?? []);
  const totalRevenue = ticketRevenue + barRevenue + inputs.otherRevenue + customRevenue;
  const enteredCosts = sum(inputs.costs);
  // The provider charges on the tickets it sells, so the percentage is taken on
  // TICKET revenue only — not on the bar take or a sponsorship, which never pass
  // through it. Charging the whole revenue would inflate the fee on exactly the
  // shows whose margin comes from the bar.
  const paymentProcessingFees = inputs.paymentProcessing
    ? applyBasisPoints(ticketRevenue, inputs.paymentProcessing.percentBasisPoints) +
      inputs.paymentProcessing.flatPerTicket * BigInt(ticketsSold)
    : 0n;
  const totalCosts = enteredCosts + paymentProcessingFees;
  const profit = totalRevenue - totalCosts;

  const averageTicketPrice =
    ticketsSold > 0 ? divideRounded(ticketRevenue, BigInt(ticketsSold)) : 0n;

  // What ticket sales still have to cover once the money that arrives regardless
  // of them is counted — the bar, the standing other-revenue row, AND every
  // custom row, all of which are money in hand before a ticket sells. Leaving
  // the custom rows out here would demand tickets for a sponsorship already
  // banked. Already covered → nothing left to break even on.
  const uncovered = totalCosts - barRevenue - inputs.otherRevenue - customRevenue;
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
    customRevenue,
    totalRevenue,
    enteredCosts,
    paymentProcessingFees,
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
