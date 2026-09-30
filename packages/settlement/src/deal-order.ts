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
 * WHO BEARS THIS DEAL — the named payer, or the pool? (decisions §25.9.6 and §25.9.12.)
 *
 * **The pool bears a deal only when nobody is named to bear it.** A deal that names a payer who is a
 * party on the event is a movement between its two parties, and the pool never sees it.
 *
 * ONE PREDICATE FOR EVERY DEAL, and it took two rulings to get here:
 *
 * - §25.7.1 (2026-09-28) settled a RENTAL as a transfer when its payer is a party on the event, and
 *   deliberately left #24.1's *the show pays for its room* case alone — so the rule also asked
 *   whether the payer shared the residual and the payee did not.
 * - §25.9.12 (2026-09-29) **overrules that exception, by its author**: the condition drops, so
 *   whoever signed the room hire bears it, always. `theShowPaysForItsRoom` is now just *"nobody was
 *   named"*.
 * - §25.9.6 (same day) extends the same rule to NON-rental deals, which had no branch that charged
 *   their payer at all: a SEK 4,000 guarantee signed by one operator was funded by the pool, so a
 *   co-host bore SEK 1,200 of a contract it is a party to in no role. Measured three times, three
 *   splits, one shape.
 *
 * So the question stopped being about rentals and became *"did anybody say who owes this?"*, which
 * is one line and cannot disagree with itself.
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
 * IT DOES NOT CHECK THE PAYER IS ON THE EVENT, deliberately. The first version of this returned
 * `null` for a payer nobody recognises — which reads as "the pool bears it" and quietly makes the
 * books right by making them wrong, on exactly the malformed data that most needs saying out loud.
 * `settleDeal` already refuses an unrecognised `chargeTo` by name, and one loud guard in one place
 * beats two opinions about the same data. (Caught by the test that pins that refusal, which failed
 * the moment this function started swallowing it.)
 *
 * THREE READERS, ONE LINE: the rental pass, the non-rental pass, and the Budget Planner — which has
 * to forecast the same fee. For one hour it did not (QA sweep run 10, QA10-1): `reconcile()` was
 * changed to branch on the payer and the planner was not, so on an event with a co-host's room hire
 * the planner quoted the performer **SEK 70,000** and the settlement paid **SEK 73,500**. The window
 * is the negotiation window — terms are agreed against the forecast and the gap surfaces at
 * settlement. `budget-planning.ts` had already written that rule down in a comment, which made it
 * the thirteenth instance of *a comment that states a rule is a test that never runs*, and the first
 * where the comment was about the very mistake being made.
 *
 * ── AND IT APPLIES TO A PERCENTAGE DEAL TOO (§25.9.6 answered, Daniel 2026-09-30) ─────────────────
 *
 * For one day this function carried a `statedSumOnly` option that answered `null` for anything but a
 * `guarantee`, because the three measurements behind §25.9.6 were all a stated sum and a door
 * split's payee is entitled to *a share of the pool* — so "charge the payer and leave the pool
 * alone" read as close to self-contradictory. The two settlements were computed side by side on the
 * seeded Album Release and put to Daniel rather than guessed.
 *
 * **He ruled the broad reading**, and named the principle: *"it should work as intended — so if the
 * payer bears it, then it needs to be deducted somehow somewhere, that's what the settlement engine
 * should figure out, the balance."* Which is exactly what `settleDeal` already does: the payer's
 * entitlement is debited the deal's whole total (`credit(chargeTo, -total)`) and gets its own
 * negative line, so the deal nets to zero out of `dealBaseSum` and `Σ net = 0` holds without the
 * pool ever funding it. The bookkeeping was never the open part.
 *
 * **WHAT IT MOVES, recorded because it is large and it was weighed.** A payer-borne deal stops
 * claiming the pool, so the residual grows by its total and the payer's own line carries it. The
 * operators' COMBINED position is unchanged — residual `pool` less a debit of `total` is the same
 * `pool − total` they shared before — but its DISTRIBUTION is not. On the seeded Album Release (pool
 * 50,000.00, a door split taking all of it, equal residual shares) the host goes from −50,000.00 to
 * −75,000.00 and the co-host from 0.00 to **+25,000.00**. On a 50% split under a 70/30 residual the
 * co-host goes from 0.15 of the pool to 0.30. **A co-host that is not a party to the deal no longer
 * contributes to the talent, and takes a larger share of the door instead.** That is the arrangement
 * the ruling chose: whoever signed the act pays the act, and the operator who did not sign shares
 * only the revenue.
 *
 * So the question this function asks is one line for every structure — *"did anybody say who owes
 * this?"* — and `guarantee_vs_door` stops being the awkward case it was under the narrow reading,
 * where the same agreement would have changed who bears it according to ticket sales.
 *
 * **The one asymmetry left, deliberately.** The Budget Planner's use of this predicate is scoped to
 * RENTALS (`useBudgetSeed.ts`), because its `operatorRemainderMinor` is a single lump for all
 * operators and the combined figure does not move — see above. It does not forecast a PER-OPERATOR
 * residual, so there is nothing there for this ruling to disagree with. The day it does, it has to
 * ask this function per operator, and that is the QA10-1 shape all over again.
 *
 * @param deal the deal's payer, if it names one
 * @returns the participant who bears it, or `null` when the pool bears it
 */
export function dealBorneBy(deal: { payerParticipantId?: string }): string | null {
  return deal.payerParticipantId ?? null;
}
