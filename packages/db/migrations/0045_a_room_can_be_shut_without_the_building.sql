-- A ROOM CAN BE SHUT WITHOUT THE BUILDING.
--
-- ClickUp `86cbceux0`, the third box: *"The system does not mark dates
-- 'unavailable' for the specific Venue profile / Room automatically when events
-- are created (see V2 - the system had the ability to mark multi unavailabilities
-- per date, per venue and per room/space."*
--
-- `profile_unavailability` had no room column, so a venue could only ever close
-- the whole building. A refit in the Back Room took the Main Room off sale with
-- it, and a date held back for a private hire in one space blanked the other.
--
-- NULL IS THE WHOLE PROFILE — which is exactly what every row written before this
-- column meant. So there is no backfill: the existing 
-- rows keep their meaning unchanged, and the old reading is the new reading with
-- one value.
--
-- THE RULE THIS BUYS, and why it needs no second rule: a room block now behaves
-- exactly like a room BOOKING. `occupiedDates` already says the whole venue is
-- busy only when every room is busy, and a venue with no rooms on record is its
-- own single space. Feeding blocks through the same function means "the Back Room
-- is shut" and "the Back Room is sold" answer the availability question the same
-- way — which is what a caller asking "can you host me on the 14th" actually
-- means.
--
-- ON DELETE CASCADE: deleting a room removes the blocks that named it. A block
-- pointing at a room that no longer exists is unreadable — it is not the venue's
-- (it never claimed the venue was shut) and there is no room left to be its
-- calendar.
ALTER TABLE "profile_unavailability"
  ADD COLUMN IF NOT EXISTS "stage_id" uuid REFERENCES "stages"("id") ON DELETE cascade;

-- Reads are always "this profile, in this window", then filtered by room in
-- memory — the row count per profile is small (hand-made blocks, not a feed).
-- The index that matters is the one that already exists on `profile_id`; this one
-- serves the cascade and the per-room reads without pretending to be more.
CREATE INDEX IF NOT EXISTS "profile_unavailability_stage_id_idx"
  ON "profile_unavailability" ("stage_id");
