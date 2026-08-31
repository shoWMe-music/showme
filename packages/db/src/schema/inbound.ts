import { sql } from "drizzle-orm";
import {
  bigint,
  date,
  index,
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
    /**
     * THE NIGHT BEING ASKED ABOUT — required, on every path (Ran, 2026-08-31:
     * "requests should always come with a date or multiple dates to select
     * from"). It was nullable until 0031, and a dateless request was a message
     * nobody could act on: it cannot be checked against a calendar, it makes a
     * draft event with no date on it, and the dedup index below cannot see it.
     */
    wantedDate: date("wanted_date").notNull(),
    /**
     * The OTHER nights the sender would take, in calendar order — "any of these
     * three works". A set of options, not a range and not a priority list, which
     * is why it is a plain array of `YYYY-MM-DD` and why the route sorts it: the
     * order it arrived in carries no meaning.
     *
     * Every entry is distinct, none of them repeats `wanted_date`, and there are
     * at most five (`routes/inbound.ts`). It is `jsonb` rather than a table by
     * the normalize-vs-embed rule: nothing joins or aggregates by an alternate
     * date — it is read with its request and displayed, and the ONE date the
     * request is filtered and deduplicated by is `wanted_date`.
     */
    additionalDates: jsonb("additional_dates").$type<string[]>(),
    /**
     * SEEN BY THE PROFILE, NOT BY A PERSON (Ran: "we should have a mark
     * read/unread"). A request arrives in a profile's shared inbox, and every
     * other fact about how that inbox handled it — `status`, the flag, the draft
     * event — is already profile-scoped: if one admin declines it, it is declined
     * for the venue. Read follows the same ownership, so a colleague opening the
     * inbox sees the same triage state as the person who read it first.
     *
     * The per-person layer already exists and is not this column: each member got
     * their own `notifications` row for the arrival, with its own `read_at`. A
     * `booking_request_reads` join table would only duplicate that.
     *
     * `read_by_user_id` is here because a shared inbox has to answer "who has
     * this?" — "seen" without a name is how two people answer the same request.
     */
    readAt: timestamp("read_at", { withTimezone: true }),
    readByUserId: text("read_by_user_id").references(() => users.id),
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
    // also collapse the others. Collapsing just this one column keeps the original
    // rule intact and adds the act to it.
    //
    // 2026-08-31: `wanted_date` is NOT NULL now, so the index's third column is
    // never NULL and the guard bites on every offer rather than skipping the
    // dateless ones. `NULLS NOT DISTINCT` is STILL wrong for the index as a
    // whole, for the remaining nullable column: `sender_user_id` is NULL on every
    // public-form row, so collapsing it would make two DIFFERENT strangers asking
    // the same venue for the same night a duplicate of each other. Those rows are
    // deduplicated by the sender's EMAIL instead, in the route.
    uniqueIndex("booking_requests_pending_dedup")
      .on(
        table.senderUserId,
        table.targetProfileId,
        table.wantedDate,
        sql`coalesce(${table.onBehalfOfProfileId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      )
      .where(sql`${table.status} = 'pending'`),
    // The unread inbox — `GET /booking-requests?unread=true`, which is the badge
    // on the screen. Partial on exactly that predicate, so the index holds only
    // what is still waiting to be looked at rather than a row per request ever
    // received; a request that gets read drops straight out of it.
    index("booking_requests_unread_idx")
      .on(table.targetProfileId, table.createdAt)
      .where(sql`${table.readAt} is null`),
  ],
);
