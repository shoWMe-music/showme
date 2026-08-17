import { test } from "@playwright/test";
import { gotoFrozen, matchFrozen } from "./helpers/visual";

/**
 * LAYER 2 — animation keyframes.
 *
 * The canvas scenes run on requestAnimationFrame, so a raw screenshot is
 * non-deterministic. `gotoFrozen` installs a fake clock and advances virtual time
 * to a FIXED point, holding the same frame every run; we then snapshot just the
 * canvas element. Cross-GPU rasterisation varies slightly, so canvas shots carry a
 * looser tolerance than the layout baselines.
 *
 * Note on the chaos → order scene (fix-list #2): its panels are built by an
 * IntersectionObserver + scroll timeline that a fake clock doesn't drive, so it's
 * covered functionally in marketing.spec.ts ("chaos → order shows the real
 * event-manager panel") rather than by a pixel baseline here.
 */

// Canvas rasterisation varies per browser launch (sub-pixel AA, GPU), so keyframe
// diffs need a looser tolerance than DOM. For tight diffs, pin the renderer (run in
// the same container image in CI); locally this catches gross regressions only.
const CANVAS_TOLERANCE = 0.1;

test.describe("desktop only", () => {
  test.skip(({ isMobile }) => !!isMobile, "keyframe baselines captured at desktop width");

  test("hero scene: frame at t=2s", async ({ page }) => {
    await gotoFrozen(page, "/", 2000);
    await matchFrozen(page.locator("#hero-canvas"), "hero-t2000.png", {
      maxDiffPixelRatio: CANVAS_TOLERANCE,
    });
  });

  test("ecosystem galaxy: frame at t=2s", async ({ page }) => {
    await gotoFrozen(page, "/", 2000);
    await matchFrozen(page.locator("#orbit canvas#galaxy-canvas"), "galaxy-t2000.png", {
      maxDiffPixelRatio: CANVAS_TOLERANCE,
    });
  });
});
