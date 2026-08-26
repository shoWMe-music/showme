import { integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { proCode } from "./enums";
import { users } from "./identity";

/**
 * Idempotency keys (decisions #8). Every retry-unsafe mutation (money moves,
 * creates, sends, gapless sequences) sends `Idempotency-Key: <uuid>`; the first
 * execution stores its result here and a replay returns the stored result
 * instead of re-executing. Scoped per `(user, endpoint)`; retention 24h (a reaper
 * prunes rows older than that). "This must not happen twice" → idempotency key;
 * "someone else changed this, reload" → the `version` columns.
 */
export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    key: text("key").notNull(), // the client-supplied uuid
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    statusCode: integer("status_code").notNull(),
    response: jsonb("response").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique().on(table.userId, table.endpoint, table.key)],
);

/**
 * The PRO tariff shoWMe estimates a show's performing-rights fee with — one row
 * per TERRITORY, written by platform admins and by nobody else.
 *
 * ## Why the key is the country and not the PRO
 *
 * A country maps to a society; a society publishes a tariff. Both "rate on the
 * country" and "rate on the PRO" describe that chain, and the country wins here
 * for three reasons.
 *
 * 1. **decisions.md #17 puts the country upstream.** The `country` stamp is the
 *    intrinsic signal that drives "VAT, PRO codes (STIM/GEMA/PRS), currency". The
 *    PRO is one of the things a country *determines*, so keying the rate on the
 *    PRO would key it on a derived value.
 * 2. **The `pro_code` enum cannot hold the territories.** It has four values
 *    (`stim | gema | prs | none`) and it is the FILING recipient vocabulary of
 *    `performance_reports` — while `apps/web/src/lib/proSocieties.ts` already
 *    names twenty societies we book in. A PRO-keyed table would make sixteen of
 *    those unratable until somebody widened a Postgres enum, i.e. one migration
 *    per territory, to record a number.
 * 3. **A society is not one tariff.** SACEM administers France, Monaco and
 *    Luxembourg; the tariff, the VAT on it and the local law differ by country
 *    inside that. The rate is a fact about a territory that a society happens to
 *    collect, not a property of the society.
 *
 * So `country` is the primary key, and the society rides along as two columns
 * with two different jobs — see below.
 *
 * ## No history, on purpose
 *
 * Tariffs are renegotiated yearly, and this table holds only the current one. A
 * planning estimate is always "as of now", so a second, older row could only ever
 * be picked by accident. The history that matters — who changed a rate, when,
 * from what to what — is in `audit_log`, which every admin write here appends to.
 */
export const performingRightsRates = pgTable("performing_rights_rates", {
  /** ISO 3166-1 alpha-2, uppercase. Constrained in SQL — see migration 0018. */
  country: text("country").primaryKey(),
  /**
   * The filing destination of record, matching `performance_reports.pro_code`.
   * `none` — the default — is the honest value for the great majority of
   * territories: we know Sweden's rate is STIM's without being able to file with
   * STIM, and there is no code at all for SACEM or SUISA.
   */
  proCode: proCode("pro_code").notNull().default("none"),
  /**
   * The society as a human writes it — "STIM", "GEMA", "PRS for Music", "SACEM".
   * This is what the Budget Planner's card prints, and it is why a short filing
   * enum does not stop a territory from having a named, credible rate.
   */
  proName: text("pro_name").notNull(),
  /** The rate, in basis points of ticket revenue. 600 = 6.00%. 0..10 000. */
  rateBasisPoints: integer("rate_basis_points").notNull(),
  /**
   * The published tariff the rate was read off. Optional, and the single most
   * valuable column here: a percentage an admin typed with no source behind it is
   * exactly as unfounded as the flat 6% this table exists to replace.
   */
  sourceUrl: text("source_url"),
  /** Which tariff, in words — "Tariff M, live concerts, 2026". */
  sourceNote: text("source_note"),
  /** The platform admin who last wrote this row (`users.is_admin`). */
  updatedBy: text("updated_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
