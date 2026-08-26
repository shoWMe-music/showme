/**
 * The Budget Planner's PRO (Performing Rights Organisation) fee ESTIMATE.
 *
 * An operator who puts on a show owes the local PRO — STIM in Sweden, GEMA in
 * Germany, PRS in the UK — a royalty on the music performed. It is a real cost of
 * running the event, and an operator budgeting a show wants it in the picture
 * before they commit, which is why the planner shows it.
 *
 * ## Where the rate comes from
 *
 * A PRO tariff is a fact about a **TERRITORY**, so the rate is looked up by the
 * event's country (decisions.md #17: the `country` stamp is what drives "VAT, PRO
 * codes (STIM/GEMA/PRS), currency"). `performing_rights_rates` holds one row per
 * country, written by platform admins, and this module is the pure half: give it
 * the territory's row and it produces the estimate; give it nothing and it says
 * so.
 *
 * ## The two answers, and why the second one still exists
 *
 * - `territory_tariff` — a rate WAS configured for this country. The estimate
 *   carries the society's name and, when the admin recorded one, the published
 *   tariff it was read off. This is the case the feature exists for.
 * - `planning_default` — no rate is configured for this country, or the event has
 *   no country we can resolve. The figure falls back to a flat 6% and **says so**,
 *   exactly as it did before any tariff table existed.
 *
 * That second branch is deliberate and permanent. The alternative — quietly
 * charging 6% and labelling it a tariff — puts a number that looks like a quote in
 * front of somebody about to commit to a show, and the number is a guess. Silence
 * about the guess is the bug; the guess itself is fine.
 *
 * ## What is still not here
 *
 * **No filing.** `performance_reports` (PLAN.md:413) holds the operator's PRO
 * filing derived from a setlist, with a `pro_code` recipient and an `estimate`
 * column — and nothing in the API or the web app writes a row to it yet. A
 * configured rate names the society a show WOULD file with; it does not mean
 * shoWMe files anything. Nobody should send this figure to a rights body.
 */

import { applyBasisPoints } from "./money";

/**
 * 6.00% of ticket revenue. The design prototype's flat assumption (its
 * `computeBudget` used `ticketRev * 0.06`), and in the same region as the
 * live-performance tariffs the European PROs publish — which is why it is a usable
 * placeholder and NOT why it is correct for any given show. Used only when the
 * event's territory has no configured rate, and always reported as
 * `planning_default`.
 */
export const PERFORMING_RIGHTS_PLANNING_RATE_BASIS_POINTS = 600;

/**
 * The filing-recipient vocabulary, mirroring the `pro_code` Postgres enum
 * (`packages/db/src/schema/enums.ts`) and `performance_reports.pro_code`.
 *
 * It is short on purpose and it is NOT the list of societies we know about — the
 * country → society register in the web app names twenty. A code exists here only
 * where there is a filing destination of record; every other territory's rate
 * carries `none` as its code and names its society in `proName` instead. Widening
 * this enum is a claim that we can file with those societies, and that claim is
 * not true of any of them yet.
 */
export const PRO_CODES = ["stim", "gema", "prs", "none"] as const;

/** One of the known PRO filing codes. */
export type ProCode = (typeof PRO_CODES)[number];

/** Is `value` one of the four PRO filing codes? */
export function isProCode(value: string): value is ProCode {
  return (PRO_CODES as readonly string[]).includes(value);
}

/**
 * The configured tariff for one territory — one row of `performing_rights_rates`,
 * in the shape the estimate reads it.
 */
export interface PerformingRightsRate {
  /** ISO 3166-1 alpha-2, uppercase — the territory this tariff governs. */
  readonly country: string;
  /** The filing destination of record, or `none` where we have no code for it. */
  readonly proCode: ProCode;
  /** The society as it is written on the card — "STIM", "GEMA", "SACEM". */
  readonly proName: string;
  /** The rate itself, in basis points of the basis below. 600 = 6.00%. */
  readonly rateBasisPoints: number;
  /** The published tariff this rate was read off, when the admin recorded one. */
  readonly sourceUrl: string | null;
  /** Which tariff, in words — "Tariff M, live concerts, 2026". */
  readonly sourceNote: string | null;
}

/**
 * What the caller knows about where the show happens. `country` may be resolved
 * while `rate` is null (we know it is in France, nobody has configured France) —
 * and the estimate reports that as a different, more useful thing than "we do not
 * know where this show is".
 */
export interface PerformingRightsTerritory {
  /** ISO 3166-1 alpha-2, or null when the event's location cannot be resolved. */
  readonly country: string | null;
  /** The configured tariff for that country, or null when there is none. */
  readonly rate: PerformingRightsRate | null;
}

/** Where the rate in an estimate came from. */
export type PerformingRightsTariffSource = "territory_tariff" | "planning_default";

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
   * Where the rate came from. `planning_default` = nobody's published tariff, and
   * the card must keep saying so.
   */
  readonly tariffSource: PerformingRightsTariffSource;
  /** The territory the estimate was resolved for, or null when unresolved. */
  readonly country: string | null;
  /** The PRO this would be filed with; null on the planning default. */
  readonly proCode: ProCode | null;
  /** The society's name; null on the planning default. */
  readonly proName: string | null;
  /** The published tariff behind the rate, when the admin recorded one. */
  readonly sourceUrl: string | null;
  readonly sourceNote: string | null;
}

/**
 * The tariff governing a country, out of the rows the caller loaded, or null when
 * none of them do.
 *
 * Comparison is on the normalized alpha-2 code, so a row written as `se` and an
 * event resolved to `SE` are the same territory. Anything that is not a
 * two-letter code matches nothing — better a `planning_default` that admits it
 * than a rate attached to a country that does not exist.
 */
export function findPerformingRightsRate(
  country: string | null | undefined,
  rates: readonly PerformingRightsRate[],
): PerformingRightsRate | null {
  const normalized = normalizeTerritory(country);
  if (normalized === null) return null;
  return rates.find((rate) => normalizeTerritory(rate.country) === normalized) ?? null;
}

/**
 * The PRO fee an operator should budget for, and everything the screen needs to
 * qualify it.
 *
 * Called with no territory it behaves exactly as it always has: the flat planning
 * rate, declared as such. That is the signature the planner used before tariffs
 * existed, and it stays honest without a caller change.
 */
export function estimatePerformingRightsFee(
  ticketRevenue: bigint,
  territory?: PerformingRightsTerritory,
): PerformingRightsFeeEstimate {
  const country = normalizeTerritory(territory?.country);
  const rate = territory?.rate ?? null;

  if (rate === null) {
    return {
      fee: applyBasisPoints(ticketRevenue, PERFORMING_RIGHTS_PLANNING_RATE_BASIS_POINTS),
      rateBasisPoints: PERFORMING_RIGHTS_PLANNING_RATE_BASIS_POINTS,
      basis: "ticket_revenue",
      tariffSource: "planning_default",
      country,
      // Null, not `"none"`. `none` is a configured statement that a territory
      // files nowhere; null is the absence of any statement at all, and the card
      // has to be able to tell those apart.
      proCode: null,
      proName: null,
      sourceUrl: null,
      sourceNote: null,
    };
  }

  return {
    fee: applyBasisPoints(ticketRevenue, rate.rateBasisPoints),
    rateBasisPoints: rate.rateBasisPoints,
    basis: "ticket_revenue",
    tariffSource: "territory_tariff",
    // The rate's own country, not the caller's: they are the same country by
    // construction (`findPerformingRightsRate` matched them), and preferring the
    // stored row keeps the estimate agreeing with the row an admin can go and edit.
    country: normalizeTerritory(rate.country) ?? country,
    proCode: rate.proCode,
    proName: rate.proName,
    sourceUrl: rate.sourceUrl,
    sourceNote: rate.sourceNote,
  };
}

/** Uppercase alpha-2, or null for anything that is not one. */
function normalizeTerritory(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(trimmed) ? trimmed : null;
}
