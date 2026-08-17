---
name: ui-testing
description: How to test UI in this repo — the layered strategy (DOM/computed-style assertions, deterministic canvas/animation keyframes, eyes-on frame review) and the hard-won determinism rules for this animation-heavy stack (Playwright + fake clock + GSAP/Lenis/canvas). Use whenever writing, debugging, or reviewing tests for the marketing site or web app, or when asked to test "what the eye sees" / how an animation looks.
---

# UI testing

Tooling: **Playwright** (`@playwright/test`), two projects — desktop Chrome + Pixel-5 — against the **production build** via `vite preview` (see `apps/marketing/playwright.config.ts`). Reference implementation: `apps/marketing/tests/` (`helpers/visual.ts`, `visual.spec.ts`, `animations.spec.ts`).

## Test the right thing the right way — three layers

Pick per target; do NOT pixel-diff everything.

1. **Correctness / appearance of static content → DOM + computed-style ASSERTIONS.**
   Colour, copy, structure, presence. Deterministic AND more precise than a pixel diff — it says *what* changed, not just *that* it did. Use `getComputedStyle(el).color`, `toContainText`, `innerText`, `toBeVisible`. This is the default. Example: assert the wordmark colour matches across pages (catches a one-page divergence) instead of screenshotting the header.

2. **Canvas / animation keyframes → deterministic frozen-frame snapshots.**
   For `<canvas>` scenes (hero, ecosystem galaxy) snapshot a FIXED frame (see determinism recipe). Loose pixel tolerance (~0.1 locally); pin the renderer (same CI container image) for tight diffs.

3. **Subjective motion quality ("does the globe spin nicely") → eyes-on, not pixels.**
   A pixel diff says *changed*, never *good*. Drive the page live with the **Playwright MCP** (or dump a strip of frames as PNGs) and actually look, judging against the spec. Never encode "looks nice" as a tolerance.

## Determinism recipe (canvas / animation frames)

`gotoFrozen()` in `helpers/visual.ts` bundles these; the reasons they're each needed (all learned the hard way):

- **Freeze a fake clock at a fixed instant.** `page.clock.install()` then `runFor(ms)` (NOT `pauseAt` — `pauseAt` blocks any later frame from painting and deadlocks a follow-up capture). Advancing a fixed amount then going idle holds one repeatable frame.
- **Seed `Math.random`** via `addInitScript` before navigation — the canvas scenes seed particle fields at load, the main source of run-to-run drift.
- **`animations:"disabled"` on the screenshot** — `page.clock` freezes JS/rAF/canvas time but NOT CSS animations (glows, button shimmer) which run on the compositor timeline. AND: the *first* `animations:"disabled"` screenshot is what performs that finalisation, so it differs from the settled state — take one **throwaway warm-up shot, then the real capture** (verified: shot #1 differs, #2+ are byte-identical).
- **Capture with `page.screenshot()` (viewport/clip), not `element.screenshot()` / `scrollIntoViewIfNeeded()`** — those run a "wait for stable" step that needs live rAF and deadlocks under the frozen clock. DOM-scroll with `el.scrollIntoView()` instead, then `page.screenshot()`.
- **Compare with `toMatchSnapshot(buffer)`, not `toHaveScreenshot()`** — the latter's live-rAF stability loop also deadlocks against the frozen clock.

## What does NOT work here (don't retry these)

- **Full-page / full-viewport pixel baselines.** `fullPage` resize re-fires Lenis + GSAP ScrollTrigger pin recalculation and never stabilises; viewport captures catch whatever animated neighbour (pinned scene, floating cards) is on screen. Even frozen + seeded + `animations:disabled`, section-sized captures carry ~3–5% per-launch subpixel drift. Use assertions (layer 1) for these sections' copy/colour, and keyframes (layer 2) for their canvases.
- **Scroll-pinned scenes as pixel baselines** (`#product` chaos, `#features` feature-scroll, `#ecosystem` galaxy container). Their DOM is built by IntersectionObserver + a scroll timeline a fake clock doesn't drive. Assert their copy via text; snapshot only the raw `<canvas>`.

## Cross-cutting gotchas

- **Cookie consent** overlays the bottom of every page — pre-seed `localStorage["showme.cookie-consent"]="granted"` in an init script (gotoFrozen does this).
- **Mobile has no desktop nav.** `nav#nav` is absent on some pages and hidden behind the mobile menu — use `.brand` for the wordmark; it's visible on every page + breakpoint.
- **Reveals** (GSAP scroll-triggered `translateY`/fade) won't settle if the clock is frozen-then-idle before the scroll triggers them — a ~20px content shift. Prefer asserting the settled DOM over pixel-capturing revealed regions.
- **Free port 4173 first** if a `vite preview` lingered: `lsof -ti:4173 | xargs kill -9`.

## Encoding open work as guardrails

Encode a not-yet-done requirement (e.g. a Ran fix-list item) as an assertion of the DESIRED state, marked `test.fail()`. It reads red-as-expected → CI stays green; when the fix ships the assertion passes, `test.fail` flips it RED ("expected to fail but passed") — the signal to delete the `test.fail()` line and keep a permanent guard. See the fix-list guardrails in `visual.spec.ts`.

## Commands

```bash
pnpm --filter @showme/marketing test                 # run all UI tests
pnpm --filter @showme/marketing test -- visual.spec.ts   # one spec
pnpm --filter @showme/marketing test -- --update-snapshots   # re-bless baselines (only after an intended visual change)
```

Baselines live next to specs in `tests/<spec>.spec.ts-snapshots/` and are committed.
