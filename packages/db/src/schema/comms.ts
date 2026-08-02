import {
  bigint,
  boolean,
  date,
  index,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  time,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { adminAlertKind, calendarItemType, templateCategory } from "./enums";
import { events, eventParticipants } from "./events";
import { profiles, users } from "./identity";

/**
 * Module 10 — Communications & miscellany. The cross-cutting tables: the
 * per-user notification feed, the two logs (activity = user-facing/target-scoped,
 * audit = forensic/append-only), unified tasks + calendar, templates, spam
 * flags, admin alerts, audience RSVPs, and the FX display cache.
 */

/** A materialized per-user feed row. Recipients are resolved by a join at write time. */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    title: text("title"),
    body: text("body"),
    eventId: uuid("event_id").references(() => events.id, { onDelete: "cascade" }),
    actorUserId: text("actor_user_id").references(() => users.id),
    actorDisplay: text("actor_display"),
    link: text("link"),
    metadata: jsonb("metadata"),
    readAt: timestamp("read_at", { withTimezone: true }), // server-side read state
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("notifications_user_id_idx").on(table.userId)],
);

/** The user-facing activity feed. Target-scoped: a row shows iff you can view its target. */
export const activityLog = pgTable("activity_log", {
  id: uuid("id").defaultRandom().primaryKey(),
  eventId: uuid("event_id").references(() => events.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  actorUserId: text("actor_user_id").references(() => users.id),
  actorProfileId: uuid("actor_profile_id").references(() => profiles.id),
  actorDisplay: text("actor_display"),
  targetKind: text("target_kind"),
  targetId: uuid("target_id"),
  summary: jsonb("summary"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Forensic audit — EVERY mutation, written in the same txn as the change,
 * append-only, admin-only. `changes` is the before/after diff.
 */
export const auditLog = pgTable("audit_log", {
  id: uuid("id").defaultRandom().primaryKey(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  actorUserId: text("actor_user_id").references(() => users.id),
  actingProfileId: uuid("acting_profile_id").references(() => profiles.id),
  capability: text("capability"),
  action: text("action").notNull(),
  targetKind: text("target_kind"),
  targetId: uuid("target_id"),
  eventId: uuid("event_id").references(() => events.id),
  changes: jsonb("changes"),
  requestId: text("request_id"),
});

/** Unified todos — event, profile, or personal (nullable scope owners). */
export const tasks = pgTable("tasks", {
  id: uuid("id").defaultRandom().primaryKey(),
  eventId: uuid("event_id").references(() => events.id, { onDelete: "cascade" }),
  ownerProfileId: uuid("owner_profile_id").references(() => profiles.id),
  ownerUserId: text("owner_user_id").references(() => users.id),
  title: text("title").notNull(),
  description: text("description"),
  completed: boolean("completed").notNull().default(false),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  dueDate: date("due_date"),
  assigneeParticipantId: uuid("assignee_participant_id").references(() => eventParticipants.id),
  budgetType: text("budget_type"),
  budgetAmount: bigint("budget_amount", { mode: "bigint" }), // minor units (money.md)
  createdBy: text("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Scheduled reminders for a task (kept a table so reminder jobs can query by date). */
export const taskReminders = pgTable("task_reminders", {
  id: uuid("id").defaultRandom().primaryKey(),
  taskId: uuid("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  date: date("date").notNull(),
  time: time("time"),
  label: text("label"),
});

/** Unified calendar entries — event/profile/personal, appointment/task/note. */
export const calendarItems = pgTable("calendar_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerProfileId: uuid("owner_profile_id").references(() => profiles.id),
  ownerUserId: text("owner_user_id").references(() => users.id),
  type: calendarItemType("type").notNull(),
  title: text("title").notNull(),
  date: date("date").notNull(),
  startTime: time("start_time"),
  endTime: time("end_time"),
  entity: text("entity"),
  assigneeUserId: text("assignee_user_id").references(() => users.id),
  assigneeName: text("assignee_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A profile's blocked dates. PLAN.md models this as a `daterange`; here it is a
 * start/end pair for simplicity (add a GiST exclusion constraint later if
 * overlap prevention is ever needed).
 */
export const profileUnavailability = pgTable("profile_unavailability", {
  id: uuid("id").defaultRandom().primaryKey(),
  profileId: uuid("profile_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  reason: text("reason"),
});

/** A profile's saved template; `payload` is validated per-category by the API. */
export const templates = pgTable("templates", {
  id: uuid("id").defaultRandom().primaryKey(),
  profileId: uuid("profile_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  category: templateCategory("category").notNull(),
  name: text("name").notNull(),
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A spam report. Suspension is COMPUTED — `COUNT(DISTINCT reporter) >= 3` over a
 * 90-day window — never a stored counter. One report per (target, reporter, kind).
 */
export const spamFlags = pgTable(
  "spam_flags",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    targetProfileId: uuid("target_profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    reporterProfileId: uuid("reporter_profile_id")
      .notNull()
      .references(() => profiles.id),
    reporterUserId: text("reporter_user_id").references(() => users.id),
    kind: text("kind").notNull(),
    contextKind: text("context_kind"),
    contextId: uuid("context_id"),
    eventId: uuid("event_id").references(() => events.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique().on(table.targetProfileId, table.reporterProfileId, table.kind)],
);

/** An operator-facing alert when a spam or expansion threshold is crossed. */
export const adminAlerts = pgTable("admin_alerts", {
  id: uuid("id").defaultRandom().primaryKey(),
  kind: adminAlertKind("kind").notNull(),
  subjectKey: text("subject_key"),
  details: jsonb("details"),
  resolved: boolean("resolved").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Public RSVPs to an event — one per (event, email). */
export const audienceRsvps = pgTable(
  "audience_rsvps",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    name: text("name"),
    email: text("email").notNull(),
    city: text("city"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique().on(table.eventId, table.email)],
);

/** Live exchange rates for DISPLAY only — never touches settled amounts. Keyed by pair. */
export const exchangeRateCache = pgTable(
  "exchange_rate_cache",
  {
    base: text("base").notNull(),
    quote: text("quote").notNull(),
    rate: numeric("rate", { precision: 18, scale: 10 }).notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.base, table.quote] })],
);
