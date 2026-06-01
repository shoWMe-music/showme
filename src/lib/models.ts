import type { BudgetCalculatorPersisted } from "./budget-types";

/**
 * Persisted profile-level fields beyond the core SharedProfile shape.
 * Keep this interface narrow — it documents fields that are stored on the
 * profile document but live outside the canonical SharedProfile interface
 * (which is defined in user-context.tsx). Components read/write through
 * `saveProfile` and structurally typed casts.
 *
 * customRoles: user-curated role strings (e.g. "Lighting Wrangler") that
 * surface in Crew/Team role pickers alongside the hardcoded presets.
 * Deduped on save. Persisted on the host profile so a user's own custom
 * vocabulary follows them across all events under that profile.
 */
export interface ProfileExtensions {
  customRoles?: string[];
}

export type EventStatus = "draft" | "suggested" | "pending" | "confirmed" | "on_hold" | "concluded" | "cancelled";

export type SettlementStatus = "open" | "pending_review" | "comments_received" | "revised" | "finalized" | "partly_paid" | "paid" | "dispute";

export type DealType = "guarantee" | "door_split" | "guarantee_vs_door" | "rental";

export const eventStatusLabels: Record<EventStatus, string> = {
  draft: "Draft",
  suggested: "Suggested",
  pending: "Pending",
  confirmed: "Confirmed",
  on_hold: "On Hold",
  concluded: "Concluded",
  cancelled: "Cancelled",
};

export const settlementStatusLabels: Record<SettlementStatus, string> = {
  open: "Open",
  pending_review: "Pending Review",
  comments_received: "Comments Received",
  revised: "Revised",
  finalized: "Finalized",
  partly_paid: "Partly Paid",
  paid: "Paid",
  dispute: "Dispute",
};

export type EventCollaboratorRole =
  | "admin"
  | "venue"
  | "promoter"
  | "organizer"
  | "festival"
  | "performer"
  | "agent"
  | "staff";

export interface Event {
  id: string;
  name: string;
  date: string;
  /** Show start time, e.g. "20:00" */
  startTime?: string;
  /** Show end time / expected end, e.g. "23:00" */
  endTime?: string;
  /** Door open time, e.g. "19:00" */
  doorTime?: string;
  /** Hard curfew time, e.g. "23:30" */
  curfew?: string;
  venue: string;
  operator: string;
  operatorType: "promoter" | "venue" | "organizer";
  capacity: number;
  artist: string;
  eventStatus: EventStatus;
  status: SettlementStatus;
  archived?: boolean;
  published?: boolean;
  /** The profile that created and owns this event (venue/promoter/organizer/festival). */
  hostProfileId?: string;
  /** All profile IDs with access — denormalized for querying. Maintained alongside participants subcollection. */
  accessProfileIds?: string[];
  /** All uids with access — denormalized for Firestore security rules. Includes host profile members + direct collaborators. */
  accessUids?: string[];
  /**
   * Uids permitted to edit the event (admin + editor permission). Denormalized
   * for Firestore rules — host profile members are NOT listed here (their
   * write power flows from profile membership). View-only collaborators are
   * also absent. Maintained by every callable/client that touches the
   * collaborators subcollection.
   *
   * Legacy events lack this field; rules treat its absence as "fall back to
   * accessUids" so pre-permissions events keep working until a new invite
   * flows through and populates the array.
   */
  editorUids?: string[];
  /**
   * Uids of non-host collaborator-admins (permission === "admin"). Denormalized
   * so Firestore rules can authorize collaborator-management writes without
   * scanning the subcollection. Host profile members are NOT in this array —
   * their admin power flows from profile membership via `isHostAdmin`.
   *
   * Missing on legacy events; rules fall back to host-only collaborator
   * management until the first non-host admin is assigned.
   */
  adminUids?: string[];
  /** On child (performer) events: the performer's profile ID. */
  performerProfileId?: string;
  /** Role tag for the performer on this event (e.g. Headliner, Support, Special Guest). */
  performerRoleTag?: "headliner" | "support" | "special_guest" | "dj" | "opener";
  /** Set when this event was created from an inbound booking request. */
  sourceRequestId?: string;
  /** The date the performer originally requested (from the booking request). Used to detect date changes. */
  sourceRequestDate?: string;
  isMultiPerformer?: boolean;
  parentEventId?: string;
  childEventIds?: string[];
  roomStage?: string;
  stageCapacity?: number;
  /** Where the event sells tickets. Each entry pairs a provider with a purchase URL. */
  tickets?: { provider: string; url: string }[];
  /** Performer's response to an event invitation: "accepted" → pending, "declined" → host notified. */
  performerResponse?: "accepted" | "declined";
  /** 1st hold, 2nd hold, etc. Only relevant when eventStatus === "on_hold". */
  holdRank?: number;
  /** If true, automatically promote this hold to confirmed when higher-ranked holds are removed. */
  holdAutoPromote?: boolean;
  /** Set when the system auto-cancelled this event because its date passed without confirmation. */
  autoCancelledReason?: "expired_unconfirmed";
  /**
   * Performer-initiated draft handoff: a Free Artist created this draft event
   * from a booking-request card and invited a venue to take over management.
   * While true, `hostProfileId` points at an unclaimed venue profile owned by
   * the performer who created it (see `createdByProfileId`). The event must
   * stay in `draft` status until the venue accepts the invitation and the
   * profile transfers to them — `claimInvitationCode` clears these fields.
   */
  pendingHostHandoff?: boolean;
  /** Email address the handoff invitation was sent to. Display-only. */
  pendingHostHandoffInviteEmail?: string;
  /** The performer profile that initiated this handoff. Display + cancel gate. */
  createdByProfileId?: string;
  /** Venue amenities for the event. Seeded from the venue profile on create; editable in Details tab. */
  amenities?: string[];
  /** Catering arrangements / dietary notes for the event. Seeded from the venue profile on create. */
  cateringNotes?: string;
  /** Accommodation arrangements for the event. Seeded from the venue profile on create. */
  accommodationNotes?: string;
  /** Free-form notes for the event. Long-form. */
  notes?: string;
  /** @deprecated Use hostProfileId. Kept for Firestore rule compatibility during transition. */
  owner_uid?: string;
  /** @deprecated Use hostProfileId. */
  primary_owner_uid?: string;
  /** @deprecated Use accessUids. */
  participant_uids?: string[];
  /** @deprecated Role info lives in participants subcollection. */
  participant_roles?: Record<string, EventCollaboratorRole>;
}

export interface CommissionParty {
  key: string;
  label: string;
  name: string;
  percentage: number;
}

export interface DealStructure {
  eventId: string;
  dealType: DealType;
  artistGuarantee: number;
  artistSplit: number;
  promoterSplit: number;
  venueSplit: number;
  organizerSplit: number;
  artistCostSplit: number;
  promoterCostSplit: number;
  venueCostSplit: number;
  organizerCostSplit: number;
  venueRental: number;
  venueRentalPaidBy?: string; // "promoter" | "artist" | "organizer" | "split"
  venueRentalPaymentMode?: "request_now" | "deduct_at_settlement";
  /** Revenue threshold that triggers a performance bonus for the performer. */
  performanceBonusThreshold?: number;
  /** Fixed bonus amount added to performer payout when revenue exceeds the threshold. */
  performanceBonusAmount?: number;
  commissions: CommissionParty[];
}

export interface VatInfo {
  rate: number;        // 0, 6, 7, 19, 25, or custom
  mode: "included" | "on_top";
}

export type InvoiceStatus = "no_invoice" | "invoice_needed" | "ready_to_pay";

export const invoiceStatusLabels: Record<InvoiceStatus, string> = {
  no_invoice: "No invoice needed",
  invoice_needed: "Invoice needed",
  ready_to_pay: "Ready to pay",
};

export interface TicketType {
  name: string;
  price: number;
  sold: number;
}

export interface AdditionalRevenueField {
  name: string;
  amount: number;
  vat?: VatInfo;
}

export interface PartySplit {
  party: string;
  percentage: number;
}

export interface CustomDeductionField {
  name: string;
  type: "fixed" | "percentage";
  amount: number; // fixed amount or percentage value
  sourceField?: string; // for percentage: which revenue field to calculate from
  // Fixed type: transfer from one party to another
  fromParty?: string;
  toParty?: string;
  // Percentage type: split among parties (must total 100%)
  partySplits?: PartySplit[];
  vat?: VatInfo;
}

export interface CustomCostField {
  name: string;
  amount: number;
  fromParty?: string; // who pays
  vat?: VatInfo;
}

export interface TicketRevenue {
  eventId: string;
  ticketsSold: number;
  grossRevenue: number;
  ticketFees: number;
  tax: number;
  refunds: number;
  doorSales: number;
  productionExpenses: number;
  additionalCosts: number;
  ticketTypes?: TicketType[];
  doorSalesTypes?: TicketType[];
  additionalRevenue?: AdditionalRevenueField[];
  additionalDeductions?: CustomDeductionField[];
  customCosts?: CustomCostField[];
}

export interface ProviderEvent {
  providerId: string;
  name: string;
  artist: string;
  venue: string;
  date: string;
  ticketTypes: TicketType[];
  ticketFees: number;
  tax: number;
  refunds: number;
  doorSales: number;
}

export interface SettlementRevision {
  date: string;
  by: string;
  changes: string;
}

export type EventActivityType =
  | "status_changed"
  | "details_updated"
  | "rider_updated"
  | "schedule_updated"
  | "agreement_updated"
  | "crew_updated"
  | "archived"
  | "unarchived"
  | "date_change_proposed"
  | "date_change_confirmed"
  | "date_change_declined"
  | "performer_accepted"
  | "performer_declined"
  | "agreement_confirmed"
  | "approvals_reset"
  | "performer_added"
  | "performer_removed";

export interface EventActivity {
  id: string;
  type: EventActivityType;
  timestamp: string;
  by: string;
  /** Profile name the user was acting as (e.g. "Sunset Venue"). */
  profile?: string;
  details?: Record<string, string>;
  /** When set to "operator_only", entry is hidden from performers. Defaults to "all". */
  visibility?: "all" | "operator_only";
}

export type SettlementActivityType =
  | "settlement_created"
  | "status_changed"
  | "comment_added"
  | "revenue_updated"
  | "deal_updated"
  | "revision_added"
  | "approval_changed";

export interface SettlementActivity {
  id: string;
  type: SettlementActivityType;
  timestamp: string; // ISO 8601
  by: string;
  /** Profile name the user was acting as (e.g. "Sunset Venue"). */
  profile?: string;
  details?: Record<string, string>;
}

export interface Settlement {
  eventId: string;
  artistPayout: number;
  promoterPayout: number;
  venuePayout: number;
  commissionPayouts: { key: string; label: string; name: string; payout: number }[];
  status: SettlementStatus;
  approvals: { party: string; approved: boolean; date?: string }[];
  comments: { party: string; message: string; date: string; attachments?: { name: string; size: number; type: string; fileUrl: string }[] }[];
  revisions: SettlementRevision[];
}

export interface PartyBreakdown {
  party: string;
  baseAmount: number;
  adjustments: { label: string; amount: number; vat?: VatInfo }[];
  finalPayout: number;
  invoiceStatus?: InvoiceStatus;
}

export function calculateSettlement(deal: DealStructure, revenue: TicketRevenue): Omit<Settlement, "status" | "approvals" | "comments" | "revisions"> & { partyBreakdowns: PartyBreakdown[] } {
  // Total additional revenue
  const totalAdditionalRevenue = (revenue.additionalRevenue || []).reduce((s, r) => s + r.amount, 0);

  // Calculate custom deduction totals
  const totalCustomDeductions = (revenue.additionalDeductions || []).reduce((s, d) => {
    if (d.type === "percentage" && d.sourceField) {
      const sourceAmount = getSourceFieldAmount(d.sourceField, revenue, totalAdditionalRevenue);
      return s + (sourceAmount * d.amount / 100);
    }
    return s + d.amount;
  }, 0);

  // Split custom costs: unassigned go to production cost pool, assigned deduct from specific party
  const unassignedCustomCosts = (revenue.customCosts || []).filter(c => !c.fromParty).reduce((s, c) => s + c.amount, 0);
  const assignedCustomCosts = (revenue.customCosts || []).filter(c => !!c.fromParty);
  const totalCustomCosts = (revenue.customCosts || []).reduce((s, c) => s + c.amount, 0);

  const totalRevenue = revenue.grossRevenue + revenue.doorSales + totalAdditionalRevenue;
  const totalDeductions = revenue.ticketFees + revenue.tax + revenue.refunds + revenue.productionExpenses + revenue.additionalCosts + totalCustomDeductions + totalCustomCosts;
  const netRevenue = totalRevenue - totalDeductions;

  // Venue rental handling: deduct from net only if not party-specific
  const venueRentalPaidBy = deal.venueRentalPaidBy || "promoter";
  const adjustedNet = netRevenue - deal.venueRental;

  let promoterPayout = adjustedNet * (deal.promoterSplit / 100);
  let venuePayout = deal.venueRental + adjustedNet * (deal.venueSplit / 100);
  let organizerPayout = adjustedNet * ((deal.organizerSplit || 0) / 100);

  // Track per-party breakdown
  const artistAdj: { label: string; amount: number }[] = [];
  const promoterAdj: { label: string; amount: number }[] = [];
  const venueAdj: { label: string; amount: number }[] = [];
  const organizerAdj: { label: string; amount: number }[] = [];

  let artistBaseLabel = "";
  let artistBaseAmount = 0;
  let promoterBase = adjustedNet * (deal.promoterSplit / 100);
  let venueBase = deal.venueRental + adjustedNet * (deal.venueSplit / 100);
  let organizerBase = adjustedNet * ((deal.organizerSplit || 0) / 100);

  // Venue rental paid-by adjustments
  if (deal.venueRental > 0) {
    if (venueRentalPaidBy === "performer") {
      artistAdj.push({ label: "Venue Rental (paid by Performer)", amount: -deal.venueRental });
    } else if (venueRentalPaidBy === "organizer") {
      organizerAdj.push({ label: "Venue Rental (paid by Organizer)", amount: -deal.venueRental });
      organizerPayout -= deal.venueRental;
    } else if (venueRentalPaidBy === "split" && ((deal.promoterCostSplit > 0 || deal.venueCostSplit > 0 || (deal.organizerCostSplit || 0) > 0))) {
      const promoterRentalShare = deal.venueRental * (deal.promoterCostSplit / 100);
      const venueRentalShare = deal.venueRental * (deal.venueCostSplit / 100);
      const organizerRentalShare = deal.venueRental * ((deal.organizerCostSplit || 0) / 100);
      if (promoterRentalShare > 0) promoterAdj.push({ label: `Venue Rental share (${deal.promoterCostSplit}%)`, amount: -promoterRentalShare });
      if (venueRentalShare > 0) venueAdj.push({ label: `Venue Rental share (${deal.venueCostSplit}%)`, amount: -venueRentalShare });
      if (organizerRentalShare > 0) organizerAdj.push({ label: `Venue Rental share (${deal.organizerCostSplit}%)`, amount: -organizerRentalShare });
      promoterPayout -= promoterRentalShare;
      venuePayout -= venueRentalShare;
      organizerPayout -= organizerRentalShare;
    } else {
      // Default: promoter pays
      promoterAdj.push({ label: "Venue Rental (paid by Promoter)", amount: -deal.venueRental });
      promoterPayout -= deal.venueRental;
    }
  }

  // Apply production cost split if defined (using only unassigned custom costs)
  let _artistProdCostDeduction = 0;
  if ((deal.artistCostSplit || 0) > 0 || deal.promoterCostSplit > 0 || deal.venueCostSplit > 0 || (deal.organizerCostSplit || 0) > 0) {
    const totalProdCosts = revenue.productionExpenses + unassignedCustomCosts;
    const artistCostShare = totalProdCosts * ((deal.artistCostSplit || 0) / 100);
    const promoterCostShare = totalProdCosts * (deal.promoterCostSplit / 100);
    const venueCostShare = totalProdCosts * (deal.venueCostSplit / 100);
    const organizerCostShare = totalProdCosts * ((deal.organizerCostSplit || 0) / 100);
    if (artistCostShare > 0) artistAdj.push({ label: `Production cost share (${deal.artistCostSplit}%)`, amount: -artistCostShare });
    promoterPayout -= promoterCostShare;
    venuePayout -= venueCostShare;
    organizerPayout -= organizerCostShare;
    if (promoterCostShare > 0) promoterAdj.push({ label: `Production cost share (${deal.promoterCostSplit}%)`, amount: -promoterCostShare });
    if (venueCostShare > 0) venueAdj.push({ label: `Production cost share (${deal.venueCostSplit}%)`, amount: -venueCostShare });
    if (organizerCostShare > 0) organizerAdj.push({ label: `Production cost share (${deal.organizerCostSplit}%)`, amount: -organizerCostShare });
    // Track artist cost for later deduction
    _artistProdCostDeduction = artistCostShare;
  } else {
    _artistProdCostDeduction = 0;
  }

  let artistBase = 0;
  if (deal.dealType === "guarantee") {
    artistBase = deal.artistGuarantee;
    artistBaseLabel = "Guarantee";
    artistBaseAmount = deal.artistGuarantee;
  } else if (deal.dealType === "door_split") {
    artistBase = adjustedNet * (deal.artistSplit / 100);
    artistBaseLabel = `Split share (${deal.artistSplit}%)`;
    artistBaseAmount = artistBase;
  } else if (deal.dealType === "guarantee_vs_door") {
    const splitAmount = adjustedNet * (deal.artistSplit / 100);
    artistBase = Math.max(deal.artistGuarantee, splitAmount);
    artistBaseLabel = artistBase === deal.artistGuarantee ? "Guarantee (higher)" : `Split share (${deal.artistSplit}%, higher)`;
    artistBaseAmount = artistBase;
  } else {
    venuePayout = deal.venueRental;
    venueBase = deal.venueRental;
    promoterPayout = adjustedNet * (deal.promoterSplit / 100);
    promoterBase = promoterPayout;
    artistBase = deal.artistGuarantee > 0 ? deal.artistGuarantee : adjustedNet * (deal.artistSplit / 100);
    artistBaseLabel = deal.artistGuarantee > 0 ? "Guarantee" : `Split share (${deal.artistSplit}%)`;
    artistBaseAmount = artistBase;
  }

  // Apply custom deduction party adjustments
  const partyAdjustments: Record<string, number> = { artist: 0, promoter: 0, venue: 0, organizer: 0 };
  for (const d of (revenue.additionalDeductions || [])) {
    if (d.type === "fixed" && d.fromParty && d.toParty) {
      partyAdjustments[d.fromParty] -= d.amount;
      partyAdjustments[d.toParty] += d.amount;
      const adjMap: Record<string, { label: string; amount: number }[]> = { artist: artistAdj, promoter: promoterAdj, venue: venueAdj, organizer: organizerAdj };
      if (adjMap[d.fromParty]) adjMap[d.fromParty].push({ label: `${d.name} → ${d.toParty}`, amount: -d.amount });
      if (adjMap[d.toParty]) adjMap[d.toParty].push({ label: `${d.name} ← ${d.fromParty}`, amount: d.amount });
    } else if (d.type === "percentage" && d.partySplits && d.partySplits.length > 0 && d.sourceField) {
      const sourceAmount = getSourceFieldAmount(d.sourceField, revenue, totalAdditionalRevenue);
      const totalSplitAmount = sourceAmount * d.amount / 100;
      for (const split of d.partySplits) {
        const splitAmt = totalSplitAmount * (split.percentage / 100);
        partyAdjustments[split.party] = (partyAdjustments[split.party] || 0) + splitAmt;
        const adjMap: Record<string, { label: string; amount: number }[]> = { artist: artistAdj, promoter: promoterAdj, venue: venueAdj, organizer: organizerAdj };
        if (adjMap[split.party]) adjMap[split.party].push({ label: `${d.name} (${split.percentage}% of ${d.amount}% ${d.sourceField})`, amount: splitAmt });
      }
    }
  }

  // Apply custom cost party adjustments (only assigned costs — unassigned are in prod cost pool)
  for (const c of assignedCustomCosts) {
    partyAdjustments[c.fromParty!] -= c.amount;
    const adjMap: Record<string, { label: string; amount: number }[]> = { artist: artistAdj, promoter: promoterAdj, venue: venueAdj, organizer: organizerAdj };
    if (adjMap[c.fromParty!]) adjMap[c.fromParty!].push({ label: `${c.name} (cost)`, amount: -c.amount });
  }

  artistBase += partyAdjustments.artist - _artistProdCostDeduction;
  promoterPayout += partyAdjustments.promoter;
  venuePayout += partyAdjustments.venue;
  organizerPayout += (partyAdjustments.organizer || 0);

  let remainder = artistBase;
  const commissionPayouts = deal.commissions.map((c) => {
    const payout = Math.round(remainder * (c.percentage / 100) * 100) / 100;
    remainder -= payout;
    return { key: c.key, label: c.label, name: c.name, payout };
  });

  // Add commission deductions to artist adjustments
  for (const cp of commissionPayouts) {
    if (cp.payout > 0) {
      artistAdj.push({ label: `${cp.label} (${cp.name})`, amount: -cp.payout });
    }
  }

  // Performance bonus: add to performer payout if revenue exceeds threshold
  if (deal.performanceBonusThreshold && deal.performanceBonusAmount && totalRevenue >= deal.performanceBonusThreshold) {
    remainder += deal.performanceBonusAmount;
    artistAdj.push({ label: "Performance Bonus", amount: deal.performanceBonusAmount });
  }

  // Build party breakdowns
  const partyBreakdowns: PartyBreakdown[] = [
    { party: "Performer", baseAmount: artistBaseAmount, adjustments: artistAdj, finalPayout: Math.round(remainder * 100) / 100 },
    { party: "Promoter", baseAmount: Math.round(promoterBase * 100) / 100, adjustments: promoterAdj, finalPayout: Math.round(promoterPayout * 100) / 100 },
    { party: "Venue", baseAmount: Math.round(venueBase * 100) / 100, adjustments: venueAdj, finalPayout: Math.round(venuePayout * 100) / 100 },
    ...((deal.organizerSplit || 0) > 0 || organizerAdj.length > 0 ? [{ party: "Organizer", baseAmount: Math.round(organizerBase * 100) / 100, adjustments: organizerAdj, finalPayout: Math.round(organizerPayout * 100) / 100 }] : []),
  ];

  // Add commission parties
  for (const cp of commissionPayouts) {
    if (cp.payout > 0) {
      partyBreakdowns.push({ party: `${cp.label} (${cp.name})`, baseAmount: cp.payout, adjustments: [], finalPayout: cp.payout });
    }
  }

  return {
    eventId: deal.eventId,
    artistPayout: Math.round(remainder * 100) / 100,
    promoterPayout: Math.round(promoterPayout * 100) / 100,
    venuePayout: Math.round(venuePayout * 100) / 100,
    commissionPayouts,
    partyBreakdowns,
  };
}

function getSourceFieldAmount(sourceField: string, revenue: TicketRevenue, totalAdditionalRevenue: number): number {
  switch (sourceField) {
    case "grossRevenue": return revenue.grossRevenue;
    case "doorSales": return revenue.doorSales;
    case "ticketSales": return revenue.grossRevenue;
    case "totalRevenue": return revenue.grossRevenue + revenue.doorSales + totalAdditionalRevenue;
    default: {
      // Check additional revenue fields by name
      const found = (revenue.additionalRevenue || []).find(r => r.name === sourceField);
      return found ? found.amount : 0;
    }
  }
}


export function getCurrencySymbol(currency: string = "EUR"): string {
  const symbols: Record<string, string> = { EUR: "€", USD: "$", GBP: "£", SEK: "kr" };
  return symbols[currency] || currency;
}

export function formatCurrency(amount: number, currency: string = "EUR"): string {
  return new Intl.NumberFormat("en-EU", { style: "currency", currency }).format(amount);
}

export function getStatusLabel(status: SettlementStatus): string {
  return settlementStatusLabels[status];
}

export function getEventStatusLabel(status: EventStatus): string {
  return eventStatusLabels[status];
}

// ── Calendar item types ──

export type CalendarItemType = "task" | "appointment" | "note";

export interface CalendarItem {
  id: string;
  type: CalendarItemType;
  title: string;
  date: string;
  description?: string;
  startTime?: string;
  endTime?: string;
  calendarEntity?: string;
  /** When set, item lives under profiles/{profileId}/calendar_items and is visible to all profile members. */
  profileId?: string;
  /** UID of the assigned user. Defaults to the creator. */
  assigneeUid?: string;
  /** Display name of the assignee (denormalized for rendering). */
  assigneeName?: string;
}

export const calendarItemTypeLabels: Record<CalendarItemType, string> = {
  task: "Task",
  appointment: "Appointment",
  note: "Note",
};

// ── Contact types ──

export type ContactType = "promoter" | "venue" | "performer" | "ticketing" | "agent" | "manager" | "production" | (string & {});

export interface ContactPerson {
  name: string;
  email: string;
  phone: string;
}

export interface Contact {
  id: string;
  name: string;
  type: ContactType | ContactType[];
  contacts: ContactPerson[];
  iban: string;
  bankName: string;
  vatId: string;
  address: string;
  notes: string;
  /** Code of the invitation this contact was auto-created from (Wave 7). */
  invitationCode?: string;
  /** Mirrors the linked InvitationCode.status so list-page filters can avoid a join. */
  invitationStatus?: "active" | "used" | "accepted" | "revoked";
}

export const contactTypeLabels: Record<string, string> = {
  promoter: "Promoter",
  venue: "Venue",
  performer: "Performer",
  ticketing: "Ticketing Provider",
  agent: "Agent",
  manager: "Manager",
  production: "Production Company",
};

// ── Public request form types ──

export interface SocialLink {
  platform: string;
  url: string;
}

/**
 * Where this booking request came from. Drives sender-side rendering (Sent
 * Requests page) and gating (rate limits, attestation modal).
 *
 * - `public_form`: unauthenticated submission via /request/[slug] widget.
 * - `performer_offer`: cold pitch sent by a performer through the offer
 *   composer. Always has sender_profile_id + sender_user_uid populated.
 * - `venue_handoff`: legacy bridge from Flow A (draft+invite). Not currently
 *   written but reserved so a future migration can backfill it.
 */
export type BookingRequestSource = "public_form" | "performer_offer" | "venue_handoff";

export interface BookingRequest {
  id: string;
  created_at: string;
  name: string;
  email: string;
  phone: string;
  artist_name: string;
  wanted_date: string;
  artist_fee: number | null;
  note: string;
  target_profile_slug: string;
  /**
   * Profile ID the request is addressed to. Required for admin/member access via
   * the `profileIds` token claim (rule + client query both read this field).
   * `target_profile_slug` is kept alongside for legacy display paths.
   * Older docs may not have this; the backfill script populates it.
   */
  target_profile_id: string;
  target_role: string;
  status: string;
  source: BookingRequestSource | string;
  event_id: string;
  music_url?: string;
  video_url?: string;
  // Wave 7 additions — public request form
  sender_type?: string;
  genres?: string[];
  performer_type?: string;
  website_url?: string;
  social_links?: SocialLink[];

  // ── Performer offer (Flow B) additions ──
  // Populated when source === "performer_offer". The sender_user_uid path is
  // also what the Firestore rule honors so the performer can read their own
  // outgoing requests on the Sent Requests page.
  /** UID of the performer-user who created the offer. */
  sender_user_uid?: string;
  /** Performer profile ID the offer was sent from. */
  sender_profile_id?: string;
  /** Denormalized display name (artist) for the Sent Requests list. */
  sender_profile_name?: string;
  /** Free-form pitch message written by the performer. */
  offer_pitch?: string;
  /** Lower bound of the proposed fee. For a single value, equals offer_fee_max. */
  offer_fee_min?: number | null;
  /** Upper bound of the proposed fee. */
  offer_fee_max?: number | null;
  /** Other dates the performer is available, ISO strings. */
  additional_dates?: string[];
  /** ISO timestamp at which an un-actioned offer auto-archives (30 days from send). */
  expires_at?: string;
  /** Which delivery path was used. `in_platform` = venue had a shoWMe account; `mailto` = generated for the performer's own email client. */
  sent_via?: "in_platform" | "mailto";
  /** Optional reason captured when the venue declines. */
  declined_reason?: string;
  /** Set when the offer was archived (manually by sender, or by the 30-day reaper). */
  archived?: boolean;
}

// ── Event Manager extended types ──

export type RiderType = "technical" | "hospitality" | "catering" | "custom";

export interface Rider {
  id: string;
  name: string;
  type: RiderType;
  description?: string;
  fileUrl?: string;
  fileName?: string;
  /** Profile ID of the collaborator who owns this rider (controls write access). */
  ownerProfileId?: string;
}

export const riderTypeLabels: Record<RiderType, string> = {
  technical: "Technical Rider",
  hospitality: "Hospitality Rider",
  catering: "Catering Rider",
  custom: "Custom Rider",
};

export type AgreementType = "terms" | "rental" | "collaboration" | "custom";

export interface Agreement {
  id: string;
  type: AgreementType;
  name: string;
  status: "draft" | "sent" | "signed";
  fileUrl?: string;
  fileName?: string;
  /** Profile ID of the collaborator who owns this agreement (controls write access). */
  ownerProfileId?: string;
}

export const agreementTypeLabels: Record<AgreementType, string> = {
  terms: "Terms & Conditions",
  rental: "Rental Agreement",
  collaboration: "Collaboration Agreement",
  custom: "Custom Document",
};

export interface CrewMember {
  id: string;
  name: string;
  role: string;
  email?: string;
  phone?: string;
  collaborator?: string;
  /** Profile ID of the collaborator who owns this crew entry (controls write access). */
  ownerProfileId?: string;
  /** Original team member ID when added from team directory (used for dedup). */
  teamMemberId?: string;
}

/** Legacy UI used invited/accepted; prefer pending/active. */
export type CollaboratorStatus = "pending" | "active" | "declined" | "revoked" | "invited" | "accepted";

export const eventCollaboratorRoleLabels: Record<EventCollaboratorRole, string> = {
  admin: "Event admin",
  venue: "Venue",
  promoter: "Promoter",
  organizer: "Organizer",
  festival: "Festival",
  performer: "Performer",
  agent: "Agent",
  staff: "Staff",
};

/**
 * Edit-power tier for an event collaborator. Independent of eventRole, which
 * labels what they are (Performer / Venue / Agent). Host profile members are
 * implicitly admin and don't appear in the collaborators subcollection.
 *
 * - admin: edit everything (including financials) + manage collaborators
 * - editor: edit non-financial event details; settlement/deal/revenue/budget
 *           are read-only
 * - view_only: read-only across the board
 */
export type CollaboratorPermission = "admin" | "editor" | "view_only";

export const collaboratorPermissionLabels: Record<CollaboratorPermission, string> = {
  admin: "Admin",
  editor: "Editor",
  view_only: "View only",
};

export const collaboratorPermissionDescriptions: Record<CollaboratorPermission, string> = {
  admin: "Full access — can edit, invite others, and manage settings",
  editor: "Can edit event details, but not financial information",
  view_only: "Can only view event information",
};

/** Default applied when a collaborator doc is missing the field (legacy rows). */
export const DEFAULT_COLLABORATOR_PERMISSION: CollaboratorPermission = "editor";

export interface EventCollaborator {
  id: string;
  email: string;
  /** Fixed role for permissions on this event. */
  eventRole: EventCollaboratorRole;
  /** @deprecated display-only; use eventRole */
  role?: string;
  name: string;
  status: CollaboratorStatus;
  invitedAt: string;
  userUid?: string;
  profileId?: string;
  inviteProfileSlug?: string;
  /** Edit-power tier. Missing on legacy rows — read with `DEFAULT_COLLABORATOR_PERMISSION` fallback. */
  permission?: CollaboratorPermission;
}

export function normalizeCollaboratorStatus(status: string): CollaboratorStatus {
  if (status === "invited") return "pending";
  if (status === "accepted") return "active";
  if (status === "pending" || status === "active" || status === "declined" || status === "revoked") {
    return status;
  }
  return "pending";
}

export function collaboratorIsActive(status: CollaboratorStatus | string): boolean {
  return status === "active" || status === "accepted";
}

export function collaboratorIsPendingInvite(status: CollaboratorStatus | string): boolean {
  return status === "pending" || status === "invited";
}

export function legacyRoleToEventRole(role: string): EventCollaboratorRole {
  const r = role.toLowerCase();
  const map: Record<string, EventCollaboratorRole> = {
    admin: "admin",
    venue: "venue",
    promoter: "promoter",
    organizer: "organizer",
    festival: "festival",
    performer: "performer",
    agent: "agent",
    staff: "staff",
  };
  return map[r] || "staff";
}

export interface ScheduleItem {
  id: string;
  time: string;
  label: string;
  description?: string;
  /** Profile ID of the collaborator who owns this schedule item (controls write access). */
  ownerProfileId?: string;
  /** Room/stage name for multi-room venues. */
  roomStage?: string;
}

export type AmenityKey =
  | "backline" | "partial_backline" | "no_backline" | "sound_engineer" | "lighting" | "light_engineer"
  | "parking" | "accommodation" | "catering" | "pa_system";

export const amenityLabels: Record<AmenityKey, string> = {
  backline: "Full Backline",
  partial_backline: "Partial Backline",
  no_backline: "No Backline",
  pa_system: "PA System",
  sound_engineer: "Sound Engineer",
  lighting: "Lighting",
  light_engineer: "Light Engineer",
  parking: "Parking",
  accommodation: "Accommodation",
  catering: "Catering",
};

export interface ExpenseItem {
  id: string;
  category: string;
  amount: number;
  description?: string;
}

// ── PRO Fee Estimation Types ──

export type ProCode = "none" | "stim" | "gema";

export type ProEventType = "live_concert" | "dj_event" | "mixed_event" | "free_entry" | "subsidized" | "other";

export const proEventTypeLabels: Record<ProEventType, string> = {
  live_concert: "Live Concert",
  dj_event: "DJ Event",
  mixed_event: "Mixed Event",
  free_entry: "Free Entry",
  subsidized: "Subsidized",
  other: "Other",
};

export type ProConfidence = "high" | "medium" | "estimate_only";

export interface ProTariff {
  pro_code: ProCode;
  country: string;
  event_type: ProEventType | "all";
  percentage_rate: number;
  percentage_rate_high?: number;
  price_threshold?: number;
  minimum_fee: number;
  complimentary_ticket_fee: number;
  flat_fee: number;
  currency: string;
  estimate_only: boolean;
  tariff_last_updated: string;
  notes: string;
}

export interface ProEstimate {
  pro: ProCode;
  country: string;
  eventType: ProEventType;
  ticketPrice: number;
  vatMode: "inclusive" | "exclusive";
  expectedTickets: number;
  compTickets: number;
  venueCapacity: number;
  estimatedFee: number;
  manualOverride: boolean;
  manualValue: number;
  confidence: ProConfidence;
  tariffVersion: string;
}

export interface SetlistEntry {
  title: string;
  composer: string;
  lyricist: string;
  publisher: string;
  order: number;
  proWorkId?: string;
}

export interface ProReportingData {
  finalTicketsSold: number;
  finalRevenue: number;
  attendance: number;
  organizerName: string;
  organizerContact: string;
  venueName: string;
  venueCity: string;
  venueCountry: string;
  eventDate: string;
  artists: string[];
  setlist: SetlistEntry[];
  preEventEstimate: number;
  postEventEstimate: number;
  reportingStatus: "awaiting_settlement" | "final_estimate_ready" | "needs_reporting_data";
}

const EXCHANGE_RATES: Record<string, number> = { SEK: 11.5, EUR: 1, GBP: 0.86, USD: 1.08 };

export function calculateProFee(estimate: ProEstimate): { fee: number; confidence: ProConfidence; basis: string } {
  if (estimate.pro === "none") return { fee: 0, confidence: "high", basis: "No PRO selected" };

  if (estimate.pro === "stim") {
    if (estimate.eventType === "subsidized") {
      return { fee: 27.30 / EXCHANGE_RATES.SEK, confidence: "high", basis: "Flat fee 27.30 SEK for subsidized concert" };
    }
    const ticketPriceSEK = estimate.ticketPrice * EXCHANGE_RATES.SEK;
    const rate = ticketPriceSEK <= 675 ? 0.04 : 0.03;
    const ticketRevenue = estimate.ticketPrice * estimate.expectedTickets;
    const vatAdjusted = estimate.vatMode === "inclusive" ? ticketRevenue / 1.25 : ticketRevenue;
    const revenueSEK = vatAdjusted * EXCHANGE_RATES.SEK;
    const feeRevenue = revenueSEK * rate;
    const feeComp = estimate.compTickets * 5.28;
    const totalSEK = Math.max(feeRevenue + feeComp, 367);
    const totalEUR = totalSEK / EXCHANGE_RATES.SEK;
    const rateLabel = ticketPriceSEK <= 675 ? "4%" : "3%";
    return { fee: Math.round(totalEUR * 100) / 100, confidence: "high", basis: `${rateLabel} of ticket revenue + comp ticket fee (STIM)` };
  }

  if (estimate.pro === "gema") {
    const ticketRevenue = estimate.ticketPrice * estimate.expectedTickets;
    const vatAdjusted = estimate.vatMode === "inclusive" ? ticketRevenue / 1.19 : ticketRevenue;
    const fee = Math.max(vatAdjusted * 0.07, 20);
    return { fee: Math.round(fee * 100) / 100, confidence: "estimate_only", basis: "7% of ticket revenue (GEMA estimate)" };
  }

  return { fee: 0, confidence: "estimate_only", basis: "Unknown PRO" };
}

// ── Notifications ──

export type NotificationType =
  | "event_created"
  | "event_status_changed"
  | "event_details_updated"
  | "event_archived"
  | "event_unarchived"
  | "date_change_proposed"
  | "date_change_confirmed"
  | "date_change_declined"
  | "deal_updated"
  | "revenue_updated"
  | "settlement_status_changed"
  | "settlement_comment_added"
  | "settlement_revision_added"
  | "message_sent"
  | "collaborator_invited"
  | "collaborator_joined"
  | "event_invitation"
  | "booking_request_received"
  | "booking_request_responded"
  | "booking_request_status_changed"
  | "task_assigned"
  | "rider_updated"
  | "agreement_updated"
  | "agreement_confirmed"
  | "crew_updated"
  | "schedule_updated"
  | "profile_invite"
  | "profile_member_joined"
  | "profile_member_removed"
  | "profile_invite_declined"
  | "profile_member_role_changed"
  | "venue_handoff_pending"
  | "venue_handoff_accepted"
  | "venue_handoff_expiring"
  | "venue_handoff_cancelled";

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  /** The event this notification is about (if applicable). */
  eventId?: string;
  eventName?: string;
  /** Who triggered this notification. */
  actorName: string;
  actorUid: string;
  read: boolean;
  createdAt: string;
  /** Link path for click-through navigation. */
  link?: string;
  /** Extra data depending on notification type. */
  metadata?: Record<string, string>;
}

export const notificationTypeLabels: Record<NotificationType, string> = {
  event_created: "New event created",
  event_status_changed: "Event status changed",
  event_details_updated: "Event details updated",
  event_archived: "Event archived",
  event_unarchived: "Event unarchived",
  date_change_proposed: "Date change proposed",
  date_change_confirmed: "Date change confirmed",
  date_change_declined: "Date change declined",
  deal_updated: "Deal updated",
  revenue_updated: "Revenue updated",
  settlement_status_changed: "Settlement status changed",
  settlement_comment_added: "New comment on settlement",
  settlement_revision_added: "Settlement revision added",
  message_sent: "New message",
  collaborator_invited: "Collaborator invited",
  collaborator_joined: "Collaborator joined",
  event_invitation: "Event invitation",
  booking_request_received: "Booking request received",
  booking_request_responded: "Booking request response",
  booking_request_status_changed: "Booking request updated",
  task_assigned: "Task assigned",
  rider_updated: "Rider updated",
  agreement_updated: "Agreement updated",
  agreement_confirmed: "Agreement confirmed",
  crew_updated: "Crew updated",
  schedule_updated: "Schedule updated",
  profile_invite: "Profile invitation",
  profile_member_joined: "Profile member joined",
  profile_member_removed: "Profile member removed",
  profile_invite_declined: "Profile invite declined",
  profile_member_role_changed: "Profile role changed",
  venue_handoff_pending: "Venue management invitation",
  venue_handoff_accepted: "Venue accepted management",
  venue_handoff_expiring: "Venue invitation expiring soon",
  venue_handoff_cancelled: "Venue handoff cancelled",
};
