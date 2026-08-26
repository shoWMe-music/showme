import { DURATION, EASE } from "@/lib/motion";
import { useReducedMotion } from "@/lib/useReducedMotion";
import gsap from "gsap";
import { useLayoutEffect, useRef } from "react";

/** The same 10px the `smRise` keyframes travel. One entrance, one distance. */
const RISE_PIXELS = 10;

/**
 * The screen entrance, for views that swap WITHOUT remounting — a router
 * outlet, where the wrapper element is the same DOM node before and after so a
 * CSS animation would never re-run.
 *
 * It plays exactly what `.sm-screen` plays (rise 10px + fade, `--ease-out`,
 * `--duration-slow`) rather than inventing a second entrance: a view that
 * arrives one way from CSS and another way from JS is precisely the kind of
 * inconsistency this pass exists to remove. Use the `.sm-screen` class when the
 * element mounts; use this hook when only its contents change.
 *
 * `useLayoutEffect` sets the start state before paint, so the new view is never
 * seen at full opacity for a frame first. `clearProps` strips the transform on
 * completion so the wrapper does not stay a containing block and re-anchor
 * portaled overlays.
 *
 * Respects `prefers-reduced-motion`: the view is simply there, no fade, no rise.
 *
 * @param viewKey changes on every navigation (a pathname) — the trigger.
 */
export function useViewMotion(viewKey: string) {
  const view = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();

  // biome-ignore lint/correctness/useExhaustiveDependencies: viewKey is the trigger — re-animate on every view change.
  useLayoutEffect(() => {
    const element = view.current;
    if (!element) return;
    if (reducedMotion) {
      gsap.set(element, { clearProps: "opacity,visibility,transform" });
      return;
    }
    const tween = gsap.fromTo(
      element,
      { autoAlpha: 0, y: RISE_PIXELS },
      {
        autoAlpha: 1,
        y: 0,
        duration: DURATION.slow,
        ease: EASE.out,
        clearProps: "transform",
      },
    );
    return () => {
      tween.kill();
    };
  }, [viewKey, reducedMotion]);

  return view;
}
