import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

/** Created once and reused: `getSnapshot` runs on every render pass, and a fresh
 * `matchMedia` call each time would be both wasteful and a new object identity. */
let mediaQuery: MediaQueryList | null = null;

function query(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  if (!mediaQuery) mediaQuery = window.matchMedia(QUERY);
  return mediaQuery;
}

function subscribe(onStoreChange: () => void): () => void {
  const current = query();
  if (!current) return () => {};
  current.addEventListener("change", onStoreChange);
  return () => current.removeEventListener("change", onStoreChange);
}

function getSnapshot(): boolean {
  return query()?.matches ?? false;
}

/** Public pages are server-rendered (`apps/ssr`), where the preference is
 * unknowable — assume full motion, and the client corrects itself before any
 * effect runs. */
function getServerSnapshot(): boolean {
  return false;
}

/**
 * Tracks the user's `prefers-reduced-motion` setting so animations can degrade
 * to instant. Returns `true` when the user asked for reduced motion.
 *
 * Read through `useSyncExternalStore` rather than `useState` + `useEffect`
 * because the answer has to be right on the FIRST render. An effect-seeded
 * version reports `false` for one commit, and every mount-triggered animation in
 * this library (modal open, toast enter, view change) starts inside that commit
 * — so a user who asked for no motion got the animation anyway, exactly once,
 * every time. That is the case that matters most.
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
