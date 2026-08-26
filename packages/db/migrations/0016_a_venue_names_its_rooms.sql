-- A venue could not name its own rooms.
--
-- `stages` — this schema's word for a room or sub-venue — has existed since 0000
-- and `events.stage_id` has pointed at it since 0000, but NOTHING has ever
-- written a row: no API route listed, created or renamed one, so the table held
-- only what a test inserted by hand. The consequences were visible on two
-- screens. The event detail page could only render "Room / Stage: Assigned",
-- because it had no way to learn the room's NAME. And the Calendar's
-- "Check & Share Availability" modal offered three hard-coded calendars —
-- "Promoter events / Performer shows / Venue bookings" — which are descriptions
-- of the acting profile's ROLE, not calendars at all.
--
-- The point of a room is that it is a SEPARATE NIGHT'S CAPACITY. A venue with a
-- main hall and a basement can sell two shows on the same Friday, so "are you
-- free on the 12th?" has no single answer for the venue — it has one answer per
-- room. Availability computed over "all my events" tells a promoter the venue is
-- busy when the basement is standing empty, which is the exact opposite of what
-- the feature is for.
--
-- This migration does not create the table (it is already there). It gives it the
-- two constraints that a room list read by humans needs, now that humans are
-- about to write one.

-- The read this feature performs everywhere: "the rooms of this venue". It draws
-- the room picker on an event, the rooms card on the venue profile, and every
-- entry in the availability dropdown. Without it, each of those is a sequential
-- scan of every stage of every venue on the platform.
CREATE INDEX IF NOT EXISTS "stages_venue_profile_id_idx" ON "stages" ("venue_profile_id");

-- Two rooms of one venue may not share a name.
--
-- Not tidiness. A room is CHOSEN BY NAME at every point it matters — the "Room"
-- dropdown on an event, the calendar picker in the share modal, the "Hall A" line
-- on the public availability link a promoter receives. Two rooms called "Hall A"
-- make every one of those choices ambiguous, and the ambiguity lands on the one
-- question the room exists to answer ("which night is which room booked?").
--
-- Scoped to the venue, not global: "Main Room" is the right name for a room in
-- a hundred different buildings.
--
-- NOT `IF NOT EXISTS` — Postgres has no such form for ADD CONSTRAINT, so this is
-- guarded the long way. Any existing duplicate names would fail this loudly,
-- which is correct: there is no honest automatic repair (renaming someone's room
-- for them is a guess), and today there cannot BE duplicates because nothing has
-- ever inserted a stage outside a test.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stages_venue_profile_id_name_key'
  ) THEN
    ALTER TABLE "stages"
      ADD CONSTRAINT "stages_venue_profile_id_name_key" UNIQUE ("venue_profile_id", "name");
  END IF;
END
$$;
