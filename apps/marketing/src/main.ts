/**
 * Marketing site entry — loaded as a module by every page.
 * - Imports the unified design tokens (single source: @showme/design-system).
 * - Nav scrolled state.
 * - GSAP-driven reveal-on-scroll + stat counters (the app's animation library).
 * - Reveals degrade to fully visible without JS and under prefers-reduced-motion.
 * The canvas scenes (hero / galaxy / chaos-order / feature-visuals) stay as their
 * own vanilla scripts — GSAP does not replace a 2D render loop.
 */
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import "lenis/dist/lenis.css";
import { initCookieConsent } from "./cookie-consent";
import "./styles/fonts.css";
import "./styles/tokens.css";
import "./styles/buttons.css";
import "./styles/reveal.css";
import "./styles/cookie-consent.css";
import "./styles/nav.css";

gsap.registerPlugin(ScrollTrigger);

// Consent banner + consent-gated Google Analytics (GA4). Runs on every page.
initCookieConsent();

// Mark JS active so CSS can hide .reveal only when we can animate it back in.
document.documentElement.classList.add("js");

// The canvas / scroll scenes (hero, chaos, feature-scroll, ecosystem) pick their
// mobile-vs-desktop layout ONCE, at load. If the viewport later crosses the mobile
// breakpoint — a Chrome DevTools device-mode toggle, or a tablet rotating — the
// scenes would be stuck in the wrong mode (desktop scroll-jacking at phone width
// looks frozen). Reload on the crossing so every scene re-initialises in the right
// mode. Fires only on an actual breakpoint change — never on a real phone (fixed
// width), so it costs nothing in production.
window.matchMedia("(max-width: 760px)").addEventListener("change", () => {
  window.location.reload();
});

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ── Smooth scrolling (Lenis), synced with GSAP ScrollTrigger. ──────────────
// Momentum wheel/trackpad scroll + eased in-page navigation. Skipped entirely
// under prefers-reduced-motion, where the browser's native scrolling stands and
// Lenis' own stylesheet leaves `scroll-behavior` untouched.
let lenis: Lenis | null = null;
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
  (window as unknown as { __lenis?: Lenis }).__lenis = lenis;
}

// Nav "scrolled" state — driven by Lenis when active, else raw window scroll.
const nav = document.getElementById("nav");
if (nav) {
  const setScrolled = (y: number) => nav.classList.toggle("scrolled", y > 30);
  if (lenis) {
    lenis.on("scroll", ({ scroll }: { scroll: number }) => setScrolled(scroll));
    setScrolled(window.scrollY);
  } else {
    const onScroll = () => setScrolled(window.scrollY);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }
}

// Smooth in-page anchor navigation (nav links + CTA buttons → sections).
// Offset clears the fixed header so the target isn't hidden beneath it.
for (const link of document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')) {
  const href = link.getAttribute("href") ?? "";
  if (href.length <= 1) continue; // ignore bare "#"
  link.addEventListener("click", (event) => {
    const target = document.querySelector(href);
    if (!target) return;
    event.preventDefault();
    if (lenis) {
      lenis.scrollTo(target as HTMLElement, { offset: -76, duration: 1.2 });
    } else {
      (target as HTMLElement).scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" });
    }
    history.pushState(null, "", href);
  });
}

// ── Mobile hamburger menu ──────────────────────────────────────────────────
// Progressive enhancement of the mobile header: the burger toggles a full-width
// slide-down overlay (#mobile-menu). Scroll is locked while open — an `overflow:
// hidden` class on <html> stops native/touch scroll, and Lenis (which drives its
// own virtual wheel scroll) is paused so the background can't move behind the
// panel. Focus moves into the panel on open and returns to the burger on close.
const burger = document.querySelector<HTMLButtonElement>(".nav-burger");
const mobileMenu = document.getElementById("mobile-menu");
if (burger && mobileMenu) {
  const closeButton = mobileMenu.querySelector<HTMLElement>(".mobile-menu__close");
  let lastFocused: HTMLElement | null = null;

  const openMenu = () => {
    lastFocused = document.activeElement as HTMLElement | null;
    mobileMenu.classList.add("open");
    mobileMenu.setAttribute("aria-hidden", "false");
    burger.setAttribute("aria-expanded", "true");
    document.documentElement.classList.add("menu-open");
    lenis?.stop();
    closeButton?.focus();
  };

  const closeMenu = () => {
    if (!mobileMenu.classList.contains("open")) return;
    mobileMenu.classList.remove("open");
    mobileMenu.setAttribute("aria-hidden", "true");
    burger.setAttribute("aria-expanded", "false");
    document.documentElement.classList.remove("menu-open");
    lenis?.start();
    (lastFocused ?? burger).focus();
  };

  burger.addEventListener("click", () => {
    if (mobileMenu.classList.contains("open")) closeMenu();
    else openMenu();
  });

  // Close on the ✕, the backdrop, any menu link, or Escape.
  for (const el of mobileMenu.querySelectorAll<HTMLElement>("[data-menu-close]")) {
    el.addEventListener("click", closeMenu);
  }
  for (const link of mobileMenu.querySelectorAll<HTMLAnchorElement>("a")) {
    link.addEventListener("click", closeMenu);
  }
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMenu();
  });
}

// ── Header dropdown menus (Product / Company / Contact) ──────────────────────
// CSS opens them on hover/focus for pointer + keyboard users; this adds explicit
// click-to-toggle (touch, and a deliberate click) plus Escape-to-close and
// outside-click-to-close, keeping aria-expanded in sync for assistive tech.
const dropdownTriggers = [...document.querySelectorAll<HTMLButtonElement>(".topnav__trigger")];
if (dropdownTriggers.length) {
  const closeAll = (except?: HTMLButtonElement) => {
    for (const trigger of dropdownTriggers) {
      if (trigger !== except) trigger.setAttribute("aria-expanded", "false");
    }
  };
  for (const trigger of dropdownTriggers) {
    trigger.addEventListener("click", (event) => {
      event.stopPropagation();
      const open = trigger.getAttribute("aria-expanded") === "true";
      closeAll(trigger);
      trigger.setAttribute("aria-expanded", String(!open));
    });
  }
  document.addEventListener("click", () => closeAll());
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeAll();
  });
}

function reveal(el: HTMLElement) {
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

function counter(el: HTMLElement) {
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

function init() {
  for (const el of gsap.utils.toArray<HTMLElement>(".reveal")) reveal(el);
  for (const el of gsap.utils.toArray<HTMLElement>("[data-count]")) counter(el);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

/**
 * Early-access / contact form → lead capture.
 * The form posts to VITE_LEAD_ENDPOINT (the API's public `/public/leads` route),
 * which forwards the lead to ClickUp CRM server-side — the API token never
 * touches the client. When the env var is unset (e.g. a preview build), it falls
 * back to logging + an optimistic success state so the page stays usable.
 */
const form = document.getElementById("contactForm") as HTMLFormElement | null;
if (form) {
  const fields = document.getElementById("cfields");
  const ok = document.getElementById("cok");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const email = String(data.get("email") || "").trim();
    const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
    const missing = (["name", "email", "message"] as const).filter(
      (k) => !String(data.get(k) || "").trim(),
    );
    if (missing.length || !emailOk) {
      const badName = missing[0] ?? "email";
      const bad = form.querySelector<HTMLInputElement>(`[name="${badName}"]`);
      bad?.setCustomValidity(missing.length ? "Please fill this in" : "Enter a valid email");
      form.reportValidity();
      bad?.addEventListener("input", () => bad.setCustomValidity(""), { once: true });
      return;
    }
    const endpoint = import.meta.env.VITE_LEAD_ENDPOINT as string | undefined;
    try {
      if (endpoint) {
        await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(Object.fromEntries(data)),
        });
      } else {
        console.info(
          "[shoWMe] lead captured (set VITE_LEAD_ENDPOINT to forward to ClickUp):",
          Object.fromEntries(data),
        );
      }
    } catch (err) {
      console.error("[shoWMe] lead submit failed", err);
    }
    if (fields) fields.style.display = "none";
    if (ok) ok.style.display = "block";
    form.setAttribute("data-submitted", "true");
  });
}
