-- A CHANGE TO A BOOKED NIGHT IS A QUESTION, NOT AN EDIT.
--
-- ClickUp `86cbcftg3`. Ran: *"When trying to change the date for an event the
-- other side must be notified... '{operator} has request changing the date of
-- this event' - 'Confirm/Decline'... In general such logic should apply across
-- changes to date, venue, room/space."*
--
-- WHY THE PROPOSED VALUES CANNOT LIVE ON THE EVENT.
-- Below `pending` nobody has agreed to anything: the operator edits the event and
-- the invitation is simply re-asked, which needs no storage. From `pending`
-- upward somebody HAS agreed — to a particular night, in a particular room — and
-- moving it under them is a new question. The event must go on saying what was
-- agreed until the answer comes back, so the proposal needs somewhere else to be.
--
-- `changes` IS A PATCH, NOT A COPY. It holds only the fields being changed, so a
-- proposal can never carry a stale value for a field nobody touched — the failure
-- you get from snapshotting a whole row and applying it later. `previous` holds
-- what those same fields said when the proposal was raised, which is what lets a
-- card draw "12 Sept → 19 Sept" without re-deriving history.
--
-- Both are `jsonb` by the normalize-vs-embed rule: nothing joins or aggregates
-- across them. They are read with their request, shown, and applied.
CREATE TYPE "event_change_request_status" AS ENUM ('pending', 'confirmed', 'declined', 'superseded');
CREATE TYPE "event_change_response" AS ENUM ('confirmed', 'declined');

CREATE TABLE IF NOT EXISTS "event_change_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "event_id" uuid NOT NULL REFERENCES "events"("id") ON DELETE cascade,
  "proposed_by_profile_id" uuid REFERENCES "profiles"("id") ON DELETE set null,
  "proposed_by_user_id" text REFERENCES "users"("id"),
  "changes" jsonb NOT NULL,
  "previous" jsonb NOT NULL,
  "status" "event_change_request_status" DEFAULT 'pending' NOT NULL,
  "reason" text,
  "resolved_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "event_change_requests_event_id_idx" ON "event_change_requests" ("event_id");
CREATE INDEX IF NOT EXISTS "event_change_requests_status_idx" ON "event_change_requests" ("status");

-- ONLY ANSWERS ARE STORED. Who is REQUIRED to answer is derived at read time —
-- the participants standing on the event, minus the proposer — because that set
-- moves. An act added after the proposal was raised is on the bill and has a
-- stake in the night; a materialised list written at proposal time would not know
-- about them. Deriving it also means a participation removed in the meantime
-- stops blocking the change without anything having to reap a row.
CREATE TABLE IF NOT EXISTS "event_change_request_responses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "change_request_id" uuid NOT NULL REFERENCES "event_change_requests"("id") ON DELETE cascade,
  "participant_id" uuid NOT NULL REFERENCES "event_participants"("id") ON DELETE cascade,
  "response" "event_change_response" NOT NULL,
  "note" text,
  "responded_by_user_id" text REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  -- One answer per participant per request. Answering twice is a 409, not a
  -- second row that would double-count toward "everybody has confirmed".
  CONSTRAINT "event_change_request_responses_request_participant_key"
    UNIQUE ("change_request_id", "participant_id")
);

CREATE INDEX IF NOT EXISTS "event_change_request_responses_request_idx"
  ON "event_change_request_responses" ("change_request_id");
