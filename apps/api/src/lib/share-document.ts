import { schema } from "@showme/db";
import type { Capability } from "@showme/shared";
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { serializeBudgetLine } from "../serialize/budget";
import { type SerializedDeal, isDealVisible, serializeDeal } from "../serialize/deal";
import type { RecipientParty } from "./share-scope";

/**
 * The LIVE document a share renders (`GET /shares/:token/document`).
 *
 * Two rules shape everything here.
 *
 * **It is live, never a snapshot.** The old app froze a copy of the event onto
 * each share row and rendered a page headed "Snapshot — does not update
 * automatically. Ask Daniel for a fresh link." A frozen copy cannot be revoked
 * and drifts from the truth the moment anything moves. Postgres can do the
 * party-scoped read for a non-user, so this builds the document from current rows
 * on every request. The one immutable record in the system stays where it belongs:
 * `settlements.finalized_snapshot`, captured on finalize.
 *
 * **A section exists because a capability granted it.** Every block below is
 * behind `capabilities.has(...)`, and the party-scoped ones are additionally
 * narrowed to the recipient's own participant. The template downstream draws
 * whatever it is handed and decides nothing — which is the whole reason there is
 * one viewer for every audience instead of a page per audience.
 */

/** Money and dates cross as strings (money.md); ids only where the client needs them. */
const DocumentEvent = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  eventDate: z.string().nullable(),
  doorTime: z.string().nullable(),
  startTime: z.string().nullable(),
  endTime: z.string().nullable(),
  timezone: z.string().nullable(),
  venueName: z.string().nullable(),
  capacity: z.number().nullable(),
  baseCurrency: z.string(),
  notes: z.string().nullable(),
});

const DocumentScheduleItem = z.object({
  id: z.string(),
  localDateTime: z.string().nullable(),
  duration: z.number().nullable(),
  label: z.string(),
  description: z.string().nullable(),
  category: z.string(),
});

const DocumentRider = z.object({
  id: z.string(),
  type: z.string(),
  name: z.string(),
  description: z.string().nullable(),
});

const DocumentBudgetLine = z.object({
  id: z.string(),
  kind: z.string(),
  label: z.string(),
  amount: z.string(),
  currency: z.string().nullable(),
});

const DocumentBudget = z.object({
  currency: z.string(),
  revenueTotal: z.string(),
  costTotal: z.string(),
  lines: z.array(DocumentBudgetLine),
});

const DocumentDealParty = z.object({
  id: z.string(),
  participantId: z.string(),
  roleInDeal: z.string(),
  share: z.unknown().nullable(),
  confirmedAt: z.string().nullable(),
  isYours: z.boolean(),
});

const DocumentDeal = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  structure: z.string().nullable(),
  currency: z.string().nullable(),
  guaranteeAmount: z.string().nullable(),
  splitBasisPoints: z.number().nullable(),
  paymentTiming: z.string(),
  agreementStatus: z.string(),
  agreementBodyText: z.string().nullable(),
  parties: z.array(DocumentDealParty),
});

const DocumentSettlement = z.object({
  id: z.string(),
  status: z.string(),
  currency: z.string(),
  entitlement: z.string().nullable(),
  collected: z.string().nullable(),
  paid: z.string().nullable(),
  held: z.string().nullable(),
  net: z.string().nullable(),
  /**
   * Money that moved BEFORE the night, and who it was with.
   *
   * `held` already contains it (`held = collected − paid + prepaid`), which is
   * exactly why it has to be stated: a performer opening their settlement saw
   * "Held by you 10,000" with nothing to say that the 10,000 was the advance they
   * were paid in March. The product owner asked for it in those terms — *"even if
   * paid in advance it should be included in the final settlement and marked
   * 'paid in advance' by X to Y"* (ClickUp `86cbcn1ue`).
   *
   * `prepaidWith` is resolved to NAMES here rather than shipped as participant
   * ids: a share recipient is off-platform by definition and has nothing to
   * resolve an id against.
   */
  prepaid: z.string().nullable(),
  prepaidWith: z.string().nullable(),
  /** Owed money moving to or from the recipient — never another pair's transfer. */
  transfers: z.array(
    z.object({
      id: z.string(),
      direction: z.enum(["incoming", "outgoing"]),
      amount: z.string(),
      currency: z.string().nullable(),
      state: z.string(),
    }),
  ),
  approvedAt: z.string().nullable(),
});

const DocumentComment = z.object({
  id: z.string(),
  section: z.string().nullable(),
  authorName: z.string().nullable(),
  authorEmail: z.string().nullable(),
  message: z.string(),
  createdAt: z.string(),
  /** Written by this recipient — the viewer marks their own lines. */
  isYours: z.boolean(),
});

/** Who the viewer is, as the document is willing to say it back to them. */
const DocumentViewer = z.object({
  email: z.string().nullable(),
  name: z.string().nullable(),
  /** True when the email resolved to a party on this event — the scope key. */
  isParty: z.boolean(),
  partyName: z.string().nullable(),
  partyRole: z.string().nullable(),
  /**
   * Set when a signed-in shoWMe account already owns this recipient's email —
   * the "claimable profile" link (`share_recipients.claimed_by_user_id`).
   */
  claimed: z.boolean(),
});

export const ShareDocumentSchema = z.object({
  capabilities: z.array(z.string()),
  targetKind: z.string().nullable(),
  targetId: z.string().nullable(),
  sharedBy: z.string().nullable(),
  expiresAt: z.string().nullable(),
  viewer: DocumentViewer,
  event: DocumentEvent.nullable(),
  schedule: z.array(DocumentScheduleItem).nullable(),
  riders: z.array(DocumentRider).nullable(),
  budget: DocumentBudget.nullable(),
  deals: z.array(DocumentDeal).nullable(),
  settlement: DocumentSettlement.nullable(),
  comments: z.array(DocumentComment).nullable(),
  actions: z.object({
    canComment: z.boolean(),
    canConfirmSettlement: z.boolean(),
    canConfirmAgreement: z.boolean(),
  }),
});

export type ShareDocument = z.infer<typeof ShareDocumentSchema>;

export interface ShareDocumentInput {
  // biome-ignore lint/suspicious/noExplicitAny: Drizzle db/tx handle.
  database: any;
  eventId: string;
  capabilities: ReadonlySet<Capability>;
  /** The recipient's party on this event, or null for an unlinked / anonymous viewer. */
  party: RecipientParty | null;
  viewerEmail: string | null;
  viewerName: string | null;
  claimed: boolean;
  targetKind: string | null;
  targetId: string | null;
  sharedBy: string | null;
  expiresAt: Date | null;
}

/** The sections a document can carry, and the capability each one needs. */
export const SECTIONS = ["event", "schedule", "riders", "budget", "deal", "settlement"] as const;
export type ShareSection = (typeof SECTIONS)[number];

const SECTION_CAPABILITY: Record<ShareSection, Capability> = {
  event: "event.view",
  schedule: "schedule.view",
  riders: "rider.view",
  budget: "budget.view",
  deal: "deal.view.own",
  settlement: "settlement.view.own",
};

/** Which sections this viewer may see — the list a comment's `section` must be in. */
export function visibleSections(capabilities: ReadonlySet<Capability>): ShareSection[] {
  return SECTIONS.filter((section) => capabilities.has(SECTION_CAPABILITY[section]));
}

export async function buildShareDocument(input: ShareDocumentInput): Promise<ShareDocument> {
  const { database, eventId, capabilities, party } = input;

  const [event] = await database.select().from(schema.events).where(eq(schema.events.id, eventId));

  return {
    capabilities: [...capabilities],
    targetKind: input.targetKind,
    targetId: input.targetId,
    sharedBy: input.sharedBy,
    expiresAt: input.expiresAt ? input.expiresAt.toISOString() : null,
    viewer: {
      email: input.viewerEmail,
      name: input.viewerName,
      isParty: party != null,
      partyName: party?.displayName ?? null,
      partyRole: party?.role ?? null,
      claimed: input.claimed,
    },
    event: capabilities.has("event.view") && event ? documentEvent(event) : null,
    schedule: capabilities.has("schedule.view") ? await loadSchedule(database, eventId) : null,
    riders: capabilities.has("rider.view") ? await loadRiders(database, eventId, party) : null,
    budget: capabilities.has("budget.view")
      ? await loadBudget(database, eventId, event?.baseCurrency ?? "")
      : null,
    deals: capabilities.has("deal.view.own")
      ? await loadDeals(database, eventId, party, input.targetKind, input.targetId)
      : null,
    settlement: capabilities.has("settlement.view.own")
      ? await loadSettlement(database, eventId, party, event?.baseCurrency ?? "")
      : null,
    comments: capabilities.has("message.post")
      ? await loadComments(database, eventId, party, input.viewerEmail)
      : null,
    actions: {
      canComment: capabilities.has("message.post"),
      // Confirming is a PER-PARTY act. A viewer who is nobody on this event has no
      // line to sign, so the button is not offered however the share was ticked.
      canConfirmSettlement: capabilities.has("settlement.confirm") && party != null,
      canConfirmAgreement: capabilities.has("agreement.confirm") && party != null,
    },
  };
}

type EventRow = typeof schema.events.$inferSelect;

function documentEvent(event: EventRow): z.infer<typeof DocumentEvent> {
  return {
    id: event.id,
    title: event.title,
    status: event.status,
    eventDate: event.eventDate ?? null,
    doorTime: event.doorTime ?? null,
    startTime: event.startTime ?? null,
    endTime: event.endTime ?? null,
    timezone: event.timezone ?? null,
    venueName: event.venueName ?? null,
    capacity: event.capacity ?? null,
    baseCurrency: event.baseCurrency,
    notes: event.notes ?? null,
  };
}

// biome-ignore lint/suspicious/noExplicitAny: Drizzle db/tx handle.
async function loadSchedule(database: any, eventId: string) {
  const rows = await database
    .select()
    .from(schema.scheduleItems)
    .where(eq(schema.scheduleItems.eventId, eventId))
    .orderBy(asc(schema.scheduleItems.localDateTime));
  return rows.map((row: typeof schema.scheduleItems.$inferSelect) => ({
    id: row.id,
    localDateTime: row.localDateTime ?? null,
    duration: row.duration ?? null,
    label: row.label,
    description: row.description ?? null,
    category: row.category,
  }));
}

/**
 * Riders, scoped the way `scopedEventRiders` scopes them on-platform: a party sees
 * its OWN documents plus the ones attached to nobody in particular (the venue's
 * house rules). A rider is the act's own artifact (decisions #12) — one
 * performer's hospitality rider is not another performer's business, and a share
 * is not the exception.
 */
// biome-ignore lint/suspicious/noExplicitAny: Drizzle db/tx handle.
async function loadRiders(database: any, eventId: string, party: RecipientParty | null) {
  const scope = party
    ? and(
        eq(schema.riders.eventId, eventId),
        or(
          eq(schema.riders.ownerParticipantId, party.participantId),
          isNull(schema.riders.ownerParticipantId),
        ),
      )
    : eq(schema.riders.eventId, eventId);
  const rows = await database.select().from(schema.riders).where(scope);
  return rows.map((row: typeof schema.riders.$inferSelect) => ({
    id: row.id,
    type: row.type,
    name: row.name,
    description: row.description ?? null,
  }));
}

/**
 * The SHARED ledger only. A private budget belongs to the profile that owns it
 * and is nobody else's to hand out — including via a link the operator minted.
 */
// biome-ignore lint/suspicious/noExplicitAny: Drizzle db/tx handle.
async function loadBudget(database: any, eventId: string, baseCurrency: string) {
  const [budget] = await database
    .select()
    .from(schema.budgets)
    .where(and(eq(schema.budgets.eventId, eventId), eq(schema.budgets.scope, "shared")));
  if (!budget) return null;

  const lines = await database
    .select()
    .from(schema.budgetLines)
    .where(eq(schema.budgetLines.budgetId, budget.id));

  let revenue = 0n;
  let cost = 0n;
  for (const line of lines as (typeof schema.budgetLines.$inferSelect)[]) {
    if (line.kind === "revenue") revenue += line.amount;
    else cost += line.amount;
  }

  return {
    currency: baseCurrency,
    revenueTotal: revenue.toString(),
    costTotal: cost.toString(),
    lines: (lines as (typeof schema.budgetLines.$inferSelect)[]).map((line) => {
      const serialized = serializeBudgetLine(line);
      return {
        id: serialized.id,
        kind: serialized.kind,
        label: serialized.label,
        amount: serialized.amount,
        currency: serialized.currency,
      };
    }),
  };
}

/**
 * The recipient's own deals — party-scoping, straight through the SAME serializer
 * the authenticated route uses (`serialize/deal.ts`), with `isManagingOperator`
 * false because a link-holder is never a managing operator.
 *
 * This is the line the old app crossed. `SettlementReviewPage` rendered a card per
 * party to any link-holder — performer, promoter, venue, agent commission and all
 * — which story.md forbids outright ("never … other parties' financials … even if
 * an operator *wanted* to show them"). Here a viewer who is not a party to a deal
 * does not see the deal, and a viewer who is a party sees their own line and no
 * other.
 */
async function loadDeals(
  // biome-ignore lint/suspicious/noExplicitAny: Drizzle db/tx handle.
  database: any,
  eventId: string,
  party: RecipientParty | null,
  targetKind: string | null,
  targetId: string | null,
): Promise<z.infer<typeof DocumentDeal>[]> {
  if (!party) return [];

  const deals = (await database
    .select()
    .from(schema.deals)
    .where(eq(schema.deals.eventId, eventId))) as (typeof schema.deals.$inferSelect)[];
  const scoped =
    targetKind === "deal" && targetId ? deals.filter((row) => row.id === targetId) : deals;
  if (scoped.length === 0) return [];

  const parties = (await database
    .select()
    .from(schema.dealParties)
    .where(
      inArray(
        schema.dealParties.dealId,
        scoped.map((deal) => deal.id),
      ),
    )) as (typeof schema.dealParties.$inferSelect)[];

  const viewer = { viewerParticipantIds: [party.participantId], isManagingOperator: false };
  const document: z.infer<typeof DocumentDeal>[] = [];
  for (const deal of scoped) {
    const lines = parties.filter((line) => line.dealId === deal.id);
    if (!isDealVisible(lines, viewer)) continue;
    document.push(documentDeal(serializeDeal(deal, lines, viewer), deal.agreementBodyText ?? null));
  }
  return document;
}

function documentDeal(deal: SerializedDeal, agreementBodyText: string | null) {
  return {
    id: deal.id,
    name: deal.name,
    type: deal.type,
    structure: deal.structure,
    currency: deal.currency,
    guaranteeAmount: deal.guaranteeAmount,
    splitBasisPoints: deal.splitBasisPoints,
    paymentTiming: deal.paymentTiming,
    agreementStatus: deal.agreementStatus,
    agreementBodyText,
    parties: deal.parties.map((line) => ({
      id: line.id,
      participantId: line.participantId,
      roleInDeal: line.roleInDeal,
      share: (line.share ?? null) as unknown,
      confirmedAt: line.confirmedAt,
      isYours: line.isYours,
    })),
  };
}

/**
 * The recipient's OWN settlement row and the transfers that touch them.
 *
 * Representation-scoped settlements (the private agent↔performer commission,
 * decisions #14) are excluded by construction: this reads by `participant_id`,
 * and a commission row has none. The commission rate is the private bit, and a
 * share is the last place it should surface.
 */
async function loadSettlement(
  // biome-ignore lint/suspicious/noExplicitAny: Drizzle db/tx handle.
  database: any,
  eventId: string,
  party: RecipientParty | null,
  baseCurrency: string,
): Promise<z.infer<typeof DocumentSettlement> | null> {
  if (!party) return null;

  const [settlement] = (await database
    .select()
    .from(schema.settlements)
    .where(
      and(
        eq(schema.settlements.eventId, eventId),
        eq(schema.settlements.participantId, party.participantId),
      ),
    )) as (typeof schema.settlements.$inferSelect)[];
  if (!settlement) return null;

  const computed = (settlement.computed ?? null) as Record<string, string> | null;

  const transfers = (await database
    .select()
    .from(schema.settlementTransfers)
    .where(
      and(
        eq(schema.settlementTransfers.eventId, eventId),
        or(
          eq(schema.settlementTransfers.fromParticipant, party.participantId),
          eq(schema.settlementTransfers.toParticipant, party.participantId),
        ),
      ),
    )) as (typeof schema.settlementTransfers.$inferSelect)[];

  /**
   * The other end of any early money, as NAMES.
   *
   * Read straight off the stored snapshot's `prepaidCounterpartyIds` — the engine
   * recorded both ends when it booked the advance, so nothing is re-derived here.
   * A settlement finalized before that field existed carries none and simply says
   * "Paid in advance" without a counterparty, which is the honest reading of a
   * legal record that never held the information.
   */
  const counterpartyIds = Array.isArray(
    (computed as unknown as { prepaidCounterpartyIds?: unknown })?.prepaidCounterpartyIds,
  )
    ? ((computed as unknown as { prepaidCounterpartyIds: string[] }).prepaidCounterpartyIds ?? [])
    : [];
  const counterparties =
    counterpartyIds.length > 0
      ? ((await database
          .select({
            id: schema.eventParticipants.id,
            /*
             * BOTH names, and the profile's is the one that usually exists.
             *
             * `event_participants.display_name` is the OVERRIDE, carried by an
             * off-platform party who has no profile to borrow a name from. Every
             * participant who is on the platform leaves it null and is known by
             * `profiles.name`. Reading only the override therefore resolved to
             * nothing for the ordinary case — caught by fetching a real share
             * document and finding `prepaidWith: null` on a settlement that
             * plainly had a counterparty, which is the sort of thing no test
             * asserting "the field exists" would ever have noticed.
             */
            displayName: schema.eventParticipants.displayName,
            profileName: schema.profiles.name,
          })
          .from(schema.eventParticipants)
          .leftJoin(schema.profiles, eq(schema.profiles.id, schema.eventParticipants.profileId))
          .where(inArray(schema.eventParticipants.id, counterpartyIds))) as {
          id: string;
          displayName: string | null;
          profileName: string | null;
        }[])
      : [];
  const prepaidWith = counterpartyIds
    .map((id) => {
      const row = counterparties.find((candidate) => candidate.id === id);
      return row?.displayName || row?.profileName;
    })
    .filter((name): name is string => typeof name === "string" && name !== "");

  const [approval] = (await database
    .select()
    .from(schema.settlementApprovals)
    .where(
      and(
        eq(schema.settlementApprovals.eventId, eventId),
        eq(schema.settlementApprovals.partyParticipantId, party.participantId),
      ),
    )) as (typeof schema.settlementApprovals.$inferSelect)[];

  return {
    id: settlement.id,
    status: settlement.status,
    currency: baseCurrency,
    entitlement: computed?.entitlement ?? null,
    collected: computed?.collected ?? null,
    paid: computed?.paid ?? null,
    held: computed?.held ?? null,
    net: computed?.net ?? null,
    // Absent on a settlement finalized before advances were recorded, and "0" on a
    // night where nothing moved early. Both are "no row to show", and neither is a
    // reason to print a zero at somebody who is reading this to find out what they
    // are owed.
    prepaid: computed?.prepaid != null && computed.prepaid !== "0" ? computed.prepaid : null,
    prepaidWith: prepaidWith.length > 0 ? prepaidWith.join(", ") : null,
    transfers: transfers
      // A commission transfer is private to the agent and the performer it is
      // about; it never rides a share, even one addressed to one of them.
      .filter((transfer) => transfer.representationId == null)
      .map((transfer) => ({
        id: transfer.id,
        direction:
          transfer.toParticipant === party.participantId
            ? ("incoming" as const)
            : ("outgoing" as const),
        amount: transfer.amount.toString(),
        currency: transfer.currency,
        state: transfer.state,
      })),
    approvedAt:
      approval?.approved && approval.approvedAt ? approval.approvedAt.toISOString() : null,
  };
}

/**
 * The comment thread the recipient is part of — and only that.
 *
 * `settlement_comments` holds every party's remarks on the event, so an
 * unfiltered read would hand a link-holder the venue's conversation with a
 * different performer. Three things are visible: the recipient's own comments,
 * comments written by their party, and comments from the event side (no party, no
 * off-platform author — i.e. the operator's own).
 */
async function loadComments(
  // biome-ignore lint/suspicious/noExplicitAny: Drizzle db/tx handle.
  database: any,
  eventId: string,
  party: RecipientParty | null,
  viewerEmail: string | null,
): Promise<z.infer<typeof DocumentComment>[]> {
  const mine = [
    party ? eq(schema.settlementComments.partyParticipantId, party.participantId) : undefined,
    viewerEmail ? eq(schema.settlementComments.authorEmail, viewerEmail) : undefined,
    and(
      isNull(schema.settlementComments.partyParticipantId),
      isNull(schema.settlementComments.authorEmail),
    ),
  ].filter((clause) => clause !== undefined);

  const rows = (await database
    .select()
    .from(schema.settlementComments)
    .where(and(eq(schema.settlementComments.eventId, eventId), or(...mine)))
    .orderBy(
      asc(schema.settlementComments.createdAt),
    )) as (typeof schema.settlementComments.$inferSelect)[];

  return rows.map((row) => ({
    id: row.id,
    section: row.section ?? null,
    authorName: row.authorName ?? null,
    authorEmail: row.authorEmail ?? null,
    message: row.message,
    createdAt: row.createdAt.toISOString(),
    isYours: viewerEmail != null && row.authorEmail === viewerEmail,
  }));
}
