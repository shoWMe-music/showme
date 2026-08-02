import { useLayoutEffect, useRef } from "react";
import gsap from "gsap";
import { useReducedMotion } from "@/lib/useReducedMotion";

/**
 * Slides the active-tab underline. Measures the active tab button and moves the
 * indicator (left + width) with GSAP — set instantly on first mount and on
 * resize, animated on tab change. Respects `prefers-reduced-motion`.
 */
export function useTabsIndicator(activeKey: string, getActiveElement: () => HTMLElement | null) {
  const indicator = useRef<HTMLSpanElement>(null);
  const reducedMotion = useReducedMotion();
  const firstRun = useRef(true);

  useLayoutEffect(() => {
    const move = (animate: boolean) => {
      const element = getActiveElement();
      if (!indicator.current || !element) return;
      const target = { left: element.offsetLeft, width: element.offsetWidth };
      if (animate && !reducedMotion) {
        gsap.to(indicator.current, { ...target, duration: 0.3, ease: "power3.out" });
      } else {
        gsap.set(indicator.current, target);
      }
    };

    move(!firstRun.current);
    firstRun.current = false;

    const onResize = () => move(false);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // getActiveElement reads a ref, so it's always current — intentionally omitted
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey, reducedMotion]);

  return indicator;
}
