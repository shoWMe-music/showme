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

/**
 * DOES THIS RENTAL COME OFF THE TOP, or settle between its two parties?
 * (decisions §25.7.1, Daniel 2026-09-28.)
 *
 * **The pool pays a rental only when the pool is what owes it and the money leaves the pool side.**
 * In data: no payer named, or a payer who shares the event's residual paying somebody who does not.
 * That is #24.1's case — the show paying for its room — and the only shape in which calling the room
 * a cost of the night, shared by everyone dividing the night, is true. Everything else with a named
 * payer is a transfer between its parties and the adjusted net never sees it.
 *
 * **IT LIVES HERE BECAUSE TWO CODEBASES ASK IT, AND ONE OF THEM ASKED IT WRONG FOR AN HOUR**
 * (QA sweep run 10, QA10-1). `reconcile()` was changed to branch on this and the **Budget Planner
 * was not**, so on a night with a co-operator's room hire the planner quoted the act
 * **SEK 70,000** and the settlement paid **SEK 73,500** — a gap of exactly the SEK 3,500 §25.7.1's
 * own hand-check names as the act's movement. The window is the negotiation window: terms are agreed
 * against the forecast and the difference surfaces at settlement.
 *
 * `budget-planning.ts` had already written down the rule I broke — *"the Budget Planner moves with
 * the engine, in the same commit … a split would otherwise have quoted the forecast one fee and the
 * settlement another"* — which makes this the thirteenth instance of **a comment that states a rule
 * is a test that never runs**, and the first where the comment was specifically about the mistake
 * being made. A shared predicate is the only version of that promise that cannot be forgotten.
 *
 * @param rental the rental deal's two ends — a payer, if the deal names one, and its payees
 * @param operatorParticipantIds the participants who share the event's residual (host and co-hosts)
 */
export function rentalComesOffTheTop(
  rental: { payerParticipantId?: string; payeeParticipantIds: readonly string[] },
  operatorParticipantIds: ReadonlySet<string>,
): boolean {
  if (rental.payerParticipantId === undefined) return true;
  return (
    operatorParticipantIds.has(rental.payerParticipantId) &&
    !rental.payeeParticipantIds.some((payee) => operatorParticipantIds.has(payee))
  );
}
