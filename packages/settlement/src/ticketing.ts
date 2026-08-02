import type { SettlementBudgetLine } from "./types";

/** Provenance of a revenue line — mirrors the DB `ticketing_source` enum (#15). */
export type TicketingSource = "manual" | "ticketing_provider";

/**
 * The port a ticketing provider (Eventbrite, etc.) plugs into (decisions #15): it
 * yields settlement revenue lines for an event, merged into the manual lines before
 * `reconcile`. v1 ships NO provider — manual budget lines are the only source — so
 * this is a deliberate build-for-later seam that keeps future adapters additive
 * (no schema churn, no settlement-engine change: a synced line is just a revenue
 * `SettlementBudgetLine` tagged with `source: "ticketing_provider"`).
 */
export interface TicketingSync {
  readonly source: TicketingSource;
  fetchRevenueLines(eventId: string): Promise<SettlementBudgetLine[]>;
}

/** The default no-provider sync — the event's manual budget lines are authoritative. */
export const manualTicketing: TicketingSync = {
  source: "manual",
  async fetchRevenueLines(): Promise<SettlementBudgetLine[]> {
    return [];
  },
};
