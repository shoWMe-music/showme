import { allocate, applyBasisPoints } from "@showme/shared";
import { dealEntitlement } from "./entitlement";
import { greedyTransfers } from "./transfers";
import type { PartyBreakdown, SettlementInput, SettlementResult } from "./types";

const sumBigint = (values: bigint[]): bigint =>
  values.reduce((running, value) => running + value, 0n);

/**
 * Reconcile one event into per-participant net positions and minimal transfers.
 *
 * The orchestration (new; the per-deal math is ported), all in `bigint` minor
 * units so nothing rounds:
 *   1. pool        = Σ revenue − Σ external costs
 *   2. entitlement = each deal's payee share (allocate) + commissions, operator = residual (allocate)
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

  // 1. Pool — revenue less costs paid to external suppliers (payee-less lines).
  const revenue = sumBigint(
    budgetLines.filter((line) => line.kind === "revenue").map((line) => line.amount),
  );
  const externalCosts = sumBigint(
    budgetLines
      .filter((line) => line.kind === "cost" && !line.payeeParticipantId)
      .map((line) => line.amount),
  );
  const pool = revenue - externalCosts;

  // 2a. Base entitlements from deals — split each deal across its payees with
  //     allocate() (exact), then apply disclosed commissions.
  const entitlement = new Map<string, bigint>(
    participants.map((party) => [party.participantId, 0n]),
  );
  const credit = (participantId: string, amount: bigint) => {
    entitlement.set(participantId, (entitlement.get(participantId) ?? 0n) + amount);
  };

  for (const deal of deals) {
    if (deal.payeeParticipantIds.length === 0) continue;
    const total = dealEntitlement(deal, pool, ticketsSold);
    const weights = deal.payeeParticipantIds.map((payee) => {
      const share = deal.partyShares?.[payee];
      return share != null ? BigInt(share) : 1n;
    });
    const portions = allocate(total, weights);
    deal.payeeParticipantIds.forEach((payee, index) => {
      const portion = portions[index] ?? 0n;
      credit(payee, portion);
      for (const commission of deal.commissions ?? []) {
        const amount = applyBasisPoints(portion, commission.basisPoints);
        credit(payee, -amount);
        credit(commission.participantId, amount);
      }
    });
  }

  // 2b. Operator residual = pool − Σ all deal entitlements, allocated across operators.
  const dealBaseSum = sumBigint([...entitlement.values()]);
  const residual = pool - dealBaseSum;
  const operators = participants.filter((party) => party.isOperator);
  if (operators.length > 0) {
    const weights = operators.map((operator) => BigInt(operator.operatorResidualShare ?? 1));
    const parts = allocate(residual, weights);
    operators.forEach((operator, index) => credit(operator.participantId, parts[index] ?? 0n));
  }

  // 3. Deductibles — a cost on behalf of a party lowers that party's entitlement.
  for (const line of budgetLines) {
    if (line.kind === "cost" && line.payeeParticipantId) {
      credit(line.payeeParticipantId, -line.amount);
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

  // 5. Breakdowns — no rounding, so nets sum to exactly zero.
  const breakdowns: PartyBreakdown[] = participants.map((party) => {
    const owed = entitlement.get(party.participantId) ?? 0n;
    const received = collected.get(party.participantId) ?? 0n;
    const fronted = paid.get(party.participantId) ?? 0n;
    const held = received - fronted;
    return {
      participantId: party.participantId,
      entitlement: owed,
      collected: received,
      paid: fronted,
      held,
      net: owed - held,
    };
  });

  // 6. Transfers.
  return {
    baseCurrency,
    pool,
    breakdowns,
    transfers: greedyTransfers(breakdowns),
  };
}

/** The conservation law: net positions must sum to exactly zero. Throws otherwise. */
export function assertBalanced(result: SettlementResult): void {
  const netSum = sumBigint(result.breakdowns.map((party) => party.net));
  if (netSum !== 0n) {
    throw new Error(`Settlement does not balance: Σ net = ${netSum}`);
  }
}
