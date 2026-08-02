import { bigint, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import {
  agreementStatus,
  dealPartyRole,
  dealStatus,
  dealStructure,
  dealType,
  paymentTiming,
} from "./enums";
import { events, eventParticipants } from "./events";
import { users } from "./identity";

/**
 * Module 3 — Deals. Party-scoped agreements (1..N parties, kind-agnostic). The
 * agreement is folded in (decisions 2026-07): a deal carries the agreement body,
 * status, confirmed snapshot, and reopen state; per-party confirmation lives on
 * `deal_parties`. Visibility is pure party-scoping — you see a deal iff you are a
 * member of a profile that is a `deal_party` on it (PLAN.md "Deals model").
 */
export const deals = pgTable("deals", {
  id: uuid("id").defaultRandom().primaryKey(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  type: dealType("type").notNull(),
  structure: dealStructure("structure"), // NULL = paper-only agreement (no computed math)
  currency: text("currency"), // payout currency; NULL defaults to the event's base_currency
  name: text("name").notNull(),
  payerParticipantId: uuid("payer_participant_id").references(() => eventParticipants.id),
  paymentTiming: paymentTiming("payment_timing").notNull().default("at_settlement"),
  priority: integer("priority").notNull().default(0), // rental / before-event settle first
  guaranteeAmount: bigint("guarantee_amount", { mode: "bigint" }), // minor units (money.md)
  // The portion of this deal paid IN ADVANCE, before the event (money.md, #1). An
  // agnostic marker: set it to the guarantee to make the guarantee the advance and
  // a door split settle after; or a partial amount. The before-event settlement
  // phase (reserved via `payment_timing`) reads this — no engine wiring yet.
  advanceAmount: bigint("advance_amount", { mode: "bigint" }), // minor units (money.md)
  splitBasisPoints: integer("split_basis_points"), // 4000 = 40.00%
  terms: jsonb("terms"), // escalator tiers, bonus, commissions — read with the deal
  agreementBodyText: text("agreement_body_text"),
  agreementStatus: agreementStatus("agreement_status").notNull().default("draft"),
  confirmedSnapshot: jsonb("confirmed_snapshot"), // frozen terms once all parties confirm
  reopen: jsonb("reopen"),
  status: dealStatus("status").notNull().default("draft"),
  version: integer("version").notNull().default(1), // optimistic lock (decisions #8)
  createdBy: text("created_by")
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A party on a deal, keyed to a kind-agnostic `event_participant`. Carries the
 * party's share and its own agreement confirmation (replaces the old
 * `agreement_confirmations`). Both lookup directions are indexed: the by-party
 * read powers every access check and settlement reconciliation.
 */
export const dealParties = pgTable(
  "deal_parties",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    dealId: uuid("deal_id")
      .notNull()
      .references(() => deals.id, { onDelete: "cascade" }),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => eventParticipants.id),
    roleInDeal: dealPartyRole("role_in_deal").notNull(),
    share: jsonb("share"), // %/amount/terms for this party
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    confirmedBy: text("confirmed_by").references(() => users.id),
    signatureHash: text("signature_hash"), // populated later by e-sign
    version: integer("version").notNull().default(1), // optimistic lock (decisions #8)
  },
  (table) => [
    index("deal_parties_deal_id_idx").on(table.dealId),
    index("deal_parties_participant_id_idx").on(table.participantId),
  ],
);
