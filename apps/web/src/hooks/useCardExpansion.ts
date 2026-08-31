import { useCallback, useEffect, useRef, useState } from "react";

/**
 * WHICH CARDS IN A LIST ARE OPEN — the mechanism, with no opinion about what a
 * card is.
 *
 * Extracted from `components/useDealCardExpansion.ts`, which now calls it and
 * keeps the deals' own rule ("closed unless it is the only card"). The Requests
 * inbox needed the same three properties and none of that rule, and copying a
 * hundred lines of `sessionStorage` handling and first-answer memoisation to get
 * them would have been two copies of the subtle half and none of the simple half.
 *
 * The three properties, all of which are why this is not four lines of `useState`:
 *
 *  - **A deliberate click wins, and is remembered** for the rest of the browser
 *    session. `sessionStorage`, not `localStorage`: it survives a re-render, a
 *    tab switch and a reload, and dies with the browser tab — the right lifetime
 *    for a view preference nobody chose deliberately enough to want it back next
 *    week.
 *  - **The default is answered ONCE per id.** `defaultExpanded` may change while
 *    the screen is up (a list falling to one deal; a reader switching to the list
 *    view), and re-answering would re-fold a card somebody is reading. The answer
 *    is cached the first time it is asked, so neither a background refetch nor
 *    the list changing length can move a card under the cursor. The rule is asked
 *    again on the next fresh look at the screen (a remount).
 *  - **Nothing is ever seeded FROM the rows** — only keyed by their ids — which
 *    is what makes it immune to the refetch trap `useBudgetEditor`'s `holdDraft`
 *    exists to patch (state re-seeded from a server response, wiping what
 *    somebody was in the middle of).
 *
 * ## Ids are the caller's to namespace
 *
 * Nothing here interprets an id, so a screen that shows the same rows in two
 * shapes prefixes them and gets two independent answers for free — which is
 * exactly what the Requests inbox does (`cards:<id>` opens by default, `list:<id>`
 * does not, and collapsing a card does not collapse its row).
 */
export interface CardExpansionOptions {
  /** `showme:`-prefixed `sessionStorage` key. Fixed for the life of the hook. */
  storageKey: string;
  /** The opening state for an id nobody has clicked yet. Read once per id. */
  defaultExpanded: boolean;
}

export interface CardExpansion {
  isExpanded: (id: string) => boolean;
  toggle: (id: string) => void;
}

function readOverrides(storageKey: string): Record<string, boolean> {
  try {
    const raw = window.sessionStorage.getItem(storageKey);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        ([, value]) => typeof value === "boolean",
      ),
    ) as Record<string, boolean>;
  } catch {
    // Private-mode Safari throws on sessionStorage, and a hand-edited value can
    // be anything. Neither is worth a broken screen over: the default is a
    // complete answer on its own.
    return {};
  }
}

function writeOverrides(storageKey: string, overrides: Record<string, boolean>): void {
  try {
    window.sessionStorage.setItem(storageKey, JSON.stringify(overrides));
  } catch {
    // See above. Losing the preference costs one click.
  }
}

export function useCardExpansion({
  storageKey,
  defaultExpanded,
}: CardExpansionOptions): CardExpansion {
  const [overrides, setOverrides] = useState<Record<string, boolean>>(() =>
    readOverrides(storageKey),
  );
  // The default's answer, remembered per id the first time it is asked. A ref
  // rather than state: it never changes what is rendered on the render that
  // fills it, it only stops the answer changing on a later one.
  const firstAnswer = useRef<Record<string, boolean>>({});

  useEffect(() => {
    writeOverrides(storageKey, overrides);
  }, [storageKey, overrides]);

  const isExpanded = (id: string): boolean => {
    const clicked = overrides[id];
    if (clicked !== undefined) return clicked;
    const remembered = firstAnswer.current[id];
    if (remembered !== undefined) return remembered;
    firstAnswer.current[id] = defaultExpanded;
    return defaultExpanded;
  };

  const toggle = useCallback(
    (id: string) => {
      setOverrides((current) => ({
        ...current,
        [id]: !(current[id] ?? firstAnswer.current[id] ?? defaultExpanded),
      }));
    },
    [defaultExpanded],
  );

  return { isExpanded, toggle };
}
