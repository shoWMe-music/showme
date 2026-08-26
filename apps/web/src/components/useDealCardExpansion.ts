import { useCallback, useEffect, useRef, useState } from "react";

/**
 * sessionStorage, and keyed by DEAL rather than by event: deal ids are unique
 * across the platform, so one map answers every event without the hook ever
 * having to know which event it is on.
 *
 * `sessionStorage` and not `localStorage`: it survives a re-render, a tab switch
 * (`EventAgreementTab` unmounts on every one of those) and a reload, and dies
 * with the browser tab — the right lifetime for a view preference nobody chose
 * deliberately enough to want it back next week.
 */
const STORAGE_KEY = "showme:deal-card-expansion";

function readOverrides(): Record<string, boolean> {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        ([, value]) => typeof value === "boolean",
      ),
    ) as Record<string, boolean>;
  } catch {
    // Private-mode Safari throws on sessionStorage, and a hand-edited value can
    // be anything. Neither is worth a broken screen over: the defaults below are
    // a complete answer on their own.
    return {};
  }
}

function writeOverrides(overrides: Record<string, boolean>): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    // See above. Losing the preference costs one click.
  }
}

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
 * The rule chooses the OPENING state and never speaks again:
 *
 *  - A deliberate click wins, and is remembered for the rest of the browser
 *    session (`sessionStorage`, so it survives a tab switch — this tab unmounts
 *    on every one — and a reload, and dies with the tab).
 *  - While the screen is up, nothing re-folds or re-opens itself. The rule's
 *    answer is remembered per deal the first time it is asked, so neither a
 *    background refetch nor the LIST CHANGING LENGTH can move a card the reader
 *    is looking at. A second deal arriving on a one-deal event leaves the open
 *    card open and arrives collapsed itself; a two-deal list falling to one
 *    leaves the survivor exactly as the reader left it, closed or open. The
 *    rule is asked again on the next fresh look at the screen (a remount, which
 *    a tab switch causes) for every card the reader never touched, so a list
 *    that shrank to one does open it — just not while they are watching.
 *  - Nothing here is ever seeded FROM the deals themselves — only keyed by their
 *    ids — which is what makes it immune to the refetch trap `useBudgetEditor`'s
 *    `holdDraft` exists to patch (state re-seeded from a server response,
 *    wiping what someone was in the middle of).
 */

export function useDealCardExpansion(dealIds: readonly string[]) {
  const [overrides, setOverrides] = useState<Record<string, boolean>>(readOverrides);
  // The rule, whole.
  const onlyCard = dealIds.length <= 1;
  // The rule's answer, remembered per deal the first time it is asked. A cache
  // rather than state: it never changes what is rendered on the render that
  // fills it, it only stops the answer changing on a later one.
  const firstAnswer = useRef<Record<string, boolean>>({});

  useEffect(() => {
    writeOverrides(overrides);
  }, [overrides]);

  const isExpanded = (dealId: string): boolean => {
    const clicked = overrides[dealId];
    if (clicked !== undefined) return clicked;
    const remembered = firstAnswer.current[dealId];
    if (remembered !== undefined) return remembered;
    firstAnswer.current[dealId] = onlyCard;
    return onlyCard;
  };

  const toggle = useCallback(
    (dealId: string) => {
      setOverrides((current) => ({
        ...current,
        [dealId]: !(current[dealId] ?? firstAnswer.current[dealId] ?? onlyCard),
      }));
    },
    [onlyCard],
  );

  return { isExpanded, toggle };
}
