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
  /**
   * Participant ids the caller stands behind: their own participant rows PLUS the
   * rows of performers they represent as an agent on this event (decisions #14 —
   * resolved per deal via the representation, never an event-level grant).
   */
  viewerParticipantIds: string[];
  /**
   * True only for managing operators (host/co_host) — they hold `budget.view`.
   * NOT a grant on its own: it widens the view to every party line, but only on a
   * deal the operator is ITSELF a party to. Being the host is not visibility
   * (decisions #4: "if you are not a `deal_party`, you cannot see the deal").
   */
  isManagingOperator: boolean;
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
 * every caller sees only the lines whose `participantId` they stand behind (a
 * performer sees only their own split, never a co-performer's). The managing
 * operator sees every line — but only on a deal it is a party to (payer / economic
 * hub); that breadth is EMERGENT from party membership, never a `*.view.all`
 * override. Money is emitted as a decimal STRING (minor units), never a JS number —
 * the raw `bigint` is stringified at the boundary.
 */
export function serializeDeal(
  deal: DealRow,
  parties: DealPartyRow[],
  viewer: DealViewer,
): SerializedDeal {
  const seesEveryLine = viewer.isManagingOperator && isParty(parties, viewer);
  const visibleParties = seesEveryLine
    ? parties
    : parties.filter((party) => viewer.viewerParticipantIds.includes(party.participantId));

  return build(deal, visibleParties);
}

/**
 * The FULL, unredacted shape — for the AUDIT LOG only, never a response body. The
 * audit records what actually changed, which is not a party-scoped question.
 */
export function serializeDealUnredacted(deal: DealRow, parties: DealPartyRow[]): SerializedDeal {
  return build(deal, parties);
}

function build(deal: DealRow, visibleParties: DealPartyRow[]): SerializedDeal {
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

/**
 * Is the deal visible to the caller at all? PURE party-scoping (decisions #4): visible
 * iff the caller stands behind one of its party lines. There is deliberately no
 * operator override — a performer's private sub-hire (performer↔crew) has no operator
 * party line, so the venue cannot see it.
 */
export function isDealVisible(parties: DealPartyRow[], viewer: DealViewer): boolean {
  return isParty(parties, viewer);
}

function isParty(parties: DealPartyRow[], viewer: DealViewer): boolean {
  return parties.some((party) => viewer.viewerParticipantIds.includes(party.participantId));
}
