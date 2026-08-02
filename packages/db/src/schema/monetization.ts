import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { planSource, planTier } from "./enums";
import { profiles, users } from "./identity";

/**
 * Module 6 — Monetization & entitlements. A SEPARATE layer from authorization:
 * `can_use_feature(profile, feature)` (plan limits) is never conflated with
 * `authorize(capability, resource)`. Counters (event cap, offer cap, spam) are
 * COMPUTED elsewhere, not stored — the only stored money state is the plan and
 * the credit ledger. Plan changes are logged to `audit_log` (no `plan_history`).
 */

/** One plan row per profile (the primary key). `status` lifecycle is app-defined text. */
export const plans = pgTable("plans", {
  profileId: uuid("profile_id")
    .primaryKey()
    .references(() => profiles.id, { onDelete: "cascade" }),
  tier: planTier("tier").notNull(),
  status: text("status").notNull().default("active"),
  source: planSource("source").notNull().default("manual"),
  assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
  assignedBy: text("assigned_by").references(() => users.id),
  renewalAt: timestamp("renewal_at", { withTimezone: true }),
  seats: integer("seats").notNull().default(1),
  cancelReason: text("cancel_reason"),
});

/** Collaboration-invite credits — the balance is `SUM(delta)`, never a stored counter. */
export const creditLedger = pgTable(
  "credit_ledger",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    delta: integer("delta").notNull(),
    reason: text("reason"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("credit_ledger_profile_id_idx").on(table.profileId)],
);
