import type { SettlementDeal } from "./types";

/**
 * WHICH DEALS SETTLE **OFF THE TOP** — before the percentage deals divide what is
 * left.
 *
 * A venue rental is not one claim on the pool among several; it is the cost of
 * having the room at all, and the industry meaning of "net door" is *after* the
 * rental. The reference app got this right (`../showme-settle-fast`
 * `src/lib/models.ts:368` — `adjustedNet = netRevenue − venueRental`, then `:437`
 * splits `adjustedNet`), and we did not: every deal used to be computed against
 * the same pool, so a 50% door performer took half of money the venue's rental
 * had already claimed. On a 10 000 pool with a 2 000 rental that is 5 000 to the
 * performer where the contract says 4 000 — a 1 000 error on a routine event.
 *
 * The rule the product owner settled (2026-08-26): **`structure = "rental"`, and
 * only that.** A fixed-amount deal that is not a rental keeps dividing the same
 * pool as everyone else.
 *
 * **The seam, deliberately left open.** Whether a deal with `priority > 0` should
 * ALSO settle off the top is an open decision parked in ClickUp **`86cba8wfk`**
 * (`deals.priority` exists in the schema and its comment reads "rental /
 * before-event settle first" — two different criteria in one line). Nothing here
 * reads `priority` today, and `SettlementDeal` deliberately carries no `priority`
 * member so no caller can half-wire it. When that decision lands, this predicate
 * is the only thing that changes: add the term here, add the field to
 * `SettlementDeal`, map it in `reconcileEvent`. The two-phase structure in
 * `reconcile()` needs no restructuring for it.
 */
export function isOffTheTop(deal: SettlementDeal): boolean {
  return deal.structure === "rental";
}
