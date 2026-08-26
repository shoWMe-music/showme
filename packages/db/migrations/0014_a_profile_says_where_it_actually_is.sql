-- A profile could say WHICH CITY it was in, and nothing more precise. `city` and
-- `country` were the whole of `profile_locations`, so a venue — a physical room
-- that a promoter has to load a truck into and an audience has to walk to — could
-- not record its street address at all. The previous app captured it (its profile
-- editor has Street and Postcode inputs beside City and Country,
-- `../showme-settle-fast/src/pages/ProfileEditPage.tsx:446`) and printed the
-- assembled address on the public venue page (`formatLocation` =
-- "street, postcode city, country", `src/lib/user-context.tsx:102`). This rebuild
-- dropped both halves, so every venue profile ported across loses its address.
--
-- WHY HERE AND NOT IN `profiles.details`: this is the same mistake 0010 had to
-- undo. `profile_locations` is the one table event timezones
-- (`lib/event-timezone.ts`), agent territory (`lib/agent-assignment.ts`), deal
-- authority (`lib/deal-authority.ts`) and profile search already join. A second
-- place holding "where this profile is" is a second answer that will disagree
-- with the first — 0010 exists precisely because a free-text `details.location`
-- had drifted from this table. An address belongs on the row that already holds
-- the city it is inside.
--
-- WHY NOT A SEPARATE `addresses` TABLE: the relation is 1:1 with a location that
-- already exists, the two columns are read with their parent row every time, and
-- nothing queries across them (searches filter on `city`/`country`, never on a
-- street). Under the normalize-vs-jsonb rule these are read-with-parent leaves on
-- an already-normalized row — columns, not a table and not a blob.
--
-- BOTH ARE NULLABLE, and stay nullable. A performer's location is a home city,
-- not a doorstep: the previous app deliberately offered street and postcode to
-- venues and organizers only and asked a performer for a city
-- (`ProfileEditPage.tsx:420-448`). That product rule is enforced above this
-- column — a band that never fills it in is normal, not incomplete.
--
-- PRIVACY. Adding a column is not publishing it. `serialize/profile.ts` decides
-- who sees these: a PLACE (venue/festival) publishes its street address, because
-- an address a stranger cannot find is a venue nobody can attend; every other
-- profile kind publishes city and country only, so a solo artist who typed their
-- home address to get the map pin right does not thereby put it on the open
-- internet. Same split the old app shipped, now enforced server-side in the
-- serializer instead of by which component happened to render it.

ALTER TABLE profile_locations ADD COLUMN street text;

--> statement-breakpoint

ALTER TABLE profile_locations ADD COLUMN postcode text;

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- And a profile could not say what ORDER its links go in.
--
-- `profile_social_links` has existed since 0000 and nothing has ever written to
-- it — the profile editor offers no links field at all, which is half of "the
-- profile is missing a lot of inputs from the old version". The old app's editor
-- let an owner add, reorder and delete them as one list
-- (`../showme-settle-fast/src/pages/ProfileEditPage.tsx:898`) and its public page
-- rendered them in that order (`PublicProfilePage.tsx:229`).
--
-- The order is the owner's editorial choice — Spotify first, then Instagram —
-- so it has to be stored. Without a column the only "order" available is the
-- primary key, which is a random uuid: the row of links would reshuffle itself on
-- every page load. `profile_media` already solved exactly this with an integer
-- `position`; this is the same concept, so it is the same column, not a new
-- mechanism.
--
-- Nullable to match `profile_media.position`, and for the same reason: rows that
-- predate anyone caring about order have no honest value to backfill, and
-- `ORDER BY position` puts them together at one end rather than inventing a
-- sequence for them.
ALTER TABLE profile_social_links ADD COLUMN position integer;
