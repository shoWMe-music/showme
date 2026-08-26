-- The seam an external calendar needs: which system a row came from, and that
-- system's id for it.
--
-- `calendar_items` had no external identity at all, so importing the same Google
-- calendar twice would insert every event twice — a title and a date are not an
-- identity, and nothing else on the row is stable across a sync.
--
-- The uniqueness is the point, not the columns. Note `NULLS NOT DISTINCT`: by
-- default Postgres treats NULLs as distinct, which silently disables exactly this
-- kind of guard. That is not hypothetical — `booking_requests_pending_dedup` keys
-- on a nullable `sender_user_id`, and public submissions therefore do not dedupe
-- at all today. A calendar row's owner is likewise one of two nullable columns
-- (`owner_user_id` for a person's own calendar, `owner_profile_id` for an
-- account's), so without this the index would let duplicates straight through.
-- Postgres 15+ only, and we are on 18.

ALTER TABLE calendar_items
  ADD COLUMN external_source text,
  ADD COLUMN external_id text;

--> statement-breakpoint

-- An id without a source is ambiguous — two providers can issue the same string —
-- so the pair travels together or not at all.
ALTER TABLE calendar_items
  ADD CONSTRAINT calendar_items_external_pair_check
  CHECK ((external_source IS NULL) = (external_id IS NULL));

--> statement-breakpoint

-- Partial: rows authored inside shoWMe carry no external identity and must not
-- collide with each other.
CREATE UNIQUE INDEX calendar_items_external_identity_idx
  ON calendar_items (external_source, external_id, owner_user_id, owner_profile_id)
  NULLS NOT DISTINCT
  WHERE external_id IS NOT NULL;
