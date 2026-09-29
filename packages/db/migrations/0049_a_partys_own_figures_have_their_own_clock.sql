-- A PARTY'S OWN FIGURES HAVE THEIR OWN CLOCK.
--
-- QA sweep run 16: the Approval Status roster told an operator *"Priya Sound · Crew · Signed off ·
-- Figures changed since"* after an unrelated production cost was edited. Her entitlement and her net
-- had not moved by a minor unit.
--
-- The badge exists (run 14, `c8f1446`) so an operator can see WHOSE consent is stale before
-- finalizing, and it is derived from `updated_at > approved_at`. `updated_at` answers a different
-- question — *"was this row rewritten"* — and the POOL LADDER is stored inside every party's
-- `computed`, so a cost edit anywhere legitimately rewrites every row and moves every `updated_at`.
-- One column was answering two questions, and the one that matters is consent.
--
-- `figures_changed_at` is written only when `samePartyFigures` (the stored-breakdown comparison with
-- the ladder taken out) says this party's own money moved. `updated_at` keeps its meaning.
--
-- BACKFILLED FROM `updated_at`, which reproduces today's behaviour exactly for every existing row.
-- That is deliberate and it is the conservative direction: the badge currently OVER-warns, and
-- silently un-warning a stale signature somebody may already have acted on would be the one
-- irreversible mistake available here. New writes are precise from now on.
--
-- NULLABLE, with no default: a row that has never been computed has no figures to have changed, and
-- `now()` there would claim a movement that never happened. The reader falls back to `updated_at`,
-- so a null is read exactly as it was before this column existed.
ALTER TABLE "settlements"
  ADD COLUMN IF NOT EXISTS "figures_changed_at" timestamp with time zone;

UPDATE "settlements" SET "figures_changed_at" = "updated_at" WHERE "figures_changed_at" IS NULL;
