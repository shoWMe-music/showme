-- A name on a bill has to survive the erasure of the account behind it.
--
-- Daniel, 2026-09-01, deciding the 90-day GDPR purge: "Every unclaimed stub over
-- 90 days. But it should keep the names in the events, not as accounts but just
-- as a name / contact, so it doesn't break the events."
--
-- WHAT A STUB IS. Two paths mint a profile nobody has claimed: an operator adding
-- an off-platform performer (`apps/api/src/lib/off-platform.ts`) and a venue
-- handoff (`apps/api/src/routes/inbound.ts`). Both hold a real person's NAME and
-- EMAIL on an account that person never asked for and may never have heard of.
-- `docs/gdpr.md` says that cannot sit there forever, and Ran's invitation spec
-- puts a number on it: gone 90 days after the invitation stopped going anywhere.
--
-- WHY THE COLUMN HAD TO BECOME NULLABLE. `event_participants.profile_id` was NOT
-- NULL with a plain (RESTRICT) foreign key, so the purge had exactly two options
-- and both were wrong. Deleting the profile would fail on this constraint and the
-- job would do nothing at all; cascading the delete would take the participant
-- row with it, and a settled show would lose a name off its bill — a name that
-- appears in its settlement, its history and its public listing. So the row now
-- OUTLIVES its profile, holding `display_name` and nothing else about the person.
--
-- A NULL HERE IS INERT, WHICH IS WHY THIS IS SAFE. Every access path joins
-- `event_participants` to `profile_members` on `profile_id`
-- (`packages/auth/src/authorize.ts`), and an equality join never matches NULL. A
-- name-only row therefore grants nobody anything, in every query, without one of
-- them being rewritten. The paths that DID have to change are the two that
-- display a roster, where an inner join to `profiles` would silently drop the
-- name this migration exists to keep: `routes/participants.ts` (already a left
-- join) and `routes/public.ts` (was an inner join).
--
-- WHAT IS NOT DONE HERE. No backfill: `display_name` is written only by the purge
-- (`packages/db/src/stub-purge.ts`), so every existing row keeps a live
-- `profile_id` and readers take the name from `profiles` exactly as before. A
-- copy maintained on every participant would be denormalization that drifts the
-- first time somebody renames their act, which is the class of bug this rebuild
-- was written to delete.
ALTER TABLE "event_participants" ADD COLUMN IF NOT EXISTS "display_name" text;

ALTER TABLE "event_participants" ALTER COLUMN "profile_id" DROP NOT NULL;

-- The purge's own working set: unclaimed profiles old enough to go. Partial on
-- `claimed_at IS NULL`, so the index holds only the stubs — a claimed profile is
-- an account with a person behind it and drops straight out of it. Without this
-- the nightly sweep is a full scan of `profiles` to find, on most nights, nothing.
CREATE INDEX IF NOT EXISTS "profiles_unclaimed_created_idx"
  ON "profiles" ("created_at")
  WHERE "claimed_at" IS NULL;
