import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  time,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { permissionSets } from "./authorization";
import { eventParticipantRole, eventParticipantStatus, eventStatus, performerTag } from "./enums";
import { profiles, users } from "./identity";

/**
 * Module 2 — Events. The second hub. An event is a container; profiles join it
 * as `event_participants`. That join table replaces the entire Firestore
 * `accessUids`/`accessProfileIds` fan-out (~1,700 LOC): access is now a plain
 * join `profile_members → event_participants` (PLAN.md "Events model").
 */

/**
 * The event. Wall-clock times (`door_time`…`curfew`) are stored offset-free and
 * anchored by `timezone` (snapshotted from the venue at creation — DST- and
 * reschedule-safe). `base_currency` is the settlement/reporting currency. Hold
 * state lives here as columns (`status='on_hold'`, `hold_rank`,
 * `hold_auto_promote`) rather than a separate table (PLAN.md §G).
 */
export const events = pgTable("events", {
  id: uuid("id").defaultRandom().primaryKey(),
  hostProfileId: uuid("host_profile_id")
    .notNull()
    .references(() => profiles.id),
  title: text("title").notNull(),
  status: eventStatus("status").notNull().default("draft"),
  eventDate: date("event_date"),
  doorTime: time("door_time"), // LOCAL wall-clock, no offset
  startTime: time("start_time"),
  endTime: time("end_time"),
  curfew: time("curfew"),
  timezone: text("timezone"), // IANA, snapshotted onto the event
  venueProfileId: uuid("venue_profile_id").references(() => profiles.id),
  stageId: uuid("stage_id").references(() => stages.id, { onDelete: "set null" }),
  venueName: text("venue_name"),
  capacity: integer("capacity"),
  baseCurrency: text("base_currency").notNull(),
  published: boolean("published").notNull().default(false),
  notes: text("notes"),
  extras: jsonb("extras"), // amenities / catering / ticket links, read with the event
  holdRank: integer("hold_rank"),
  holdAutoPromote: boolean("hold_auto_promote").notNull().default(false),
  version: integer("version").notNull().default(1), // optimistic lock (decisions #8)
  createdBy: text("created_by")
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A physical stage/room owned by a place profile — a **venue or festival** (both
 * operator-kind). It is a permanent attribute of that profile, not of any event.
 * An event is placed on exactly one stage via `events.stage_id`, so a venue or
 * festival runs concurrent events by putting them on different stages. The stages
 * available to an event are those whose `venue_profile_id` is the event's venue.
 *
 * NOT the same thing as `venue_details.capacity_setups`. A stage is a ROOM — a
 * separate space that can hold its own show on the same night. A capacity setup
 * is a named ARRANGEMENT of one room ("Theater seating" 220 / "Standing only"
 * 400): the same four walls, counted differently. Two rooms can be booked twice
 * on a Friday; two setups of one room cannot.
 *
 * `events.stage_id` is `ON DELETE SET NULL` (see `events` above), which is the
 * schema's answer to "what happens to the shows when a room is deleted": the
 * shows survive and become room-less, exactly as if they had never been assigned.
 * Deleting a room is a statement about the BUILDING, and a settled event must
 * never disappear because someone tidied up a floor plan.
 */
export const stages = pgTable(
  "stages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    venueProfileId: uuid("venue_profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    capacity: integer("capacity"),
  },
  (table) => [
    // "The rooms of this venue" is now a real query — it draws the room picker on
    // an event, the rooms card on the profile, and every calendar in the
    // availability dropdown.
    index("stages_venue_profile_id_idx").on(table.venueProfileId),
    // Two rooms of one venue may not share a name. A room list is chosen from by
    // NAME — in the dropdown, on the event, in the shared availability link — so
    // duplicates are not a cosmetic problem: they make the choice meaningless.
    unique("stages_venue_profile_id_name_key").on(table.venueProfileId, table.name),
  ],
);

/**
 * A profile's participation in an event — event-role + a modular permission set.
 * The host is both `events.host_profile_id` and a `host` row here, so access is
 * one uniform join. `details` folds in the former `crew_details` (call time,
 * task, pay note) for crew participants. Unique per (event, profile).
 *
 * **INVARIANT — a participant row is never hard-deleted.** Removing someone (an
 * operator dropping a participant, a group unassigned, a representation
 * terminated) sets `status = 'removed'`; `authorize()` excludes those rows, so
 * access ends immediately while the record stays. This is not tidiness: money
 * history points here — `settlements.participant_id`, `settlement_transfers`,
 * `settlement_approvals`, `budget_lines.collected_by/paid_by/payee`,
 * `deal_parties.participant_id` — and those references carry NO `ON DELETE` on
 * purpose. They are the backstop: an accidental hard delete fails loudly instead
 * of orphaning or erasing a settled figure.
 */
export const eventParticipants = pgTable(
  "event_participants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id),
    role: eventParticipantRole("role").notNull(),
    permissionSetId: uuid("permission_set_id").references(() => permissionSets.id),
    performerTag: performerTag("performer_tag"),
    status: eventParticipantStatus("status").notNull().default("invited"),
    details: jsonb("details"), // crew_details (call_time, task, pay_note) folded in
    addedBy: text("added_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique().on(table.eventId, table.profileId),
    // Both directions of the access join are hot: by event (list participants)
    // and by profile (list a profile's events).
    index("event_participants_event_id_idx").on(table.eventId),
    index("event_participants_profile_id_idx").on(table.profileId),
  ],
);
