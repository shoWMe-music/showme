import { allocate, applyBasisPoints } from "@showme/shared";
import type { SettlementBudgetLine } from "./types";

/**
 * WHO BEARS A COST — the "defined cost rule" the 2026-08 settlements meeting made
 * mandatory (01:02:58–01:06:31): *"The production system requires a defined rule:
 * either a cost split or a single payer. Once the rule is set in the budget
 * planner, costs entered against it are processed automatically at settlement."*
 *
 * A cost is borne one of three ways, and they are the same mechanism at three
 * settings:
 *
 * | Rule in the planner | Stored as | What settlement does |
 * |---|---|---|
 * | Shared — the event carries it | neither column set | an external pool cost: the pool drops, so the operator's residual absorbs it |
 * | A single bearer (a *deduction*) | `payee_participant_id` | that party's entitlement drops by the whole amount |
 * | A split | `cost_split` (participant → basis points) | each named party's entitlement drops by their share; anything unallocated stays a pool cost |
 *
 * The first two already existed; the third is what the meeting adds, and it is a
 * strict GENERALISATION of the second rather than a new branch — a `payee` is a
 * split of 100% to one party. That matters for the conservation law: `reconcile`
 * balances because every cost line is partitioned into exactly two buckets,
 *
 *     amount = poolShare + Σ borne[]
 *
 * with `poolShare` lowering the pool (and therefore the operator's residual) and
 * each `borne` entry lowering one party's entitlement. Both halves are counted
 * exactly once, so `Σ net = 0` survives however the rule is set. A rule that
 * dropped a portion of a line from both buckets would balance the books around a
 * gap — which is why the remainder is deliberately kept rather than discarded.
 *
 * `allocate()` (not repeated `applyBasisPoints`) divides the borne total, so the
 * parts sum to it EXACTLY — three parties on a 33/33/34 split cannot lose or gain
 * a minor unit between them.
 */
export interface CostBearing {
  /** The portion that lowers the pool — an external cost nobody is charged for. */
  poolShare: bigint;
  /** participantId → the portion deducted from that party's entitlement. */
  borne: Map<string, bigint>;
}

export function costBearingOf(line: SettlementBudgetLine): CostBearing {
  const borne = new Map<string, bigint>();
  if (line.kind !== "cost") return { poolShare: 0n, borne };

  const split = line.costSplit;
  const bearers = split ? Object.entries(split).filter(([, points]) => points > 0) : [];

  if (bearers.length > 0) {
    // The share of the line the named parties carry between them, then divided
    // among them exactly. Basis points that do not reach 10 000 are not an error:
    // "the venue takes 60%, the event carries the rest" is a real arrangement, and
    // the remainder simply stays a pool cost.
    const totalBasisPoints = bearers.reduce((running, [, points]) => running + points, 0);
    const borneTotal = applyBasisPoints(line.amount, Math.min(totalBasisPoints, 10_000));
    const parts = allocate(
      borneTotal,
      bearers.map(([, points]) => BigInt(points)),
    );
    bearers.forEach(([participantId, _points], index) => {
      const part = parts[index] ?? 0n;
      borne.set(participantId, (borne.get(participantId) ?? 0n) + part);
    });
    return { poolShare: line.amount - borneTotal, borne };
  }

  if (line.payeeParticipantId) {
    // A deductible: one party paying on another's behalf (the venue books the
    // band's hotel), recovered out of that party's cut. The whole line is theirs.
    borne.set(line.payeeParticipantId, line.amount);
    return { poolShare: 0n, borne };
  }

  return { poolShare: line.amount, borne };
}
