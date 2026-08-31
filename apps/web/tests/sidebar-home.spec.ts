import { expect, test } from "@playwright/test";
import { authFile } from "./support/accounts";

/**
 * Which sidebar destination lights up for a given screen.
 *
 * The rail marks the active item with `aria-current="page"` (SidebarItem), so
 * this reads the accessibility tree rather than a CSS class — the marker is a
 * promise to a screen reader before it is a gradient.
 *
 * The case that made this worth a spec: the settlement workspace lives at
 * `/events/:id/settlement`, so the prefix rule claimed it for Events while the
 * top bar already called it "Money · Settlement". The chrome contradicted
 * itself. Reported by Ran, 2026-08-31.
 */
const EVENT_ID = "e2e00000-0000-4000-8000-0000000000e2";

test.use({ storageState: authFile("operator") });

async function activeNavLabel(page: import("@playwright/test").Page): Promise<string> {
  const current = page.locator('#app-navigation [aria-current="page"]');
  await current.first().waitFor({ timeout: 15_000 });
  // More than one would mean two destinations both claim the screen, which is
  // the same class of bug from the other direction.
  expect(await current.count(), "exactly one sidebar item may be current").toBe(1);
  return ((await current.first().textContent()) ?? "").trim();
}

test("the settlement workspace lights up Settlements, not Events", async ({ page }) => {
  await page.goto(`/events/${EVENT_ID}/settlement`);
  await page.locator("main").first().waitFor({ timeout: 30_000 });
  expect(await activeNavLabel(page)).toContain("Settlements");
});

test("the event workspace still lights up Events", async ({ page }) => {
  await page.goto(`/events/${EVENT_ID}`);
  await page.locator("main").first().waitFor({ timeout: 30_000 });
  // The positive control: the deep-route override must not have stolen the
  // ordinary case it sits next to.
  expect(await activeNavLabel(page)).toContain("Events");
});

test("the events list still lights up Events", async ({ page }) => {
  await page.goto("/events");
  await page.locator("main").first().waitFor({ timeout: 30_000 });
  expect(await activeNavLabel(page)).toContain("Events");
});
