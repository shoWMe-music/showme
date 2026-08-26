import { applyBasisPoints } from "@showme/shared";
import type { DisclosedCommission } from "./types";

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
 * ## Parallel today — and the one place to change it
 *
 * With two commissions of 20% and 10% on a 1 000 line, there are two defensible
 * answers:
 *
 * | | first | second | payee |
 * |---|---|---|---|
 * | **PARALLEL** (today) — each takes its cut of the same base | 200 | 100 | 700 |
 * | **CASCADING** — the second takes its cut of what is left | 200 | 80 | 720 |
 *
 * The documents disagree with each other: `docs/money.md` says cascading, the
 * `settlement` skill says off-the-top (which reads as parallel), and the reference
 * app cascades (`../showme-settle-fast` `src/lib/models.ts:490-491`). The product
 * owner's answer (2026-08-26) is that it depends on the shape of the deal, and the
 * decision is parked in ClickUp **`86cba8wmb`**. So this keeps **today's parallel
 * behaviour** rather than silently picking the other one, and concentrates the
 * arithmetic here: switching is replacing the body of the loop below with a
 * running remainder — no caller changes, because the outcome shape is the same.
 *
 * Conservation is independent of that choice: the payee is credited with
 * `lineAmount − Σ charges` rather than a separately-rounded figure, so the line is
 * partitioned exactly however the cuts round and `Σ net = 0` survives.
 */
export function applyCommissions(
  lineAmount: bigint,
  commissions: readonly DisclosedCommission[] | undefined,
): CommissionOutcome {
  const charges: CommissionCharge[] = (commissions ?? []).map((commission) => ({
    participantId: commission.participantId,
    // ClickUp 86cba8wmb — cascading would read `remainder` here instead of `lineAmount`.
    amount: applyBasisPoints(lineAmount, commission.basisPoints),
  }));
  const charged = charges.reduce((running, charge) => running + charge.amount, 0n);
  return { payeeAmount: lineAmount - charged, charges };
}
