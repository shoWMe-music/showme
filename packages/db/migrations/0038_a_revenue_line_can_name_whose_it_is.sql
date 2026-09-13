-- A REVENUE LINE CAN NAME WHOSE IT IS.
--
-- decisions.md #23.2. The budget planner has a card for this — Ran's design titles
-- it "Revenue shares & deductions" and describes it as *"Move a slice of any revenue
-- from the party that collects it to another party… These move money between parties
-- at settlement. They do not change the event's total revenue or costs."* Nothing in
-- the schema could express it.
--
-- THIS IS THE MIRROR OF `cost_split`, and deliberately shaped like it. A cost names
-- who bears it; a revenue line names who, other than its collector, is owed a slice
-- of it. "10% of the bar to the act." "A cut of merch back to the venue."
--
-- jsonb, NOT A TABLE, by the normalize-vs-embed rule: it is read with its line and
-- nothing joins, filters or aggregates across it. `cost_split` beside it made the
-- same call for the same reason.
--
--   [{ "toParticipantId": "…", "basisPoints": 1000 }]
--   [{ "toParticipantId": "…", "amount": "50000" }]     -- minor units, as a STRING
--
-- Money as a string because jsonb has no bigint and a JS number would silently round
-- a large figure — the same spelling `deal_parties.share.illustrativeAmount` uses.
--
-- NOT WHERE A DOOR SPLIT LIVES, even though it is the same shape. The act's 70% of
-- the ticket line is written on the DEAL, with the guarantee and the escalator
-- tiers, and `reconcile()` reads it from there. Two writable homes for one number is
-- precisely the drift this rebuild exists to delete, so the planner must never offer
-- the ticket split a second, editable home in the budget.
--
-- WHY THE ENGINE NEEDED THIS AT ALL. #23.1 says bar and merch "belong to whoever
-- collects them". Until now every revenue line reached the pool whatever
-- `collected_by` said, so a venue running its own bar was credited nothing while
-- holding the cash, and `net = entitlement − held` made it OWE the operator its own
-- takings. The books balanced perfectly while describing the wrong world. Revenue
-- attribution and these shares are the two halves of fixing that.
--
-- BOTH TABLES, because a settlement line is the forecast line corrected after the
-- show: a share agreed while planning has to survive into what actually settles, the
-- same way `cost_split` and `details` already do.
--
-- Additive and nullable. NULL means "no slice is promised to anyone", which is what
-- every existing row means today, so nothing recomputes and no backfill is owed.
ALTER TABLE "budget_lines"
  ADD COLUMN IF NOT EXISTS "revenue_shares" jsonb;

ALTER TABLE "settlement_lines"
  ADD COLUMN IF NOT EXISTS "revenue_shares" jsonb;
