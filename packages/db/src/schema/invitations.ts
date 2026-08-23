import { type AnyPgColumn, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
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
