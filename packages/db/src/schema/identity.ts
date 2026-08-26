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

/**
 * The venue-specific facts about a place profile — capacity, what the room
 * offers, and the logistics a booked party needs. PLAN.md:346 puts exactly these
 * here: "Venue-heavy queryable fields (capacity, amenities, sub-venues/rooms,
 * setups) → a `venue_details` extension table", and the data-model rule is
 * normalize what is queried across. A promoter hunting for a room filters on
 * capacity and amenities together with `profile_locations.city`, so these are
 * columns with indexes, not a `details` jsonb blob nothing can search.
 *
 * Sub-venues/rooms are NOT here: this schema already models them as `stages`
 * (`events.ts`), keyed by `venue_profile_id`, so a second rooms list would be a
 * competing source of truth for the same thing.
 *
 * The PRIVACY LINE runs through this table, and it is deliberate. `decisions.md`
 * #16.7 splits logistics in two — "Artist logistics on the venue profile + event;
 * audience logistics on the public page". `artist_logistics_notes` (load-in,
 * back entrance, artist parking, travel party) is for parties who are actually
 * booked; `audience_logistics_notes` (how the public gets in and parks) is the
 * one that may be published. Contact details are private for the same reason:
 * an unauthenticated page must never hand a scraper a booker's mailbox.
 */
export const venueDetails = pgTable(
  "venue_details",
  {
    // One row per profile — the extension-table relation is 1:1, so the foreign
    // key IS the primary key. No surrogate id to get out of sync.
    profileId: uuid("profile_id")
      .primaryKey()
      .references(() => profiles.id, { onDelete: "cascade" }),
    capacity: integer("capacity"), // total, when the venue is not split into stages
    /** House PA, as a venue writes it: "Funktion-One", "d&b audiotechnik". Free
     * text on purpose — it is a make and model, not a category. Prototype
     * "Venue Specs" card (shoWMe All View.dc.html:3351). */
    soundSystem: text("sound_system"),
    /** House curfew as local wall-clock ("02:00") — a standing house rule, not a
     * moment in time, so it is not a timestamp. Prototype Venue Specs:3352. */
    curfew: text("curfew"),
    /** Stable amenity keys (`@showme/shared` VENUE_AMENITIES) plus the venue's own
     * free-text entries. Not an enum: real venues type their own. */
    amenities: text("amenities").array().notNull().default([]),
    /** Deal shapes this venue will sign — advertised preference, never terms. */
    dealTypes: text("deal_types").array().notNull().default([]),
    cateringNotes: text("catering_notes"),
    accommodationNotes: text("accommodation_notes"),
    artistLogisticsNotes: text("artist_logistics_notes"), // PRIVATE (decisions #16.7)
    audienceLogisticsNotes: text("audience_logistics_notes"), // publishable
    contactEmail: text("contact_email"), // PRIVATE — booking contact, never public
    contactPhone: text("contact_phone"), // PRIVATE
    /** Named seating/standing configurations, read only with the parent row and
     * never filtered on — the one leaf here that earns jsonb. */
    capacitySetups: jsonb("capacity_setups"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // "A room for 400" is a range scan. The amenity half of that search is a GIN
    // index on the array, declared in the migration SQL — drizzle-kit has no
    // expression for `USING gin` on a text[] here, and a container query
    // (`amenities @> ARRAY['pa_system']`) is useless without it.
    index("venue_details_capacity_idx").on(table.capacity),
  ],
);
