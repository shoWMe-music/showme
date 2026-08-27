import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { fileKind, messageVisibility, proCode, riderType, scheduleCategory } from "./enums";
import { events, eventParticipants } from "./events";
import { profiles, users } from "./identity";

/**
 * Module 5 — Event content. Riders, run-of-show, messages, setlists, and PRO
 * reports, plus `files` (pulled forward — riders and messages reference it). All
 * are gated by event participation + permission set at the API layer; the schema
 * just carries `owner_participant_id` + `visibility` for the serializer to refine.
 */

/**
 * File metadata. The bytes live in Firebase Storage (GCS); this row stores the
 * `path` (not a URL — access is via API-issued signed URLs) plus size/type.
 */
export const files = pgTable("files", {
  id: uuid("id").defaultRandom().primaryKey(),
  path: text("path").notNull(), // Storage object path, not a URL
  kind: fileKind("kind").notNull(),
  contentType: text("content_type"),
  sizeBytes: bigint("size_bytes", { mode: "number" }),
  ownerUserId: text("owner_user_id")
    .notNull()
    .references(() => users.id),
  ownerProfileId: uuid("owner_profile_id").references(() => profiles.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A rider — either a profile's reusable library doc (`event_id` NULL) or an
 * instance attached to an event (`event_id` + `owner_participant_id`). Attaching
 * COPIES the library doc (`source_rider_id` records the origin) so edits to the
 * master never touch past events.
 */
export const riders = pgTable("riders", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerProfileId: uuid("owner_profile_id").references(() => profiles.id),
  eventId: uuid("event_id").references(() => events.id, { onDelete: "cascade" }),
  ownerParticipantId: uuid("owner_participant_id").references(() => eventParticipants.id),
  type: riderType("type").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  fileId: uuid("file_id").references(() => files.id),
  sourceRiderId: uuid("source_rider_id").references((): AnyPgColumn => riders.id),
  isDefault: boolean("is_default").notNull().default(false), // auto-attach on join
  createdBy: text("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Run-of-show / crew schedule. `start_time` is absolute; `duration` is minutes. */
export const scheduleItems = pgTable(
  "schedule_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    // Wall-clock LOCAL time, offset-free (e.g. "2026-07-15T20:00"), anchored by the
    // event's `timezone` — never a pre-baked UTC instant (decisions #10). Resolved to
    // an instant on demand, so a DST rule change or reschedule can't shift "20:00 local".
    localDateTime: text("local_date_time"),
    duration: integer("duration"), // minutes
    label: text("label").notNull(),
    description: text("description"),
    category: scheduleCategory("category").notNull().default("production"),
    ownerParticipantId: uuid("owner_participant_id").references(() => eventParticipants.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("schedule_items_event_id_idx").on(table.eventId)],
);

/**
 * A message in one of an event's THREADS. An event is not one conversation: the
 * operator is the hub and every counterparty meets them on their own edge of the
 * event, seeing only their slice (story.md, "the event is the shared object where
 * every party meets; each person sees only their slice of it").
 *
 * A thread is identified by `(visibility, thread_participant_id)`, and NOTHING
 * else — deliberately no `threads` table:
 *   - `all`       + NULL         → the EVENT ROOM (everyone with `event.view`).
 *   - `operators` + NULL         → the OPERATORS back office (host/co_host).
 *   - `party`     + participant  → that counterparty's PARTY THREAD.
 *
 * A thread has no attributes of its own — no title, no lifecycle, and crucially no
 * membership list. Its readers are DERIVED per request from the participation graph
 * (`apps/api/src/lib/message-threads.ts`), the same way every other visibility rule
 * here is a `WHERE` rather than a stored set (decisions #3). A `threads` table would
 * be a second membership store that can drift from `event_participants` — which is
 * exactly the `accessUids` fan-out this rebuild deletes. So: one nullable key column
 * on the message, and the rule stays the only source of truth.
 *
 * The CHECK is what keeps the two representations from disagreeing.
 */
export const eventMessages = pgTable(
  "event_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    senderUserId: text("sender_user_id")
      .notNull()
      .references(() => users.id),
    senderParticipantId: uuid("sender_participant_id").references(() => eventParticipants.id),
    /**
     * The counterparty whose thread this is — set for `party`, NULL otherwise. No
     * `ON DELETE`, matching every other reference to a participant: those rows are
     * never hard-deleted (see `event_participants`), so an accidental delete must
     * fail loudly rather than silently orphan a conversation.
     */
    threadParticipantId: uuid("thread_participant_id").references(() => eventParticipants.id),
    body: text("body").notNull(),
    attachments: jsonb("attachments"),
    visibility: messageVisibility("visibility").notNull().default("all"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("event_messages_event_id_idx").on(table.eventId),
    // Reading one thread is the hot path — the UI opens a single thread at a time.
    index("event_messages_thread_idx").on(table.eventId, table.threadParticipantId),
    check(
      "event_messages_thread_key_matches_scope",
      sql`(${table.visibility} = 'party') = (${table.threadParticipantId} IS NOT NULL)`,
    ),
  ],
);

/** A performer's setlist for an event — one per participant. Crew see it if shared. */
export const setlists = pgTable(
  "setlists",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => eventParticipants.id),
    items: jsonb("items"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique().on(table.eventId, table.participantId)],
);

/**
 * A setlist SHARED with one more participant (PLAN.md:412 — "crew see only if
 * shared (observer)"). The setlist itself stays party-scoped to the performer who
 * authored it; a row here is the performer's explicit, revocable grant of read
 * access to one other participant on the same event (the lighting operator on a
 * cued show, decisions.md "Setlists"). Never a write grant — only the author writes.
 */
export const setlistShares = pgTable(
  "setlist_shares",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    setlistId: uuid("setlist_id")
      .notNull()
      .references(() => setlists.id, { onDelete: "cascade" }),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => eventParticipants.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique().on(table.setlistId, table.participantId)],
);

/**
 * The operator's PRO filing, derived from the setlists on one show.
 *
 * A ROW IS A RECORD OF A REAL-WORLD ACT, not a submission shoWMe made. There is
 * no integration with any collecting society; the operator exports the
 * performed-works report and sends it to STIM/GEMA/PRS themselves, and this row
 * is where they write down that they did — when, in whose name, and with the
 * reference the society handed back. Migration 0023 has the full argument.
 *
 * ONE PER EVENT (unique index on `event_id`): a society hears about a
 * performance once, and a second report of the same night is an amendment, so
 * re-filing updates this row and the amendment history lives in `audit_log`.
 *
 * The `country`/`pro_name`/`rate_basis_points`/`ticket_revenue` group is
 * STAMPED at filing rather than re-derived on read, for the reason a finalized
 * settlement locks its FX rate (money.md): the venue's address can be corrected
 * years later and must not rewrite what the operator reported last month.
 */
export const performanceReports = pgTable(
  "performance_reports",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    /** The filing destination of record. `none` where we hold no code for the society. */
    proCode: proCode("pro_code").notNull().default("none"),
    /** The society as it was named on the filing — "STIM", "SACEM", "Koda". */
    proName: text("pro_name").notNull(),
    /** ISO 3166-1 alpha-2 of the territory the show happened in (decisions #17). */
    country: text("country").notNull(),
    filedAt: timestamp("filed_at", { withTimezone: true }).notNull().defaultNow(),
    filedByUserId: text("filed_by_user_id")
      .notNull()
      .references(() => users.id),
    /** The operator profile the filing was made in the name of. */
    filedByProfileId: uuid("filed_by_profile_id")
      .notNull()
      .references(() => profiles.id),
    /** The society's own receipt, when it gave one. Free text — every society differs. */
    reference: text("reference"),
    /** The performed works as they stood at filing. Count/runtime are derived, never stored. */
    works: jsonb("works").notNull(),
    /**
     * The royalty estimate and the three facts that make it checkable. All four
     * are null together when no published tariff is configured for `country` —
     * a filing never falls back to the planner's flat 6% (see 0023).
     */
    estimate: bigint("estimate", { mode: "bigint" }), // minor units (money.md)
    estimateCurrency: text("estimate_currency"),
    rateBasisPoints: integer("rate_basis_points"),
    ticketRevenue: bigint("ticket_revenue", { mode: "bigint" }), // minor units (money.md)
  },
  (table) => [uniqueIndex("performance_reports_one_per_event").on(table.eventId)],
);
