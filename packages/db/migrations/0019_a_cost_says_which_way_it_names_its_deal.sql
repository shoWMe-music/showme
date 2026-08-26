-- A cost line could name a deal, but not say WHY — and the two reasons are
-- opposite instructions to the settlement.
--
-- `budget_lines.deal_id` has carried two incompatible meanings since it was
-- added, one from each of the two documents that describe it:
--
--   * The 2026-08 settlements meeting means ACCOUNTABILITY — "all project costs
--     assigned to specific deals, creating accountability for each agreement".
--     500 of catering booked against the headliner's deal so the true cost of
--     that night can be read off. Somebody was really invoiced 500.
--
--   * The budget-planner design handoff (§6) means IDENTITY — "performer fee →
--     a deal ENTITLEMENT, not a budget line — assign the line to the deal via
--     `deal_id` so it is never double-counted". The 3 000 typed into "Performer
--     fee" IS the guarantee the deal already promises. Nobody paid it twice.
--
-- The engine can only obey one of them. It obeys the second: `reconcileEvent`
-- drops every cost line carrying a `deal_id`, because leaving the fee in would
-- lower the pool AND entitle the payee, and the operator's residual would come
-- out short by the whole fee. Correct for the handoff's case, and wrong for the
-- meeting's: the 500 of catering, tagged for reporting, silently LEFT the
-- settlement — the pool stayed 500 too high and the operator's residual with it.
--
-- Both readings are real and the same operator wants both, so the distinction
-- goes in the data instead of in a convention. `deal_id` keeps the meaning the
-- engine already gives it — this line is the deal's own figure — and this
-- migration adds the other one beside it.

-- The deal a cost is REPORTED UNDER. Nothing about the money changes: the line
-- lowers the pool and honours `paid_by` / `payee_participant_id` / `cost_split`
-- exactly as an untagged cost does. Deliberately NOT read by the settlement
-- engine — that is what makes it accountability rather than arithmetic, and it
-- is why the two senses could not share one column: `reconcileEvent` decides by
-- the presence of `deal_id` alone.
ALTER TABLE "budget_lines" ADD COLUMN IF NOT EXISTS "attributed_deal_id" uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'budget_lines_attributed_deal_id_deals_id_fk'
  ) THEN
    ALTER TABLE "budget_lines"
      ADD CONSTRAINT "budget_lines_attributed_deal_id_deals_id_fk"
      FOREIGN KEY ("attributed_deal_id") REFERENCES "deals"("id");
  END IF;
END
$$;

-- A line is one or the other, never both. Both at once would be a line claiming
-- to be a deal's own figure AND an extra cost of that deal, which is the exact
-- ambiguity this migration exists to remove — and whichever way the engine
-- resolved it, half the operators reading the row would be wrong.
--
-- `<= 1`, not `= 1`: most costs name no deal at all, and that stays the default.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'budget_lines_one_deal_sense'
  ) THEN
    ALTER TABLE "budget_lines"
      ADD CONSTRAINT "budget_lines_one_deal_sense"
      CHECK (num_nonnulls("deal_id", "attributed_deal_id") <= 1);
  END IF;
END
$$;

-- NOTHING IS BACKFILLED, and that is the honest choice rather than a shortcut.
-- Every existing `deal_id` was written by a planner whose only control said "the
-- figure from <deal>" and whose row-note said the settlement takes that figure
-- from the agreement. So each stored row already means the sense `deal_id` keeps,
-- and the settlement's treatment of it does not change by one unit. Moving any of
-- them to the new column would silently ADD their amounts to the pool — a guess
-- about somebody's books, made on their behalf, in exactly the place where a
-- guess turns into a wrong transfer.
