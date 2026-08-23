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
    // The performer an AGENT is offering on behalf of (decisions #14): the sender
    // profile is the agent's own, so without this the act being offered has no
    // identity. Set only when an active representation covers the two — validated
    // at write time, never inferred at read time.
    onBehalfOfProfileId: uuid("on_behalf_of_profile_id").references(() => profiles.id, {
      onDelete: "set null",
    }),
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
    // Dedup only PENDING requests, so a declined one can be re-sent. The act being
    // offered is part of the identity of the offer: an agent pitching two different
    // performers to the same venue on the same night is two offers, not a duplicate.
    // The act is COALESCEd rather than indexed raw, and only the act: Postgres
    // treats NULLs as distinct, so an unqualified `on_behalf_of_profile_id` would
    // make every direct (non-agent) offer unique and switch the guard off for the
    // senders it was written for. `NULLS NOT DISTINCT` would fix that column but
    // also collapse the others, silently deduplicating two DATELESS offers that
    // have always been allowed. Collapsing just this one column keeps the original
    // rule intact and adds the act to it.
    uniqueIndex("booking_requests_pending_dedup")
      .on(
        table.senderUserId,
        table.targetProfileId,
        table.wantedDate,
        sql`coalesce(${table.onBehalfOfProfileId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      )
      .where(sql`${table.status} = 'pending'`),
  ],
);
