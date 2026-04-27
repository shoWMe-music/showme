/**
 * Pure settlement calculation helpers extracted from event-store.tsx.
 * No React hooks — safe to import anywhere.
 */

import {
  type DealStructure,
  type TicketRevenue,
  type Settlement,
  type SettlementStatus,
  calculateSettlement,
} from "./models";

const DEFAULT_APPROVALS: { party: string; approved: boolean }[] = [
  { party: "Operator", approved: false },
  { party: "Performer", approved: false },
  { party: "Venue", approved: false },
];

/**
 * Build (or rebuild) a Settlement from a deal + revenue pair.
 * Preserves the status, approvals, comments and revisions from an existing
 * settlement if one is provided; otherwise uses sensible defaults.
 */
export function buildSettlementUpdate(
  deal: DealStructure,
  revenue: TicketRevenue,
  existing?: Settlement,
): Settlement {
  const calc = calculateSettlement(deal, revenue);
  return {
    ...calc,
    status: (existing?.status ?? "open") as SettlementStatus,
    approvals: existing?.approvals ?? DEFAULT_APPROVALS.map((a) => ({ ...a })),
    comments: existing?.comments ?? [],
    revisions: existing?.revisions ?? [],
  };
}

/**
 * Returns an empty TicketRevenue record for a given event id.
 * Used when creating a new event or when revenue data has not been persisted yet.
 */
export function emptyRevenue(eventId: string): TicketRevenue {
  return {
    eventId,
    ticketsSold: 0,
    grossRevenue: 0,
    ticketFees: 0,
    tax: 0,
    refunds: 0,
    doorSales: 0,
    productionExpenses: 0,
    additionalCosts: 0,
  };
}
