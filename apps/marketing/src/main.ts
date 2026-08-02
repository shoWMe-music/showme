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
import "./styles/tokens.css";
import "./styles/reveal.css";

gsap.registerPlugin(ScrollTrigger);

// Mark JS active so CSS can hide .reveal only when we can animate it back in.
document.documentElement.classList.add("js");

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Nav scrolled state
const nav = document.getElementById("nav");
if (nav) {
  const onScroll = () => nav.classList.toggle("scrolled", window.scrollY > 30);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
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
 * The form posts to VITE_LEAD_ENDPOINT when configured; the actual ClickUp CRM
 * wiring is server-side (a lead endpoint that creates a ClickUp task) and is a
 * deliberate stub here — no API keys in the client. Falls back to an optimistic
 * success state so the page is usable pre-integration.
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
        // TODO(clickup): POST leads to a server endpoint that creates a ClickUp task.
        console.info("[shoWMe] lead captured (set VITE_LEAD_ENDPOINT to forward):", Object.fromEntries(data));
      }
    } catch (err) {
      console.error("[shoWMe] lead submit failed", err);
    }
    if (fields) fields.style.display = "none";
    if (ok) ok.style.display = "block";
    form.setAttribute("data-submitted", "true");
  });
}
