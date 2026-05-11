import { useEffect, useRef } from "react";
import { useRouterState } from "@tanstack/react-router";

/**
 * Returns a ref to attach to a section element. Whenever the router hash
 * equals one of the `hashes` provided, that element gets smooth-scrolled
 * into view on the next animation frame.
 *
 * Used by event-manager sub-tabs to honor notification deep links such as
 * `/events/$id?tab=settlement#activity` — the notification invalidator
 * surfaces the section via `metadata.section` in `notificationLinks.ts`.
 *
 * Pass multiple hashes when one element should respond to several
 * notification types (e.g. `#deal` and `#revenue` both pointing at the
 * Budget tab's body).
 */
export function useScrollToHash<T extends HTMLElement>(...hashes: string[]) {
  const ref = useRef<T>(null);
  const routerHash = useRouterState({ select: (s) => s.location.hash });
  useEffect(() => {
    if (!routerHash || !hashes.includes(routerHash)) return;
    const raf = requestAnimationFrame(() => {
      ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => cancelAnimationFrame(raf);
    // hashes is a rest array; we depend on its joined identity to keep deps stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routerHash, hashes.join(",")]);
  return ref;
}
