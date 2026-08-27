-- A venue was asked for its capacity three times, in three different vocabularies.
--
-- On one profile screen: `venue_details.capacity` ("The room → Capacity"),
-- `venue_details.capacity_setups` ("Capacity setups — alternate configurations")
-- and a `stages` row per physical room ("Rooms & stages"), each with a capacity
-- box of its own. The rooms card had to carry a written disclaimer — "not the
-- same as the capacity setups above, which are one room counted two ways" — and
-- a UI that needs a disclaimer to be understood is the thing that is wrong.
--
-- The model that needs no sentence: a venue has ROOMS, and a room has a capacity
-- and optionally alternate SETUPS. "One room counted two ways" is then visible in
-- the nesting. So the setups move onto the room, and the flat number stops being
-- a thing anybody types.
--
-- What each of the two flat columns becomes:
--
--   * `venue_details.capacity_setups` — MOVED to `stages.capacity_setups` and
--     dropped here. It was never a building-level fact; it was always about one
--     room, and there was no room to attach it to until `stages` got a UI.
--
--   * `venue_details.capacity` — KEPT, and it is now DERIVED: the capacity of the
--     venue's largest room, rewritten whenever a room is added, edited or
--     removed. It has to stay a column on the profile because two readers need it
--     as one: the venue search (`venue_details_capacity_idx`, "a room for 400" is
--     a range scan) and the public page's chip. And one writer needs it as a
--     fallback: `routes/events.ts` stamps `events.capacity` at creation from the
--     chosen room, or from this number when the show names no room. Emptying it
--     would have created shows with no capacity at all — the ticket inventory cap
--     and the break-even line both read that stamp.
--
-- Largest, not first or newest, because both readers mean the same thing by it.
-- "Can this venue hold 400?" is answered by its biggest space, and a show placed
-- at the building without naming a room is presumed to be in the main one.

-- ── The setups move onto the room ───────────────────────────────────────────
--
-- jsonb for the same reason it was jsonb on `venue_details`: a setup is read with
-- its room, never filtered on and never pointed at. It is the room's own
-- alternate arrangements — "Theater seating" 220, "Standing only" 400 — where the
-- room's `capacity` column is the headline the rest of the app uses.
ALTER TABLE "stages" ADD COLUMN IF NOT EXISTS "capacity_setups" jsonb;

-- ── A venue with a flat capacity and no rooms gets its room ─────────────────
--
-- This is the case the new screen calls "flat": one room, and the card shows a
-- bare Capacity box with no hierarchy to meet. But it has to be a real `stages`
-- row underneath, because that is the only thing an event can point AT
-- (`events.stage_id`) and the only thing the calendar can answer availability
-- per. A venue that had typed 400 into the old flat field keeps 400 — it now
-- reads as the capacity of its one room, which is what the number always meant.
--
-- "Main Room" is the name, matching the placeholder the rooms card has always
-- offered ("e.g. Main Room") and reading correctly the day a second room is added
-- beside it. Guarded on the venue having no rooms at all, so nothing is invented
-- for a venue that has already named its spaces.
INSERT INTO "stages" ("venue_profile_id", "name", "capacity")
SELECT vd."profile_id", 'Main Room', vd."capacity"
FROM "venue_details" vd
WHERE vd."capacity" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "stages" s WHERE s."venue_profile_id" = vd."profile_id");

-- ── The setups land on the room they were always about ──────────────────────
--
-- The biggest room of the venue, which for every venue that had setups to move is
-- either the room just created above or the main hall — a setup describes the
-- space a promoter is being sold, and that is the one.
--
-- The shape changes on the way across, and the change is a deletion. The old row
-- was `{id, name, capacitySitting, capacityStanding, isMain, notes}`; the new one
-- is `{id, name, capacity}`.
--   * SITTING/STANDING collapse to one number. The NAME already says which
--     arrangement it is ("Theater seating", "Standing only") — carrying the
--     distinction a second time as two boxes was the same doubling this whole
--     migration is undoing. The larger of the two survives, which is the figure
--     the setup was offering.
--   * `isMain` goes. Its job was "which of these is the headline capacity", and
--     the room's own `capacity` column now answers that. A radio that competes
--     with a plain field for the same meaning is a third place to enter a
--     capacity, which is where we came in.
--   * `notes` goes. A named arrangement and a number is the whole of it.
--
-- Measured before writing this: `capacity_setups` is NULL on every row in the dev
-- database, and no route wrote it before 2026-08-26 — so this reshape is a
-- correctness statement about future reads, not a repair of real rows.
UPDATE "stages" s
SET "capacity_setups" = moved."setups"
FROM (
  SELECT
    vd."profile_id",
    (
      SELECT s2."id"
      FROM "stages" s2
      WHERE s2."venue_profile_id" = vd."profile_id"
      ORDER BY s2."capacity" DESC NULLS LAST, s2."name" ASC
      LIMIT 1
    ) AS "stage_id",
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', COALESCE(setup->>'id', 'VCS-' || ordinality::text),
          'name', setup->>'name',
          'capacity', GREATEST(
            NULLIF(setup->>'capacitySitting', '')::int,
            NULLIF(setup->>'capacityStanding', '')::int
          )
        )
        ORDER BY ordinality
      )
      FROM jsonb_array_elements(vd."capacity_setups") WITH ORDINALITY AS entry(setup, ordinality)
      WHERE COALESCE(TRIM(setup->>'name'), '') <> ''
    ) AS "setups"
  FROM "venue_details" vd
  WHERE jsonb_typeof(vd."capacity_setups") = 'array'
) moved
WHERE s."id" = moved."stage_id" AND moved."setups" IS NOT NULL;

ALTER TABLE "venue_details" DROP COLUMN IF EXISTS "capacity_setups";

-- ── The flat number becomes the biggest room ────────────────────────────────
--
-- From here on this column is written only by the code that writes rooms
-- (`routes/profiles.ts`, the three `/profiles/:id/stages` handlers), never by a
-- person and never by `PATCH /profiles/:id`. This statement is that same
-- recomputation, run once for the rows that already exist.
--
-- For every venue the flat field and the rooms agree today (the venues that had a
-- capacity got a room holding exactly it, one line up), so this changes nothing
-- in the dev database and is here for the case it would: a building total typed
-- before rooms existed that no single room can hold. That figure is not something
-- the app can honestly keep — nothing sells the whole building at once, and a
-- search hit on a capacity no room can seat is a lie to the promoter it answers.
UPDATE "venue_details" vd
SET "capacity" = rooms."largest"
FROM (
  SELECT "venue_profile_id", MAX("capacity") AS "largest"
  FROM "stages"
  GROUP BY "venue_profile_id"
) rooms
WHERE rooms."venue_profile_id" = vd."profile_id"
  AND vd."capacity" IS DISTINCT FROM rooms."largest";

-- A venue that named rooms but never opened the details form has no
-- `venue_details` row to hold the derived number, so it is invisible to search
-- and its public page shows no capacity chip. Give it the row — the rest of the
-- columns are nullable or defaulted, so it says only what the venue has said.
INSERT INTO "venue_details" ("profile_id", "capacity")
SELECT s."venue_profile_id", MAX(s."capacity")
FROM "stages" s
WHERE NOT EXISTS (
  SELECT 1 FROM "venue_details" vd WHERE vd."profile_id" = s."venue_profile_id"
)
GROUP BY s."venue_profile_id"
HAVING MAX(s."capacity") IS NOT NULL;
