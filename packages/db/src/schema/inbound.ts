import { sql } from "drizzle-orm";
import {
  bigint,
  date,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { bookingRequestSource, bookingRequestStatus, bookingSentVia } from "./enums";
import { events } from "./events";
import { profiles, users } from "./identity";

/**
 * Module 8 — Inbound booking requests. One table for all three entry flows
 * (public form / performer offer / venue handoff, PLAN.md §L). A partial unique
 * index dedups only *pending* requests for the same (sender, target, date) so a
 * declined request can be re-sent. Reaper jobs flip stale rows to `expired`.
 */
export const bookingRequests = pgTable(
  "booking_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    source: bookingRequestSource("source").notNull(),
    status: bookingRequestStatus("status").notNull().default("pending"),
    targetProfileId: uuid("target_profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    senderUserId: text("sender_user_id").references(() => users.id),
    senderProfileId: uuid("sender_profile_id").references(() => profiles.id),
    contactName: text("contact_name"),
    email: text("email"),
    phone: text("phone"),
    artistName: text("artist_name"),
    wantedDate: date("wanted_date"),
    additionalDates: jsonb("additional_dates"),
    artistFee: bigint("artist_fee", { mode: "bigint" }), // minor units (money.md)
    offerFeeMin: bigint("offer_fee_min", { mode: "bigint" }),
    offerFeeMax: bigint("offer_fee_max", { mode: "bigint" }),
    // The currency the fees above are denominated in. Stamped at creation from the
    // TARGET (venue) profile's country — currency is a per-country fact (#17) — and
    // authoritative thereafter, so re-stating the venue's country never reprices an
    // existing request. NULL only when the venue's country is unknown, in which case
    // the amount is shown without a symbol rather than guessed.
    currency: text("currency"),
    pitch: text("pitch"),
    note: text("note"),
    musicUrl: text("music_url"),
    videoUrl: text("video_url"),
    senderType: text("sender_type"),
    performerType: text("performer_type"),
    genres: jsonb("genres"),
    websiteUrl: text("website_url"),
    socialLinks: jsonb("social_links"),
    sentVia: bookingSentVia("sent_via").notNull().default("in_platform"),
    // The request predates the event and outlives it — the conversation stands,
    // only the link to the (deleted) event clears.
    eventId: uuid("event_id").references(() => events.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("booking_requests_pending_dedup")
      .on(table.senderUserId, table.targetProfileId, table.wantedDate)
      .where(sql`${table.status} = 'pending'`),
  ],
);
