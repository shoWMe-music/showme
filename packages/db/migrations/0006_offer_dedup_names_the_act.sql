-- The act being offered is part of an offer's identity (audit A-24): an agent
-- pitching two different performers to the same venue on the same night is two
-- offers, not a duplicate. Only the new column is COALESCEd — Postgres treats
-- NULLs as distinct, so indexing it raw would switch the guard off for every
-- direct (non-agent) offer, while `NULLS NOT DISTINCT` would also collapse the
-- other three and start deduplicating dateless offers that have always been legal.
DROP INDEX "booking_requests_pending_dedup";--> statement-breakpoint
CREATE UNIQUE INDEX "booking_requests_pending_dedup" ON "booking_requests" USING btree ("sender_user_id","target_profile_id","wanted_date",coalesce("on_behalf_of_profile_id", '00000000-0000-0000-0000-000000000000'::uuid)) WHERE "booking_requests"."status" = 'pending';