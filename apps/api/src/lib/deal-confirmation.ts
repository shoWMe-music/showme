import { schema } from "@showme/db";
import { eq } from "drizzle-orm";

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
      confirmedSnapshot: freezeDealSnapshot(deal, parties),
      version: deal.version + 1,
      updatedAt: now,
    })
    .where(eq(schema.deals.id, deal.id))
    .returning();
  return (frozen as DealRow | undefined) ?? deal;
}
