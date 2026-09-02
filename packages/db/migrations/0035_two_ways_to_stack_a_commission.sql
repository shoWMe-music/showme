-- Two disclosed commissions on one deal can compose two ways, and which one is
-- right belongs to the AGREEMENT rather than to the product.
--
-- 20% and 10% on a 1 000 line:
--
--   parallel  — each takes its cut of the same base → 200 + 100, payee keeps 700
--   cascading — the second takes its cut of what is left → 200 + 80, payee keeps 720
--
-- Our own documents disagreed about which we do: `docs/money.md` said cascading,
-- `.claude/skills/settlement/SKILL.md` read as parallel, and the reference app
-- cascades (`../showme-settle-fast` `src/lib/models.ts:490-491`). The product
-- owner's answer (2026-08-26, ClickUp `86cba8wmb`) was that it depends on the
-- shape of the deal — so neither is "the rule", and the deal carries the answer.
--
-- WHY `parallel` IS THE DEFAULT, and why that is safe:
--
--  1. It is exactly what `applyCommissions` has always done, so every deal that
--     already exists settles to the identical figure after this migration. A
--     default of `cascading` would silently restate money on live settlements —
--     the class of change that has to be a deliberate act on one deal, never a
--     column default applied to all of them at once.
--  2. It is ORDER-INDEPENDENT. Cascading makes the payout depend on the sequence
--     the commission parties happen to sit in, and nobody signs a contract whose
--     result changes if the two agents are entered the other way round. The
--     order-sensitive rule is therefore the one that must be chosen on purpose.
--
-- NOT NULL with a default rather than a nullable column: "we never said" and
-- "parallel" would settle identically, so a null would be a third state that
-- means nothing and can only ever be mistaken for something.
--
-- Scope: DISCLOSED commissions only — an entitled `deal_parties` row every party
-- to the deal can see. A booking agent's PRIVATE representation commission is a
-- separate settlement (decisions.md #14) and is untouched by this column.
DO $$ BEGIN
  CREATE TYPE "commission_mode" AS ENUM ('parallel', 'cascading');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "commission_mode" "commission_mode" NOT NULL DEFAULT 'parallel';
