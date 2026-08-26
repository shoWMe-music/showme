import gsap from "gsap";
import { useLayoutEffect, useRef } from "react";
import { DURATION, EASE } from "@/lib/motion";
import { useReducedMotion } from "@/lib/useReducedMotion";

/**
 * Slides the active-tab underline. Measures the active tab button and moves the
 * indicator (left + width) with GSAP — set instantly on first mount and on
 * resize, animated on tab change. Respects `prefers-reduced-motion`.
 *
 * `layoutSignature` is every tab's key and badge, joined. The measurement is of
 * a POSITION in a strip, so it goes stale whenever the strip changes without the
 * selection changing — a tab appearing (the budget tab, which only operators
 * get) shifts every tab after it, and a count badge arriving widens the tab it
 * rides on. Both would leave the bar sitting under the wrong label. A change to
 * it re-measures without animating: nothing was selected, so nothing should
 * appear to travel.
 */
export function useTabsIndicator(
  activeKey: string,
  getActiveElement: () => HTMLElement | null,
  layoutSignature = "",
) {
  const indicator = useRef<HTMLSpanElement>(null);
  const reducedMotion = useReducedMotion();
  const firstRun = useRef(true);
  const measuredKey = useRef(activeKey);

  useLayoutEffect(() => {
    const move = (animate: boolean) => {
      const element = getActiveElement();
      if (!indicator.current || !element) return;
      const target = { left: element.offsetLeft, width: element.offsetWidth };
      if (animate && !reducedMotion) {
        // Same duration as the panel scoot (`useTabPanelMotion`) — the bar and the
        // content it labels have to arrive together or the mismatch is the
        // whole thing you notice.
        gsap.to(indicator.current, { ...target, duration: DURATION.base, ease: EASE.out });
      } else {
        gsap.set(indicator.current, target);
      }
    };

    // Animate only when the SELECTION changed. A re-measure caused by the strip
    // itself changing shape must snap.
    move(!firstRun.current && activeKey !== measuredKey.current);
    firstRun.current = false;
    measuredKey.current = activeKey;

    const onResize = () => move(false);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // getActiveElement reads a ref, so it's always current — intentionally omitted
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey, layoutSignature, reducedMotion]);

  return indicator;
}
