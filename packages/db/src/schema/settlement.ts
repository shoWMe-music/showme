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
 * reconciliation reads. `deal_id` assigns the line to a deal for accountability.
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
    dealId: uuid("deal_id").references(() => deals.id),
    version: integer("version").notNull().default(1), // optimistic lock (decisions #8)
  },
  (table) => [index("budget_lines_budget_id_idx").on(table.budgetId)],
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
