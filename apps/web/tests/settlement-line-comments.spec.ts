import { expect, test } from "@playwright/test";
import { authFile } from "./support/accounts";

/**
 * A COMMENT CAN NAME THE FIGURE IT IS ABOUT.
 *
 * ClickUp `86cbcn1ue`: *"The option for collaborators to comment on a specific
 * field."* The settlement has always had a thread; what it could not do is point
 * at one row. `EventSettlement`'s own note records why that matters — answering a
 * settlement comment MEANS changing a figure — and a remark floating in a general
 * thread makes the reader hunt for which one it disputes.
 *
 * Serial, because both tests reconcile the same event and the second reads what
 * the first wrote.
 */
test.use({ storageState: authFile("operator") });
test.describe.configure({ mode: "serial" });

const ALBUM_RELEASE = "e2e00000-0000-4000-8000-0000000000e1";

async function openFinancials(page: import("@playwright/test").Page) {
  await page.goto(`/events/${ALBUM_RELEASE}/settlement`);
  await page.getByRole("tab", { name: "Financials" }).click();
  // The lines are the settlement's copy of the budget, taken on the first compute.
  const run = page.getByRole("button", { name: /the settlement$/ });
  await expect(run).toBeEnabled();
  await run.click();
  await expect(page.getByRole("button", { name: /^Recalculate the settlement$/ })).toBeVisible();
}

test("a remark can be attached to one line, and shows under that line", async ({ page }) => {
  await openFinancials(page);

  /*
   * Targeted by the control's OWN accessible name rather than by walking up from
   * the row's text. A `div` filter picks the deepest match, which is the label's
   * own wrapper and holds no button — the first version of this spec spent its
   * whole timeout waiting inside an element that could never contain what it
   * wanted. Naming the button after its row fixed the test and the screen reader
   * at once: "Comment on this figure", eight times down a column, is one label
   * eight times over to anybody not looking at the pointer.
   */
  await page.getByRole("button", { name: /^Comment on Advance ticket sales/ }).click();
  await page
    .getByRole("textbox", { name: /^Your comment on Advance ticket sales/ })
    .fill("Should be 168, not 260 — we did not sell out.");
  await page.getByRole("button", { name: "Post", exact: true }).click();

  await expect(page.getByText(/Should be 168, not 260/)).toBeVisible();

  // THE HALF THAT MAKES IT AN ANCHOR: the remark belongs to the line it is about,
  // and the others still offer an empty affordance rather than inheriting it.
  await expect(
    page.getByRole("button", { name: /^Comment on Walk-up ticket sales/ }),
  ).toBeVisible();
  // The commented line offers a reply instead — its thread has started.
  await expect(
    page.getByRole("button", { name: /^Reply about Advance ticket sales/ }),
  ).toBeVisible();
});

/**
 * ONE THREAD, TWO WAYS IN. A remark made against a figure is still part of the
 * settlement's conversation, so it has to appear in the tab that lists everything
 * said — otherwise the operator reading the Comments tab is quietly missing the
 * objections that were raised where the numbers are.
 */
test("a line remark is still part of the settlement's own thread", async ({ page }) => {
  await page.goto(`/events/${ALBUM_RELEASE}/settlement`);
  await page.getByRole("tab", { name: "Comments" }).click();
  await expect(page.getByText(/Should be 168, not 260/)).toBeVisible();
});
