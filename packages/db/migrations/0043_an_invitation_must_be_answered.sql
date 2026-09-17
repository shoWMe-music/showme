-- An invitation must be answered before it grants anything.
--
-- ClickUp 86cbcehmp / 123qy9rnf87. `event_participants.status` has carried
-- `invited | accepted | declined | confirmed | removed` since the schema was
-- written, and NOTHING has ever advanced it: the host row is born `confirmed`,
-- an agent row `accepted`, and every performer, support act and crew member
-- `invited` — for ever. Authorization asked only `status <> 'removed'`, so the
-- column decided nothing and being named on a bill was the same as having
-- agreed to play it.
--
-- The gate lands with the API change that reads it. This migration exists ONLY
-- to make that gate safe on data that predates it.
--
-- WHY EVERY EXISTING `invited` ROW BECOMES `accepted`:
--
-- The new rule is "invited grants no capabilities". Applied to rows written
-- under the old rule, it would REVOKE access that people are using right now —
-- on 30 live events, mid-booking, with no way for them to grant it back to
-- themselves except an accept button that did not exist when they were added.
-- A migration that logs people out of their own events on deploy is not an
-- acceptable way to ship a feature, however correct the feature is.
--
-- So the population is grandfathered: everyone who could reach an event the
-- moment before this ran can still reach it the moment after. The gate applies
-- to invitations issued FROM NOW ON, which is the only group for whom an
-- "Accept" step was ever offered.
--
-- This is deliberately NOT reversible in data terms. Rolling the API back
-- restores the old behaviour for everyone (the old predicate ignores the
-- column); rolling this back would need to know which rows were `invited`
-- because nobody had answered versus `invited` because nobody could, and that
-- distinction is not recorded anywhere. Down-migrating is a no-op by design.
UPDATE event_participants
SET status = 'accepted',
    updated_at = now()
WHERE status = 'invited';
