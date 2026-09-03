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

/**
 * A DEDUCTION STATED AS A SHARE OF ANOTHER ROW — ClickUp `86cbcn1ue`: *"there
 * should be the option to create deductible with either fixed amount or a
 * percentage from X. As it was in V2."*
 *
 * The interesting assertion is the last one, and it is the one that caught a real
 * bug. Raising the base updates the derived figure on screen INSTANTLY, because
 * the value is computed rather than stored — so the screen is a witness that
 * cannot testify about whether anything was saved. The first version of this
 * feature displayed the new figure while leaving the old one in Postgres, and the
 * only place that would ever have surfaced is the settlement, which copies
 * `amount` months later when it is real money.
 *
 * So the write itself is watched, on the wire. A screen assertion here would pass
 * over exactly the defect this is for.
 */
test("a percentage deduction follows its base, on screen and in what gets saved", async ({
  page,
}) => {
  const saved: string[] = [];
  /** Writes the planner has actually COMPLETED, so the test can wait for them. */
  let settledWrites = 0;
  page.on("request", (request) => {
    if (request.method() === "PATCH" && /\/budgets\/.+\/lines\//.test(request.url())) {
      saved.push(request.postData() ?? "");
    }
  });
  page.on("response", (response) => {
    const isLineWrite =
      /\/budgets\/.+\/lines/.test(response.url()) &&
      ["POST", "PATCH"].includes(response.request().method());
    if (isLineWrite && response.ok()) settledWrites += 1;
  });

  await openBudgetPlanner(page);

  // A base worth taking a share of: 25 a head across the seeded 400 = 10 000.
  const merch = page.locator('[aria-label="Average merch spend per guest"]');
  await merch.fill("25");
  await expect(page.getByText("Merch revenue").locator("..")).toContainText("10,000");

  await page.getByRole("button", { name: "Add field" }).last().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByText("A deduction").click();
  await dialog.getByText("A percentage of…").click();

  await dialog.locator("input").first().fill("Venue's cut of merch");
  await dialog.locator('[aria-label="Percentage"]').fill("10");
  await dialog.locator('[aria-label="The party this deduction comes out of"]').click();
  await page.getByRole("option", { name: /Marlo Vance/ }).click();
  await dialog.locator('[aria-label="The row this percentage is taken of"]').click();
  await page.getByRole("option", { name: "Merchandise" }).click();
  await dialog.getByRole("button", { name: "Add deduction" }).click();

  const row = page
    .locator("main div")
    .filter({ hasText: /^Venue's cut of merch/ })
    .first();
  await expect(row).toContainText("1,000"); // 10% of 10 000
  await expect(row).toContainText("Deduction");
  // The rule is named on the row, so the figure is checkable rather than magic.
  await expect(page.getByText("10% of Merchandise, kept in step with it.")).toBeVisible();

  // Computed, therefore not typeable: an editable box over a derived figure would
  // invite typing that the next recompute throws away.
  await expect(row.locator("input")).toHaveCount(0);

  /*
   * RELOAD BEFORE MOVING THE BASE, and the reason is the bug's actual shape.
   *
   * A row that has only just been added is still a pending create — it has no
   * server id yet, so "has the stored figure drifted?" has nothing to compare
   * against, and the create writes the computed figure correctly anyway. The
   * defect lives one step later: a row that IS saved, whose base then moves.
   * Reloading puts the test in that state instead of the easy one.
   *
   * It also proves the rule itself survived the round trip: the figure below is
   * recomputed from `details`, so a rule that failed to store would come back as
   * a plain amount with no note under it.
   */
  /*
   * The planner saves on a 700ms debounce, so a reload fired straight after the
   * click races the write it is supposed to be checking — and loses, silently,
   * as an empty page rather than as a failed assertion. Waiting on the RESPONSES
   * rather than on a timeout means this stays correct if the debounce changes.
   *
   * Two writes are owed by this point: the merch figure, and the deduction.
   */
  await expect
    .poll(() => settledWrites, { timeout: 10_000, message: "planner writes settled" })
    .toBeGreaterThanOrEqual(2);

  await page.reload();
  await page.getByRole("tab", { name: /budget planner/i }).click();
  const reloaded = page
    .locator("main div")
    .filter({ hasText: /^Venue's cut of merch/ })
    .first();
  await expect(reloaded).toContainText("1,000");
  await expect(page.getByText("10% of Merchandise, kept in step with it.")).toBeVisible();

  saved.length = 0;

  // Move the base. 50 a head across 400 = 20 000, so the cut is 2 000.
  await page.locator('[aria-label="Average merch spend per guest"]').fill("50");
  await expect(reloaded).toContainText("2,000");

  // AND it must reach the server. Without this the test passes on a stale write.
  await expect
    .poll(() => saved.some((body) => body.includes('"amount":"200000"')), {
      timeout: 5_000,
      message: "the derived deduction was re-saved after its base moved",
    })
    .toBe(true);
});
