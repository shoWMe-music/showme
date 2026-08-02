import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { permissionSets } from "./authorization";
import {
  accountKind,
  payoutMethod,
  profileMediaKind,
  profileMemberRole,
  representationParty,
  representationStatus,
} from "./enums";

/**
 * Module 1 — Identity & accounts. The two hubs the whole schema hangs off:
 * `users` (the authenticated person) and `profiles` (every actor). Firebase Auth
 * owns the credential; Postgres owns everything else — `users.id` IS the Firebase
 * uid, and no custom claims are synced back (PLAN.md decision #4).
 */

/**
 * A person with a login. `id` is the Firebase uid (short-lived token proves it;
 * the principal is resolved from this row per request). `kind` is fixed at signup
 * and locked to one value — it gates which profiles they may create, plus the
 * dashboard, features, and pricing they see.
 */
export const users = pgTable("users", {
  id: text("id").primaryKey(), // Firebase uid
  email: text("email").notNull(),
  name: text("name"),
  initials: text("initials"),
  avatarUrl: text("avatar_url"),
  currency: text("currency"), // display currency (cosmetic; live FX)
  dateFormat: text("date_format"),
  timeFormat: text("time_format"),
  timezone: text("timezone"), // IANA — display + user-local reminders
  companyName: text("company_name"),
  country: text("country"),
  kind: accountKind("kind").notNull(),
  isAdmin: boolean("is_admin").notNull().default(false),
  anonymizedAt: timestamp("anonymized_at", { withTimezone: true }), // GDPR erasure tombstone
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * An actor in the domain — a venue, band, crew service, or agent. Owned by a
 * user, inherits that user's `kind`. `type` is the finer subtype (venue /
 * promoter / band / dj / …). Queried-across fields live in `_details` extension
 * tables; read-with-parent leaves live in `details` / `billing` jsonb.
 */
export const profiles = pgTable("profiles", {
  id: uuid("id").defaultRandom().primaryKey(),
  kind: accountKind("kind").notNull(),
  type: text("type"),
  ownerUserId: text("owner_user_id")
    .notNull()
    .references(() => users.id),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  isPublic: boolean("is_public").notNull().default(false),
  bio: text("bio"),
  avatarUrl: text("avatar_url"),
  bannerUrl: text("banner_url"),
  details: jsonb("details"), // social links / media / custom fields read with the profile
  billing: jsonb("billing"), // legal_name, address, vat_id, vat_rate, invoice_number_seq (gapless)
  claimedAt: timestamp("claimed_at", { withTimezone: true }), // NULL = unclaimed stub
  createdBy: text("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Ordered media gallery for a profile (photos, videos, banner, avatar, docs). */
export const profileMedia = pgTable("profile_media", {
  id: uuid("id").defaultRandom().primaryKey(),
  profileId: uuid("profile_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  kind: profileMediaKind("kind").notNull(),
  url: text("url").notNull(),
  position: integer("position"),
});

/** A profile's locations — kept normalized because discovery queries by them. */
export const profileLocations = pgTable("profile_locations", {
  id: uuid("id").defaultRandom().primaryKey(),
  profileId: uuid("profile_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  city: text("city"),
  country: text("country"),
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  isPrimary: boolean("is_primary").notNull().default(false),
});

/** External social/streaming links shown on a public profile. */
export const profileSocialLinks = pgTable("profile_social_links", {
  id: uuid("id").defaultRandom().primaryKey(),
  profileId: uuid("profile_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  platform: text("platform").notNull(),
  url: text("url").notNull(),
});

/**
 * A party's own bank/money identity — later becomes a Stripe Express connected
 * account. Distinct from a contact's payout info: this is the profile's own.
 */
export const payoutAccounts = pgTable("payout_accounts", {
  id: uuid("id").defaultRandom().primaryKey(),
  profileId: uuid("profile_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  type: payoutMethod("type").notNull(), // bankgiro | iban | swish | … (extensible)
  identifier: text("identifier"), // the account value: IBAN / bankgiro / Swish number
  currency: text("currency"),
  holderName: text("holder_name"),
  bankName: text("bank_name"),
  isPrimary: boolean("is_primary").notNull().default(false),
});

/**
 * Users ↔ profiles. Also absorbs the old non-user "team" directory: `user_id`
 * NULL = an off-platform contact/crew record (invitable → claim). Role is
 * per-profile. `admin` consumes a seat; editor/viewer/crew are free.
 */
export const profileMembers = pgTable(
  "profile_members",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id), // NULL = off-platform contact
    email: text("email"),
    displayName: text("display_name"),
    role: profileMemberRole("role").notNull(),
    seatConsumed: boolean("seat_consumed").notNull().default(false),
    status: text("status"),
    permissionSetId: uuid("permission_set_id").references(() => permissionSets.id),
    phone: text("phone"),
    notes: text("notes"),
    addedBy: text("added_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique().on(table.profileId, table.userId),
    // The access join runs `WHERE pm.user_id = :uid` then hops by profile_id.
    index("profile_members_user_id_idx").on(table.userId),
    index("profile_members_profile_id_idx").on(table.profileId),
  ],
);

/** A profile's crew-role vocabulary (e.g. "FOH engineer", "stage manager"). */
export const profileCustomRoles = pgTable("profile_custom_roles", {
  id: uuid("id").defaultRandom().primaryKey(),
  profileId: uuid("profile_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
});

/** A reusable member bundle owned at the user/org level, serving many profiles. */
export const groups = pgTable("groups", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerUserId: text("owner_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
});

/** A member of a group. `user_id` NULL = off-platform (same as profile_members). */
export const groupMembers = pgTable("group_members", {
  id: uuid("id").defaultRandom().primaryKey(),
  groupId: uuid("group_id")
    .notNull()
    .references(() => groups.id, { onDelete: "cascade" }),
  userId: text("user_id").references(() => users.id),
  email: text("email"),
  roleLabel: text("role_label"),
  defaultPermissionSetId: uuid("default_permission_set_id").references(() => permissionSets.id),
});

/** Which profiles a group serves — a group is cross-profile by design. */
export const groupProfiles = pgTable("group_profiles", {
  id: uuid("id").defaultRandom().primaryKey(),
  groupId: uuid("group_id")
    .notNull()
    .references(() => groups.id, { onDelete: "cascade" }),
  profileId: uuid("profile_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
});

/**
 * A standing agent↔performer agreement (decisions.md #14). Bidirectional: either
 * side proposes; the proposer auto-confirms, the counterparty confirms to
 * activate or counters. On the performer's in-region events it fans out into an
 * `event_participants(role=agent)` — the authority is an ordinary permission set,
 * never an auth override. Commission settles separately, never as a deal party.
 */
export const representations = pgTable("representations", {
  id: uuid("id").defaultRandom().primaryKey(),
  agentProfileId: uuid("agent_profile_id")
    .notNull()
    .references(() => profiles.id),
  performerProfileId: uuid("performer_profile_id")
    .notNull()
    .references(() => profiles.id),
  region: text("region").array(), // ISO country codes; disjoint per active representation
  isWorldwide: boolean("is_worldwide").notNull().default(false),
  commissionRate: integer("commission_rate"), // basis points
  commissionableBasis: text("commissionable_basis"),
  agentCollects: boolean("agent_collects").notNull().default(false),
  proposedBy: representationParty("proposed_by").notNull(),
  status: representationStatus("status").notNull().default("proposed"),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  confirmedByAgent: boolean("confirmed_by_agent").notNull().default(false),
  confirmedByPerformer: boolean("confirmed_by_performer").notNull().default(false),
  terminatedAt: timestamp("terminated_at", { withTimezone: true }),
  terminatedEffectiveAt: timestamp("terminated_effective_at", { withTimezone: true }),
  terminatedBy: text("terminated_by").references(() => users.id),
});
