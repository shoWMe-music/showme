import gsap from "gsap";
import { useLayoutEffect, useRef } from "react";

/**
 * Page transition for the app shell. On each route change the incoming page
 * fades and rises a few pixels into place while the sidebar/topbar stay put — a
 * quiet frame with content that resolves. Same easing idiom as the onboarding
 * steps (power3.out), but deliberately smaller travel and shorter duration:
 * pages should feel like they settle, not slide.
 *
 * `useLayoutEffect` sets the start state before paint (no flash of the new page
 * at full opacity). Respects prefers-reduced-motion (a brief opacity fade, no
 * movement), and `clearProps` strips the transform afterwards so the wrapper
 * never becomes a containing block that would offset portaled overlays.
 *
 * Pass the route key (pathname) so it re-runs on every navigation.
 */
export function usePageTransition(routeKey: string) {
  const ref = useRef<HTMLDivElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: routeKey is the trigger — re-animate on every route change.
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    gsap.fromTo(
      element,
      { autoAlpha: 0, y: reduce ? 0 : 10 },
      {
        autoAlpha: 1,
        y: 0,
        duration: reduce ? 0.2 : 0.4,
        ease: "power3.out",
        clearProps: "transform",
      },
    );
  }, [routeKey]);

  return ref;
}
