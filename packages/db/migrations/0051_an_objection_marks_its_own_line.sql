-- AN OBJECTION MARKS ITS OWN LINE, NOT THE WHOLE EVENT'S STATUS.
--
-- decisions.md §25.9.8 (Daniel, 2026-09-29). Signing a settlement became settlement-scoped in
-- §25.8.2 — a party signs the line that is theirs — while objecting stayed event-scoped: one
-- `dispute` moved `settlements.status` for the whole event. So the two halves of one conversation
-- came apart, and the review email truthfully asks a crew member to "sign off when they match your
-- books" and in the same breath says "if something looks wrong, say so there", which they could not
-- do. The asking-and-ability rule §25.8.2 was decided on was half-kept.
--
-- `settlement_approvals` already holds one row per party, which is exactly the grain an objection
-- has. So a refusal lands here beside the signature it is the opposite of, and "one party objected"
-- stops being written into a status that means "nobody is signing anything".
--
-- AND IT RETIRES A WORKAROUND. `eventHasBeenFinalized` exists because `dispute` OVERWRITES
-- `settlements.status` — the only column that recorded the freeze — so a settlement finalized ninety
-- seconds earlier came back unlocked, `signableByYou` returned, and `confirm` answered 200 on
-- immutable figures. That is QA sweep run 16's first MAJOR, and run 17's QA17-2 was the same defect
-- surviving in a second data shape. Once an objection stops touching the status, the class
-- disappears at its source. The guard stays as a belt and stops being load-bearing.
--
-- NULLABLE AND NOT BACKFILLED. An existing `settlements.status = 'dispute'` row is a real objection
-- and stays readable as one; there is no way to know WHICH party raised it (the status is the
-- event's), so inventing a `declined_at` for one of them would put a refusal in somebody's name that
-- they may not have made. The read path asks both sources for as long as old rows exist.
--
-- NO INDEX: read only alongside the row itself, which is already fetched by `event_id` or by
-- `party_participant_id`.
ALTER TABLE "settlement_approvals"
  ADD COLUMN IF NOT EXISTS "declined_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "declined_note" text;
