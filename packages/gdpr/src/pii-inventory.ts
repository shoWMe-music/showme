import { schema } from "@showme/db";
import type { PgTable } from "drizzle-orm/pg-core";

/**
 * The PII inventory — the single machine-readable artifact that drives BOTH GDPR
 * erasure (anonymize) and data export (Art. 15/20). It is the documented map of
 * `{ table → PII columns }` for the data where **shoWMe is the controller**
 * (docs/gdpr.md). Erasure strips these columns; export gathers them.
 *
 * Each entry also records HOW a row is tied to the data subject so the same map
 * can locate a user's rows across the schema:
 *  - `userColumn`    — a direct FK to `users.id`.
 *  - `emailColumn`   — the subject's email, for off-platform rows with no user FK.
 *  - `profileColumn` — a FK to `profiles.id`, resolved to the subject's owned profiles.
 *
 * EXCLUSION — `contacts` (an operator's address book: email, iban, vat_id) is
 * deliberately NOT here: the **operator** is the controller of that data, so it is
 * out of shoWMe's subject-erasure scope (docs/gdpr.md). Erasing a shoWMe user must
 * never unilaterally scrub an operator's business records; those follow the
 * operator's own obligations.
 */
export interface PiiTableSpec {
  /** Postgres table name — the export grouping key and documentation anchor. */
  readonly tableName: string;
  /** The Drizzle table the columns live on. */
  readonly table: PgTable;
  /** Property names of the columns holding personal data. */
  readonly piiColumns: readonly string[];
  /** Property name of a direct FK to `users.id`, if the table has one. */
  readonly userColumn?: string;
  /** Property name of an email column, for rows with no user FK (off-platform). */
  readonly emailColumn?: string;
  /** Property name of a FK to `profiles.id`, resolved to the subject's profiles. */
  readonly profileColumn?: string;
}

export const PII_INVENTORY: readonly PiiTableSpec[] = [
  {
    tableName: "users",
    table: schema.users,
    piiColumns: ["email", "name", "initials", "avatarUrl"],
    userColumn: "id",
  },
  {
    tableName: "profiles",
    table: schema.profiles,
    piiColumns: ["name", "bio", "avatarUrl", "bannerUrl"],
    userColumn: "ownerUserId",
  },
  {
    tableName: "profile_members",
    table: schema.profileMembers,
    piiColumns: ["displayName", "email", "phone", "notes"],
    userColumn: "userId",
    emailColumn: "email",
  },
  {
    tableName: "share_recipients",
    table: schema.shareRecipients,
    piiColumns: ["name", "email"],
    userColumn: "claimedByUserId",
    emailColumn: "email",
  },
  {
    tableName: "booking_requests",
    table: schema.bookingRequests,
    piiColumns: ["contactName", "email", "phone", "artistName"],
    userColumn: "senderUserId",
    emailColumn: "email",
  },
  {
    tableName: "audience_rsvps",
    table: schema.audienceRsvps,
    piiColumns: ["name", "email"],
    emailColumn: "email",
  },
  {
    tableName: "invitations",
    table: schema.invitations,
    piiColumns: ["recipientName", "recipientEmail"],
    userColumn: "usedByUser",
    emailColumn: "recipientEmail",
  },
  {
    tableName: "payout_accounts",
    table: schema.payoutAccounts,
    piiColumns: ["holderName", "identifier", "bankName"],
    profileColumn: "profileId",
  },
  {
    // The forensic `audit_log` (docs/gdpr.md names it) is append-only and carries
    // only the pseudonymous `actor_user_id` — which is DELIBERATELY RETAINED for
    // integrity — so it holds no scrubbable display PII. The actor's display NAME
    // lives on `activity_log.actor_display` in this schema, so that is the row the
    // inventory scrubs (keeping the pseudonymous `actor_user_id`).
    tableName: "activity_log",
    table: schema.activityLog,
    piiColumns: ["actorDisplay"],
    userColumn: "actorUserId",
  },
];
