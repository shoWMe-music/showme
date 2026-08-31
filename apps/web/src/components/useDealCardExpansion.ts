import { type CardExpansion, useCardExpansion } from "../hooks/useCardExpansion";

/**
 * sessionStorage, and keyed by DEAL rather than by event: deal ids are unique
 * across the platform, so one map answers every event without the hook ever
 * having to know which event it is on.
 */
const STORAGE_KEY = "showme:deal-card-expansion";

/**
 * WHICH DEAL CARDS OPEN THEMSELVES.
 *
 * The product owner's rule, verbatim: *"The deals should be closed by default,
 * unless there is only one deal."* So: **collapsed, unless it is the only card
 * on the screen.**
 *
 * Two properties are worth naming, because they are why this beats the cleverer
 * rule it replaced (open whatever "needs attention", fold the settled ones).
 * It is PREDICTABLE — the reader always knows what they are going to get — and
 * it contains no guess about which deal matters to whoever is looking. A
 * heuristic would have encoded someone's theory of the workflow as if it were a
 * fact about it.
 *
 * "ONLY ONE DEAL" MEANS ONE CARD ON THE SCREEN, not one deal on the event.
 * Deals are party-scoped: the server shows a performer only the deals she is a
 * party to, so an event carrying three of them can legitimately render her one
 * card — and that card is the one thing she came here for. What is counted is
 * therefore the rendered list, which is what this hook is handed.
 *
 * ── It is a default, not a lock ──
 * The rule chooses the OPENING state and never speaks again. A deliberate click
 * wins and is remembered for the browser session; while the screen is up nothing
 * re-folds or re-opens itself, not even when the list changes length. Both of
 * those are properties of `useCardExpansion`, which owns the mechanism (and the
 * long-form reasoning for each) — everything this file adds is the rule above.
 */
export function useDealCardExpansion(dealIds: readonly string[]): CardExpansion {
  return useCardExpansion({
    storageKey: STORAGE_KEY,
    // The rule, whole. `useCardExpansion` reads it once per deal, so a second
    // deal arriving on a one-deal event leaves the open card open and arrives
    // collapsed itself.
    defaultExpanded: dealIds.length <= 1,
  });
}
