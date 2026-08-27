import { expect, test } from "@playwright/test";
import { authFile } from "./support/accounts";

/**
 * What "not responsive" actually means, measured rather than argued about.
 *
 * Two assertions carry almost all of it, and both are objective:
 *
 *   1. **The page must not scroll sideways.** `scrollWidth <= clientWidth` at
 *      390px (an iPhone 14/15 in portrait, the narrowest device worth caring
 *      about). A page that scrolls horizontally is the single most legible
 *      symptom of a desktop layout that was never given a narrow rule — one
 *      fixed width, one min-width, one un-wrapping grid, and the whole screen
 *      slides under the reader's thumb.
 *
 *   2. **You must be able to get somewhere else.** Below 860px (`app.css`) the
 *      sidebar leaves the layout and becomes an off-canvas drawer, so the test
 *      drives the whole journey — open the menu, pick a destination, land on it
 *      — with the pointer and again with the keyboard alone. It used to be
 *      `display: none` with nothing in its place, which is not a polish problem;
 *      it is the app not working.
 *
 * Tap targets are reported, not asserted. The 44px floor is Apple's guideline
 * rather than a law, and this app is full of deliberate 26–28px icon buttons —
 * so the count is a work list, not a pass/fail. Failing the build on it would
 * turn a judgement into an obstacle.
 *
 * Run: `pnpm --filter @showme/web exec playwright test mobile-audit`
 */

const PHONE = { width: 390, height: 844 };

/** Every screen the operator's sidebar can reach, plus the two deep ones. */
const SCREENS: ReadonlyArray<{ readonly path: string; readonly name: string }> = [
  { path: "/", name: "Dashboard" },
  { path: "/calendar", name: "Calendar" },
  { path: "/events", name: "Events" },
  { path: "/tasks", name: "Tasks" },
  { path: "/reports", name: "Setlists" },
  { path: "/settlements", name: "Settlements" },
  { path: "/projections", name: "Financial Projections" },
  { path: "/requests", name: "Requests" },
  { path: "/invoices", name: "Bills & Invoices" },
  { path: "/team", name: "Team" },
  { path: "/contacts", name: "Contacts" },
  { path: "/audience", name: "Audience" },
  { path: "/profiles", name: "My Profiles" },
  { path: "/settings", name: "Settings" },
  { path: "/events/e2e00000-0000-4000-8000-0000000000e1", name: "Event workspace" },
  { path: "/events/e2e00000-0000-4000-8000-0000000000e2/settlement", name: "Settlement workspace" },
];

test.use({ storageState: authFile("operator"), viewport: PHONE });

test.describe("mobile audit at 390px", () => {
  for (const screen of SCREENS) {
    test(`${screen.name} does not scroll sideways`, async ({ page }) => {
      await page.goto(screen.path);
      // The shell is up once the top bar exists. Deliberately not
      // `networkidle`: the SSE stream keeps a request in flight forever.
      await page.locator("main").first().waitFor({ timeout: 30_000 });
      // Let one paint settle so a grid that reflows is measured after it does.
      await page.waitForTimeout(400);

      const overflow = await page.evaluate(() => {
        const el = document.documentElement;
        const widest = [...document.querySelectorAll<HTMLElement>("body *")]
          .filter((node) => node.getBoundingClientRect().right > el.clientWidth + 1)
          .slice(0, 5)
          .map((node) => {
            const rect = node.getBoundingClientRect();
            return {
              tag: node.tagName.toLowerCase(),
              className: typeof node.className === "string" ? node.className.slice(0, 60) : "",
              right: Math.round(rect.right),
              text: (node.textContent ?? "").trim().slice(0, 40),
            };
          });
        return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, widest };
      });

      expect(
        overflow.scrollWidth,
        `${screen.name} overflows by ${overflow.scrollWidth - overflow.clientWidth}px. ` +
          `Widest offenders: ${JSON.stringify(overflow.widest, null, 2)}`,
      ).toBeLessThanOrEqual(overflow.clientWidth);
    });
  }

  test("a phone can navigate somewhere other than where it landed", async ({ page }) => {
    await page.goto("/");
    await page.locator("main").first().waitFor({ timeout: 30_000 });

    // The sidebar is off-canvas at this width, so the whole question is whether
    // something brings it back. Asking only "is a nav control in the DOM" is not
    // enough — an off-canvas panel still has a bounding box — so this drives the
    // real journey: open the menu, pick a destination, land on it.
    await page.getByTestId("menu-toggle").click();

    const drawer = page.locator("#app-navigation");
    await expect(
      drawer,
      "The navigation drawer did not open. Below 860px the sidebar leaves the " +
        "layout (app.css), so the menu trigger is the only way back to it.",
    ).toBeVisible();

    await drawer.getByRole("button", { name: "Events", exact: true }).click();
    await expect(page).toHaveURL(/\/events$/);
    // Arriving closes the menu: a drawer left over the screen you just asked for
    // is the classic way a mobile menu feels broken.
    await expect(drawer).toBeHidden();
  });

  test("the drawer opens, closes and gives focus back, keyboard only", async ({ page }) => {
    await page.goto("/");
    await page.locator("main").first().waitFor({ timeout: 30_000 });

    const trigger = page.getByTestId("menu-toggle");
    await trigger.focus();
    await page.keyboard.press("Enter");

    const drawer = page.locator("#app-navigation");
    await expect(drawer).toBeVisible();
    expect(
      await drawer.evaluate((node) => node.contains(document.activeElement)),
      "Opening the drawer must move focus into it, or a keyboard has to tab " +
        "through the whole page to reach the menu it just opened.",
    ).toBe(true);

    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(
      trigger,
      "Closing the drawer must hand focus back to the button that opened it.",
    ).toBeFocused();
  });

  test("reports tap targets below 44px (informational, never fails)", async ({ page }) => {
    const rows: string[] = [];
    for (const screen of SCREENS) {
      await page.goto(screen.path);
      await page.locator("main").first().waitFor({ timeout: 30_000 });
      const small = await page.evaluate(() => {
        return [...document.querySelectorAll<HTMLElement>("button, a[href], [role='tab']")]
          .map((node) => node.getBoundingClientRect())
          .filter((rect) => rect.width > 0 && rect.height > 0)
          .filter((rect) => rect.height < 44 || rect.width < 44).length;
      });
      rows.push(`${screen.name}: ${small}`);
    }
    // eslint-disable-next-line no-console
    console.log(`\nTap targets under 44px per screen:\n  ${rows.join("\n  ")}\n`);
    expect(rows.length).toBe(SCREENS.length);
  });
});
