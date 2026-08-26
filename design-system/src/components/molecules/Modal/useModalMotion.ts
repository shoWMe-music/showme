import gsap from "gsap";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { DURATION, EASE } from "@/lib/motion";
import { useReducedMotion } from "@/lib/useReducedMotion";

/**
 * Open/close motion for the Modal, kept out of the component. Handles the exit
 * animation too: while closing it keeps `rendered` true, plays the out tween,
 * then unmounts. Respects `prefers-reduced-motion` (falls back to instant).
 *
 *  - open  → scrim fades in, panel rises + scales up;
 *  - close → panel drops + scales down, scrim fades out, then unmounts.
 */
export function useModalMotion(open: boolean) {
  const scrim = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [rendered, setRendered] = useState(open);
  const reducedMotion = useReducedMotion();

  // Mount immediately on open; unmount happens after the exit tween completes.
  useEffect(() => {
    if (open) setRendered(true);
  }, [open]);

  useLayoutEffect(() => {
    if (!rendered || !scrim.current || !panel.current) return;

    if (open) {
      const timeline = gsap.timeline();
      timeline.fromTo(scrim.current, { autoAlpha: 0 }, { autoAlpha: 1, duration: reducedMotion ? 0 : DURATION.quick, ease: EASE.soft });
      timeline.fromTo(
        panel.current,
        { autoAlpha: 0, y: reducedMotion ? 0 : 12, scale: reducedMotion ? 1 : 0.96 },
        { autoAlpha: 1, y: 0, scale: 1, duration: reducedMotion ? 0 : DURATION.slow, ease: EASE.out },
        reducedMotion ? 0 : "-=0.1",
      );
      return () => { timeline.kill(); };
    }

    const timeline = gsap.timeline({ onComplete: () => setRendered(false) });
    timeline.to(panel.current, { autoAlpha: 0, y: reducedMotion ? 0 : 8, scale: reducedMotion ? 1 : 0.98, duration: reducedMotion ? 0 : DURATION.base, ease: EASE.in });
    timeline.to(scrim.current, { autoAlpha: 0, duration: reducedMotion ? 0 : DURATION.quick, ease: EASE.in }, reducedMotion ? 0 : "-=0.12");
    return () => { timeline.kill(); };
  }, [open, rendered, reducedMotion]);

  return { rendered, scrim, panel };
}
