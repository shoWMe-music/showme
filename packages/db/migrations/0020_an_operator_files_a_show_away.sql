-- An operator could tidy their events list only by deleting a show.
--
-- The old app had an "archive" action in the event workspace, and the product
-- owner asked for it back on the events list and the calendar. What it must NOT
-- become is another `event_status` value. A status says where the BOOKING got to
-- — `confirmed`, `concluded`, `cancelled` — and archiving says something else
-- entirely: whether the person filing still wants to look at it. Both a
-- concluded show and a cancelled one are worth filing away, and filing must not
-- overwrite the word that says which is which. Adding `archived` to the
-- `event_status` enum would do exactly that, irreversibly, one row at a time.
--
-- So it is a timestamp, and it lives on `event_participants` rather than on
-- `events`. That placement is the whole decision:
--
--   * The old app stored `archived` on the event document, so archiving hid the
--     show from EVERYONE on it. Here the operator's filing cabinet is theirs.
--     `docs/story.md` gives the performer's world as "my bookings, my
--     availability, my riders, my money" — an operator deciding they are done
--     looking at a show is not a fact about the performer's calendar, and it must
--     not take the booking off their list.
--   * The access join already runs through this table (`events ⋈
--     event_participants ⋈ profile_members` — the WHERE that IS the rule in
--     `GET /events`), so "hide what I filed away" is one more predicate on a join
--     that was already happening, not a second visibility system.
--
-- It changes NOTHING about what an event costs. The free-tier event cap counts
-- `events.status IN ('confirmed','concluded')` for the host profile
-- (`CAP_COUNTING_EVENT_STATUSES`); this column is in a different table and that
-- counter never reads it. An operator therefore cannot archive a confirmed show
-- to dodge the cap — not because a rule forbids it, but because there is nothing
-- here for the counter to see.
--
-- NULL means "not archived", which is what every row written before today means
-- and what it should go on meaning. Reversible by construction: unarchiving is
-- setting it back to NULL.
--
-- No new index. Both directions of this predicate are correlated subqueries on
-- `event_participants.event_id`, which `event_participants_event_id_idx` already
-- covers; a partial index on `archived_at` would earn nothing until archives
-- outnumber live rows.
ALTER TABLE "event_participants" ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "event_participants" ADD COLUMN IF NOT EXISTS "archived_by" text;--> statement-breakpoint
-- The actor is a user, not a profile: "who filed this away" is a person's act.
-- No ON DELETE — the same reasoning the rest of this table carries. A user row is
-- never hard-deleted out from under history; if one ever were, this should fail
-- loudly rather than quietly forget who did it.
ALTER TABLE "event_participants"
  ADD CONSTRAINT "event_participants_archived_by_users_id_fk"
  FOREIGN KEY ("archived_by") REFERENCES "public"."users"("id")
  ON DELETE no action ON UPDATE no action;
