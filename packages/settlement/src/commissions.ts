import { applyBasisPoints } from "@showme/shared";
import type { CommissionMode, DisclosedCommission } from "./types";

/** What one commission party earns out of one payee's line, in minor units. */
export interface CommissionCharge {
  participantId: string;
  amount: bigint;
}

export interface CommissionOutcome {
  /** What the payee keeps after every commission on the deal. */
  payeeAmount: bigint;
  /** What each commission party earns. `payeeAmount + Σ charges === lineAmount`, exactly. */
  charges: CommissionCharge[];
}

/**
 * DISCLOSED commissions on one entitled line — the whole arithmetic, in one place.
 *
 * Scope: this is the **disclosed** commission, an entitled `deal_party` with
 * `role_in_deal = 'commission'` that every party to the deal can see. A booking
 * **agent**'s private representation commission is NOT this and must never be
 * expressed as a deal party — it is a second, representation-scoped settlement
 * between agent and performer (`representation.ts`, decisions.md #14), so the
 * event keeps the performer at full gross and its `Σ net = 0` carries no hidden
 * term.
 *
 * Applied PER ENTITLED LINE, not per deal: on a split deal each payee's own
 * portion is commissioned, which is what makes a shared split show each performer
 * only their own line.
 *
 * ## Both stacking rules, chosen per deal
 *
 * With two commissions of 20% and 10% on a 1 000 line, there are two defensible
 * answers:
 *
 * | | first | second | payee |
 * |---|---|---|---|
 * | **`parallel`** — each takes its cut of the same base | 200 | 100 | 700 |
 * | **`cascading`** — the second takes its cut of what is left | 200 | 80 | 720 |
 *
 * The documents disagreed with each other: `docs/money.md` said cascading, the
 * `settlement` skill read as parallel, and the reference app cascades
 * (`../showme-settle-fast` `src/lib/models.ts:490-491`). The product owner's
 * answer (2026-08-26, ClickUp **`86cba8wmb`**) was that **it depends on the shape
 * of the deal** — which means neither is "the rule", and picking one globally
 * would have been wrong whichever we picked. So `deals.commission_mode` carries
 * it and both work.
 *
 * `parallel` is the default because it is what the engine always did — every deal
 * that predates the column settles to the identical figure — and because it is
 * ORDER-INDEPENDENT. Cascading makes the payout depend on the sequence the
 * commission parties sit in, so it is the one that has to be asked for. When it
 * IS asked for, the order is `reconcile()`'s existing sort by participant id, so
 * the result is at least stable and reproducible across recomputes rather than
 * following insertion accident.
 *
 * Conservation is independent of the choice: the payee is credited with
 * `lineAmount − Σ charges` rather than a separately-rounded figure, so the line is
 * partitioned exactly however the cuts round and `Σ net = 0` survives both ways.
 */
export function applyCommissions(
  lineAmount: bigint,
  commissions: readonly DisclosedCommission[] | undefined,
  mode: CommissionMode = "parallel",
): CommissionOutcome {
  const charges: CommissionCharge[] = [];
  // The base the NEXT cut is taken from. Under `parallel` it never moves; under
  // `cascading` each charge lowers it. One loop, because the only difference
  // between the two rules is which number is handed to `applyBasisPoints`.
  let base = lineAmount;
  for (const commission of commissions ?? []) {
    const amount = applyBasisPoints(base, commission.basisPoints);
    charges.push({ participantId: commission.participantId, amount });
    if (mode === "cascading") base -= amount;
  }
  const charged = charges.reduce((running, charge) => running + charge.amount, 0n);
  return { payeeAmount: lineAmount - charged, charges };
}
