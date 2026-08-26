import { DURATION, EASE, useReducedMotion } from "@showme/design-system";
import gsap from "gsap";
import { useLayoutEffect, useRef } from "react";

/**
 * The List ↔ Board switch on the Events screen: the incoming view FADES, it does
 * not scoot.
 *
 * A filter chip narrows one list, so `TabPanels` scoots it the way the chips are
 * ordered — the next bucket really is to the right of this one. The view toggle
 * is a different claim: the board is not to the right of the list, it is the same
 * events drawn another way. Sliding it in from a side would assert a spatial
 * relationship that does not exist, and the reader would spend a moment looking
 * for what moved. A fade says "same set, redrawn", which is the truth.
 *
 * The three constraints it shares with `useTabPanelMotion`, for the same reasons:
 *
 *  - **Enter only.** The outgoing view is gone the instant React re-renders. A
 *    true cross-fade would hold the list AND the four board columns laid out at
 *    once, and the board is the heaviest surface on the screen — a cross-fade you
 *    cannot afford is a stutter.
 *  - **`opacity`, not `autoAlpha`.** `autoAlpha` sets `visibility: hidden` at
 *    zero, which would make every card and every row menu in the arriving view
 *    unclickable for the length of the tween. Motion is never allowed to gate
 *    input (STYLE-GUIDE §4).
 *  - **No transform at all.** Nothing here travels, so nothing needs one — and
 *    the absence is load-bearing: a transform on this wrapper would make it a
 *    containing block and re-anchor the row menu's portaled popover, and would
 *    put a compositing layer over the whole board while its own cards are
 *    animating their hover lift.
 *
 * `DURATION.base`, not `slow`: this is a control being pressed, and §4 caps an
 * interaction response at ~250ms. Respects `prefers-reduced-motion` — the view is
 * simply there.
 *
 * @param view the key of the view being shown ("list" | "board") — the trigger
 */
export function useEventsViewMotion(view: string) {
  const panel = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  const previousView = useRef(view);

  useLayoutEffect(() => {
    const element = panel.current;
    const from = previousView.current;
    previousView.current = view;
    // First mount is not a view change — the screen's own entrance
    // (`usePageTransition`) already plays there, and a second one would compete.
    if (!element || from === view || reducedMotion) return;

    const tween = gsap.fromTo(
      element,
      { opacity: 0 },
      { opacity: 1, duration: DURATION.base, ease: EASE.out, clearProps: "opacity" },
    );
    return () => {
      tween.kill();
      gsap.set(element, { clearProps: "opacity" });
    };
  }, [view, reducedMotion]);

  return panel;
}
