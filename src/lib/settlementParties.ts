/**
 * Party-display helpers for the Settlement UI.
 *
 * `Event.operatorType` says which role the operator plays: "promoter",
 * "venue", or "organizer". `calculateSettlement` always emits a "Promoter"
 * entry in `partyBreakdowns` and a `promoterPayout` field, regardless of who
 * the operator is. When the operator is the venue or organizer there is no
 * external promoter — the promoter-share economics belong to the operator's
 * own party. These helpers fold that case so the UI never renders a phantom
 * "Promoter" card labeled with the venue/organizer's name.
 */

import type { Event as AppEvent, Settlement, PartyBreakdown } from "./models";

const ROLE_TO_LABEL = {
  promoter: "Promoter",
  venue: "Venue",
  organizer: "Organizer",
  artist: "Performer",
} as const;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * When `operatorType` is "venue" or "organizer", fold the synthetic Promoter
 * breakdown into the operator's breakdown (creating it if missing) and drop
 * the Promoter entry. When the operator is the promoter, returns the input
 * unchanged.
 */
export function visiblePartyBreakdowns(
  event: Pick<AppEvent, "operatorType">,
  partyBreakdowns: PartyBreakdown[],
): PartyBreakdown[] {
  if (event.operatorType === "promoter") return partyBreakdowns;

  const operatorLabel = ROLE_TO_LABEL[event.operatorType];
  const promoter = partyBreakdowns.find((pb) => pb.party === "Promoter");
  if (!promoter) return partyBreakdowns;

  let foundOperator = false;
  const result: PartyBreakdown[] = [];
  for (const pb of partyBreakdowns) {
    if (pb.party === "Promoter") continue;
    if (pb.party === operatorLabel) {
      foundOperator = true;
      result.push({
        ...pb,
        baseAmount: round2(pb.baseAmount + promoter.baseAmount),
        adjustments: [...pb.adjustments, ...promoter.adjustments],
        finalPayout: round2(pb.finalPayout + promoter.finalPayout),
      });
    } else {
      result.push(pb);
    }
  }
  if (!foundOperator) {
    result.push({ ...promoter, party: operatorLabel });
  }
  return result;
}

/**
 * Map party label → display name for the Settlement breakdown cards. Excludes
 * "Promoter" when no external promoter exists; `event.operator` is the
 * operator's name and only equals the promoter when `operatorType === "promoter"`.
 */
export function buildPartyNames(event: AppEvent): Record<string, string> {
  const names: Record<string, string> = {
    Performer: event.artist,
    Venue: event.venue,
  };
  if (event.operatorType === "promoter") names.Promoter = event.operator;
  if (event.operatorType === "organizer") names.Organizer = event.operator;
  return names;
}

export interface PayoutRow {
  label: string;
  value: number;
  color: string;
  role: string;
}

/**
 * Rows for the "Total Payouts" list on the Settlement tab. Contains the
 * operator's own row (so callers that want to show it can; the standard list
 * filters by `role !== operatorType` to keep only amounts payable to others).
 * Includes a Promoter row only when the operator is the promoter — otherwise
 * the promoter share is the operator's and is not a separate payable.
 */
export function buildPayoutRows(
  event: AppEvent,
  settlement: Settlement,
  partyBreakdowns: PartyBreakdown[],
): PayoutRow[] {
  const operatorRole = event.operatorType;
  const allRows: PayoutRow[] = [
    { label: `Performer Payout (${event.artist})`, value: settlement.artistPayout, role: "artist", color: "bg-primary" },
  ];
  if (operatorRole === "promoter") {
    allRows.push({ label: `Promoter Payout (${event.operator})`, value: settlement.promoterPayout, role: "promoter", color: "bg-foreground" });
  }
  allRows.push({ label: `Venue Payout (${event.venue})`, value: settlement.venuePayout, role: "venue", color: "bg-muted-foreground" });

  const orgBreakdown = partyBreakdowns.find((pb) => pb.party === "Organizer");
  if (orgBreakdown) {
    allRows.push({ label: "Organizer Payout", value: orgBreakdown.finalPayout, role: "organizer", color: "bg-accent" });
  }
  for (const c of settlement.commissionPayouts) {
    if (c.payout > 0) {
      allRows.push({ label: `${c.label}${c.name ? ` (${c.name})` : ""}`, value: c.payout, role: c.key, color: "bg-accent-foreground/50" });
    }
  }
  return allRows.filter((r) => r.role !== operatorRole);
}

export interface PayoutParty {
  key: string;
  party: string;
  amount: number;
  defaultIban: string;
}

/** Same operator/promoter rule as buildPayoutRows, shape for PayoutTab. */
export function buildPayoutParties(event: AppEvent, settlement: Settlement): PayoutParty[] {
  const operatorRole = event.operatorType;
  const rows: PayoutParty[] = [
    { key: "artist", party: `Artist (${event.artist})`, amount: settlement.artistPayout, defaultIban: "NL91 ABNA 0417 1643 00" },
  ];
  if (operatorRole === "promoter") {
    rows.push({ key: "promoter", party: `Promoter (${event.operator})`, amount: settlement.promoterPayout, defaultIban: "NL20 INGB 0001 2345 67" });
  }
  rows.push({ key: "venue", party: `Venue (${event.venue})`, amount: settlement.venuePayout, defaultIban: "NL86 RABO 0145 8372 81" });
  for (const c of settlement.commissionPayouts.filter((c) => c.payout > 0)) {
    rows.push({ key: c.key, party: `${c.label} (${c.name})`, amount: c.payout, defaultIban: "NL44 RABO 0312 4567 89" });
  }
  return rows.filter((p) => p.key !== operatorRole);
}
