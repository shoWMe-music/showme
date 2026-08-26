import { DURATION, EASE } from "@/lib/motion";
import { useReducedMotion } from "@/lib/useReducedMotion";
import gsap from "gsap";
import { useLayoutEffect, useRef } from "react";

/** How far the incoming panel travels. Small on purpose: the eye needs a
 * direction, not a journey, and a long slide over a tall panel (the budget
 * sheet is eight sections) is what makes a transition drop frames. */
const TRAVEL_PIXELS = 14;

/** +1 when the new tab sits to the RIGHT of the old one, -1 when it sits to the
 * left, and +1 when either key is unknown to the order (a defensive default that
 * still reads as "forward"). The incoming panel then enters FROM that side, so
 * moving right pulls content in from the right, like paging forward. Backwards
 * is the one thing worse than no motion at all. */
function directionBetween(order: readonly string[], from: string, to: string): 1 | -1 {
  const fromIndex = order.indexOf(from);
  const toIndex = order.indexOf(to);
  if (fromIndex < 0 || toIndex < 0) return 1;
  return toIndex < fromIndex ? -1 : 1;
}

/**
 * Scoots and cross-fades tab content when the active tab changes, so the panel
 * agrees with the indicator instead of flipping under it.
 *
 * Three deliberate choices, all about not making a working tool feel slow:
 *
 *  - **Enter only.** The outgoing panel is gone the instant React re-renders;
 *    only the incoming one animates. Holding the old panel to fade it out would
 *    mean two heavy subtrees (budget sheet, month grid) laid out at once and the
 *    new panel arriving ~100ms late. A cross-fade you cannot afford is a stutter.
 *  - **`opacity`, not `autoAlpha`.** `autoAlpha` would set `visibility: hidden`
 *    at zero and the panel would be unclickable for the length of the tween.
 *    Plain opacity keeps every control in the incoming panel hit-testable from
 *    the first frame — the motion is never allowed to gate input.
 *  - **`clearProps` afterwards.** A lingering transform on the wrapper makes it
 *    a containing block, which would re-anchor any `position: fixed` overlay
 *    rendered inside the panel (see the note in `Modal.tsx`).
 *
 * Respects `prefers-reduced-motion`: no tween at all, the panel is simply there.
 *
 * @param activeKey the key of the tab whose panel is showing
 * @param order every tab key in display order — direction is derived from it
 */
export function useTabPanelMotion(activeKey: string, order: readonly string[]) {
  const panel = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  const previousKey = useRef(activeKey);
  // Held in a ref, not read as a dependency. `order` is rebuilt inline on every
  // render at basically every call site, and it is not the trigger anyway: a tab
  // appearing or disappearing (the budget tab, which only operators get) must
  // not replay the scoot on the panel that is already showing.
  const latestOrder = useRef(order);
  latestOrder.current = order;

  useLayoutEffect(() => {
    const element = panel.current;
    const from = previousKey.current;
    previousKey.current = activeKey;
    // First mount is not a tab change — the panel belongs to whatever entrance
    // the surrounding view already plays, and animating here too would be the
    // second competing entrance.
    if (!element || from === activeKey || reducedMotion) return;

    const direction = directionBetween(latestOrder.current, from, activeKey);
    const tween = gsap.fromTo(
      element,
      { opacity: 0, x: direction * TRAVEL_PIXELS },
      {
        opacity: 1,
        x: 0,
        duration: DURATION.base,
        ease: EASE.out,
        clearProps: "opacity,transform",
      },
    );
    return () => {
      tween.kill();
      gsap.set(element, { clearProps: "opacity,transform" });
    };
  }, [activeKey, reducedMotion]);

  return panel;
}
