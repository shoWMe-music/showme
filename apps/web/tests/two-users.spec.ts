import { expect, test } from "@playwright/test";
import { openAs } from "./support/e2e";

/**
 * Two users interacting in a single test — the capability this whole harness
 * exists to unlock. Each account gets its own browser context (its own session),
 * open at the same time, so we can assert on what BOTH see of the same shared
 * entity from their respective vantage points.
 *
 * The seed puts the operator (host) and performerA (headliner) on the same
 * confirmed event; the operator sees the event it hosts, and the performer sees
 * the same event it was booked on.
 */
test("operator and performer both see the event they share", async ({ browser }) => {
  const operator = await openAs(browser, "operator");
  const performer = await openAs(browser, "performerA");

  try {
    await operator.page
      .getByRole("button", { name: /Events/i })
      .first()
      .click();
    await expect(operator.page.getByText("Marlo Vance — Album Release")).toBeVisible();

    await performer.page
      .getByRole("button", { name: /Events/i })
      .first()
      .click();
    await expect(performer.page.getByText("Marlo Vance — Album Release")).toBeVisible();
  } finally {
    await operator.context.close();
    await performer.context.close();
  }
});
