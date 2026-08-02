import type { PartyBreakdown, Transfer } from "./types";

/**
 * Greedily match debtors (net < 0, holding too much) to creditors (net > 0,
 * owed money) into a minimal set of transfers: repeatedly settle the largest
 * debtor against the largest creditor. All in `bigint` minor units — no escrow,
 * these are recorded, not moved.
 */
export function greedyTransfers(breakdowns: PartyBreakdown[]): Transfer[] {
  const byAmountDescending = (a: { amount: bigint }, b: { amount: bigint }): number =>
    a.amount < b.amount ? 1 : a.amount > b.amount ? -1 : 0;

  const debtors = breakdowns
    .filter((party) => party.net < 0n)
    .map((party) => ({ id: party.participantId, amount: -party.net }))
    .sort(byAmountDescending);
  const creditors = breakdowns
    .filter((party) => party.net > 0n)
    .map((party) => ({ id: party.participantId, amount: party.net }))
    .sort(byAmountDescending);

  const transfers: Transfer[] = [];
  let debtorIndex = 0;
  let creditorIndex = 0;

  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex];
    const creditor = creditors[creditorIndex];
    if (!debtor || !creditor) break;

    const amount = debtor.amount < creditor.amount ? debtor.amount : creditor.amount;
    if (amount > 0n) {
      transfers.push({ fromParticipantId: debtor.id, toParticipantId: creditor.id, amount });
    }
    debtor.amount -= amount;
    creditor.amount -= amount;
    if (debtor.amount === 0n) debtorIndex++;
    if (creditor.amount === 0n) creditorIndex++;
  }

  return transfers;
}
