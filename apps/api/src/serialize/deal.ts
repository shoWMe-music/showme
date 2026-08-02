import type { schema } from "@showme/db";

type DealRow = typeof schema.deals.$inferSelect;
type DealPartyRow = typeof schema.dealParties.$inferSelect;

export interface SerializedDealParty {
  id: string;
  participantId: string;
  roleInDeal: string;
  share: unknown;
  /** ISO timestamp of this party's own agreement confirmation, or null (decisions #1). */
  confirmedAt: string | null;
  version: number;
}

export interface SerializedDeal {
  id: string;
  eventId: string;
  type: string;
  structure: string | null;
  name: string;
  currency: string | null;
  guaranteeAmount: string | null;
  advanceAmount: string | null;
  splitBasisPoints: number | null;
  paymentTiming: string;
  priority: number;
  status: string;
  /** Agreement lifecycle (draft|sent|confirmed|signed) — the per-party rollup (#1). */
  agreementStatus: string;
  version: number;
  parties: SerializedDealParty[];
}

export interface DealViewer {
  /** Participant ids the caller stands behind (their own deal-party lines). */
  viewerParticipantIds: string[];
  /** True only for managing operators (host/co_host) — they hold `budget.view`. */
  isOperator: boolean;
}

function serializeParty(party: DealPartyRow): SerializedDealParty {
  return {
    id: party.id,
    participantId: party.participantId,
    roleInDeal: party.roleInDeal,
    share: party.share ?? null,
    confirmedAt: party.confirmedAt ? party.confirmedAt.toISOString() : null,
    version: party.version,
  };
}

/**
 * Shape a deal by the caller's relationship to it — the field-level serializer,
 * server-side (PLAN "Deals model" + decisions #4). Party-scoping is the core rule:
 * an operator sees every party line; every other caller sees only the lines whose
 * `participantId` they stand behind (a performer sees only their own split, never a
 * co-performer's). Money is emitted as a decimal STRING (minor units), never a JS
 * number — the raw `bigint` is stringified at the boundary.
 */
export function serializeDeal(
  deal: DealRow,
  parties: DealPartyRow[],
  viewer: DealViewer,
): SerializedDeal {
  const visibleParties = viewer.isOperator
    ? parties
    : parties.filter((party) => viewer.viewerParticipantIds.includes(party.participantId));

  return {
    id: deal.id,
    eventId: deal.eventId,
    type: deal.type,
    structure: deal.structure ?? null,
    name: deal.name,
    currency: deal.currency ?? null,
    guaranteeAmount: deal.guaranteeAmount != null ? deal.guaranteeAmount.toString() : null,
    advanceAmount: deal.advanceAmount != null ? deal.advanceAmount.toString() : null,
    splitBasisPoints: deal.splitBasisPoints ?? null,
    paymentTiming: deal.paymentTiming,
    priority: deal.priority,
    status: deal.status,
    agreementStatus: deal.agreementStatus,
    version: deal.version,
    parties: visibleParties.map(serializeParty),
  };
}

/** Is the deal visible to the caller at all? Visible iff operator OR a party on it. */
export function isDealVisible(parties: DealPartyRow[], viewer: DealViewer): boolean {
  if (viewer.isOperator) return true;
  return parties.some((party) => viewer.viewerParticipantIds.includes(party.participantId));
}
