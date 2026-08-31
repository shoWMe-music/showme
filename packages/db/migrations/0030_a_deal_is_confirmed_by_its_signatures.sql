-- `deals.status` HAS A WRITER NOW, so the rows written before it need to catch up.
--
-- The column shipped in 0000 with an enum (`draft | confirmed | cancelled`), two
-- readers, and nothing anywhere that moved it. It defaulted to `draft` and stayed
-- there for every deal any operator ever created: `routes/events.ts` said so in as
-- many words, both confirm doors advanced only `agreement_status`, and no screen
-- sent it. `docs/db-build-plan.md:50` had already flagged the whole enum as an
-- unratified assumption. From 2026-08-31 the last signature advances it
-- (`apps/api/src/lib/deal-confirmation.ts`), and `POST /deals/:did/reopen` puts it
-- back.
--
-- WITHOUT THIS BACKFILL THE COLUMN WOULD BE HALF TRUE, which is worse than being
-- inert. Deals signed BEFORE the writer existed are sitting at
-- `agreement_status = 'confirmed'` (or `'signed'`) with `status = 'draft'` — fully
-- signed agreements that the column calls proposals. Two readers would act on it:
-- the Budget Planner blanks its "Performer fee" heading for anything not
-- `confirmed` (`apps/web/src/components/useBudgetSeed.ts`), and the settlement
-- engine's deal filter reads the same column. Production has no deal data at all —
-- it has never been deployed — but every seeded and dev database does, as does
-- every fixture that inserts a deal directly.
--
-- THE RULE IS DERIVED, NOT GUESSED. `agreement_status IN ('confirmed','signed')`
-- is precisely the condition under which every signatory line already carries a
-- `confirmed_at` — it is what `allSignatoriesConfirmed` computes and what the
-- freeze into `confirmed_snapshot` records. So this promotes exactly the rows the
-- new writer would have promoted had it existed, and no others. Both seeds
-- (`seed.ts`, `seed-e2e.ts`) already write the pair consistently, so they are
-- no-ops here — which is the point: the backfill states the invariant they were
-- already keeping by hand.
--
-- IT ONLY EVER MOVES `draft` FORWARD.
--   * `cancelled` IS NOT TOUCHED. A withdrawn deal that was signed before it was
--     withdrawn stays withdrawn; cancelling does not clear `agreement_status`, so
--     without this exclusion the backfill would settle deals somebody had
--     explicitly pulled (the engine drops `cancelled` and nothing else —
--     `apps/api/src/routes/settlement.ts`). The new writer makes the same
--     exclusion for the same reason.
--   * Nothing is demoted. See the guard below for why that is refused rather than
--     done quietly.
UPDATE "deals"
   SET "status" = 'confirmed'
 WHERE "status" = 'draft'
   AND "agreement_status" IN ('confirmed', 'signed');

-- AND THE OTHER DIRECTION IS REFUSED, NOT PERFORMED.
--
-- The mirror-image inconsistency is a row reading `status = 'confirmed'` while
-- `agreement_status` is still `draft` or `sent`: a deal marked confirmed that
-- nobody signed. Nothing in the app can produce one today — the only forward
-- writer is the signature rollup, and `PATCH /deals/:did` now refuses a hand-set
-- `confirmed` for exactly this reason — but that PATCH DID accept it until
-- 2026-08-31, so an API client could have written one, and this migration cannot
-- see production's rows to know.
--
-- Demoting such a row is a money-visible act: it takes a fee off the Budget
-- Planner's read-only "Performer fee" heading, and it is the kind of change that
-- must be a person's decision rather than a deploy's side effect. Promoting it
-- instead would be worse — it would forge a signature. So the migration stops and
-- says so, which is the only correct place for that choice. If you are reading
-- this in a failed deploy: either sign the agreement properly, or set those rows
-- to 'draft' by hand, then re-run.
DO $$
DECLARE
  unsigned_confirmed bigint;
BEGIN
  SELECT count(*) INTO unsigned_confirmed
    FROM deals
   WHERE status = 'confirmed'
     AND agreement_status IN ('draft', 'sent');

  IF unsigned_confirmed > 0 THEN
    RAISE EXCEPTION
      'deals holds % row(s) with status = ''confirmed'' but an agreement that is still draft or sent — a confirmed deal nobody signed. This migration will NOT demote them: dropping a deal out of ''confirmed'' removes its fee from the Budget Planner heading, and that is a decision for a person, not a deploy. Sign the agreements, or set those rows to ''draft'' by hand, then re-run.', unsigned_confirmed;
  END IF;
END $$;
