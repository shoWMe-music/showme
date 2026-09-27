-- A REQUEST NAMES THE ROOM IT WANTS.
--
-- ClickUp `123qy9rpqp0`, §3: *"Every booking request form must carry and autofill the
-- selected Venue and Room/space, not only the date. This way every incoming request
-- arrives with date + venue + room, and the system can check it for double booking the
-- moment it comes in."*
--
-- `booking_requests` carried a date and nothing about WHERE. That is the whole reason
-- the double-booking check cannot run on an incoming request (`123qy9rprbx` §1): a
-- double booking is relative to a physical space — two separate events on one date in
-- the SAME venue and room — and the row held one of the three facts that question
-- needs.
--
-- BOTH NULLABLE, and not as a migration convenience. A request to a PERFORMER names no
-- venue, because an act does not own a room. A request from the public profile page of
-- a two-room venue may legitimately not have picked between them yet. The absence is a
-- real state and reads as "not said" — never as "the whole venue", which is a
-- different claim and the one that would silently pass a double-booking check.
--
-- WHY `stage_id` IS `ON DELETE SET NULL` and `venue_profile_id` CASCADES. The same
-- split migration 0045 made for `profile_unavailability`, for the same reason read from
-- the other end: shutting a room must not erase the requests that asked for it — the
-- ask still happened, and the operator still has to answer it — whereas a request whose
-- target venue profile is gone has nobody to answer it and goes with the profile.
--
-- NOT VALIDATED HERE. That the room belongs to the venue, and the venue to the profile
-- being asked, is enforced on the write path (`routes/inbound.ts`) rather than by a
-- composite foreign key. A public form posts these, so the check has to produce a 400
-- naming what was wrong, not a constraint violation surfacing as a 500 — and the rule
-- is "the venue is the profile being asked, or one it owns", which no foreign key can
-- state.
ALTER TABLE "booking_requests"
  ADD COLUMN IF NOT EXISTS "venue_profile_id" uuid REFERENCES "profiles"("id") ON DELETE cascade;

ALTER TABLE "booking_requests"
  ADD COLUMN IF NOT EXISTS "stage_id" uuid REFERENCES "stages"("id") ON DELETE set null;

-- The read this buys is "is anything already booked in this room on this date", which
-- runs against `events`, not against this table — so neither column needs an index for
-- the check itself. This one serves the cascade above and the inbox's own per-venue
-- reads, and claims nothing more.
CREATE INDEX IF NOT EXISTS "booking_requests_venue_profile_id_idx"
  ON "booking_requests" ("venue_profile_id");
