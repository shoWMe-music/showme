import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { useRef } from "react";
import { DURATION, EASE } from "@/lib/motion";
import { useReducedMotion } from "@/lib/useReducedMotion";

/**
 * All the GSAP motion for a sidebar item, kept out of the component so the
 * component stays dumb (just markup). Returns the refs to attach and the
 * pointer handlers. Respects `prefers-reduced-motion` (falls back to instant).
 *
 *  - active → the red→gold fade opacity-tweens in and the left marker bar grows
 *    from its center (scaleY) with its glow;
 *  - hover/focus → the content eases right and the icon does a soft pop.
 */
export function useSidebarItemMotion(active: boolean | undefined) {
  const root = useRef<HTMLButtonElement>(null);
  const background = useRef<HTMLSpanElement>(null);
  const marker = useRef<HTMLSpanElement>(null);
  const content = useRef<HTMLSpanElement>(null);
  const icon = useRef<HTMLSpanElement>(null);
  const reducedMotion = useReducedMotion();

  const { contextSafe } = useGSAP(
    () => {
      // The marker MOVES (scaleY) and the wash only repaints, but they are one
      // state change on one item, so both take the movement duration and land
      // together. This is also the click that starts a route change: at the old
      // 0.4/0.45 the highlight was still catching up after the new page had
      // already arrived.
      const duration = reducedMotion ? 0 : DURATION.base;
      gsap.to(background.current, { autoAlpha: active ? 1 : 0, duration, ease: EASE.out });
      gsap.to(marker.current, {
        scaleY: active ? 1 : 0,
        autoAlpha: active ? 1 : 0,
        duration,
        ease: active ? EASE.out : EASE.in,
      });
    },
    { scope: root, dependencies: [active, reducedMotion] },
  );

  const handlePointerEnter = contextSafe(() => {
    if (reducedMotion) return;
    gsap.to(content.current, { x: 3, duration: DURATION.base, ease: EASE.soft });
    gsap.to(icon.current, { scale: 1.12, duration: DURATION.base, ease: EASE.pop });
  });

  const handlePointerLeave = contextSafe(() => {
    if (reducedMotion) return;
    gsap.to(content.current, { x: 0, duration: DURATION.base, ease: EASE.soft });
    gsap.to(icon.current, { scale: 1, duration: DURATION.base, ease: EASE.soft });
  });

  return { root, background, marker, content, icon, handlePointerEnter, handlePointerLeave };
}
