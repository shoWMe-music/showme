import { type Locator, type Page, expect } from "@playwright/test";

/**
 * Visual-testing helpers for the marketing site.
 *
 * The site resists naive screenshots: canvas + requestAnimationFrame scenes (hero,
 * ecosystem galaxy, chaos-order) never stop moving, and Lenis + GSAP ScrollTrigger
 * reflow the page. The fix is one idea used everywhere here:
 *
 *   Freeze a fake clock at a FIXED instant (gotoFrozen), so every rAF-driven scene
 *   holds the same frame every run, then take a ONE-SHOT capture (matchFrozen) and
 *   pixel-diff it against a committed baseline. We deliberately avoid
 *   `toHaveScreenshot`, whose live-rAF stability loop deadlocks against the frozen
 *   clock — a single screenshot() has no such loop.
 *
 * Layer 1 (visual.spec.ts) captures static section ELEMENTS — snapshotting the
 * element, not the viewport, keeps animated neighbours (a pinned scene bleeding in,
 * floating cards) out of frame. Layer 2 (animations.spec.ts) captures the canvas
 * elements at fixed keyframes.
 */

/** The animated canvases. */
export const CANVAS_SELECTORS = [
  "#hero-canvas",
  "#orbit canvas#galaxy-canvas",
  "#chaos-stage canvas",
  "#feat-stage canvas",
] as const;

/** Locators for every canvas — mask these if a captured element overlaps one. */
export function canvasMasks(page: Page): Locator[] {
  return CANVAS_SELECTORS.map((selector) => page.locator(selector));
}

/**
 * Navigate with a fake clock, then advance animation time to a FIXED point so
 * rAF-driven canvas scenes render a deterministic frame and then hold still.
 * Must install BEFORE navigation. `runFor` (not `pauseAt`) leaves the clock idle
 * afterwards, so rAF stops and the scene is a still frame for the capture. Also
 * pre-dismisses the cookie banner so it never overlays a snapshot.
 */
export async function gotoFrozen(page: Page, path: string, atMs = 2000): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("showme.cookie-consent", "granted");
    } catch {}
    // Seed Math.random so canvas particle fields (hero, galaxy) are identical every
    // run — the scenes seed positions at load, which is otherwise the main source of
    // run-to-run pixel drift. A tiny LCG is enough; the values just need to repeat.
    let seed = 0x2f6e2b1;
    Math.random = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
  });
  await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
  await page.goto(path, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.clock.runFor(atMs);
}

/** Advance virtual time (e.g. to let a toggle's tween finish), then hold still. */
export async function advance(page: Page, ms: number): Promise<void> {
  await page.clock.runFor(ms);
}

/**
 * One-shot capture of an element under the frozen clock, pixel-diffed against a
 * committed baseline. Works for a canvas (Layer 2) or a static section (Layer 1) —
 * the element's own box excludes animated neighbours. `mask` overpaints any canvas
 * that overlaps the element (e.g. hero copy sitting over #hero-canvas).
 *
 * We DOM-scroll the section to the top of the viewport and capture the VIEWPORT via
 * `page.screenshot()` — not `element.screenshot()`, whose scroll + "wait for stable"
 * step needs live rAF and deadlocks against the frozen clock.
 *
 * Determinism comes from three things together:
 *   · the frozen clock (gotoFrozen) freezes JS/rAF/canvas time;
 *   · seeded Math.random (gotoFrozen) fixes canvas particle fields;
 *   · `animations:"disabled"` finalises CSS animations — which the fake clock does
 *     NOT touch (they run on the compositor timeline). Crucially the FIRST such
 *     screenshot is what performs that finalisation, so it differs from the settled
 *     state; we take one throwaway shot, then the real one (verified: shot #1 differs,
 *     #2 onward are byte-identical).
 */
export async function matchFrozen(
  target: Locator,
  name: string,
  opts: { maxDiffPixelRatio?: number; mask?: Locator[] } = {},
): Promise<void> {
  const { maxDiffPixelRatio = 0.02, mask = [] } = opts;
  const page = target.page();
  await target.evaluate((el) => el.scrollIntoView({ block: "start" }));
  // Warm-up shot: this is the call that finalises CSS animations; discard it.
  await page.screenshot({ animations: "disabled" });
  const buffer = await page.screenshot({
    caret: "hide",
    animations: "disabled",
    mask,
    maskColor: "#FF00FF",
  });
  expect(buffer).toMatchSnapshot(name, { maxDiffPixelRatio });
}
