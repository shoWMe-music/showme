import { allocate } from "@showme/shared";
import { applyCommissions } from "./commissions";
import { costBearingOf } from "./cost-bearing";
import { isOffTheTop } from "./deal-order";
import { dealEntitlementDetailed } from "./entitlement";
import { greedyTransfers } from "./transfers";
import type {
  EntitlementLine,
  PartyBreakdown,
  SettlementDeal,
  SettlementInput,
  SettlementResult,
} from "./types";

const sumBigint = (values: bigint[]): bigint =>
  values.reduce((running, value) => running + value, 0n);

/**
 * Reconcile one event into per-participant net positions and minimal transfers.
 *
 * The orchestration (new; the per-deal math is ported), all in `bigint` minor
 * units so nothing rounds:
 *   1. pool        = Σ revenue − Σ external costs
 *   2. entitlement = off-the-top deals first (they reduce the pool the rest divide),
 *                    then each remaining deal's payee share (allocate) + commissions,
 *                    operator = residual (allocate)
 *   3. deductibles = costs on behalf of a party reduce that party's entitlement
 *   4. held        = collected − paid
 *   5. net         = entitlement − held   →   Σ net === 0n exactly, by construction
 *   6. transfers   = greedy debtor→creditor match
 *
 * The event must have at least one operator (the residual has nowhere to go
 * otherwise). `allocate()` guarantees each split's parts sum to the total.
 */
export function reconcile(input: SettlementInput): SettlementResult {
  const { baseCurrency, participants, deals, budgetLines } = input;
  const ticketsSold = input.ticketsSold ?? 0;

  // 1. Pool — revenue less the portion of each cost nobody is charged for.
  //
  //    Every cost line is partitioned by its BEARING RULE (`cost-bearing.ts`) into
  //    the share that lowers the pool and the shares deducted from named parties in
  //    step 3. The two halves always sum to the line, which is what keeps `Σ net = 0`
  //    true whether a cost is shared, deducted from one party, or split between
  //    several (the 2026-08 meeting's "either a cost split or a single payer").
  const revenue = sumBigint(
    budgetLines.filter((line) => line.kind === "revenue").map((line) => line.amount),
  );
  const bearings = budgetLines.map((line) => costBearingOf(line));
  const externalCosts = sumBigint(bearings.map((bearing) => bearing.poolShare));
  const pool = revenue - externalCosts;

  // 2a. Base entitlements from deals — split each deal across its payees with
  //     allocate() (exact), then apply disclosed commissions.
  const entitlement = new Map<string, bigint>(
    participants.map((party) => [party.participantId, 0n]),
  );
  const credit = (participantId: string, amount: bigint) => {
    entitlement.set(participantId, (entitlement.get(participantId) ?? 0n) + amount);
  };

  // The same credits, kept apart by WHY they were made, so a party's line can say
  // what it is made of instead of arriving as one unexplained figure. None of this
  // participates in the arithmetic — `entitlement` above is still the only total.
  const lines = new Map<string, EntitlementLine[]>(
    participants.map((party) => [party.participantId, []]),
  );
  const commissionEarned = new Map<string, bigint>();
  const deductibles = new Map<string, bigint>();
  const residualOf = new Map<string, bigint>();
  const addTo = (map: Map<string, bigint>, participantId: string, amount: bigint) => {
    map.set(participantId, (map.get(participantId) ?? 0n) + amount);
  };

  /** Settle one deal against the pool it divides; returns what it claims in total. */
  const settleDeal = (deal: SettlementDeal, poolForDeal: bigint): bigint => {
    if (deal.payeeParticipantIds.length === 0) return 0n;
    const settled = dealEntitlementDetailed(deal, poolForDeal, ticketsSold);
    const total = settled.amount;
    const weights = deal.payeeParticipantIds.map((payee) => {
      const share = deal.partyShares?.[payee];
      return share != null ? BigInt(share) : 1n;
    });
    const portions = allocate(total, weights);
    deal.payeeParticipantIds.forEach((payee, index) => {
      // Commissions are charged per ENTITLED LINE (`commissions.ts`), so each
      // payee on a split deal carries only the commission on its own portion.
      const { payeeAmount, charges } = applyCommissions(
        portions[index] ?? 0n,
        deal.commissions,
        deal.commissionMode,
      );
      credit(payee, payeeAmount);
      const charged = (portions[index] ?? 0n) - payeeAmount;
      lines.get(payee)?.push({
        dealId: deal.dealId,
        dealTotal: total,
        amount: payeeAmount,
        basis: settled.basis,
        ...(settled.bonus > 0n ? { bonus: settled.bonus } : {}),
        ...(settled.escalatorApplied ? { escalatorApplied: true } : {}),
        ...(charged > 0n ? { commissionCharged: charged } : {}),
      });
      for (const charge of charges) {
        // A commission credited to somebody who is not a participant on this event
        // would leave the books short by exactly that amount — visible only as an
        // opaque "does not balance" throw two steps later. Name it here instead.
        if (!entitlement.has(charge.participantId)) {
          throw new Error(
            `Deal ${deal.dealId} pays a commission to ${charge.participantId}, who is not a participant on this event.`,
          );
        }
        credit(charge.participantId, charge.amount);
        addTo(commissionEarned, charge.participantId, charge.amount);
      }
    });
    return total;
  };

  // OFF THE TOP FIRST. A rental is settled before the percentage deals and reduces
  // the pool they divide (`deal-order.ts` for the rule and why it is rentals only) —
  // 10 000 pool, 2 000 rental, 50% door → the performer takes half of 8 000, not
  // half of 10 000. Off-the-top deals themselves are computed against the FULL pool:
  // they are fixed amounts, and the operator's residual is still `pool − Σ everyone`,
  // so `Σ net = 0` is unaffected by the ordering — only the DISTRIBUTION moves.
  let splitPool = pool;
  for (const deal of deals) {
    if (isOffTheTop(deal)) splitPool -= settleDeal(deal, pool);
  }
  for (const deal of deals) {
    if (!isOffTheTop(deal)) settleDeal(deal, splitPool);
  }

  // 2b. Operator residual = pool − Σ all deal entitlements, allocated across operators.
  const dealBaseSum = sumBigint([...entitlement.values()]);
  const residual = pool - dealBaseSum;
  const operators = participants.filter((party) => party.isOperator);
  if (operators.length > 0) {
    const weights = operators.map((operator) => BigInt(operator.operatorResidualShare ?? 1));
    const parts = allocate(residual, weights);
    operators.forEach((operator, index) => {
      credit(operator.participantId, parts[index] ?? 0n);
      addTo(residualOf, operator.participantId, parts[index] ?? 0n);
    });
  }

  // 3. Deductibles — the borne half of each cost lowers those parties' entitlements.
  //    One party at the whole amount is the classic deductible (a venue paying for
  //    the band); several at stated percentages is the meeting's cost split.
  for (const bearing of bearings) {
    for (const [participantId, amount] of bearing.borne) {
      credit(participantId, -amount);
      addTo(deductibles, participantId, amount);
    }
  }

  // 4. Cash held per participant.
  const collected = new Map<string, bigint>();
  const paid = new Map<string, bigint>();
  for (const line of budgetLines) {
    if (line.kind === "revenue" && line.collectedBy) {
      collected.set(line.collectedBy, (collected.get(line.collectedBy) ?? 0n) + line.amount);
    }
    if (line.kind === "cost" && line.paidBy) {
      paid.set(line.paidBy, (paid.get(line.paidBy) ?? 0n) + line.amount);
    }
  }

  // 4b. Money a DEAL already moved before the night — a rental paid to hold the
  //     room, a guarantee paid to secure the booking (`prepaid.ts`).
  //
  //     Cash, not entitlement. The deal drives the transaction, so the payee is
  //     still owed exactly what the deal says they earned; an advance simply means
  //     part of it is already in their hands, so only the REMAINING transfer
  //     shrinks. Booking it here rather than in step 2a is what keeps that true —
  //     and keeps the pool out of it, because an advance is not a cost and must
  //     never lower what the percentage deals divide.
  //
  //     Both ends, always. The payee's `prepaid` goes up and the payer's goes down
  //     by the same amount, so the conservation law is untouched: one party holds
  //     more of what it is owed and the other has already parted with it.
  const prepaid = new Map<string, bigint>();
  /**
   * WHO THE EARLY MONEY WAS WITH — the other end, per party.
   *
   * `prepaid` is a net figure and a party can be on both sides of the night, so
   * the amount alone cannot say *"paid in advance BY X TO Y"* — which is exactly
   * how the product owner asked for it to read (ClickUp `86cbcn1ue`): *"even if
   * paid in advance it should be included in the final settlement and marked
   * 'paid in advance' by X to Y."*
   *
   * Recorded here rather than re-derived by a caller, because this loop is the
   * only place that already knows both ends of every advance. A screen that had
   * to work it out again would have to re-implement `allocate` and the payer
   * fallback to do it, and would then be a second opinion about who was paid.
   */
  const prepaidCounterparties = new Map<string, Set<string>>();
  const noteCounterparty = (party: string, other: string) => {
    const existing = prepaidCounterparties.get(party) ?? new Set<string>();
    existing.add(other);
    prepaidCounterparties.set(party, existing);
  };
  for (const deal of deals) {
    const amount = deal.prepaidAmount ?? 0n;
    if (amount === 0n) continue;
    if (!deal.payerParticipantId) {
      // Refusing to guess, in the manner of `weightFromShare`: a one-ended advance
      // would conjure money into the settlement and `assertBalanced` would fail
      // somewhere far from the cause. Fail here, naming the deal.
      throw new Error(`deal ${deal.dealId} states money paid before the event but names no payer`);
    }
    const payees = deal.payeeParticipantIds;
    if (payees.length === 0) {
      throw new Error(`deal ${deal.dealId} states money paid before the event but names no payee`);
    }
    // Divided by the SAME weights the entitlement uses, so a shared split's
    // advance lands in the same proportion as the fee it is part of. `allocate`
    // keeps it exact — the remainder is distributed, never dropped.
    const weights = payees.map((payee) => BigInt(deal.partyShares?.[payee] ?? 1));
    const parts = allocate(amount, weights);
    payees.forEach((payee, index) => {
      addTo(prepaid, payee, parts[index] ?? 0n);
      noteCounterparty(payee, deal.payerParticipantId as string);
      noteCounterparty(deal.payerParticipantId as string, payee);
    });
    addTo(prepaid, deal.payerParticipantId, -amount);
  }

  // 5. Breakdowns — no rounding, so nets sum to exactly zero.
  const breakdowns: PartyBreakdown[] = participants.map((party) => {
    const owed = entitlement.get(party.participantId) ?? 0n;
    const received = collected.get(party.participantId) ?? 0n;
    const fronted = paid.get(party.participantId) ?? 0n;
    const early = prepaid.get(party.participantId) ?? 0n;
    const held = received - fronted + early;
    return {
      participantId: party.participantId,
      entitlement: owed,
      collected: received,
      paid: fronted,
      prepaid: early,
      prepaidCounterpartyIds: [...(prepaidCounterparties.get(party.participantId) ?? [])].sort(),
      held,
      net: owed - held,
      lines: lines.get(party.participantId) ?? [],
      commissionEarned: commissionEarned.get(party.participantId) ?? 0n,
      deductibles: deductibles.get(party.participantId) ?? 0n,
      residual: residualOf.get(party.participantId) ?? 0n,
    };
  });

  // 6. Transfers.
  return {
    baseCurrency,
    pool,
    ladder: {
      revenue,
      costs: externalCosts,
      pool,
      offTheTop: pool - splitPool,
      splitPool,
    },
    breakdowns,
    transfers: greedyTransfers(breakdowns),
  };
}

/**
 * The conservation law: net positions must sum to exactly zero. Throws otherwise.
 *
 * The check itself is absolute and stays that way — an imbalance means money has
 * appeared or vanished, and no settlement may be persisted on top of it. The message
 * carries the pool and every party's net because the sum alone says only *that* the
 * books are wrong, never *where* (audit A-14: an imbalance of exactly the amount of
 * one mis-attributed budget line surfaced as an opaque 500).
 */
export function assertBalanced(result: SettlementResult): void {
  const netSum = sumBigint(result.breakdowns.map((party) => party.net));
  if (netSum !== 0n) {
    const positions = result.breakdowns
      .map(
        (party) =>
          `${party.participantId} net=${party.net} (entitlement=${party.entitlement}, held=${party.held})`,
      )
      .join("; ");
    throw new Error(
      `Settlement does not balance: Σ net = ${netSum} (pool=${result.pool} ${result.baseCurrency}). Positions: ${positions || "none"}`,
    );
  }
}
