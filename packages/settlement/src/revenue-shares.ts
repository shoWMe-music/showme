import { applyBasisPoints } from "@showme/shared";
import type { SettlementBudgetLine } from "./types";

/**
 * WHO A REVENUE LINE BELONGS TO — the mirror of `cost-bearing.ts`, and the second
 * half of decision #23.
 *
 * #23.1 says bar and merch "belong to whoever collects them — the venue's bar, the
 * act's merch". Until this module the engine did not implement that sentence: every
 * revenue line landed in the pool whatever `collected_by` said, so a venue that ran
 * its own bar was credited nothing and held the cash, and `net = entitlement − held`
 * made it OWE the operator its own bar take. The books balanced perfectly while
 * describing the wrong world — which is why nothing caught it.
 *
 * Two rules, and the first is the default:
 *
 * | Who collected it | What happens |
 * |---|---|
 * | an **operator**, or nobody named | it reaches the pool, exactly as before, and the operator's residual carries it |
 * | **anyone else** | it is that party's own income: they are entitled to it and the pool never sees it |
 *
 * A non-operator's line therefore settles to `net = 0` — they keep what they took,
 * and no transfer is written for money that was never the event's.
 *
 * #23.2's REVENUE SHARE then moves named slices off the top of either kind: "10% of
 * the bar to the act", "a cut of merch back to the venue". A share is not a cost —
 * it changes nobody's totals, only who the money is attributed to, which is exactly
 * how the design brief words it: *"These move money between parties at settlement.
 * They do not change the event's total revenue or costs."*
 *
 * The door split is deliberately NOT expressed here even though it is the same
 * shape. It is written on the deal, along with the guarantee and the escalator
 * tiers, and that is where settlement reads it from — two writable homes for one
 * number is the drift this rebuild exists to delete (#23.2).
 */
export interface RevenueShare {
  /** The party the slice moves TO. */
  toParticipantId: string;
  /**
   * Basis points OF THE WHOLE LINE — 1 000 = 10%. Mutually exclusive with
   * `amount`; `amount` wins if both are somehow present, because a figure someone
   * typed is more likely to be what they meant than a percentage left behind.
   */
  basisPoints?: number;
  /** A fixed slice in minor units, clamped to what is left of the line. */
  amount?: bigint;
}

/**
 * The slices a revenue line gives away, per recipient.
 *
 * Percentages are taken of the LINE TOTAL rather than of what previous shares left,
 * so entering two parties in the other order cannot change what either is paid —
 * the same order-independence `commissionMode` defaults to, and for the same
 * reason. What IS sequential is the clamp: each slice is capped at the remainder,
 * so however the shares are written they can never sum past the line. That is the
 * rule the design states outright (`Math.min(value, src.total)`), generalised to
 * several shares.
 *
 * Returns an empty map for a cost line, or a revenue line that gives nothing away.
 */
export function revenueSharesOf(line: SettlementBudgetLine): Map<string, bigint> {
  const slices = new Map<string, bigint>();
  if (line.kind !== "revenue" || !line.revenueShares?.length) return slices;

  let remaining = line.amount > 0n ? line.amount : 0n;
  for (const share of line.revenueShares) {
    const requested =
      share.amount != null ? share.amount : applyBasisPoints(line.amount, share.basisPoints ?? 0);
    const slice = requested < 0n ? 0n : requested > remaining ? remaining : requested;
    if (slice > 0n) {
      slices.set(share.toParticipantId, (slices.get(share.toParticipantId) ?? 0n) + slice);
      remaining -= slice;
    }
  }
  return slices;
}

/**
 * Does this line's money reach the pool?
 *
 * True when an operator collected it, or when nobody is named — an unattributed
 * take is the event's, which is the safe reading and the one every budget written
 * before `collected_by` existed relies on.
 */
export function reachesThePool(
  line: SettlementBudgetLine,
  operatorParticipantIds: ReadonlySet<string>,
): boolean {
  if (line.kind !== "revenue") return false;
  return !line.collectedBy || operatorParticipantIds.has(line.collectedBy);
}
