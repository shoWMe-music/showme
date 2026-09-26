-- A night run by ONE operator keeps its costs inside its own settlement.
--
-- `ensureEventBudgets` used to give a solo operator only a `private` budget and
-- deliberately no shared ledger. But the settlement copies the SHARED budget and
-- only the shared budget, so the one book the operator was offered was the one
-- book nothing read: they typed the night's costs into it, `seedTicketTiersIntoBudget`
-- created a shared ledger of its own for the event's ticket tiers, and the night
-- settled with revenue and no costs at all.
--
-- The provisioning rule is now PLAN.md:215 as written — the event has one ledger
-- (`shared`), and a `private` book is the extra an operator MAY ALSO keep, which
-- only exists once there is a co-host to keep it from. New events get that from
-- `ensureEventBudgets` on first open.
--
-- This heals the events that already exist. Relabelling is the right repair
-- rather than provisioning an empty shared ledger beside the private one: the
-- lines in that private book ARE the night's plan — there is nobody they were
-- ever private FROM — and leaving them behind would strand exactly the work this
-- bug already failed to settle once.
--
-- Deliberately narrow. It touches a budget only where all four hold:
--   * the event has exactly one operating profile (host / co_host, not removed),
--   * that profile owns the budget,
--   * the budget is private,
--   * the event has no shared ledger yet.
-- A co-hosted event's private margin books are untouched, and so is any event
-- that already has a shared ledger — there the private book is a real second
-- book and its contents are nobody else's business.
UPDATE budgets AS solo_budget
SET scope = 'shared',
    owner_profile_id = NULL
WHERE solo_budget.scope = 'private'
  -- The event has no ledger yet. Where one exists, the private book is a real
  -- second book and its contents are nobody else's business.
  AND NOT EXISTS (
    SELECT 1
    FROM budgets AS existing_shared
    WHERE existing_shared.event_id = solo_budget.event_id
      AND existing_shared.scope = 'shared'
  )
  -- The owner of this book is an operator on this event, rather than someone
  -- who has since been removed from it.
  AND EXISTS (
    SELECT 1
    FROM event_participants AS owner_participant
    WHERE owner_participant.event_id = solo_budget.event_id
      AND owner_participant.profile_id = solo_budget.owner_profile_id
      AND owner_participant.role IN ('host', 'co_host')
      AND owner_participant.status <> 'removed'
  )
  -- And they are the ONLY operator, so there is nobody this book was private
  -- from. (No MIN(profile_id) here: Postgres has no min() for uuid.)
  AND (
    SELECT COUNT(DISTINCT operating.profile_id)
    FROM event_participants AS operating
    WHERE operating.event_id = solo_budget.event_id
      AND operating.role IN ('host', 'co_host')
      AND operating.status <> 'removed'
      AND operating.profile_id IS NOT NULL
  ) = 1;
