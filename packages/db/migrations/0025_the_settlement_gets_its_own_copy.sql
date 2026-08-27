-- The settlement had a snapshot of the budget. It did not have a COPY.
--
-- 0024 gave planned-vs-actual something to compare against: `budget_snapshots`
-- captures the forecast at version 1 so the 50 000 survives the day it becomes
-- 42 000. That fixed remembering. It did not fix WHERE THE 42 000 IS TYPED.
--
-- `reconcileEvent` still read `budget_lines` live, so the only place to enter
-- what a night actually cost was the planner — which means entering an actual
-- was an edit to the forecast, and the two documents were still one set of rows
-- wearing two hats. An operator asking "where do I put the real numbers?" had
-- the honest answer "in your budget, on top of your estimate".
--
-- The product owner's rule (2026-08-27) settles it in one line:
--
--     "The settlement has a copy of the budget.
--      The budget is never changed from the settlement."
--
-- So the settlement gets rows of its own. The planner keeps `budget_lines` and
-- goes on being a planning document; `reconcile()` reads these instead.
--
-- ── Sealed at the copy ─────────────────────────────────────────────────────
-- The copy is taken once, when the settlement is first run, and never consults
-- the budget again — the owner's choice among the drift behaviours. A budget
-- edited after the show is a forecast being revised after the fact, and it has
-- no standing over a night that already happened.
--
-- `origin_budget_line_id` is what planned-vs-actual pairs on. It is NULL for a
-- line first entered in the settlement, and that null is meaningful: asked what
-- this was budgeted at, the honest answer is "nothing — nobody foresaw it".
-- ON DELETE SET NULL rather than CASCADE, because deleting a forecast line must
-- never delete the record of money that actually moved.
--
-- Keyed on the EVENT, like `budget_snapshots` and for the same reason: there is
-- one night's cash, and `settlements` holds one row per party to it.
--
-- ── Only the SHARED budget is copied ───────────────────────────────────────
-- With a co-host, the shared budget is the one that becomes the settlement (the
-- product owner, 2026-08-27). A co-promoter's `private` budget is their own
-- margin — their internal accounting, not part of the night's reconciliation —
-- and it is never copied. So every row in this table is shared by construction,
-- which is why it carries no scope of its own: there is no private line here to
-- withhold from anybody, and the other party sees only what belongs to their
-- part of the deal.

CREATE TABLE IF NOT EXISTS "settlement_lines" (
  "id"                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "event_id"               uuid NOT NULL REFERENCES "events" ("id") ON DELETE CASCADE,
  "origin_budget_line_id"  uuid REFERENCES "budget_lines" ("id") ON DELETE SET NULL,
  "kind"                   "budget_line_kind" NOT NULL,
  "source"                 "ticketing_source" NOT NULL DEFAULT 'manual',
  "provider_ref"           text,
  "label"                  text NOT NULL,
  "amount"                 bigint NOT NULL,
  "currency"               text,
  "collected_by"           uuid REFERENCES "event_participants" ("id"),
  "paid_by"                uuid REFERENCES "event_participants" ("id"),
  "payee_participant_id"   uuid REFERENCES "event_participants" ("id"),
  "cost_split"             jsonb,
  "details"                jsonb,
  "deal_id"                uuid REFERENCES "deals" ("id"),
  "attributed_deal_id"     uuid REFERENCES "deals" ("id"),
  "version"                integer NOT NULL DEFAULT 1,
  "created_at"             timestamptz NOT NULL DEFAULT now(),
  "updated_at"             timestamptz NOT NULL DEFAULT now(),
  -- The same rule the forecast carries: a line is either a deal's own figure or
  -- a cost reported under it. It can never be both, because the two say opposite
  -- things about whether the settlement should count the money.
  CONSTRAINT "settlement_lines_one_deal_sense"
    CHECK (num_nonnulls("deal_id", "attributed_deal_id") <= 1)
);

CREATE INDEX IF NOT EXISTS "settlement_lines_event_id_idx"
  ON "settlement_lines" ("event_id");
CREATE INDEX IF NOT EXISTS "settlement_lines_origin_idx"
  ON "settlement_lines" ("origin_budget_line_id");
