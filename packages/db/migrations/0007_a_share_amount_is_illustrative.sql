-- A-36: a share's `guaranteeAmount` was never a floor, so it stops calling itself one.
--
-- The engine reads a share only for `splitBasisPoints`; the amount beside it was
-- never consulted. That made it a promise nothing would keep — and `freezeSnapshot`
-- copied it verbatim into `deals.confirmed_snapshot`, the record both parties sign.
-- A floor is not missing from the model: it is the deal-level `guarantee_vs_door`
-- structure, which really is settled as max(guarantee, door). Renaming the key is
-- the whole fix; every value is preserved exactly.
--
-- Deliberately NOT touched: `deals.reopen -> priorSnapshot`. That is the archived
-- text of an agreement someone WITHDREW, and rewriting the words of a withdrawn
-- agreement is not this migration's business.

-- The live shares.
UPDATE deal_parties
SET share = (share - 'guaranteeAmount')
            || jsonb_build_object('illustrativeAmount', share -> 'guaranteeAmount')
WHERE share ? 'guaranteeAmount';

--> statement-breakpoint

-- The frozen snapshots, party by party, preserving array order.
UPDATE deals
SET confirmed_snapshot = jsonb_set(
      confirmed_snapshot,
      '{parties}',
      (
        SELECT jsonb_agg(
                 CASE
                   WHEN party -> 'share' ? 'guaranteeAmount' THEN jsonb_set(
                     party,
                     '{share}',
                     -- Both the inner parens and the cast are load-bearing. Postgres
                     -- binds `-` TIGHTER than `->`, so `party -> 'share' - 'key'` parses
                     -- as `party -> ('share' - 'key')` and dies trying to read `share`
                     -- as JSON; and with the operand untyped, jsonb's `- text` and
                     -- `- integer` are ambiguous.
                     ((party -> 'share') - 'guaranteeAmount'::text)
                     || jsonb_build_object('illustrativeAmount', party -> 'share' -> 'guaranteeAmount')
                   )
                   ELSE party
                 END
                 ORDER BY position
               )
        FROM jsonb_array_elements(confirmed_snapshot -> 'parties')
             WITH ORDINALITY AS frozen(party, position)
      )
    )
WHERE confirmed_snapshot IS NOT NULL
  AND jsonb_typeof(confirmed_snapshot -> 'parties') = 'array'
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(confirmed_snapshot -> 'parties') AS frozen(party)
    WHERE party -> 'share' ? 'guaranteeAmount'
  );
