import { pgEnum } from "drizzle-orm/pg-core";

/**
 * Postgres enums shared across the schema. Kept in one place so a value can only
 * be added deliberately — these are the fixed vocabularies of the domain.
 */

/**
 * Account kind — fixed per account at signup, inherited by every profile the
 * account owns. Gates dashboard, features, and pricing (story.md). A cross-kind
 * person (e.g. promoter who also DJs) holds two accounts, not one dual-kind one.
 */
export const accountKind = pgEnum("account_kind", [
  "operator",
  "performer",
  "professional",
  "agent",
]);

/**
 * Profile-level membership role — per-profile, not global (a user may be admin on
 * one profile and editor on another). `admin` = owner-level minus owner-only
 * (billing/delete/transfer) and consumes a seat; the rest are free. Event-level
 * authority is data-driven via `permission_sets`, not this enum.
 */
export const profileMemberRole = pgEnum("profile_member_role", [
  "owner",
  "admin",
  "editor",
  "viewer",
  "crew",
]);

/** Kind of media attached to a profile. */
export const profileMediaKind = pgEnum("profile_media_kind", [
  "photo",
  "video",
  "banner",
  "avatar",
  "document",
]);

/**
 * Event lifecycle. Distinct from the `published` boolean (public visibility):
 * `on_hold` is the hold-ranking state (holdRankLogic); the rest are the booking
 * lifecycle. Vocabulary is the canonical set ported from the prior app
 * (`models.ts` `EventStatus`).
 */
export const eventStatus = pgEnum("event_status", [
  "draft",
  "suggested",
  "pending",
  "confirmed",
  "on_hold",
  "concluded",
  "cancelled",
]);

/**
 * A profile's role on an event. `host`/`co_host` are the managing operators;
 * `agent` is fanned out from a `representation` on the performer's in-region
 * events (decisions.md #14). Actual authority is the attached permission set.
 */
export const eventParticipantRole = pgEnum("event_participant_role", [
  "host",
  "co_host",
  "performer",
  "support",
  "crew_lead",
  "crew",
  "agent",
]);

/** Where a participant is in the invite→confirm flow. */
export const eventParticipantStatus = pgEnum("event_participant_status", [
  "invited",
  "accepted",
  "declined",
  "confirmed",
  "removed",
]);

/** Display billing tag for a performer participant (cosmetic, not authority). */
export const performerTag = pgEnum("performer_tag", ["headliner", "support", "dj", "opener"]);

/** The relationship/grouping a deal represents (its economic shape at a glance). */
export const dealType = pgEnum("deal_type", ["performance", "rental", "fee", "split", "custom"]);

/**
 * The settlement math a deal uses (canonical set ported from `models.ts`
 * `DealType`). NULL on the deal = a paper-only agreement with no computed math.
 */
export const dealStructure = pgEnum("deal_structure", [
  "guarantee",
  "door_split",
  "guarantee_vs_door",
  "rental",
]);

/** When a deal settles — drives pre-settlement vs at-settlement transfer timing. */
export const paymentTiming = pgEnum("payment_timing", [
  "before_event",
  "at_settlement",
  "due_date",
]);

/** Agreement lifecycle (the agreement is folded into the deal, decisions 2026-07). */
export const agreementStatus = pgEnum("agreement_status", ["draft", "sent", "confirmed", "signed"]);

/**
 * A party's role within one deal. `observer` = a read-only share with no
 * entitlement (how a co-host is granted deal visibility). `commission` is the
 * disclosed/off-the-top kind only — private agent commission settles separately.
 */
export const dealPartyRole = pgEnum("deal_party_role", [
  "payer",
  "payee",
  "split_member",
  "commission",
  "observer",
]);

/** Deal lifecycle. Assumed vocabulary — the prior app had no explicit deal-status union. */
export const dealStatus = pgEnum("deal_status", ["draft", "confirmed", "cancelled"]);

/** A budget is shared by all co-operators, or private to one operator. */
export const budgetScope = pgEnum("budget_scope", ["shared", "private"]);

/** A budget line is external revenue (money in) or a cost (money out). */
export const budgetLineKind = pgEnum("budget_line_kind", ["revenue", "cost"]);

/**
 * Where a (revenue) line came from (decisions #15). `manual` today; a
 * `ticketing_provider` line is synced from Eventbrite/etc. via the TicketingSync
 * port + `provider_ref` — additive, no schema churn when adapters land.
 */
export const ticketingSource = pgEnum("ticketing_source", ["manual", "ticketing_provider"]);

/**
 * Settlement lifecycle (canonical set ported from `models.ts` `SettlementStatus`).
 * `finalized` freezes an immutable snapshot with the locked FX rate.
 */
export const settlementStatus = pgEnum("settlement_status", [
  "open",
  "pending_review",
  "comments_received",
  "revised",
  "finalized",
  "partly_paid",
  "paid",
  "dispute",
]);

/**
 * State of a single transfer in "who owes whom". No escrow — money is tracked,
 * not held, so parties mark `paid`/`handled` manually.
 */
export const transferState = pgEnum("transfer_state", ["owed", "paid", "handled"]);

/** Kind of a stored file (bytes live in Firebase Storage; the row is metadata). */
export const fileKind = pgEnum("file_kind", ["photo", "video", "document", "audio", "other"]);

/** Type of a rider (reusable library doc or an event instance). */
export const riderType = pgEnum("rider_type", ["tech", "hospitality", "stage_plot", "input_list"]);

/** Whether a schedule item is production run-of-show or crew-facing. */
export const scheduleCategory = pgEnum("schedule_category", ["production", "crew"]);

/** Who can see an event message. `party` = only the sender's deal parties. */
export const messageVisibility = pgEnum("message_visibility", ["all", "operators", "party"]);

/** Performing-rights organisation a performance report is filed with. */
export const proCode = pgEnum("pro_code", ["stim", "gema", "prs", "none"]);

/** Subscription tier per profile (operator vs artist, free vs pro). */
export const planTier = pgEnum("plan_tier", [
  "free_operator",
  "operator_pro",
  "free_artist",
  "artist_pro",
]);

/** Where a plan assignment came from — manual grant or a Stripe subscription. */
export const planSource = pgEnum("plan_source", ["manual", "stripe"]);

/** A payout account's method (decisions #5) — extend as rails are added. */
export const payoutMethod = pgEnum("payout_method", ["bankgiro", "iban", "swish"]);

/** What an invitation grants when used. */
export const invitationType = pgEnum("invitation_type", [
  "profile_member",
  "event_participant",
  "code",
]);

/** Invitation lifecycle. */
export const invitationStatus = pgEnum("invitation_status", [
  "pending",
  "accepted",
  "declined",
  "revoked",
  "expired",
  "used",
]);

/** Which product flow created an invitation (unifies the 3 legacy invite systems). */
export const invitationSource = pgEnum("invitation_source", [
  "collaborator",
  "admin",
  "team",
  "venue_handoff",
  "performer_offer",
]);

/** Which inbound flow a booking request came through. */
export const bookingRequestSource = pgEnum("booking_request_source", [
  "public_form",
  "performer_offer",
  "venue_handoff",
]);

/** Booking-request lifecycle. */
export const bookingRequestStatus = pgEnum("booking_request_status", [
  "pending",
  "accepted",
  "declined",
  "flagged",
  "archived",
  "expired",
]);

/** How the request was delivered — inside the platform or via an email handoff. */
export const bookingSentVia = pgEnum("booking_sent_via", ["in_platform", "mailto"]);

/** A share is open to anyone with the link, or gated behind recipient identity. */
export const shareAccess = pgEnum("share_access", ["public", "protected"]);

/** Whether an invoice is one we issued or one we received. */
export const invoiceDirection = pgEnum("invoice_direction", ["issued", "received"]);

/** Invoice lifecycle. */
export const invoiceState = pgEnum("invoice_state", ["draft", "sent", "paid", "overdue", "void"]);

/** A calendar entry is a task, an appointment, or a free note. */
export const calendarItemType = pgEnum("calendar_item_type", ["task", "appointment", "note"]);

/** Which surface a saved template applies to (`payload` is validated per-category). */
export const templateCategory = pgEnum("template_category", [
  "budget",
  "deal",
  "rider",
  "terms",
  "schedule",
  "crew",
  "settlement_overview",
  "settlement_deal",
]);

/** What tripped an admin alert. */
export const adminAlertKind = pgEnum("admin_alert_kind", ["spam_threshold", "expansion_threshold"]);

/** Lifecycle of a standing agent↔performer representation (decisions.md #14). */
export const representationStatus = pgEnum("representation_status", [
  "proposed",
  "active",
  "terminated",
]);

/**
 * Which side made the current offer on a representation. Symmetric: either side
 * can invite and propose terms; a counter re-stamps this and clears the other
 * side's confirmation.
 */
export const representationParty = pgEnum("representation_party", ["agent", "performer"]);
