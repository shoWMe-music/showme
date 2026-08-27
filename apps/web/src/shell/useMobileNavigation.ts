import { BREAKPOINTS, atMost } from "@showme/design-system";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

/**
 * The behaviour behind the off-canvas navigation drawer: is the shell narrow
 * enough that the sidebar has become a drawer, is that drawer open, and all the
 * focus bookkeeping a modal surface owes a keyboard.
 *
 * It lives in a hook rather than in `AppShell` because the shell is already the
 * longest component in the app and none of this is rendering — it is a media
 * query, a boolean, an escape key, and where the focus ring goes.
 */

/** Created once per query string and reused: `getSnapshot` runs on every render
 * pass, so a fresh `matchMedia` call each time would be both wasteful and a new
 * object identity. Same reasoning as the design system's `useReducedMotion`. */
const mediaQueries = new Map<string, MediaQueryList>();

function mediaQuery(query: string): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  const existing = mediaQueries.get(query);
  if (existing) return existing;
  const created = window.matchMedia(query);
  mediaQueries.set(query, created);
  return created;
}

const COMPACT = atMost(BREAKPOINTS.tablet);

function subscribe(onStoreChange: () => void): () => void {
  const query = mediaQuery(COMPACT);
  if (!query) return () => {};
  query.addEventListener("change", onStoreChange);
  return () => query.removeEventListener("change", onStoreChange);
}

/**
 * True when the viewport is at or below the `tablet` breakpoint — the width at
 * which the sidebar stops being a column of the layout and becomes a drawer.
 *
 * Read through `useSyncExternalStore` so the answer is right on the FIRST
 * render: the drawer's dialog semantics (`role`, `aria-modal`) and the position
 * of the theme toggle are decided in that first commit, and a version seeded by
 * an effect would announce the sidebar as a plain landmark for one paint on
 * every phone.
 */
function useIsCompact(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => mediaQuery(COMPACT)?.matches ?? false,
    () => false,
  );
}

/** Everything a keyboard can land on inside the drawer. */
const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface MobileNavigation {
  /** The sidebar is currently a drawer rather than a column. */
  compact: boolean;
  open: boolean;
  toggle: () => void;
  close: () => void;
  /** Put on the `<aside>`. The focus trap reads its contents. */
  drawer: React.RefObject<HTMLElement | null>;
  /** Put on the menu button. Focus returns here when the drawer closes. */
  trigger: React.RefObject<HTMLButtonElement | null>;
}

export function useMobileNavigation(routeKey: string): MobileNavigation {
  const compact = useIsCompact();
  const [open, setOpen] = useState(false);
  const drawer = useRef<HTMLElement | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);

  // Going somewhere closes the menu — the drawer's whole job is done the moment
  // it is used, and leaving it over the screen you just asked for is the classic
  // way a mobile menu feels broken. `routeKey` is a prop-derived string, so the
  // linter's "outer scope value" warning does not apply; it re-renders like any
  // other prop.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the route IS the trigger
  useEffect(() => setOpen(false), [routeKey]);

  // Widening past the breakpoint hands the sidebar back to the layout, so the
  // drawer's scrim and focus trap have nothing left to guard.
  useEffect(() => {
    if (!compact) setOpen(false);
  }, [compact]);

  useEffect(() => {
    if (!open) return;
    const panel = drawer.current;
    if (!panel) return;

    const returnFocusTo = trigger.current;
    // First stop is the close button, so the first Tab walks INTO the list
    // rather than out of the last nav item.
    panel.querySelector<HTMLElement>(FOCUSABLE)?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      // Tab cycles within the drawer while it is open. This is a trap on
      // purpose and it is never a dead end: Escape, the scrim, the close button
      // and every nav item all close it, and closing returns the focus ring to
      // the button that opened it. The alternative — letting Tab walk behind a
      // scrim into a page the pointer cannot reach — is the version that
      // actually strands a keyboard.
      const stops = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const first = stops.at(0);
      const last = stops.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    // The page behind a full-height drawer must not scroll under it.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      returnFocusTo?.focus();
    };
  }, [open]);

  return {
    compact,
    open,
    toggle: () => setOpen((value) => !value),
    close: () => setOpen(false),
    drawer,
    trigger,
  };
}
