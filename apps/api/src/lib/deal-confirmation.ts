import { schema } from "@showme/db";
import { eq } from "drizzle-orm";
import { conflict } from "../errors";

type DealRow = typeof schema.deals.$inferSelect;
type DealPartyRow = typeof schema.dealParties.$inferSelect;

/**
 * What happens when the LAST party signs an agreement — the half of confirmation
 * that is not "stamp my own line".
 *
 * `deals.agreement_status = 'confirmed'` is a claim that the terms are settled,
 * and `confirmed_snapshot` is the evidence for it: the live rows keep moving
 * (someone edits a guarantee, a share is renegotiated), and the snapshot is the
 * only record of what was actually agreed on the night. A deal that reaches
 * `confirmed` without one is a signed agreement with no signed terms, which is
 * exactly the record a settlement dispute needs and cannot get back.
 *
 * This module exists because there are now TWO ways to sign. `POST /deals/:did/confirm`
 * is the in-app one; `POST /shares/:token/approve` is the off-platform one, where
 * the signatory has no account at all. They differ entirely in how they decide WHO
 * may sign — that is the authorization question, and it stays in each route — and
 * must not differ by one line in what signing DOES.
 *
 * `routes/deals.ts` still carries its own copy of the freeze (it is not this
 * agent's file to change). `shares.test.ts` therefore signs the same deal both
 * ways and asserts the two snapshots are identical, so the duplication cannot
 * drift unnoticed until the in-app route is switched over to this function.
 */

/**
 * May a signature land on this agreement at all — the question that comes BEFORE
 * "whose line is it".
 *
 * `agreement_status` moves **draft → sent → confirmed** (decisions #1), and until
 * 2026-08-31 neither door checked it: a party could sign a deal that had never
 * been sent. A draft is terms nobody has been shown — the composer is still
 * editing them, `PATCH /deals/:did` moves the figures freely, and no party has
 * been told the agreement exists. A signature on one binds somebody to a document
 * that was never delivered, and `freezeDealSnapshot` then preserves it as the
 * record of what was agreed.
 *
 * The cost of leaving it open was not theoretical. The Create-Event wizard holds
 * its Undo timer IN FRONT of the send (`apps/web/src/hooks/useDealAutoSend.ts`)
 * rather than offering a retract afterwards, precisely because a counterparty
 * could sign inside a retract window — a workaround for this gap.
 *
 * `confirmed` and `signed` pass: on those, every signatory line already carries a
 * `confirmed_at`, so confirming again is the no-op the route promises (it is
 * idempotent per party) — not a transition, and nothing to refuse.
 *
 * **The manually-agreed ("Other — agreed manually", `structure: null`) kind is not
 * an exemption.** It is a paper agreement RECORDED here, and it is recorded the
 * same way as every other kind: created as a draft (no writer sets any other
 * initial status — `routes/deals.ts`, `routes/events.ts`), offered "Send to
 * parties" on the Deals tab whatever its structure, and already gated on `sent`
 * by the web app's own `dealActionsFor`. Sending is how the other side learns
 * there is something to countersign; a deal shoWMe does not COMPUTE is still a
 * deal shoWMe DELIVERS.
 */
export function assertAgreementSignable(deal: DealRow): void {
  if (deal.agreementStatus === "draft") {
    throw conflict("Only a sent agreement can be confirmed");
  }
}

/** Is this party a signatory? Observers watch the deal; they do not sign it. */
function isSignatory(party: DealPartyRow): boolean {
  return party.roleInDeal !== "observer";
}

/**
 * The frozen record of the terms and who signed them, as it is stored in
 * `deals.confirmed_snapshot` (jsonb). Money crosses as a STRING (money.md: minor
 * units past 2^53 are unsafe as a number).
 */
export function freezeDealSnapshot(deal: DealRow, parties: DealPartyRow[]) {
  return {
    frozenAt: new Date().toISOString(),
    terms: {
      type: deal.type,
      structure: deal.structure,
      currency: deal.currency,
      name: deal.name,
      guaranteeAmount: deal.guaranteeAmount != null ? deal.guaranteeAmount.toString() : null,
      advanceAmount: deal.advanceAmount != null ? deal.advanceAmount.toString() : null,
      splitBasisPoints: deal.splitBasisPoints,
      paymentTiming: deal.paymentTiming,
      terms: deal.terms,
      agreementBodyText: deal.agreementBodyText,
    },
    parties: parties.map((party) => ({
      participantId: party.participantId,
      roleInDeal: party.roleInDeal,
      share: party.share,
      confirmedAt: party.confirmedAt ? party.confirmedAt.toISOString() : null,
      confirmedBy: party.confirmedBy,
    })),
  };
}

/** True once every signatory line carries a `confirmed_at`. */
export function allSignatoriesConfirmed(parties: DealPartyRow[]): boolean {
  const signatories = parties.filter(isSignatory);
  return signatories.length > 0 && signatories.every((party) => party.confirmedAt != null);
}

/**
 * Advance the deal to `confirmed` and freeze its terms, IF this signature was the
 * last one outstanding. Returns the deal as it now stands — unchanged when the
 * agreement is still waiting on somebody, or when it was already frozen (both are
 * ordinary outcomes, not failures).
 *
 * Call it with the party rows AS THEY ARE AFTER the caller's own stamp, inside the
 * same transaction: the rollup is a question about current state, and asking it
 * against a stale read is how a deal ends up signed by everyone and confirmed by
 * nobody.
 *
 * **`deals.status` MOVES HERE TOO, and this is the only place in the product that
 * moves it forward.** The column had an enum (`draft | confirmed | cancelled`),
 * two readers, and no writer at all: it defaulted to `draft` and stayed there for
 * every deal any operator ever created, so `useBudgetSeed`'s "Performer fee"
 * heading was blank for all of them and the engine's status filter could only ever
 * be a filter on `cancelled`. It is written HERE rather than in either route for
 * the reason this module exists: two doors sign, and what signing DOES must not
 * differ between them by a line.
 *
 * The meaning is deliberately the SAME rollup the freeze uses — every signatory
 * stamped. `agreement_status` is the paperwork's position (draft → sent →
 * confirmed → signed); `status` is the deal's own (is this a live agreement, a
 * proposal, or a withdrawn one). They move together on this transition because on
 * this transition they say the same thing, and `reopen` puts both back.
 */
export async function confirmDealIfComplete(
  // biome-ignore lint/suspicious/noExplicitAny: Drizzle db/tx handle.
  tx: any,
  deal: DealRow,
  parties: DealPartyRow[],
  now: Date = new Date(),
): Promise<DealRow> {
  const alreadyFrozen = deal.agreementStatus === "confirmed" || deal.agreementStatus === "signed";
  if (alreadyFrozen || !allSignatoriesConfirmed(parties)) return deal;

  const [frozen] = await tx
    .update(schema.deals)
    .set({
      agreementStatus: "confirmed",
      // A WITHDRAWN DEAL IS NOT RESURRECTED BY A SIGNATURE. Cancelling does not
      // touch `agreement_status`, so a cancelled deal can still be sitting at
      // `sent` with a share link live — and walking it to `confirmed` here would
      // put it straight back into the settlement, undoing the one filter the
      // engine has (`routes/settlement.ts`, `ne(status, 'cancelled')`). The
      // agreement still freezes: the terms somebody signed are a record worth
      // keeping even when the deal they belonged to is gone.
      status: deal.status === "cancelled" ? "cancelled" : "confirmed",
      confirmedSnapshot: freezeDealSnapshot(deal, parties),
      version: deal.version + 1,
      updatedAt: now,
    })
    .where(eq(schema.deals.id, deal.id))
    .returning();
  return (frozen as DealRow | undefined) ?? deal;
}

/**
 * The agreement statuses that mean SIGNED — the ones a settlement may open on.
 *
 * `agreement_status` runs `draft → sent → confirmed → signed`, and the door has to
 * open on a state the product can actually reach. **`confirmed` is that state.** It
 * is written by `confirmDealIfComplete` above, on exactly the rollup
 * `allSignatoriesConfirmed` computes — every signatory line carrying a
 * `confirmed_at` — and it is the transition that freezes `confirmed_snapshot`. So
 * "confirmed" is not a weaker reading of "signed"; it IS every signature being in,
 * recorded with the terms they were given for.
 *
 * **`signed` alone would have closed the product.** Nothing writes it: the only
 * occurrences outside this set are `packages/db/seed.ts` and `seed-e2e.ts`, which
 * stamp it by hand. Requiring it would refuse every settlement of every event any
 * operator has ever run, which is the same class of catastrophe as `33e5742`. It
 * passes here because it is strictly downstream of `confirmed` — decisions #1 makes
 * e-signature "a later meaning-upgrade to `signature_hash`, zero schema change", so
 * a `signed` agreement is a `confirmed` one with better evidence, never a weaker one.
 */
const SIGNED_AGREEMENT_STATUSES: ReadonlySet<string> = new Set(["confirmed", "signed"]);

/** Is this agreement signed by everyone it needed? */
export function isAgreementSigned(deal: Pick<DealRow, "agreementStatus">): boolean {
  return SIGNED_AGREEMENT_STATUSES.has(deal.agreementStatus);
}

/**
 * **A SETTLEMENT CANNOT OPEN UNLESS THE DEAL IS SIGNED** (the product owner,
 * 2026-08-31). The precondition on `reconcileEvent`, and therefore on both doors
 * into the money: `POST /events/:id/settlement/compute` and
 * `POST /events/:id/settlement/finalize`.
 *
 * **Why a refusal at the door rather than a filter in the maths.** The alternative
 * — drop unsigned deals from the input and report what was dropped — was
 * considered and rejected. Dropping one pays its performer **zero** while
 * `Σ net = 0` still holds perfectly, because the operator's residual silently
 * absorbs the missing entitlement; nothing in the figures says an agreement went
 * missing. A refusal is legible and a zero inside a balanced settlement is not.
 * The point of the rule is that the failure never arises.
 *
 * **The set checked is the set the engine settles, by construction** — the caller
 * hands over the rows it read, after its own `ne(status, 'cancelled')` filter. So a
 * WITHDRAWN deal cannot hold the door shut: it is not an agreement anybody is
 * waiting on, and `reconcileEvent` already entitles nobody under it. The two can
 * never drift apart, because there is only one read.
 *
 * **A deal with no signatory at all is skipped, and that is not a hole.** An
 * all-`observer` deal can never reach `confirmed` — `allSignatoriesConfirmed`
 * returns false on an empty signatory list, by design — so gating on it would shut
 * the settlement permanently with no action that reopens it. It also entitles
 * nobody (the engine pays `payee` and `split_member` lines), so skipping it cannot
 * let money move under an unsigned agreement.
 *
 * **409, not 403.** The caller may absolutely run this settlement — they hold
 * `settlement.edit`, which the ceiling gives only to host/co_host. It is the
 * event's state that refuses, which is what `assertNotFinalized` and "Only a sent
 * agreement can be confirmed" both mean by a conflict.
 *
 * **The message names the deal.** An operator staring at a 409 has to know which
 * agreement and what it is waiting for, or the settlement is unopenable with no
 * diagnosis — the failure `unsettlableLine` exists to prevent one layer down. It
 * discloses deal names to a caller who might not be a party to every deal, which
 * is the same trade `unsettlableLine` already makes with settlement-line labels,
 * and for the same reason: the person running the night's reconciliation is the
 * person who has to go and chase the signature.
 */
export function assertEveryAgreementSigned(
  deals: readonly DealRow[],
  parties: readonly DealPartyRow[],
): void {
  const waiting = deals
    .filter((deal) => !isAgreementSigned(deal))
    .map((deal) => {
      const signatories = parties.filter((party) => party.dealId === deal.id && isSignatory(party));
      return { deal, signatories };
    })
    .filter(({ signatories }) => signatories.length > 0)
    // Ordered, so the same stuck event always reads the same way — an operator
    // comparing two attempts is comparing the agreements, not the row order
    // Postgres happened to return.
    .sort((left, right) => left.deal.name.localeCompare(right.deal.name))
    .map(({ deal, signatories }) => {
      if (deal.agreementStatus === "draft") {
        return `"${deal.name}" (${deal.id}) has not been sent to its parties`;
      }
      const outstanding = signatories.filter((party) => party.confirmedAt == null).length;
      return `"${deal.name}" (${deal.id}) is waiting on ${outstanding} of ${signatories.length} signature${signatories.length === 1 ? "" : "s"}`;
    });

  if (waiting.length === 0) return;
  throw conflict(
    `This settlement cannot open until every agreement on the event is signed: ${waiting.join("; ")}. Send each agreement and have its parties confirm it — or cancel one that is no longer happening — then run the settlement again.`,
  );
}
