/**
 * The Budget Planner's PRO (Performing Rights Organisation) fee ESTIMATE.
 *
 * An operator who puts on a show owes the local PRO — STIM in Sweden, GEMA in
 * Germany, PRS in the UK — a royalty on the music performed. It is a real cost of
 * running the event, and an operator budgeting a show wants it in the picture
 * before they commit, which is why the planner shows it.
 *
 * WHAT SHOWME DOES NOT HAVE, and this module refuses to pretend otherwise:
 *
 *   - **No tariff data.** PRO tariffs are per-country and per-event-type
 *     (decisions #17: the `country` stamp drives "VAT, PRO codes (STIM/GEMA/PRS),
 *     currency"), they are negotiated by venue and updated yearly, and not one of
 *     them is in this repository. There is no rate table to look a real number up
 *     in.
 *   - **No filing.** `performance_reports` (PLAN.md:413) holds the operator's PRO
 *     filing derived from a setlist, with a `pro_code` recipient and an `estimate`
 *     column — and nothing in the API or the web app writes a row to it yet. So
 *     this event has no PRO of record either.
 *
 * Therefore the figure below is a PLANNING PLACEHOLDER at a single flat rate,
 * carried over from the design prototype (its `computeBudget` used
 * `ticketRev * 0.06`). It is returned WITH the facts that qualify it — the rate,
 * what the rate is charged on, that no territory tariff was consulted and that no
 * PRO is named — so the screen can state its assumptions rather than print a
 * number that looks like a quote. Nobody should send this to a rights body.
 *
 * When tariffs land (a `pro_tariffs` table keyed by country + event type, fed from
 * the venue's `profile_locations.country`), this function grows a territory
 * argument and `tariffSource` stops being `planning_default`. The shape of the
 * return value is built for that day.
 */

import { applyBasisPoints } from "./money";

/**
 * 6.00% of ticket revenue. The prototype's flat assumption, and in the same
 * region as the live-performance tariffs the European PROs publish — which is
 * why it is a usable placeholder and NOT why it is correct for any given show.
 */
export const PERFORMING_RIGHTS_PLANNING_RATE_BASIS_POINTS = 600;

export interface PerformingRightsFeeEstimate {
  /** The estimate itself, in minor units. */
  readonly fee: bigint;
  readonly rateBasisPoints: number;
  /**
   * What the rate is charged on. Ticket revenue only: a PRO royalty is levied on
   * the performance, so bar takings and sponsorship are outside it.
   */
  readonly basis: "ticket_revenue";
  /**
   * Where the rate came from. `planning_default` = nobody's published tariff — the
   * only possible value until tariff data exists.
   */
  readonly tariffSource: "planning_default";
  /**
   * The PRO this would be filed with, once an event has one (`performance_reports`
   * is unwritten, so today this is always null and the screen must say so).
   */
  readonly proCode: null;
}

export function estimatePerformingRightsFee(ticketRevenue: bigint): PerformingRightsFeeEstimate {
  return {
    fee: applyBasisPoints(ticketRevenue, PERFORMING_RIGHTS_PLANNING_RATE_BASIS_POINTS),
    rateBasisPoints: PERFORMING_RIGHTS_PLANNING_RATE_BASIS_POINTS,
    basis: "ticket_revenue",
    tariffSource: "planning_default",
    proCode: null,
  };
}
