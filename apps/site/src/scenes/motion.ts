// @ts-nocheck
/**
 * Motion bootstrap — GSAP-driven reveal-on-scroll + stat counters + Lenis smooth
 * scrolling, ported from the marketing site's main.ts.
 * - Reveals degrade to fully visible without JS and under prefers-reduced-motion.
 * - The canvas scenes (hero / galaxy / chaos-order / feature-scroll) stay as their
 *   own scripts — GSAP does not replace a 2D render loop.
 * Run from a client-only React effect AFTER the DOM is ready, so it inits
 * immediately rather than waiting for DOMContentLoaded.
 */
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import "lenis/dist/lenis.css";

export function initMotion() {
  gsap.registerPlugin(ScrollTrigger);

  // Mark JS active so CSS can hide .reveal only when we can animate it back in.
  document.documentElement.classList.add("js");

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ── Smooth scrolling (Lenis), synced with GSAP ScrollTrigger. ──────────────
  // Momentum wheel/trackpad scroll + eased in-page navigation. Skipped entirely
  // under prefers-reduced-motion, where the browser's native scrolling stands and
  // Lenis' own stylesheet leaves `scroll-behavior` untouched.
  let lenis = null;
  if (!reduceMotion) {
    lenis = new Lenis({
      duration: 1.1,
      // expo-out: quick to start, long gentle settle — the "premium" glide.
      easing: (t) => Math.min(1, 1.001 - 2 ** (-10 * t)),
      smoothWheel: true,
    });
    lenis.on("scroll", ScrollTrigger.update);
    gsap.ticker.add((time) => lenis?.raf(time * 1000));
    gsap.ticker.lagSmoothing(0); // one clock for scroll + tweens = no jitter
    // Expose for standalone scripts (e.g. the feature-scroll role switcher) that
    // need a Lenis-safe programmatic scroll.
    window.__lenis = lenis;
  }

  // Nav "scrolled" state — driven by Lenis when active, else raw window scroll.
  const nav = document.getElementById("nav");
  if (nav) {
    const setScrolled = (y) => nav.classList.toggle("scrolled", y > 30);
    if (lenis) {
      lenis.on("scroll", ({ scroll }) => setScrolled(scroll));
      setScrolled(window.scrollY);
    } else {
      const onScroll = () => setScrolled(window.scrollY);
      window.addEventListener("scroll", onScroll, { passive: true });
      onScroll();
    }
  }

  // Smooth in-page anchor navigation (nav links + CTA buttons → sections).
  // Offset clears the fixed header so the target isn't hidden beneath it.
  for (const link of document.querySelectorAll('a[href^="#"]')) {
    const href = link.getAttribute("href") ?? "";
    if (href.length <= 1) continue; // ignore bare "#"
    link.addEventListener("click", (event) => {
      const target = document.querySelector(href);
      if (!target) return;
      event.preventDefault();
      if (lenis) {
        lenis.scrollTo(target, { offset: -76, duration: 1.2 });
      } else {
        target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" });
      }
      history.pushState(null, "", href);
    });
  }

  function reveal(el) {
    if (reduceMotion) {
      gsap.set(el, { autoAlpha: 1, y: 0 });
      return;
    }
    gsap.to(el, {
      autoAlpha: 1,
      y: 0,
      duration: 0.7,
      ease: "power3.out",
      scrollTrigger: { trigger: el, start: "top 88%", once: true },
    });
  }

  function counter(el) {
    const target = Number.parseInt(el.dataset.count || "0", 10);
    const suffix = el.dataset.suffix || "";
    if (reduceMotion) {
      el.textContent = target + suffix;
      return;
    }
    const obj = { v: 0 };
    ScrollTrigger.create({
      trigger: el,
      start: "top 82%",
      once: true,
      onEnter: () =>
        gsap.to(obj, {
          v: target,
          duration: 1.8,
          ease: "power3.out",
          onUpdate: () => {
            el.textContent = Math.floor(obj.v) + suffix;
          },
          onComplete: () => {
            el.textContent = target + suffix;
          },
        }),
    });
  }

  for (const el of gsap.utils.toArray(".reveal")) reveal(el);
  for (const el of gsap.utils.toArray("[data-count]")) counter(el);
}
