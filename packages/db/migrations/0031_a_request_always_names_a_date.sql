-- A booking request could arrive with no date on it, and nobody could answer it.
--
-- Ran, 2026-08-31: "requests should always come with a date or multiple dates to
-- select from", and "we should have a mark read/unread". Both are one table's
-- problem, so both are one migration.
--
-- WHY A DATELESS REQUEST IS NOT A REQUEST. `wanted_date` has been nullable since
-- 0000 and the public form's body made it optional, so "are you free sometime?"
-- was a legal ask. Nothing downstream can act on it: the inbox cannot place it
-- against a calendar, `POST /booking-requests/:id/draft-event` mints an event
-- with no `event_date`, the availability screen's day filter drops it, and the
-- pending-dedup index below cannot see it at all (its third column is
-- `wanted_date`, and Postgres counts NULLs as distinct, so two identical dateless
-- asks were two rows). The one place it was deliberately allowed — the public
-- PROFILE page, which has no published-date list to click — gets a date input in
-- the same change (`apps/marketing/src/availability-request.ts`), so the ask
-- survives; it just names a night now.
--
-- WHAT HAPPENS TO THE ROWS ALREADY LIKE THAT: NOTHING, AND THE DEPLOY STOPS.
-- There is no honest backfill. A date is the sender's information, not ours:
-- `created_at + 30 days` invents an ask nobody made, and it would then be sent
-- into the dedup index and into a draft event as though the sender had chosen it.
-- Deleting the rows is worse — they are somebody's inbox. Production has never
-- carried booking-request data (the app is deployed but the table is empty), but
-- every dev and seeded database has rows, and this migration cannot see them from
-- here. So it counts, refuses, and says exactly what to do. If you are reading
-- this in a failed deploy: give those rows a date, or delete them deliberately,
-- then re-run.
DO $$
DECLARE
  dateless bigint;
BEGIN
  SELECT count(*) INTO dateless FROM booking_requests WHERE wanted_date IS NULL;

  IF dateless > 0 THEN
    RAISE EXCEPTION
      'booking_requests holds % row(s) with no wanted_date, and this migration will NOT invent one. A date is the sender''s information: backfilling it would put an ask nobody made into the dedup index and into any draft event made from the row. Set a date on those rows by hand, or delete them, then re-run. To find them: SELECT id, source, email, created_at FROM booking_requests WHERE wanted_date IS NULL;', dateless;
  END IF;
END $$;

ALTER TABLE "booking_requests" ALTER COLUMN "wanted_date" SET NOT NULL;

-- AND THE ALTERNATES COLUMN STOPS BEING A DECORATION.
--
-- `additional_dates` has existed since 0000 with ZERO readers and ZERO writers in
-- `apps/api`, `apps/web` and `apps/marketing` — a column that looks like a
-- feature and is not one. It is kept rather than dropped because it is precisely
-- the second half of what Ran asked for ("or multiple dates to select from"), and
-- it now has a shape (a jsonb array of `YYYY-MM-DD`), two writers (the public
-- form and `POST /offers`) and a reader (every booking-request payload, plus the
-- draft event's notes).
--
-- The CHECK states the half of the shape the database can hold on its own — that
-- it is an ARRAY. Distinctness, the cap of five and "never repeats wanted_date"
-- are Zod's, in `routes/inbound.ts`, because they are refusals a sender must be
-- told about in words, not a 23514 surfaced as a 500. Adding it validated is safe
-- for the reason above: with no writer, every existing row is NULL. If that turns
-- out to be false somewhere, this statement fails loudly rather than accepting a
-- shape the readers cannot render — which is the correct outcome.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'booking_requests_additional_dates_is_array'
  ) THEN
    ALTER TABLE "booking_requests"
      ADD CONSTRAINT "booking_requests_additional_dates_is_array"
      CHECK ("additional_dates" IS NULL OR jsonb_typeof("additional_dates") = 'array');
  END IF;
END $$;

-- READ / UNREAD — ON THE ROW, BECAUSE THE INBOX BELONGS TO THE PROFILE.
--
-- `booking_requests` has never had a read or seen column of any kind: `pending`
-- is a TRIAGE state (nobody has answered) and was doing double duty as a READ
-- state (nobody has looked), which is why an operator could not tell a request
-- they had read and left open from one that arrived while they were out.
--
-- It is one column on the row and not a `booking_request_reads(request_id,
-- user_id)` join table, because a booking request is addressed to a PROFILE and
-- every other fact about how that profile handled it is already profile-scoped:
-- `status`, the spam flag, the draft event. One admin declining declines it for
-- the venue; one admin reading it marks it read for the venue, and the colleague
-- who opens the inbox next sees that somebody has it. The per-person layer that a
-- join table would add already exists somewhere better: every member got their
-- own `notifications` row when it arrived, with its own `read_at` (the
-- notification route also learns to un-read in this change).
--
-- `read_by_user_id` is the name that makes the shared state usable — "seen" with
-- nobody attached is how two people answer the same request. It is nullable and
-- cleared on un-read, so the pair is always consistent: both set, or both null.
ALTER TABLE "booking_requests" ADD COLUMN IF NOT EXISTS "read_at" timestamp with time zone;
ALTER TABLE "booking_requests" ADD COLUMN IF NOT EXISTS "read_by_user_id" text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'booking_requests_read_by_user_id_users_id_fk'
  ) THEN
    ALTER TABLE "booking_requests"
      ADD CONSTRAINT "booking_requests_read_by_user_id_users_id_fk"
      FOREIGN KEY ("read_by_user_id") REFERENCES "users"("id");
  END IF;
END $$;

-- Partial on exactly the query the badge runs (`?unread=true`, scoped to the
-- profiles you are a member of, newest first), so the index holds only what is
-- still waiting to be looked at rather than a row per request ever received.
CREATE INDEX IF NOT EXISTS "booking_requests_unread_idx"
  ON "booking_requests" ("target_profile_id", "created_at")
  WHERE "read_at" IS NULL;
