import { expect, test } from "@playwright/test";
import { authFile } from "./support/accounts";

/**
 * THE COST VOCABULARY ON THE BUDGET PLANNER, AND THE COST-VS-DEDUCTION SIGNAL.
 *
 * Both come from ClickUp `86cbcn1ue`, and both exist because the same complaint
 * has now been answered four times:
 *
 *   "Born by" → "Carries it" → "Borne by" → "To be deducted from"
 *
 * Every round was somebody reading a written note and picking words. This spec is
 * the thing that was missing each time — the caption is asserted, so the fifth
 * rename has to be a decision rather than an accident. `apps/web` has no unit-test
 * runner (ClickUp `86cbazcf3`), so a rendered assertion is the only kind available
 * here, and it is the better kind anyway: it fails on what the reader sees.
 *
 * The deduction badge is the other half of the same ticket: *"it's treating
 * everything as deductible. Some fields are just costs and some are deductible."*
 * The engine always kept the three cases apart; the sheet drew them identically.
 * So the assertion that matters is not "a badge exists" but **"a badge exists on
 * exactly the rows that have a bearer, and on no others"** — a badge on all six
 * rows would mark nothing, which is the state being fixed.
 */
test.use({ storageState: authFile("operator") });

const ALBUM_RELEASE = "e2e00000-0000-4000-8000-0000000000e1";

async function openBudgetPlanner(page: import("@playwright/test").Page) {
  await page.goto(`/events/${ALBUM_RELEASE}`);
  const tab = page.getByRole("tab", { name: /budget planner/i });
  await tab.waitFor();
  await tab.click();
  await expect(page.getByText("Costs", { exact: true }).first()).toBeVisible();
}

test("cost rows are captioned in the product owner's words", async ({ page }) => {
  await openBudgetPlanner(page);

  const captions = await page.evaluate(() =>
    [...document.querySelectorAll("main span")]
      .filter((span) => span.children.length === 0)
      .map((span) => span.textContent?.trim() ?? ""),
  );

  expect(captions).toContain("Paid by");
  expect(captions).toContain("To be deducted from");

  // The three wordings this caption has already worn. Any of them coming back is
  // a regression, not a preference — see the rename history in
  // `BudgetLineAttribution.tsx`.
  for (const retired of ["Borne by", "Born by", "Carries it", "Pays it"]) {
    expect(captions).not.toContain(retired);
  }
});

test("the caption is never squeezed or truncated, at phone width or desktop", async ({ page }) => {
  await openBudgetPlanner(page);

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    /*
     * SETTLE BEFORE MEASURING, and this wait is load-bearing rather than
     * superstition.
     *
     * Crossing the mobile breakpoint turns `.sidebar` from a static rail into a
     * `position: fixed` drawer that lives off-canvas at `translateX(-100%)`, on a
     * `--duration-slow` (280ms) transition (`app.css`). Measured immediately after
     * the resize, the drawer is momentarily a 300px fixed panel sitting at left: 0
     * — the page genuinely overflows, for about a quarter of a second, and then
     * does not.
     *
     * Probed directly before writing this: a fresh load at 390, and a
     * 390 → 1440 → 390 round trip, both settle at scrollWidth === clientWidth ===
     * 390 with the drawer parked at left: -300. So the transient is the animation,
     * not the layout.
     *
     * A fixed wait, deliberately, and NOT `waitForFunction` on the assertion
     * itself: polling until the page stops overflowing is a check that cannot
     * fail, which is the exact trap CLAUDE.md describes. 450ms clears the 280ms
     * transition with room, and if the page is still sideways after that, it is
     * sideways.
     */
    await page.waitForTimeout(450);
    const measured = await page.evaluate(() => {
      const caption = [...document.querySelectorAll("main span")].find(
        (span) => span.textContent?.trim() === "To be deducted from",
      );
      if (!caption) return null;
      const root = document.documentElement;
      return {
        truncated: caption.scrollWidth > caption.clientWidth,
        pageScrollsSideways: root.scrollWidth > root.clientWidth,
      };
    });

    expect(measured, `caption missing at ${width}px`).not.toBeNull();
    // `scrollWidth > clientWidth` is a weak check on its own (CLAUDE.md), so it is
    // paired with the page-level one: a label can also "fit" by shoving the page
    // sideways, and that is not fitting either.
    expect(measured?.truncated, `caption truncated at ${width}px`).toBe(false);
    expect(measured?.pageScrollsSideways, `page overflows at ${width}px`).toBe(false);
  }
});

test("only a row with a bearer is badged a Deduction", async ({ page }) => {
  await openBudgetPlanner(page);

  const bearers = page.locator('[aria-label^="To be deducted from"]');
  const rowCount = await bearers.count();
  expect(rowCount).toBeGreaterThan(1); // otherwise "exactly one" proves nothing

  const badge = page.locator("main span", { hasText: /^Deduction$/ });

  // Seeded state: every cost is the event's own, so NOTHING is badged. This is
  // the half that would silently pass if the badge rendered unconditionally.
  await expect(badge).toHaveCount(0);

  // Give one row a bearer, and only that row gains the badge.
  await bearers.last().click();
  await page.getByRole("option", { name: /Marlo Vance/ }).click();

  await expect(badge).toHaveCount(1);
  await expect(badge.first()).toHaveAttribute("title", /Deducted from Marlo Vance/);

  // And hand it back: the badge goes away again, so it is tracking the value
  // rather than the fact that the menu was opened once.
  await bearers.last().click();
  await page.getByRole("option", { name: /^The event/ }).click();
  await expect(badge).toHaveCount(0);
});

/**
 * Bar and merch are two rows with two collectors — ClickUp `86cbcn1ue`: *"Bar and
 * merchandise can not be together."*
 *
 * Asserted on the SCREEN rather than in the database because the reason they were
 * split is a screen fact: one revenue line carries one `collected_by`, so the
 * combined row physically could not say that the venue keeps the bar and the
 * performer keeps the merch.
 */
test("bar and merch are separate rows, each with its own collector", async ({ page }) => {
  await openBudgetPlanner(page);

  await expect(page.getByText("Average bar spend per guest")).toBeVisible();
  await expect(page.getByText("Average merch spend per guest")).toBeVisible();
  await expect(page.getByText("Bar and merchandise")).toHaveCount(0);

  await expect(page.locator('[aria-label="Collected by, for bar revenue"]')).toBeVisible();
  await expect(page.locator('[aria-label="Collected by, for merch revenue"]')).toBeVisible();
});
