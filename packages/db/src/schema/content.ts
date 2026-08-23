import {
  type AnyPgColumn,
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
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

/** A typed event message with `visibility` (operators can keep internal notes). */
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
    body: text("body").notNull(),
    attachments: jsonb("attachments"),
    visibility: messageVisibility("visibility").notNull().default("all"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("event_messages_event_id_idx").on(table.eventId)],
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

/** The operator's PRO filing, derived from a setlist. */
export const performanceReports = pgTable("performance_reports", {
  id: uuid("id").defaultRandom().primaryKey(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  proCode: proCode("pro_code").notNull().default("none"),
  eventType: text("event_type"),
  confidence: text("confidence"),
  estimate: bigint("estimate", { mode: "bigint" }), // minor units (money.md)
});
