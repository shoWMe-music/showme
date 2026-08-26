import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { deals } from "./deals";
import {
  budgetLineKind,
  budgetScope,
  settlementStatus,
  ticketingSource,
  transferState,
} from "./enums";
import { events, eventParticipants } from "./events";
import { profiles, representations } from "./identity";

/**
 * Module 4 — Budget & settlement. Two kinds of money: budget lines = external
 * cash (revenue `collected_by`, external costs `paid_by`); deals = inter-party
 * entitlements. Settlement reconciles them into per-participant "who owes whom"
 * transfers with `Σ net = 0` (PLAN.md "Reconciliation algorithm"). No escrow —
 * amounts are tracked, not moved; parties confirm receipt manually.
 */

/** A budget for an event — one shared budget for co-operators, plus optional private ones. */
export const budgets = pgTable(
  "budgets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    scope: budgetScope("scope").notNull().default("shared"),
    ownerProfileId: uuid("owner_profile_id").references(() => profiles.id), // set only for private
    // The planner's standing assumptions — today what the operator expects a
    // payment/ticketing provider to keep. NOT lines: nobody has paid this money,
    // and `reconcile()` reads lines as cash that actually moved (0015).
    planningAssumptions: jsonb("planning_assumptions"),
    version: integer("version").notNull().default(1), // optimistic lock (decisions #8)
  },
  (table) => [
    // Budgets are provisioned on demand, so two concurrent reads can race to
    // create the same one. These give the INSERT .. ON CONFLICT DO NOTHING
    // something to conflict on: at most one private budget per owning profile,
    // and at most one shared ledger per event.
    uniqueIndex("budgets_one_private_per_owner")
      .on(table.eventId, table.ownerProfileId)
      .where(sql`scope = 'private'`),
    uniqueIndex("budgets_one_shared_per_event").on(table.eventId).where(sql`scope = 'shared'`),
  ],
);

/**
 * A revenue or cost line. `collected_by` (revenue: who receives) / `paid_by`
 * (cost: who fronts) / `payee_participant_id` (cost: who the line is *for* — any
 * participant, e.g. a performer's hotel; NULL = external supplier) are what the
 * reconciliation reads.
 *
 * TWO WAYS A COST CAN NAME A DEAL, and they are opposite facts about the money —
 * which is why there are two columns and not one nullable `deal_id` plus a
 * convention:
 *
 * - **`deal_id` — the line IS that deal's own figure.** The guarantee typed into
 *   "Performer fee" while planning. It is a forecast of what the agreement will
 *   pay, not cash anybody moved, so the settlement takes the figure from the DEAL
 *   and drops the line at the engine boundary (`routes/settlement.ts`). Counting
 *   it would charge the pool once and entitle the payee again — the operator's
 *   residual short by the whole fee (design-handoff-budget-planner §6).
 * - **`attributed_deal_id` — a real third-party cost REPORTED UNDER that deal.**
 *   The 500 of catering booked to the headliner's night so the deal's true cost
 *   can be read off (2026-08 settlements meeting: *"all project costs assigned to
 *   specific deals, creating accountability for each agreement"*). Somebody was
 *   genuinely invoiced, so it is ordinary external cash: it lowers the pool and
 *   obeys `paid_by` / `payee_participant_id` / `cost_split` exactly as an
 *   untagged cost does. The settlement never reads this column at all — it is
 *   accountability, not arithmetic.
 *
 * Inferring the difference is what cannot be done. Both readings are legitimate
 * and the same operator wants both on the same event, so the line has to SAY
 * which it is, and the planner asks in words at the moment of assignment.
 */
export const budgetLines = pgTable(
  "budget_lines",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    budgetId: uuid("budget_id")
      .notNull()
      .references(() => budgets.id, { onDelete: "cascade" }),
    kind: budgetLineKind("kind").notNull(),
    // Provenance of a revenue line (decisions #15): `manual` or synced from a
    // ticketing provider (then `provider_ref` carries the external id).
    source: ticketingSource("source").notNull().default("manual"),
    providerRef: text("provider_ref"),
    label: text("label").notNull(),
    amount: bigint("amount", { mode: "bigint" }).notNull(), // minor units (money.md)
    currency: text("currency"), // defaults to the event's base_currency
    collectedBy: uuid("collected_by").references(() => eventParticipants.id),
    paidBy: uuid("paid_by").references(() => eventParticipants.id),
    payeeParticipantId: uuid("payee_participant_id").references(() => eventParticipants.id),
    costSplit: jsonb("cost_split"), // split rule (e.g. 50/50) when shared
    // The planner's breakdown behind `amount` (unit x quantity). `amount`
    // stays the authoritative figure settlement reads; this only remembers
    // how the operator arrived at it. NULL for a hand-entered line.
    details: jsonb("details"),
    // The deal whose OWN FIGURE this line is — settlement takes it from the deal
    // and ignores the line. See the two-columns note above.
    dealId: uuid("deal_id").references(() => deals.id),
    // The deal this cost is REPORTED UNDER — a real cost, still settled.
    attributedDealId: uuid("attributed_deal_id").references(() => deals.id),
    version: integer("version").notNull().default(1), // optimistic lock (decisions #8)
  },
  (table) => [
    index("budget_lines_budget_id_idx").on(table.budgetId),
    // A line is either a deal's own figure or a cost reported under it; it can
    // never be both, because the two say opposite things about whether the
    // settlement should count the money.
    check(
      "budget_lines_one_deal_sense",
      sql`num_nonnulls(${table.dealId}, ${table.attributedDealId}) <= 1`,
    ),
  ],
);

/**
 * One settlement per participant (the per-event view), OR one per representation
 * (the private agent↔performer commission settlement, decisions #14) — exactly
 * one of the two links is set, enforced by CHECK. `computed` holds the derived
 * E / collected / paid / net; `manual_overrides` the confirmed-cash corrections.
 */
export const settlements = pgTable(
  "settlements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    participantId: uuid("participant_id").references(() => eventParticipants.id),
    representationId: uuid("representation_id").references(() => representations.id),
    status: settlementStatus("status").notNull().default("open"),
    computed: jsonb("computed"),
    manualOverrides: jsonb("manual_overrides"),
    // The locked FX rates live in the finalize snapshot (`data.lockedRates`) — a MAP,
    // since a multi-currency event locks several pair rates (money.md, #7).
    version: integer("version").notNull().default(1), // optimistic lock (decisions #8)
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "settlements_exactly_one_subject",
      sql`num_nonnulls(${table.participantId}, ${table.representationId}) = 1`,
    ),
    index("settlements_event_id_idx").on(table.eventId),
  ],
);

/** A minimal `owed`/`paid`/`handled` transfer between two participants. */
export const settlementTransfers = pgTable(
  "settlement_transfers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    fromParticipant: uuid("from_participant")
      .notNull()
      .references(() => eventParticipants.id),
    toParticipant: uuid("to_participant")
      .notNull()
      .references(() => eventParticipants.id),
    amount: bigint("amount", { mode: "bigint" }).notNull(), // minor units (money.md)
    currency: text("currency"),
    // Set → this is a PRIVATE agent↔performer commission transfer (decisions #14);
    // the operator never sees it. Null → an ordinary event settlement transfer.
    representationId: uuid("representation_id").references(() => representations.id),
    state: transferState("state").notNull().default("owed"),
    version: integer("version").notNull().default(1), // optimistic lock (decisions #8)
  },
  (table) => [index("settlement_transfers_event_id_idx").on(table.eventId)],
);

/** A comment on a settlement, from an on- or off-platform party. */
export const settlementComments = pgTable("settlement_comments", {
  id: uuid("id").defaultRandom().primaryKey(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  partyParticipantId: uuid("party_participant_id").references(() => eventParticipants.id),
  authorEmail: text("author_email"),
  authorName: text("author_name"),
  /**
   * WHICH part of the document the comment is about — `event`, `schedule`,
   * `riders`, `budget`, `deal` or `settlement` (the share viewer's sections,
   * which are the share capabilities themselves). NULL for a comment on the
   * settlement as a whole, which is every row written before this column existed.
   *
   * A column and not a prefix on `message`: the old app posted `"[Agreement] …"`
   * so the operator's inbox could guess what a comment was about, and a guess
   * parsed out of user-supplied text is not a field — a recipient who types
   * "[Settlement] " themselves lands wherever the parser puts them.
   */
  section: text("section"),
  message: text("message").notNull(),
  attachments: jsonb("attachments"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** A party's approval of their settlement (kept versioned per the 2026-07 decision). */
export const settlementApprovals = pgTable("settlement_approvals", {
  id: uuid("id").defaultRandom().primaryKey(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  partyParticipantId: uuid("party_participant_id")
    .notNull()
    .references(() => eventParticipants.id),
  approved: boolean("approved").notNull().default(false),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
});

/** An immutable legal record, written only when a settlement is finalized. */
export const settlementSnapshots = pgTable("settlement_snapshots", {
  id: uuid("id").defaultRandom().primaryKey(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  data: jsonb("data").notNull(),
  finalizedAt: timestamp("finalized_at", { withTimezone: true }).notNull().defaultNow(),
});
