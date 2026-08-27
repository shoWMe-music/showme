-- A budget is edited in place from forecast to fact, so the forecast is gone by
-- the time anyone could compare it to anything.
--
-- decisions.md #16.8: "Today a budget disappears once it becomes a settlement.
-- Snapshot the budget when the settlement is created/finalized so
-- planned-vs-actual survives." The owner's framing is the clearest statement of
-- what the two sides are: "It copies the budget. Since budgets will be used to
-- determine predicted income, SETTLEMENTS ARE THE REAL NUMBERS."
--
-- The mechanism that destroys the prediction is not a delete — `budgets` and
-- `budget_lines` survive the settlement perfectly well. It is that ONE SET OF
-- ROWS PLAYS BOTH PARTS. The planner types a ticket tier as 200 x 250 into
-- `budget_lines.details` while the show is still a plan; the 2026-08 settlements
-- meeting (01:12:54) then requires every collaborator to enter their REAL revenue
-- and cost into those same rows before the settlement is generated, so the row
-- that said 50 000 now says 42 000 and nothing anywhere remembers the 50 000.
-- Every planned-vs-actual question dies at that UPDATE.
--
-- So the fix is not a new field on the budget. It is a COPY, taken at a moment
-- somebody can name, that the planner can no longer reach.

-- ── Alongside `settlement_snapshots`, not inside it ─────────────────────────
--
-- #16.8 says "alongside" and the three reasons are structural, not stylistic:
--
--  1. `settlement_snapshots` is written ONLY at finalize, and its `version` IS
--     the finalization sequence — `routes/settlement.ts` numbers each freeze from
--     `max(version)` on the event. Capturing a budget at COMPUTE would mean
--     writing rows there for events that are computed and never finalized, which
--     breaks both the table's meaning ("an immutable legal record, written only
--     when a settlement is finalized") and its numbering.
--
--  2. The cardinalities are different. A budget is captured whenever it MOVES
--     during the settlement conversation — that movement is the whole subject —
--     while a settlement is frozen once per finalize.
--
--  3. The access rule is different, and this is the reason that would matter even
--     if the first two did not. A `settlement_snapshots` row is served per party
--     through `serializeSettlement`, which strips the pool from anyone without
--     pool visibility. A budget snapshot has no per-party reading: it is the
--     whole night's money — every takings line, every cost, who collected which.
--     story.md:44 makes a performer's view of the pool an inviolable ceiling, and
--     a separate table is what lets "who may read this" have ONE answer for every
--     row (`budget.view`, which `POOL_CAPABILITIES` refuses to any arm's-length
--     role) instead of a per-column rule the next writer has to remember.
CREATE TABLE IF NOT EXISTS "budget_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "event_id" uuid NOT NULL,
  -- 1, 2, 3 … per event, and **version 1 is the plan of record**. It is written
  -- by the first compute — the moment the operator declares the event finished
  -- enough to reconcile — and never rewritten. Everything earlier than that first
  -- compute was overwritten in place before this table existed to catch it, and
  -- no migration can invent it back; v1 is the earliest state the platform can
  -- honestly claim to have witnessed, which is exactly why it must be immutable.
  "version" integer NOT NULL,
  -- `compute` or `finalize`. Text and not an enum: the vocabulary here is a log
  -- of which act took the copy, and a new capture point (a scheduled pre-show
  -- baseline, say) should not need a migration to `ALTER TYPE`. The API is the
  -- only writer and writes one of two literals.
  "reason" text NOT NULL,
  -- Set ONLY on a `finalize` capture, and this is the join that makes the frozen
  -- figures checkable: it names the exact `settlement_snapshots` row those
  -- numbers were produced from. NULL on every `compute` capture, because at that
  -- point no legal record exists yet to point at.
  --
  -- ON DELETE CASCADE, matching the settlement snapshot's own cascade from the
  -- event: a budget capture that names a freeze that no longer exists would be a
  -- provenance claim about nothing.
  "settlement_snapshot_id" uuid,
  -- The currency the three totals below are stated in. STAMPED, not resolved from
  -- `events.base_currency` on read — same discipline as the locked FX rate on a
  -- finalized settlement (money.md) and the stamped `country` on a PRO filing
  -- (0023). An event whose base currency is corrected later must not silently
  -- relabel a total that was summed in the old one.
  "base_currency" text NOT NULL,
  -- Σ revenue and Σ cost of the captured lines, converted to base at capture time
  -- with the rates stored in `data.rates`, in minor units (money.md).
  --
  -- DENORMALIZED ON PURPOSE, and this is a deliberate departure from 0023's rule
  -- that a summary of an array belongs derived on read rather than stored beside
  -- it. What made that rule right there is what makes it wrong here: drift comes
  -- from an UPDATE that touches a summary and not the thing it summarises, and
  -- THIS TABLE HAS NO UPDATE PATH AT ALL — rows are inserted once, by one
  -- function, in the same statement that computes them, and are never written
  -- again. The payoff is #16.9, the cross-event analytics surface this feeds:
  -- "revenue per event, avg, net profit, projected-vs-realized" across months is
  -- a SUM() over these columns, not a deserialize-and-fold of one jsonb blob per
  -- event in the operator's history.
  "planned_revenue" bigint NOT NULL,
  "planned_costs" bigint NOT NULL,
  -- revenue − costs. Stored rather than expressed, so #16.9 can ORDER BY it.
  "planned_pool" bigint NOT NULL,
  -- The frozen copy: every budget on the event with every line, in the exact
  -- shape `GET /events/:id/budgets` serves (`serialize/budget.ts`), plus the FX
  -- rate map the three totals above were produced with. One spelling of a budget
  -- line everywhere — a second hand-written copy of that shape is what audit A-13
  -- was.
  --
  -- PRIVATE BUDGETS ARE INCLUDED. `reconcileEvent` joins `budget_lines` to
  -- `budgets` on `event_id` with NO scope filter, so a co-promoter's private line
  -- moves the pool exactly as a shared one does. A snapshot that skipped them
  -- would report a planned pool that could never tie out against the settlement
  -- it sits next to. Confidentiality is enforced where it already is — at the
  -- serving boundary, by the same `visibleBudgetFilter` predicate the budget
  -- routes use — not by writing an incomplete record.
  "data" jsonb NOT NULL,
  "captured_at" timestamptz DEFAULT now() NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'budget_snapshots_event_id_events_id_fk'
  ) THEN
    ALTER TABLE "budget_snapshots"
      ADD CONSTRAINT "budget_snapshots_event_id_events_id_fk"
      FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE;
  END IF;
  -- NAMED EXPLICITLY, and shorter than drizzle's `<table>_<column>_<ref table>_<ref
  -- column>_fk` convention would produce. That pattern spells 66 characters here and
  -- Postgres silently truncates every identifier at 63 — so the constraint would be
  -- STORED under a name this guard's `conname =` could never match, and re-running
  -- the migration would try to create it a second time and fail on the duplicate.
  -- (`\d budget_snapshots` in psql is where you would eventually notice; the NOTICE
  -- Postgres emits about it scrolls past during a migration run.)
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'budget_snapshots_settlement_snapshot_id_fk'
  ) THEN
    ALTER TABLE "budget_snapshots"
      ADD CONSTRAINT "budget_snapshots_settlement_snapshot_id_fk"
      FOREIGN KEY ("settlement_snapshot_id") REFERENCES "settlement_snapshots"("id") ON DELETE CASCADE;
  END IF;
END
$$;

-- The version sequence is per event and gapless-by-intent, so two concurrent
-- computes must not both read `max(version) = 3` and both insert a 4. This index
-- is what turns that race into a failed transaction the caller retries, rather
-- than two rows that disagree about which one is version 4 — the same reasoning
-- 0013 gives for the partial unique indexes that let budget provisioning race
-- safely.
CREATE UNIQUE INDEX IF NOT EXISTS "budget_snapshots_one_version_per_event"
  ON "budget_snapshots" ("event_id", "version");

-- Every read is "the captures for this event, oldest first" (v1 is the plan) or
-- "the newest capture for this event" (the actual). Both are this index.
CREATE INDEX IF NOT EXISTS "budget_snapshots_event_id_idx" ON "budget_snapshots" ("event_id");

-- ── NOTHING IS BACKFILLED, and it is important that nothing is ──────────────
--
-- Every event already in the database has a budget whose lines were last saved at
-- some unknown point on the road from forecast to fact. Writing a version 1 for
-- those events would stamp "this was the plan" onto figures that are, for any
-- event already settled, the actuals — and the analytics page would then report a
-- variance of exactly zero on the whole of history and call it accuracy.
--
-- So existing events simply have no plan of record, the API answers `plan: null`,
-- and the screen says so. An empty state that admits the platform was not
-- watching is worth more than a fabricated baseline that flatters every operator
-- who has ever used the product.
