-- Imported calendar entries: what they are, that they occupy time, and how one
-- becomes a show.
--
-- 0009 gave `calendar_items` an external IDENTITY (`external_source`,
-- `external_id`) so a re-sync updates instead of duplicating. It stopped there:
-- an imported entry was indistinguishable from a hand-typed note, occupied
-- nothing, and could not become anything. This migration adds the three things
-- the product actually asks for — "treat them as external events", "block
-- availability for the times they are there unless marked available anyway",
-- "turn it into a real event" — plus the outbound half, so a shoWMe event can
-- appear on the user's own calendar without coming back as a duplicate.

-- `external` is a KIND, not a NULL check. `external_source` says which provider a
-- row came from; `type` says what the row IS to shoWMe — and an external event is
-- its own thing here: it hides its title from everyone but the person whose
-- calendar it came from, it occupies availability, and it can be promoted. None
-- of that is true of a task or a note. The two columns cannot drift because
-- `POST /calendar` refuses `external` outright: an external event is never
-- hand-authored, it arrives through the sync seam, which stamps both.
--
-- NOTE — nothing below may mention 'external'. Postgres permits ALTER TYPE ...
-- ADD VALUE inside a transaction block but refuses to USE the new value in that
-- same transaction, and drizzle runs one migration file as one transaction. That
-- is why the index further down is not partial on `type = 'external'`.
ALTER TYPE "public"."calendar_item_type" ADD VALUE 'external';

--> statement-breakpoint

ALTER TABLE "calendar_items"
  -- The last day the entry runs, inclusive; NULL = it starts and ends on `date`.
  -- Real calendars contain multi-day entries (a festival, a holiday, a tour leg),
  -- and one `date` column could only model those by expanding them into a row per
  -- day — which would hand every one of those rows the SAME `external_id` and
  -- collide with 0009's idempotency index. One row, two bounds, one identity.
  ADD COLUMN "end_date" date,

  -- Does this entry take its time off the owner's availability? TRUE by default,
  -- which is the rule stated plainly: an imported commitment occupies you unless
  -- you say otherwise. FALSE is the user's "available anyway" override.
  --
  -- WHY A FLAG AND NOT A DELETE: the entry is still on the user's real calendar,
  -- so deleting the row here brings it straight back on the next sync — and takes
  -- the override with it. The flag survives because the upsert does not touch it.
  --
  -- Existing rows take TRUE and nothing changes for them: the availability union
  -- ingests `external` entries only, and there are none yet. A note is a reminder,
  -- not an occupied window.
  ADD COLUMN "blocks_availability" boolean DEFAULT true NOT NULL,

  -- The show this entry was turned into. Modelled on `booking_requests.event_id`,
  -- which solves the identical problem, down to the delete rule: the calendar
  -- entry predates the event and outlives it, so deleting the show must NOT
  -- delete the entry. The commitment is still on the user's real calendar and
  -- still occupies that night; a CASCADE here would silently free it.
  ADD COLUMN "promoted_event_id" uuid;

--> statement-breakpoint

ALTER TABLE "calendar_items"
  ADD CONSTRAINT "calendar_items_promoted_event_id_events_id_fk"
  FOREIGN KEY ("promoted_event_id") REFERENCES "public"."events"("id")
  ON DELETE set null ON UPDATE no action;

--> statement-breakpoint

-- A range that ends before it starts is not a shorter block, it is a block that
-- silently matches nothing — the worst failure mode for an availability rule.
ALTER TABLE "calendar_items"
  ADD CONSTRAINT "calendar_items_end_date_after_start_check"
  CHECK ("end_date" IS NULL OR "end_date" >= "date");

--> statement-breakpoint

-- The availability read asks "this profile, these days", and the list route asks
-- the same question — one composite index serves both. See the note above for why
-- it is not partial on the new enum value.
CREATE INDEX "calendar_items_owner_profile_date_idx"
  ON "calendar_items" USING btree ("owner_profile_id","date");

--> statement-breakpoint

-- A copy of one of OUR events living on somebody else's calendar — the outbound
-- half of sync.
--
-- WHY A TABLE AND NOT COLUMNS ON `events`. Inbound and outbound are not the same
-- relationship. An imported row exists BECAUSE the remote event exists: that is
-- provenance, intrinsic to the row, and it belongs on the row (0009). A pushed
-- copy is the reverse — the `events` row is the original and the remote copy is a
-- projection with its own id, its own ETag and its own failure modes. Four
-- columns of sync plumbing parked in the middle of the booking/settlement spine
-- would be read past by everyone who works on events and would need four more the
-- day a second provider appears; here a second provider is a second ROW.
--
-- It is also what makes the ECHO trap detectable. Push an event to Google, run
-- the inbound sync, and without this table it returns as an imported entry that
-- blocks its own night a second time. The inbound seam asks this table first —
-- "is this remote id a copy of something of ours?" — and skips it if so.
--
-- NOT HERE, deliberately: the credential. A refresh token, Google's per-calendar
-- `nextSyncToken`, and the webhook channel registration are all per-CONNECTION (a
-- user and one remote calendar), not per-event, and where a refresh token may be
-- stored is an unresolved security decision. See `apps/api/src/lib/external-calendar.ts`.
CREATE TABLE "external_calendar_mirrors" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "event_id" uuid NOT NULL,
  -- The provider holding the copy — "google" today.
  "provider" text NOT NULL,
  -- That provider's calendar id (for Google, the calendar's address).
  "provider_calendar_id" text NOT NULL,
  -- That provider's id for the copy — what an update or a delete addresses.
  "provider_event_id" text NOT NULL,
  -- The provider's version stamp, sent back as `If-Match` so a push cannot
  -- clobber an edit made on the far side without us noticing.
  "etag" text,
  -- When the provider last saw the copy change — theirs, not ours.
  "remote_updated_at" timestamp with time zone,
  -- When we last wrote it. `remote_updated_at > pushed_at` means they edited it.
  "pushed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  -- One link per remote event, and the lookup the echo check performs.
  CONSTRAINT "external_calendar_mirrors_remote_identity" UNIQUE("provider","provider_calendar_id","provider_event_id")
);

--> statement-breakpoint

-- CASCADE and not SET NULL: a mirror row is live bookkeeping about a copy, not
-- history. With no event there is nothing left to mirror, and a row pointing at
-- a NULL event would be a permanent orphan the pusher could never resolve.
-- The consequence is stated where it belongs — the outbound seam must issue the
-- remote delete BEFORE the local one, because afterwards the address is gone.
ALTER TABLE "external_calendar_mirrors"
  ADD CONSTRAINT "external_calendar_mirrors_event_id_events_id_fk"
  FOREIGN KEY ("event_id") REFERENCES "public"."events"("id")
  ON DELETE cascade ON UPDATE no action;

--> statement-breakpoint

CREATE INDEX "external_calendar_mirrors_event_idx"
  ON "external_calendar_mirrors" USING btree ("event_id");
