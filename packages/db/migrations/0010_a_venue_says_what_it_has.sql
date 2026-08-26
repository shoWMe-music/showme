-- A venue profile could not say what it has. It had a name, a bio and a picture,
-- and nothing a promoter actually decides on: no capacity, no PA, no curfew, no
-- amenities. So "prefill the event's amenities from the venue" had nothing to
-- read, and the event's Amenities card was the only place the facts lived — which
-- means every event re-typed them from scratch.
--
-- WHY A TABLE AND NOT `profiles.details`: PLAN.md:346 already decided this —
-- "Venue-heavy queryable fields (capacity, amenities, sub-venues/rooms, setups)
-- → a `venue_details` extension table". The data-model rule is normalize what is
-- queried across, and this is the queried-across set: a promoter looking for a
-- room filters city (already normalized in `profile_locations`) AND capacity AND
-- amenities in one query. jsonb would make the two halves of that search
-- unindexable while buying nothing — these are not read-with-parent leaves.
--
-- WHAT IS NOT HERE: rooms/stages. `stages` (venue_profile_id, name, capacity)
-- already models them, and a second rooms list would be a competing truth.

CREATE TABLE venue_details (
  -- 1:1 with the profile, so the foreign key IS the primary key — there is no
  -- second venue_details row for a venue and no surrogate id to drift.
  profile_id uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,

  capacity integer,
  sound_system text,   -- house PA as written: "Funktion-One", "d&b audiotechnik"
  curfew text,         -- local wall-clock house rule ("02:00"), not a timestamp

  -- Ported from the previous app's `AmenityKey` enum, which is the only evidence
  -- of what real venues filled in. NOT a Postgres enum: that app's venues also
  -- typed their own ("Green Room", "Loading Dock", "Wheelchair Accessible" are
  -- all real values from its seed), and an enum would have rejected every one of
  -- them. The offered set lives in `@showme/shared` VENUE_AMENITIES; the column
  -- accepts anything.
  amenities text[] NOT NULL DEFAULT '{}',

  -- Deal shapes this venue will sign, advertised so a promoter knows before
  -- asking. A preference on a profile, never the terms of a deal.
  deal_types text[] NOT NULL DEFAULT '{}',

  catering_notes text,
  accommodation_notes text,

  -- decisions.md #16.7 draws this line, not us: "Artist logistics on the venue
  -- profile + event; audience logistics on the public page." The two are
  -- separate COLUMNS rather than one notes field precisely so the public
  -- serializer can publish one and cannot accidentally publish the other. Load-in
  -- times, the back entrance and the door code are not audience information.
  artist_logistics_notes text,
  audience_logistics_notes text,

  -- Private by construction: an unauthenticated page must never hand a scraper a
  -- booker's mailbox. The public profile route selects neither of these.
  contact_email text,
  contact_phone text,

  -- Named seating/standing configurations ("Theater seating", "GA floor"). Read
  -- only with the parent row and never filtered on — the one leaf here that
  -- earns jsonb under the normalize-vs-jsonb rule.
  capacity_setups jsonb,

  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint

-- "A room for 400" is a range scan.
CREATE INDEX venue_details_capacity_idx ON venue_details (capacity);

--> statement-breakpoint

-- The other half of the same search. A containment query
-- (`amenities @> ARRAY['pa_system']`) cannot use a btree at all, so without GIN
-- the amenity filter is a sequential scan over every venue on the platform.
CREATE INDEX venue_details_amenities_idx ON venue_details USING gin (amenities);

--> statement-breakpoint

-- The other half of "a venue profile cannot say where it is".
--
-- Two places claimed to hold a profile's location and they disagreed. The
-- normalized `profile_locations` table is the real one — event timezones
-- (`lib/event-timezone.ts`), agent territory (`lib/agent-assignment.ts`), deal
-- authority (`lib/deal-authority.ts`) and profile search all read it. But the
-- profile editor wrote a free-text string to `profiles.details -> 'location'`
-- instead, and the Profiles screen read that string back — so a venue with a
-- perfectly good Stockholm row rendered "No location set", and a venue that
-- typed a location into the editor was invisible to every query above.
--
-- `profile_locations` wins, and the stray strings move into it rather than being
-- thrown away. The whole string goes into `city` with a NULL country on purpose:
-- it was never structured ("Kreuzberg, Berlin", "Berlin / London"), and guessing
-- a country code out of prose would put wrong data into the column that decides
-- an event's timezone and an agent's territory. A slightly odd city the owner can
-- correct is honest; an invented `country` is not.
INSERT INTO profile_locations (profile_id, city, country, is_primary)
SELECT p.id, trim(p.details ->> 'location'), NULL, true
FROM profiles p
WHERE p.details ->> 'location' IS NOT NULL
  AND trim(p.details ->> 'location') <> ''
  AND NOT EXISTS (SELECT 1 FROM profile_locations existing WHERE existing.profile_id = p.id);

--> statement-breakpoint

-- With the value carried across, the duplicate key goes — leaving a second
-- "location" behind is how the two drifted apart in the first place.
UPDATE profiles
SET details = details - 'location'
WHERE details ? 'location';
