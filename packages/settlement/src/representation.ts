import { applyBasisPoints } from "@showme/shared";

/**
 * A private agent↔performer commission settlement (decisions #14), in `bigint`
 * minor units of the deal's payout currency. Runs SEPARATELY from the event
 * settlement — the event keeps the performer at full gross, so its `Σ net = 0`
 * has no hidden term. Resolved PER entitled deal-party line (a split deal
 * produces one of these per agented performer).
 */
export interface RepresentationInput {
  /**
   * THE COMMISSIONABLE INCOME this deal line produces — not the performer's
   * entitlement, which is a different figure on the same night.
   *
   * It was called `performerEntitlement` and measured 2026-09-26 on one API response:
   * `commissions[0].performerEntitlement` SEK 32,100 next to
   * `settlements[Marlo].computed.entitlement` SEK 33,600 — two fields named for the
   * same thing, SEK 1,500 apart (QA sweep run 2, r2:603). The engine's base is
   * `entitlement + deductibles`, which decisions #14 calls commissionable income, and
   * that is what the name now says. WHAT the base should be is still a product call
   * (ClickUp `86cba8wtb`); what it is called is not.
   */
  commissionableIncome: bigint;
  /** Commission as basis points of commissionable income (4000 = 40.00%). */
  commissionBasisPoints: number;
  /** True → the agent is the payout destination and collected the gross on the performer's behalf. */
  agentCollects: boolean;
}

export type CommissionParty = "performer" | "agent";

export interface RepresentationSettlement {
  commission: bigint;
  /** The single transfer that settles the commission, or null when nothing is owed. */
  transfer: { from: CommissionParty; to: CommissionParty; amount: bigint } | null;
}

/**
 * Direction follows who held the cash:
 * - performer collected → performer owes the agent the commission.
 * - agent collected (`agentCollects`) → agent owes the performer `gross − commission`.
 * The performer always stays the entitled party; `agentCollects` only redirects
 * the payout destination.
 */
export function settleRepresentation(input: RepresentationInput): RepresentationSettlement {
  const commission = applyBasisPoints(input.commissionableIncome, input.commissionBasisPoints);

  if (input.agentCollects) {
    const owedToPerformer = input.commissionableIncome - commission;
    return {
      commission,
      transfer:
        owedToPerformer > 0n ? { from: "agent", to: "performer", amount: owedToPerformer } : null,
    };
  }

  return {
    commission,
    transfer: commission > 0n ? { from: "performer", to: "agent", amount: commission } : null,
  };
}
