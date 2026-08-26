import { DURATION, EASE, useReducedMotion } from "@showme/design-system";
import gsap from "gsap";
import { useLayoutEffect, useRef } from "react";

/**
 * The open/close motion for a disclosure — the deal cards on the event
 * workspace are the first user.
 *
 * SAME LANGUAGE AS THE SELECT POPOVER, because a thing opening under the control
 * you just clicked should feel like one gesture wherever it happens: fade in on
 * `--ease-out` on the way open, fade out on the way closed. What is different is
 * the DURATION. `selectIn` is `--duration-quick` because a menu only paints;
 * this one MOVES — every card below it is pushed down the page — so it takes
 * `--duration-base`, which the token file names as the speed for exactly that
 * and as the interaction ceiling. Both halves take it, so the fade and the
 * height land together instead of one trailing the other.
 *
 * ── The height problem, and how it is solved ──
 * `height: auto` does not transition, so the height has to be a measured number
 * for the length of the tween. The trap is being LEFT with that number: a card
 * whose content grows while it is open (a party confirms, a line appears) would
 * be clipped by a height measured before the growth.
 *
 * So the measured number exists only DURING the tween. The moment the open tween
 * completes the wrapper is set back to `height: auto`, which is a real resting
 * state that tracks its content forever after. Nothing observes the content,
 * nothing re-measures, and there is no stale number to go stale — the only
 * moments a fixed height exists are the ~200ms in which it is being animated.
 *
 * Closing does the mirror: read the live height, pin it, tween it to zero.
 * Because the pin is read at the instant of the click it is always current, and
 * because tweens start from the element's CURRENT value, interrupting an open
 * halfway and closing again is continuous rather than a jump.
 *
 * ── Two things the motion is not allowed to do ──
 *  - **Gate input.** Plain `opacity`, never `autoAlpha` (which would set
 *    `visibility: hidden` and make the content unclickable for the length of the
 *    tween), and the trigger lives OUTSIDE the wrapper, so it stays clickable
 *    throughout — including mid-tween.
 *  - **Leave a transform behind.** Nothing here translates. A lingering
 *    transform would make the wrapper a containing block and re-anchor any
 *    `position: fixed` overlay rendered inside it (the same trap documented in
 *    `useTabPanelMotion` and `Modal`).
 *
 * `prefers-reduced-motion` removes the tween entirely: the content is simply
 * there, or simply not.
 *
 * @param expanded whether the content should be showing
 * @returns the two refs to attach — `wrapper` is the clipping box, `content` the
 *   single child it measures
 */
export function useCollapseMotion(expanded: boolean) {
  const wrapper = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  const firstRun = useRef(true);

  useLayoutEffect(() => {
    const box = wrapper.current;
    const inner = content.current;
    if (!box || !inner) return;

    // First paint is a resting state, not a transition: a card that starts
    // collapsed must never be seen folding itself shut.
    const animate = !firstRun.current && !reducedMotion;
    firstRun.current = false;
    // Before anything is measured. Interrupting mid-tween leaves the height at
    // whatever pixel it had reached, which is exactly the value the next tween
    // should start from — that is what makes a fast double-click continuous
    // instead of a jump.
    gsap.killTweensOf([box, inner]);

    if (!animate) {
      gsap.set(
        box,
        expanded ? { height: "auto", overflow: "visible" } : { height: 0, overflow: "hidden" },
      );
      gsap.set(inner, { opacity: expanded ? 1 : 0 });
      return;
    }

    if (expanded) {
      const timeline = gsap.timeline();
      // `overflow: hidden` is the clip that makes a partial height read as a
      // fold; it is released on completion so a focus ring or a popover inside
      // the card is not shaved off while it rests open.
      timeline.set(box, { overflow: "hidden" });
      timeline.to(box, {
        height: inner.offsetHeight,
        duration: DURATION.base,
        ease: EASE.out,
        onComplete: () => gsap.set(box, { height: "auto", overflow: "visible" }),
      });
      timeline.to(inner, { opacity: 1, duration: DURATION.base, ease: EASE.out }, 0);
      return () => {
        timeline.kill();
      };
    }

    // Closing. Pin the live height first — `height: auto` is not a number GSAP
    // can tween FROM, and reading it at the instant of the click is what keeps
    // the pin current no matter how the content grew while it was open.
    gsap.set(box, { height: box.offsetHeight, overflow: "hidden" });
    const timeline = gsap.timeline();
    timeline.to(box, { height: 0, duration: DURATION.base, ease: EASE.in });
    timeline.to(inner, { opacity: 0, duration: DURATION.base, ease: EASE.in }, 0);
    return () => {
      timeline.kill();
    };
  }, [expanded, reducedMotion]);

  return { wrapper, content };
}
