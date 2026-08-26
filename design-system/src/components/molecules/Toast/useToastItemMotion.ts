import gsap from "gsap";
import { useLayoutEffect, useRef } from "react";
import { DURATION, EASE } from "@/lib/motion";
import { useReducedMotion } from "@/lib/useReducedMotion";

/**
 * Enter/exit motion for one queued toast. Enters on mount (rise + fade); when
 * `dismissing` flips true it plays the out tween and then calls `onExited` so
 * the provider removes it. Respects `prefers-reduced-motion`.
 */
export function useToastItemMotion(dismissing: boolean, onExited: () => void) {
  const element = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  const exited = useRef(onExited);
  exited.current = onExited;

  useLayoutEffect(() => {
    if (!element.current) return;
    const tween = gsap.fromTo(
      element.current,
      { autoAlpha: 0, y: reducedMotion ? 0 : 16, scale: reducedMotion ? 1 : 0.98 },
      { autoAlpha: 1, y: 0, scale: 1, duration: reducedMotion ? 0 : DURATION.slow, ease: EASE.out },
    );
    return () => { tween.kill(); };
  }, [reducedMotion]);

  useLayoutEffect(() => {
    if (!dismissing || !element.current) return;
    const tween = gsap.to(element.current, {
      autoAlpha: 0,
      y: reducedMotion ? 0 : 8,
      scale: reducedMotion ? 1 : 0.98,
      // Leaving is quicker than arriving: nobody is reading a toast on its way
      // out, and a slow exit holds the corner of the screen hostage.
      duration: reducedMotion ? 0 : DURATION.base,
      ease: EASE.in,
      onComplete: () => exited.current(),
    });
    return () => { tween.kill(); };
  }, [dismissing, reducedMotion]);

  return element;
}
