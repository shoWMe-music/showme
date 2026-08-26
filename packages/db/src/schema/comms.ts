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
import { groups, profiles, users } from "./identity";

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
 *
 * `event_id` is deliberately a BARE uuid with **no foreign key**: the audit log is
 * history, and history outlives the row it describes. A foreign key would either
 * block `DELETE /events/:id` outright or (with `ON DELETE SET NULL`) silently blank
 * the column that groups a deleted event's whole trail together — losing exactly the
 * record an audit exists to keep. The same reasoning applies to `target_id`, which
 * has never had one.
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
  eventId: uuid("event_id"), // no FK — see the note above; the trail survives the event
  changes: jsonb("changes"),
  requestId: text("request_id"),
});

/** Unified todos — event, profile, or personal (nullable scope owners). */
export const tasks = pgTable("tasks", {
  id: uuid("id").defaultRandom().primaryKey(),
  eventId: uuid("event_id").references(() => events.id, { onDelete: "cascade" }),
  ownerProfileId: uuid("owner_profile_id").references(() => profiles.id),
  ownerUserId: text("owner_user_id").references(() => users.id),
  // Optional named work-group (reusable roster) this task belongs to — drives
  // the Tasks screen's group-by-work-group view. Null = ungrouped/scope-only.
  groupId: uuid("group_id").references(() => groups.id, { onDelete: "set null" }),
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

/**
 * Unified calendar entries — event/profile/personal; task, appointment, note, or
 * an imported `external` event.
 *
 * OWNERSHIP IS TWO COLUMNS AND BOTH MATTER FOR AN IMPORTED ROW.
 * `ownerProfileId` is WHOSE AVAILABILITY this occupies — availability is a
 * property of a profile (that is what `profile_unavailability` is keyed by and
 * what the public page is asked about), so an import that should block bookings
 * must name a profile. `ownerUserId` is WHOSE CALENDAR IT CAME FROM — the person
 * who connected the account. A hand-authored row sets one or the other; an
 * imported row sets BOTH, and the pair is exactly what the title rule needs:
 * co-members of a profile may see that Tuesday 09:00–09:30 is taken, but only the
 * person whose Google account it came from may see that it is called "Founder
 * Lunch" (see `serialize/calendar.ts`).
 */
export const calendarItems = pgTable(
  "calendar_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerProfileId: uuid("owner_profile_id").references(() => profiles.id),
    ownerUserId: text("owner_user_id").references(() => users.id),
    type: calendarItemType("type").notNull(),
    title: text("title").notNull(),
    date: date("date").notNull(),
    // The last day this entry runs, inclusive; null means it starts and ends on
    // `date`. Added for imports: a real calendar contains multi-day entries (a
    // festival, a holiday, a tour leg), and a single `date` could only model one
    // by expanding it into a row per day — which would give every one of those
    // rows the SAME `external_id` and so collide with the idempotency index that
    // makes re-syncing safe. One row, two bounds, one identity.
    endDate: date("end_date"),
    startTime: time("start_time"),
    endTime: time("end_time"),
    entity: text("entity"),
    assigneeUserId: text("assignee_user_id").references(() => users.id),
    assigneeName: text("assignee_name"),
    // Where this row came from, when it did not come from us. `externalSource` names
    // the provider ("google", "ics"); `externalId` is that provider's opaque event id.
    // The pair is what makes a re-sync idempotent — without it, importing the same
    // calendar twice duplicates every entry, because nothing else about a calendar
    // row is stable enough to match on (a title and a date are not an identity).
    // Both null for anything authored inside shoWMe. See migration 0009.
    externalSource: text("external_source"),
    externalId: text("external_id"),
    // Does this entry take its time off the owner's availability? True by default,
    // which is the product rule stated plainly: an imported commitment occupies you
    // unless you say otherwise. `false` is the user's "available anyway" override —
    // the dentist appointment you would happily move for a show.
    //
    // WHY A FLAG RATHER THAN DELETING THE ROW: the entry is still on the user's real
    // calendar. Deleting it here would make it come straight back on the next sync,
    // and the override with it. The flag survives an upsert precisely because the
    // upsert does not touch it.
    //
    // Non-external rows carry `true` as well, and nothing reads it there yet — the
    // availability union ingests imported entries only, because a note or a task is
    // a reminder, not an occupied window. The value is not a lie: it says "if this
    // were counted, it would count", which is what a shoWMe-authored appointment
    // would want if appointments are ever folded in.
    blocksAvailability: boolean("blocks_availability").notNull().default(true),
    // The shoWMe event this entry was turned into ("turn it into a real event").
    // Modelled exactly like `booking_requests.event_id`: the calendar entry predates
    // the event and outlives it, so the link is `SET NULL` rather than `CASCADE` —
    // deleting the show must not silently delete the imported entry, because the
    // commitment is still on the user's real calendar and still occupies the night.
    promotedEventId: uuid("promoted_event_id").references(() => events.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // The availability read is "this profile, these days" and the list route is the
  // same question — one composite index serves both. Deliberately NOT partial on
  // `type = 'external'`: a partial index on a value added to the enum in the same
  // migration cannot be created in that migration (Postgres refuses to use a new
  // enum value in the transaction that added it), and the full index is useful to
  // the list route anyway.
  (table) => [index("calendar_items_owner_profile_date_idx").on(table.ownerProfileId, table.date)],
);

/**
 * A copy of one of OUR events living on somebody else's calendar — the outbound
 * half of calendar sync ("the events in shoWMe should also show in the calendar").
 *
 * WHY A TABLE AND NOT COLUMNS ON `events`. The inbound and outbound directions are
 * not the same relationship, and collapsing them would be the mistake. An imported
 * row EXISTS BECAUSE the remote event exists — that is provenance, it is intrinsic
 * to the row, and it belongs on the row (`calendar_items.external_source/id`, added
 * by 0009). A pushed copy is the opposite: the `events` row is the original and the
 * remote copy is a projection with its own lifecycle, its own ETag, and its own
 * failure modes. Putting `google_event_id`, `google_calendar_id`, `etag` and
 * `pushed_at` on `events` would park four columns of sync plumbing in the middle of
 * the booking/settlement spine, where every reader of the table has to scroll past
 * them, and would add four more the day a second provider appears. Here a second
 * provider is a second ROW.
 *
 * It is also what makes the ECHO trap detectable. Push an event to Google, then run
 * the inbound sync, and without this table the event comes back as an imported
 * external entry that blocks its own night twice. The inbound seam asks this table
 * first — "is this remote id a copy of something of ours?" — and skips it if so.
 * One indexed lookup on the unique key below.
 *
 * NOT HERE, deliberately: the credential. A `sync_token`, a refresh token, and the
 * webhook channel registration are all per-CONNECTION (a user and one remote
 * calendar), not per-event, and where a refresh token may be stored is an open
 * security decision. See `lib/external-calendar.ts` for exactly what is still
 * missing.
 */
export const externalCalendarMirrors = pgTable(
  "external_calendar_mirrors",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    /** The provider holding the copy — "google" today. */
    provider: text("provider").notNull(),
    /** That provider's calendar id (for Google, the calendar's address). */
    providerCalendarId: text("provider_calendar_id").notNull(),
    /** That provider's id for the copy — what an update or a delete addresses. */
    providerEventId: text("provider_event_id").notNull(),
    /** The provider's version stamp, sent back as `If-Match` so a push cannot
     * clobber an edit made on the far side without us noticing. */
    etag: text("etag"),
    /** When the provider last saw the copy change — theirs, not ours. */
    remoteUpdatedAt: timestamp("remote_updated_at", { withTimezone: true }),
    /** When we last wrote it. `remoteUpdatedAt > pushedAt` means they edited it. */
    pushedAt: timestamp("pushed_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One link per remote event, and the lookup the echo check performs.
    unique("external_calendar_mirrors_remote_identity").on(
      table.provider,
      table.providerCalendarId,
      table.providerEventId,
    ),
    index("external_calendar_mirrors_event_idx").on(table.eventId),
  ],
);

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
    // Context only. A deleted event must not take the report (and the suspension
    // count it feeds) with it, so the pointer clears and the flag stands.
    eventId: uuid("event_id").references(() => events.id, { onDelete: "set null" }),
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
