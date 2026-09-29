import type { schema } from "@showme/db";

type DealRow = typeof schema.deals.$inferSelect;
type DealPartyRow = typeof schema.dealParties.$inferSelect;

/**
 * A party line as the AUDIT records it — the row itself, with nothing in it that
 * depends on who is looking.
 */
export interface DealPartyRecord {
  id: string;
  participantId: string;
  roleInDeal: string;
  share: unknown;
  /** ISO timestamp of this party's own agreement confirmation, or null (decisions #1). */
  confirmedAt: string | null;
  version: number;
}

/**
 * A party line as a CALLER receives it. `isYours` is the only viewer-dependent
 * field, and it exists because confirmation is a per-party act (decisions #1):
 * the caller may stamp this line and no other. An operator that is a party sees
 * every line of its own deal, so "is there anything left for ME to sign?" is not
 * answerable from `confirmedAt` alone — without this flag a screen either offers
 * Confirm to someone with nothing to confirm, or hides it from someone who does.
 * True for the caller's own participant rows AND for the lines of performers they
 * represent as agent here, which is exactly the set `POST /deals/:did/confirm`
 * stamps (decisions #14 — the agent confirms the performer's own line).
 */
export interface SerializedDealParty extends DealPartyRecord {
  isYours: boolean;
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
  /**
   * Escalator tiers and the threshold bonus (ClickUp 123qy9rnwud). Deal-level like
   * the agreement body: the tiers ARE the agreement, so every party to it reads
   * the terms it signed. `null` when the deal has neither.
   */
  terms: SerializedDealTerms | null;
  /** Why the agreement was reopened, when a reason was given. */
  reopenReason: string | null;
  paymentTiming: string;
  /** How several disclosed commissions stack — `parallel` | `cascading` (86cba8wmb). */
  commissionMode: string;
  priority: number;
  status: string;
  /** Agreement lifecycle (draft|sent|confirmed|signed) — the per-party rollup (#1). */
  agreementStatus: string;
  /**
   * The agreement's terms & conditions, as written. Deal-level, not party-scoped:
   * it is the body EVERY party signs, so redacting it per line would hide from a
   * signatory the very text they are being asked to confirm.
   */
  agreementBodyText: string | null;
  version: number;
  parties: SerializedDealParty[];
}

/** The same deal with viewer-independent party lines — the audit's shape. */
export interface UnredactedDeal extends Omit<SerializedDeal, "parties"> {
  parties: DealPartyRecord[];
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
  /**
   * WHO IS ASKING — the caller's own user id, or null for a viewer who is not a user at all
   * (a share-link recipient, who is a party and can never be an author).
   *
   * Read only to answer "did you write this deal". See `authoredByViewer`.
   */
  callerUserId: string | null;
}

function partyRecord(party: DealPartyRow): DealPartyRecord {
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
/** `deals.terms` as it travels — money in minor units as strings (jsonb has no bigint). */
export interface SerializedDealTerms {
  escalators?: { thresholdSold: number; splitBasisPoints: number }[];
  bonusThreshold?: string;
  bonusAmount?: string;
}

export function serializeDeal(
  deal: DealRow,
  parties: DealPartyRow[],
  viewer: DealViewer,
): SerializedDeal {
  /*
   * A REDACTION THAT LEAVES NOTHING IS NOT A REDACTION, IT IS A BLANK (run 13's BLOCKER).
   *
   * Party-scoping serves each caller "the lines you stand behind". An AUTHOR who is not a party
   * stands behind none, so the slice is empty and the card renders a deal with no parties on it —
   * which is what the reachability fix in `deal-authority.ts` would otherwise have produced.
   *
   * So this is a FLOOR, not a widening: the author sees the whole deal only when party-scoping would
   * show them nothing at all. Deliberately NOT "the author always sees every line" — I wrote that
   * first and `deals.test.ts`'s performer↔crew sub-hire refused it, because its fixture makes the
   * PERFORMER the author and the test's own sentence is *"Both parties to the sub-hire see it — each
   * their own line."* That is the redaction rule between two parties and it is not this blocker's
   * business. An author who holds a line already sees one.
   */
  const standsBehindALine = isParty(parties, viewer);
  const seesEveryLine =
    (viewer.isManagingOperator && standsBehindALine) ||
    (authoredByViewer(deal, viewer) && !standsBehindALine);
  const visibleParties = seesEveryLine
    ? parties
    : parties.filter((party) => viewer.viewerParticipantIds.includes(party.participantId));

  return {
    ...build(deal),
    parties: visibleParties.map((party) => ({
      ...partyRecord(party),
      isYours: viewer.viewerParticipantIds.includes(party.participantId),
    })),
  };
}

/**
 * The FULL, unredacted shape — for the AUDIT LOG only, never a response body. The
 * audit records what actually changed, which is not a party-scoped question.
 */
export function serializeDealUnredacted(deal: DealRow, parties: DealPartyRow[]): UnredactedDeal {
  return { ...build(deal), parties: parties.map(partyRecord) };
}

/**
 * The reason off a `deals.reopen` record — a jsonb column, so it is read defensively
 * rather than cast: a row written before the field existed carries no `reason`, and a
 * blank one is the same as none to everybody reading it.
 */
function reopenReasonOf(reopen: unknown): string | null {
  if (reopen == null || typeof reopen !== "object") return null;
  const reason = (reopen as { reason?: unknown }).reason;
  if (typeof reason !== "string") return null;
  const trimmed = reason.trim();
  return trimmed === "" ? null : trimmed;
}

function build(deal: DealRow): Omit<SerializedDeal, "parties"> {
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
    commissionMode: deal.commissionMode,
    priority: deal.priority,
    status: deal.status,
    agreementStatus: deal.agreementStatus,
    agreementBodyText: deal.agreementBodyText ?? null,
    // Escalator tiers and the threshold bonus (ClickUp 123qy9rnwud). Party-scoped
    // like everything else here only in the sense that a caller who cannot see the
    // deal sees none of it — the tiers ARE the agreement, so a party to it reads
    // the terms it signed.
    terms: (deal.terms as SerializedDealTerms | null) ?? null,
    /**
     * WHY THE AGREEMENT WAS REOPENED, when whoever reopened it said (ClickUp
     * `123qy9rnh3f`).
     *
     * `deals.reopen` has recorded the reason since reopening existed and nothing ever
     * read it back: the other side saw their confirmation disappear and the Sign button
     * return, with no statement of what is being renegotiated. Ran's ticket is exactly
     * that — the reason is asked for and then kept from the person it is addressed to.
     *
     * Only the reason travels, not the whole `reopen` record. `priorSnapshot` is the
     * terms as they stood before, which is a second copy of the agreement and has no
     * business on a list response; `reopenedBy` is a user id, and the person is named
     * by the notification and the timeline instead.
     */
    reopenReason: reopenReasonOf(deal.reopen),
    version: deal.version,
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

/**
 * DID THIS CALLER WRITE THIS DEAL — `deals.created_by`, which has been `notNull` since the column
 * existed and was read by nothing that decides authority.
 *
 * A share-link recipient carries `callerUserId: null` — a party, never an author. There is
 * deliberately NO `!= null` guard: `created_by` cannot be null, so `null === <uuid>` is already
 * false and the guard could not change the answer. I wrote one first and the mutation deleting it
 * survived, which is what a line that cannot decide anything looks like.
 */
export function authoredByViewer(deal: { createdBy: string }, viewer: DealViewer): boolean {
  return deal.createdBy === viewer.callerUserId;
}

/**
 * CAN THE CALLER REACH THIS DEAL AT ALL — a party to it, or the person who wrote it.
 *
 * The union exists because two deliberate rules collided (run 13's BLOCKER). The composer offers
 * every participant as a party and requires nothing of the author — right, because a venue brokering
 * "the act pays its own engineer" is a real agreement the settlement engine has to reconcile. And
 * `isDealVisible` above is pure party-scoping for the reason its own docstring gives. Together they
 * let an operator create a deal that then vanished from its author's screen, that NO account in the
 * system could send, cancel or delete, and that `assertEveryAgreementSigned` refused every future
 * settlement over.
 *
 * The author stands behind the deal in the most literal sense: they typed every line. Hiding it from
 * them afterwards protects nothing, because the confidentiality was never there. This is a completion
 * of party-scoping, not a widening of it — and NOT "everyone holding `deal.edit`", which is the thing
 * decisions #4 forbids and which several tests pin. `created_by` is one account.
 *
 * The privacy rule keeps its own test as the control: `deals.test.ts`'s performer↔crew sub-hire is
 * inserted with the PERFORMER as `createdBy`, and the operator's 404 on it still stands.
 */
export function isDealReachable(
  deal: { createdBy: string },
  parties: DealPartyRow[],
  viewer: DealViewer,
): boolean {
  return isDealVisible(parties, viewer) || authoredByViewer(deal, viewer);
}

function isParty(parties: DealPartyRow[], viewer: DealViewer): boolean {
  return parties.some((party) => viewer.viewerParticipantIds.includes(party.participantId));
}
