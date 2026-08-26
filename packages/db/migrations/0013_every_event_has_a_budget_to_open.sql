-- A budget the planner can actually open, and a place to keep its arithmetic.
--
-- Until now `POST /events` created no budget and no route in the web app ever
-- called `POST /events/:id/budgets`, so the Budget Planner on every new event
-- was an empty state with no way past it. Budgets are now provisioned on demand
-- (see `lib/budget-provisioning.ts`): one PRIVATE budget per operating profile —
-- that operator's own margin line — plus one SHARED ledger once a second
-- operator co-hosts.
--
-- These two partial unique indexes are what make that provisioning safe to run
-- from a concurrent read: the "create if absent" is an INSERT .. ON CONFLICT DO
-- NOTHING, and without a matching unique constraint there is nothing for it to
-- conflict ON, so two simultaneous requests would each insert a duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS "budgets_one_private_per_owner"
  ON "budgets" ("event_id", "owner_profile_id")
  WHERE "scope" = 'private';

CREATE UNIQUE INDEX IF NOT EXISTS "budgets_one_shared_per_event"
  ON "budgets" ("event_id")
  WHERE "scope" = 'shared';
--> statement-breakpoint

-- The planner reasons in unit × quantity (a ticket tier at a price, a bar spend
-- per head), but `amount` is the single figure settlement reads and must stay
-- authoritative. `details` keeps the breakdown that produced it so reopening the
-- planner shows the tiers the operator typed rather than a collapsed total.
-- Nullable throughout: a hand-entered line has no breakdown and needs none.
ALTER TABLE "budget_lines" ADD COLUMN IF NOT EXISTS "details" jsonb;
