-- A HOLD MOVES UP WHEN THE ONE ABOVE IT GOES, UNLESS SOMEBODY FROZE IT.
--
-- QA sweep run 14: a hold placed through the app was born `hold_auto_promote = false`, so the queue
-- it joined never advanced. The wizard never sends the field and the column default was `false` —
-- from the initial scaffold, with no comment and no ruling behind it.
--
-- Three other statements of the same rule say the opposite. `packages/shared/src/holds.ts`
-- documents *"`holdAutoPromote` defaults to `true` when undefined"* and `computeDeclinePromotion`
-- reads `sibling.holdAutoPromote !== false`; the release dialog tells the operator *"Every hold
-- below it moves up one, unless it is frozen"*, which reads as promotion being the norm; and the
-- hold panel badges the off state **"Frozen"**, which is a word for the unusual state. Because this
-- column is NOT NULL, the helper's `undefined → true` branch could never fire against a real row.
--
-- THE ROWS ALREADY WRITTEN, and why this backfill is narrow. `false` today means one of two things:
-- born that way, or frozen on purpose. Unfreezing somebody's deliberate freeze changes who gets a
-- date, which is not a migration's decision to take blind. But the distinction is recoverable: the
-- ONLY way to choose `false` is `POST /events/:id/hold/auto-promote`, which writes an `audit_log`
-- row with `action = 'hold.auto_promote'`. So this moves exactly the holds no such row was ever
-- written for, and every deliberate freeze stands.
--
-- Scoped to `status = 'on_hold'` as well: the flag means nothing on a row that is not a pencil, and
-- a cancelled or confirmed event has no queue to advance in. A hold that is placed again later gets
-- the new default like any other new row.
ALTER TABLE "events" ALTER COLUMN "hold_auto_promote" SET DEFAULT true;

UPDATE "events"
SET "hold_auto_promote" = true, "updated_at" = now()
WHERE "status" = 'on_hold'
  AND "hold_auto_promote" = false
  AND NOT EXISTS (
    SELECT 1 FROM "audit_log"
    WHERE "audit_log"."target_kind" = 'event'
      AND "audit_log"."target_id" = "events"."id"
      AND "audit_log"."action" = 'hold.auto_promote'
  );
