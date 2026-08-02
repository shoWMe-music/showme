import { useLayoutEffect, useRef } from "react";
import gsap from "gsap";
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
      { autoAlpha: 1, y: 0, scale: 1, duration: reducedMotion ? 0 : 0.35, ease: "power3.out" },
    );
    return () => { tween.kill(); };
  }, [reducedMotion]);

  useLayoutEffect(() => {
    if (!dismissing || !element.current) return;
    const tween = gsap.to(element.current, {
      autoAlpha: 0,
      y: reducedMotion ? 0 : 8,
      scale: reducedMotion ? 1 : 0.98,
      duration: reducedMotion ? 0 : 0.25,
      ease: "power2.in",
      onComplete: () => exited.current(),
    });
    return () => { tween.kill(); };
  }, [dismissing, reducedMotion]);

  return element;
}
