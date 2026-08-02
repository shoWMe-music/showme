import { useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
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
      const duration = reducedMotion ? 0 : 0.45;
      gsap.to(background.current, {
        autoAlpha: active ? 1 : 0,
        duration: reducedMotion ? 0 : 0.4,
        ease: "power3.out",
      });
      gsap.to(marker.current, {
        scaleY: active ? 1 : 0,
        autoAlpha: active ? 1 : 0,
        duration,
        ease: active ? "power3.out" : "power2.in",
      });
    },
    { scope: root, dependencies: [active, reducedMotion] },
  );

  const handlePointerEnter = contextSafe(() => {
    if (reducedMotion) return;
    gsap.to(content.current, { x: 3, duration: 0.3, ease: "power2.out" });
    gsap.to(icon.current, { scale: 1.12, duration: 0.34, ease: "back.out(2.4)" });
  });

  const handlePointerLeave = contextSafe(() => {
    if (reducedMotion) return;
    gsap.to(content.current, { x: 0, duration: 0.38, ease: "power2.out" });
    gsap.to(icon.current, { scale: 1, duration: 0.38, ease: "power2.out" });
  });

  return { root, background, marker, content, icon, handlePointerEnter, handlePointerLeave };
}
