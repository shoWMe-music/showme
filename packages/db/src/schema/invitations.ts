import {
  type AnyPgColumn,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { permissionSets } from "./authorization";
import { invitationSource, invitationStatus, invitationType } from "./enums";
import { events } from "./events";
import { profiles, users } from "./identity";

/**
 * Module 7 — Invitations & contacts. One `invitations` table replaces the three
 * legacy invite systems (profile / collaborator / code). `contacts` is a
 * profile-scoped address book (an operator's, not a user's); its people are
 * folded into `persons jsonb`. The two reference each other (an invite can link
 * a contact; a contact can be created from an invite) via lazy self-refs.
 */

/** A pending grant — a human `SHOW-XXXX` code, an opaque link `token`, or both. */
export const invitations = pgTable("invitations", {
  id: uuid("id").defaultRandom().primaryKey(),
  type: invitationType("type").notNull(),
  code: text("code").unique(), // human SHOW-XXXX-XXXX for code-style invites
  token: text("token").unique(), // opaque token for link invites
  status: invitationStatus("status").notNull().default("pending"),
  createdByUser: text("created_by_user")
    .notNull()
    .references(() => users.id),
  createdByProfile: uuid("created_by_profile").references(() => profiles.id),
  recipientEmail: text("recipient_email"),
  recipientName: text("recipient_name"),
  targetProfileId: uuid("target_profile_id").references(() => profiles.id),
  // An invitation to a deleted event is unusable, so it goes with the event.
  targetEventId: uuid("target_event_id").references(() => events.id, { onDelete: "cascade" }),
  linkedContactId: uuid("linked_contact_id").references((): AnyPgColumn => contacts.id),
  role: text("role"), // profile-member or event-participant role, resolved per type
  permissionSetId: uuid("permission_set_id").references(() => permissionSets.id),
  passwordHash: text("password_hash"),
  source: invitationSource("source").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  usedByUser: text("used_by_user").references(() => users.id),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** A profile's address-book entry, including its payout details and contact people. */
export const contacts = pgTable("contacts", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerProfileId: uuid("owner_profile_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  type: text("type"),
  iban: text("iban"),
  bankName: text("bank_name"),
  vatId: text("vat_id"),
  address: text("address"),
  notes: text("notes"),
  persons: jsonb("persons"), // folded contact_persons: [{ name, email, phone }]
  invitationId: uuid("invitation_id").references((): AnyPgColumn => invitations.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A one-time code proving control of the address an invitation was SENT to.
 *
 * WHY THIS EXISTS. Claiming an invited account used to require signing in with
 * the invited address itself (`assertInvitationRecipient`) — which is airtight
 * and, in practice, wrong: a venue is invited at `info@`, and the person who runs
 * it signs up as themselves. Ran's spec went the other way and made the link the
 * only credential, which hands the account to whoever the email is forwarded to.
 *
 * Daniel, 2026-09-01, choosing neither: "The email must verify it. So some type
 * of OTP. But they should be able to change the email." So control of the invited
 * address is proved ONCE, by a code sent to it, and the account it becomes may
 * then be any address the claimant likes. A forwarded link is not enough, because
 * the code goes to the original address and not to whoever received the forward.
 *
 * Modelled on `share_otps`, down to the two counters, because the reasoning there
 * was paid for once already (migration 0018): `attempts` is wrong guesses against
 * the live code, `issues` is codes sent inside the window, and they are separate
 * so that asking for a fresh code cannot reset the hour. The row is never deleted
 * while its window is open, for the same reason. There is no `email_hash` column —
 * unlike a share, an invitation names exactly one address, so the invitation IS
 * the key.
 */
export const invitationOtps = pgTable("invitation_otps", {
  invitationId: uuid("invitation_id")
    .primaryKey()
    .references(() => invitations.id, { onDelete: "cascade" }),
  codeHash: text("code_hash").notNull(),
  salt: text("salt").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  /** Wrong guesses against the code that is live right now. Max 5, then spent. */
  attempts: integer("attempts").notNull().default(0),
  /** Codes SENT inside the current window. Max 3 — its own counter, so a fresh
   *  code cannot reset the hour by resetting `attempts`. */
  issues: integer("issues").notNull().default(0),
  /** Set when the code is spent — verified, or burnt out on wrong guesses. */
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  rateWindowStart: timestamp("rate_window_start", { withTimezone: true }),
});
