import {
  bigint,
  date,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { invoiceDirection, invoiceState, shareAccess } from "./enums";
import { events, eventParticipants } from "./events";
import { profiles, users } from "./identity";
import { budgetLines, settlementTransfers } from "./settlement";

/**
 * Module 9 — Settlement sharing. A `share` is a tokenized capability grant
 * against any target (generalized beyond settlement); `capabilities` draws from
 * the same catalog as `permission_sets`. Protected shares verify recipient
 * identity via signed-in user / OTP→JWT / owner — recipients are never leaked in
 * responses. `invoices` are documents OVER a transfer or cost line (no escrow).
 */

/** A tokenized, capability-scoped grant against a target, optionally expiring/revocable. */
export const shares = pgTable("shares", {
  id: uuid("id").defaultRandom().primaryKey(),
  token: text("token").notNull().unique(),
  eventId: uuid("event_id").references(() => events.id, { onDelete: "cascade" }),
  targetKind: text("target_kind"),
  targetId: uuid("target_id"),
  capabilities: text("capabilities").array().notNull().default([]),
  access: shareAccess("access").notNull().default("public"),
  ownerUserId: text("owner_user_id")
    .notNull()
    .references(() => users.id),
  ownerProfileId: uuid("owner_profile_id")
    .notNull()
    .references(() => profiles.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** A named recipient of a share — carries claim + party-link state (kept a table). */
export const shareRecipients = pgTable(
  "share_recipients",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shareId: uuid("share_id")
      .notNull()
      .references(() => shares.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    name: text("name"),
    linkedParticipantId: uuid("linked_participant_id").references(() => eventParticipants.id),
    claimedByUserId: text("claimed_by_user_id").references(() => users.id),
    invitedAt: timestamp("invited_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  },
  (table) => [unique().on(table.shareId, table.email)],
);

/**
 * A one-time passcode for a protected share. Port the constants: 6-digit
 * salted-SHA256, 10-min TTL, 3/hr, 5 attempts → HS256 JWT for 24h.
 */
export const shareOtps = pgTable(
  "share_otps",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shareId: uuid("share_id")
      .notNull()
      .references(() => shares.id, { onDelete: "cascade" }),
    emailHash: text("email_hash").notNull(),
    codeHash: text("code_hash").notNull(),
    salt: text("salt").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    rateWindowStart: timestamp("rate_window_start", { withTimezone: true }),
  },
  (table) => [unique().on(table.shareId, table.emailHash)], // one active OTP per (share, email)
);

/** An invoice document layered over a settlement transfer or a budget cost line. */
export const invoices = pgTable("invoices", {
  id: uuid("id").defaultRandom().primaryKey(),
  // The profile whose books this invoice lives in — the gapless number sequence
  // (decisions #5) belongs to this profile's `billing`, and it gates access.
  ownerProfileId: uuid("owner_profile_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  eventId: uuid("event_id").references(() => events.id, { onDelete: "cascade" }),
  direction: invoiceDirection("direction").notNull(),
  issuerRef: text("issuer_ref"),
  recipientRef: text("recipient_ref"),
  transferId: uuid("transfer_id").references(() => settlementTransfers.id),
  budgetLineId: uuid("budget_line_id").references(() => budgetLines.id),
  number: text("number"),
  currency: text("currency"),
  lineItems: jsonb("line_items"),
  vat: jsonb("vat"),
  total: bigint("total", { mode: "bigint" }), // minor units (money.md)
  issuedAt: timestamp("issued_at", { withTimezone: true }),
  dueDate: date("due_date"),
  state: invoiceState("state").notNull().default("draft"),
  documentSnapshot: jsonb("document_snapshot"),
});
