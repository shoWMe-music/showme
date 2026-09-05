import { expect, test } from "@playwright/test";
import { authFile } from "./support/accounts";

/**
 * THE CURRENCY PEEK ON THE BUDGET PLANNER — ClickUp `123qy9rnjb8`.
 *
 * The ticket was filed as "the selector changes the label and not the number".
 * The truth was worse: the symbol it changed was the left icon on the money
 * INPUTS, so an operator could type a fee into a field marked € and have it
 * stored and settled in the event's own currency. A guarantee entered under the
 * wrong symbol is a wrong deal, not a wrong caption.
 *
 * The rule that replaced it, from Ran: **figures are always in the transaction
 * currency**, and a selector is for CHECKING what that comes to elsewhere. Three
 * things follow, and this spec exists because all three are invisible to a unit
 * test — they are facts about what is on the screen:
 *
 *   1. the event's own currency is on screen whether peeking or not;
 *   2. a peeked figure is marked as derived and CANNOT BE TYPED INTO, which is
 *      what makes the original bug structurally impossible rather than merely
 *      discouraged;
 *   3. one click returns everything, editable, to the real currency.
 *
 * Asserting only that "the numbers changed" would pass on the exact bug being
 * fixed, since relabelling changes the rendered text too.
 */
test.use({ storageState: authFile("operator") });

/** A seeded SEK event with budget figures on it. */
const ALBUM_RELEASE = "e2e00000-0000-4000-8000-0000000000e1";

/** Seeded in `seed-e2e.ts`; the peek is unreachable without a cached rate. */
const SEK_TO_EUR = 0.0863;

async function openBudgetPlanner(page: import("@playwright/test").Page) {
  await page.goto(`/events/${ALBUM_RELEASE}`);
  const tab = page.getByRole("tab", { name: /budget planner/i });
  await tab.waitFor();
  await tab.click();
  await expect(page.getByText("Costs", { exact: true }).first()).toBeVisible();
}

const peekSelect = (page: import("@playwright/test").Page) =>
  page.getByLabel("View these figures in another currency");

/**
 * One money field carrying a real figure — 9 000.00 SEK, seeded by
 * `referenceAlbumReleaseBudgetLines`. Chosen because it has NO `dealId`, so it
 * renders as an editable input rather than as a figure the deal owns; a
 * deal-owned row is already a readout and could not show the peek changing one.
 *
 * The first draft of this spec used the bar-spend field, which is empty on this
 * event — so two of the three tests below were asserting against "" and passing
 * on nothing. The `toBeGreaterThan(0)` guard is what caught it and is why it
 * stays.
 */
const moneyField = (page: import("@playwright/test").Page) =>
  page.getByLabel("Marketing & print amount");

test("the event's own currency is on screen before anyone touches the selector", async ({
  page,
}) => {
  await openBudgetPlanner(page);

  // Not "somewhere on the page": the control itself states it, next to the
  // choice, so the fact cannot be scrolled away from the thing that changes it.
  await expect(page.getByText("SEK", { exact: true }).first()).toBeVisible();
  await expect(peekSelect(page)).toBeVisible();

  // And nothing is being previewed yet, so no `≈` anywhere.
  await expect(page.getByText(/Showing ≈/)).toBeHidden();
});

test("peeking converts the figures and makes them not typeable", async ({ page }) => {
  await openBudgetPlanner(page);

  const field = moneyField(page);
  await expect(field).toBeVisible();
  // An <input> before the peek — this is the control the original bug relabelled.
  expect(await field.evaluate((node) => node.tagName)).toBe("INPUT");
  const typedValue = await field.inputValue();
  // The spec is meaningless on an empty budget: there would be no figure to
  // convert and "—" would pass every assertion below.
  expect(Number(typedValue), "seeded budget should carry a bar-spend figure").toBeGreaterThan(0);

  await peekSelect(page).click();
  await page.getByRole("option", { name: "EUR" }).click();

  // 1. The transaction currency is STILL on screen, and now says so explicitly.
  await expect(page.getByText(/the budget is in SEK/i)).toBeVisible();
  await expect(page.getByText(/Showing ≈ EUR/)).toBeVisible();

  // 2. The field is no longer an input at all. This is the assertion that would
  //    have failed on the shipped bug: relabelling left it typeable.
  const peeked = moneyField(page);
  expect(await peeked.evaluate((node) => node.tagName)).not.toBe("INPUT");

  // 3. It shows the CONVERTED figure, not the same number under a new symbol —
  //    the other half of what the ticket reported. Compared as a number, because
  //    the symbol, grouping and rounding are the formatter's business.
  const shown = (await peeked.textContent()) ?? "";
  const shownNumber = Number(shown.replace(/[^0-9.]/g, ""));
  const expected = Number(typedValue) * SEK_TO_EUR;
  // A ratio, not `toBeCloseTo`: the formatter rounds to whole units, and pinning
  // a rounding rule here would make this fail the next time the display changes
  // its mind about decimals. What is being tested is that a RATE was applied.
  expect(Math.abs(shownNumber - expected) / expected).toBeLessThan(0.01);
  // Explicitly NOT the original number wearing a euro sign — the reported bug.
  expect(shownNumber).not.toBe(Number(typedValue));
});

test("one click puts it back, editable, in the real currency", async ({ page }) => {
  await openBudgetPlanner(page);

  const before = await moneyField(page).inputValue();

  await peekSelect(page).click();
  await page.getByRole("option", { name: "EUR" }).click();
  await expect(page.getByText(/Showing ≈ EUR/)).toBeVisible();

  await page.getByRole("button", { name: "Back to SEK" }).click();

  await expect(page.getByText(/Showing ≈ EUR/)).toBeHidden();
  const restored = moneyField(page);
  expect(await restored.evaluate((node) => node.tagName)).toBe("INPUT");
  // The figure that comes back is the one that was there — a peek must not be
  // able to write through to the draft it was reading.
  expect(await restored.inputValue()).toBe(before);
});
