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

/**
 * Whether an amount is a RATE PER HEAD or a SUM FOR THE NIGHT.
 *
 * The prototype puts this on every other-revenue row as a control, and until now
 * ours was hardcoded: the bar and merch were always per head, other revenue was
 * always flat. A bar MINIMUM — "the venue guarantees 40,000 over the bar
 * whatever the room does" — is an ordinary deal term and could not be expressed
 * at all; typing it as a per-head rate made it scale with attendance, which is
 * the one thing a guarantee does not do.
 *
 * It matters beyond the total: a per-head row belongs in `contributionPerHead`
 * and a flat one in `standingRevenue`, and break-even is solved from those two.
 * Getting the basis wrong moves the break-even, not just a figure.
 */
export type RevenueBasis = "per_guest" | "flat";

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
  /**
   * Average spend per head on MERCH, times the same heads.
   *
   * A field of its own, and not a share of `averageBarSpend`, because the two
   * takes belong to different people. ClickUp `86cbcn1ue`, 2026-09-03: *"Bar and
   * merchandise can not be together."* He is right at the level that matters
   * here — the bar is almost always the venue's income and merch is almost
   * always the performer's, frequently with a percentage back to the venue. One
   * line cannot carry two collectors, so a single "Bar and merchandise" row had
   * to attribute both takes to whoever the bar belonged to, and the settlement
   * then moved the performer's merch money to the venue without anybody saying
   * so.
   *
   * Optional so that every existing caller — and every budget written before the
   * split — keeps computing exactly the number it did before.
   */
  readonly averageMerchSpend?: bigint;
  /**
   * How to read `averageBarSpend` / `averageMerchSpend`. Absent means `per_guest`,
   * which is what every budget written before this field meant, so nothing
   * recomputes.
   */
  readonly barBasis?: RevenueBasis;
  readonly merchBasis?: RevenueBasis;
  readonly capacity: number;
  /** Revenue that is neither ticketing, bar nor merch (sponsorship, a fee, a grant). */
  readonly otherRevenue: bigint;
  /** How to read `otherRevenue`. Absent means `flat`, as it always was. */
  readonly otherRevenueBasis?: RevenueBasis;
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
  /** Merch take — per head times capacity, like the bar and separate from it. */
  readonly merchRevenue: bigint;
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
  /**
   * Revenue that arrives whether or not a ticket sells — the standing other-revenue
   * row plus every custom row. The break-even line's intercept, and the ONLY
   * revenue that offsets a fixed cost rather than riding on attendance.
   */
  readonly standingRevenue: bigint;
  /**
   * Bar + merch spend for ONE head, as rates rather than totals. Totals are zero
   * on a half-typed form (no tier has a quantity yet), but the rates are known
   * from the moment they are typed, and the chart needs the slope before it has
   * a forecast to draw against.
   */
  readonly perHeadRevenue: bigint;
  /** What selling one more ticket costs: the provider's cut of it, plus the flat charge. */
  readonly variableCostPerTicket: bigint;
  /**
   * What one more guest leaves behind: ticket price + per-head revenue, less the
   * variable cost of selling to them. Non-positive means there is no break-even
   * at any attendance, which is why `breakEvenTickets` is 0 in that case.
   */
  readonly contributionPerHead: bigint;
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
  /**
   * ATTENDEES, NOT CAPACITY — the bug this block used to carry.
   *
   * Bar and merch are spend PER HEAD, so they arrive with the people who turn
   * up, not with the seats the room happens to have. Multiplying by `capacity`
   * credited a sold-out bar to a plan that expects 1 280 of 1 600, inflating
   * revenue and profit at the plan and understating break-even underneath it.
   * The old comment defended it as "money in hand before a ticket sells" — true
   * of a sponsorship, false of a bar take, and that conflation is what put a
   * per-head figure on a fixed footing.
   *
   * `capacity` still bounds the CHART's x-axis; it no longer decides how many
   * people bought a drink.
   */
  const attendees = BigInt(ticketsSold);
  // A row's amount is a rate times the heads, or the whole sum once. Defaults
  // preserve what each row has always meant.
  const perGuest = (basis: RevenueBasis | undefined, fallback: RevenueBasis) =>
    (basis ?? fallback) === "per_guest";
  const barIsPerGuest = perGuest(inputs.barBasis, "per_guest");
  const merchIsPerGuest = perGuest(inputs.merchBasis, "per_guest");
  const otherIsPerGuest = perGuest(inputs.otherRevenueBasis, "flat");

  const merchSpend = inputs.averageMerchSpend ?? 0n;
  const barRevenue = barIsPerGuest ? inputs.averageBarSpend * attendees : inputs.averageBarSpend;
  const merchRevenue = merchIsPerGuest ? merchSpend * attendees : merchSpend;
  const otherRevenue = otherIsPerGuest ? inputs.otherRevenue * attendees : inputs.otherRevenue;
  const customRevenue = sum(inputs.customRevenue ?? []);
  /**
   * Money that genuinely arrives whether or not a ticket sells — so only the rows
   * whose basis says so. This is the half of the basis that break-even reads: a
   * flat bar minimum covers fixed costs from the first ticket, where a per-head
   * bar take only arrives as guests do.
   */
  const standingRevenue =
    (otherIsPerGuest ? 0n : inputs.otherRevenue) +
    (barIsPerGuest ? 0n : inputs.averageBarSpend) +
    (merchIsPerGuest ? 0n : merchSpend) +
    customRevenue;
  const totalRevenue = ticketRevenue + barRevenue + merchRevenue + otherRevenue + customRevenue;
  const enteredCosts = sum(inputs.costs);
  // The provider charges on the tickets it sells, so the percentage is taken on
  // TICKET revenue only — not on the bar or merch take, nor a sponsorship, none
  // of which pass through it. Charging the whole revenue would inflate the fee on
  // exactly the shows whose margin comes from the bar.
  const paymentProcessingFees = inputs.paymentProcessing
    ? applyBasisPoints(ticketRevenue, inputs.paymentProcessing.percentBasisPoints) +
      inputs.paymentProcessing.flatPerTicket * BigInt(ticketsSold)
    : 0n;
  const totalCosts = enteredCosts + paymentProcessingFees;
  const profit = totalRevenue - totalCosts;

  const averageTicketPrice =
    ticketsSold > 0 ? divideRounded(ticketRevenue, BigInt(ticketsSold)) : 0n;

  /**
   * BREAK-EVEN IS SOLVED, NOT DIVIDED.
   *
   * Every term that moves with attendance has to be evaluated at the attendance
   * being solved for — which the previous version did not do. It divided by the
   * ticket price alone, after subtracting a bar take counted at capacity and
   * adding processing fees counted at the PLANNED ticket count. Both are
   * functions of `t` frozen at the wrong `t`, and the answer moved whenever the
   * forecast did, which is the tell that it was wrong: break-even is a property
   * of the economics, not of the plan.
   *
   * So: contribution per head — what one more guest leaves behind after the
   * variable cost of selling to them — against the costs that genuinely do not
   * move, less the revenue that genuinely does not either.
   *
   *   contribution = price + bar + merch − (provider % of price + flat per ticket)
   *   break-even   = ceil((fixed costs − standing revenue) / contribution)
   *
   * A non-positive contribution means every extra guest loses money: there is no
   * break-even, and 0 says so (the screen renders that as "no break-even", never
   * as "none needed").
   */
  const variableCostPerTicket = inputs.paymentProcessing
    ? applyBasisPoints(averageTicketPrice, inputs.paymentProcessing.percentBasisPoints) +
      inputs.paymentProcessing.flatPerTicket
    : 0n;
  const perHeadRevenue =
    (barIsPerGuest ? inputs.averageBarSpend : 0n) +
    (merchIsPerGuest ? merchSpend : 0n) +
    (otherIsPerGuest ? inputs.otherRevenue : 0n);
  const contributionPerHead = averageTicketPrice + perHeadRevenue - variableCostPerTicket;
  const uncovered = enteredCosts - standingRevenue;
  let breakEvenTickets = 0;
  if (contributionPerHead > 0n && uncovered > 0n) {
    // Ceiling division: a part ticket is a whole ticket, because half a guest
    // does not buy half a drink.
    breakEvenTickets = Number((uncovered + contributionPerHead - 1n) / contributionPerHead);
  }

  const marginPercent = totalRevenue > 0n ? (Number(profit) / Number(totalRevenue)) * 100 : 0;
  // Per GUEST: the people who came, not the seats that exist (see `attendees`).
  const guests = attendees > 0n ? attendees : 1n;

  return {
    ticketRevenue,
    barRevenue,
    merchRevenue,
    customRevenue,
    totalRevenue,
    enteredCosts,
    paymentProcessingFees,
    totalCosts,
    profit,
    ticketsSold,
    averageTicketPrice,
    breakEvenTickets,
    standingRevenue,
    perHeadRevenue,
    variableCostPerTicket,
    contributionPerHead,
    marginPercent,
    revenuePerGuest: totalRevenue / guests,
    costPerGuest: totalCosts / guests,
  };
}

/** A row marked as a deal's own figure, and the deal it disagrees with. */
export interface DealFigureDisagreement {
  /** What the planner is forecasting — the figure typed on the budget row. */
  readonly planned: bigint;
  /** What the settlement will actually use — the deal's own amount. */
  readonly deal: bigint;
}

/**
 * A budget row that CLAIMS to be a deal's own figure but states a different one.
 *
 * The dangerous silence this closes: a row assigned to a deal as *"this IS the
 * deal's figure"* is dropped at the settlement boundary, because the deal is the
 * authority on what the deal pays. So the operator plans against the number on
 * the row and gets settled on the number in the deal. When those two drift apart
 * — a fee renegotiated on the deal after the budget was written, or a placeholder
 * typed while the terms were still being argued — nothing anywhere said so. The
 * planner simply forecast one figure while the settlement stood ready to move
 * another.
 *
 * Both sides are MINOR UNITS as bigint, and compared as integers (money.md).
 * Never format first and compare strings: `3000` and `3,000` and `3000.00` are
 * the same money and three different strings, and a rounded display figure would
 * hide a disagreement of up to half a unit — which is the one comparison this
 * function exists to get right.
 *
 * `null` when there is nothing to warn about: the amounts agree, or the deal
 * states no amount of its own (a pure split has no figure to disagree with).
 */
export function dealFigureDisagreement(
  planned: bigint,
  deal: bigint | null | undefined,
): DealFigureDisagreement | null {
  if (deal == null) return null;
  if (planned === deal) return null;
  return { planned, deal };
}
