/**
 * E2E test: Budget save flow
 *
 * Tests: navigate to budget → edit value → wait for debounced save →
 * reload page → verify data persisted.
 *
 * Requires: Firebase emulators running with seeded data (`npm run emulators`).
 */
import { test, expect } from "@playwright/test";
import { signIn, navigateAndWaitForApp } from "./helpers";

test.describe("Budget save", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "testvenueuser1@showme.music");
  });

  test("budget data persists after page reload", async ({ page }) => {
    // Navigate to events and open first event
    await navigateAndWaitForApp(page, "/events");

    const eventLink = page.locator("a[href*='/events/']").first();
    await expect(eventLink).toBeVisible({ timeout: 10_000 });
    await eventLink.click();
    await page.waitForURL("**/events/**", { timeout: 10_000 });

    // Click budget tab
    const budgetTab = page.locator("button, [role=tab]", { hasText: /budget/i });
    await expect(budgetTab).toBeVisible({ timeout: 10_000 });
    await budgetTab.click();

    // Wait for budget content to load
    await page.waitForTimeout(2_000);

    // Find any editable number input in the budget
    const numberInputs = page.locator("input[type='number'], input[inputmode='numeric']");
    const inputCount = await numberInputs.count();

    if (inputCount > 0) {
      const input = numberInputs.first();
      await input.click();
      await input.fill("");

      // Enter a unique test value
      const testValue = "7777";
      await input.fill(testValue);

      // Tab out to trigger blur/change
      await input.press("Tab");

      // Wait for debounced save (2s debounce + network)
      await page.waitForTimeout(3_500);

      // Reload the page
      await page.reload();

      // Navigate back to budget tab
      const budgetTabAfterReload = page.locator("button, [role=tab]", {
        hasText: /budget/i,
      });
      await expect(budgetTabAfterReload).toBeVisible({ timeout: 10_000 });
      await budgetTabAfterReload.click();

      // Wait for data to load
      await page.waitForTimeout(2_000);

      // Verify the value persisted
      const inputAfterReload = numberInputs.first();
      const value = await inputAfterReload.inputValue();
      expect(value).toBe(testValue);
    }
  });

  test("budget tab renders without errors", async ({ page }) => {
    await navigateAndWaitForApp(page, "/events");

    const eventLink = page.locator("a[href*='/events/']").first();
    await expect(eventLink).toBeVisible({ timeout: 10_000 });
    await eventLink.click();
    await page.waitForURL("**/events/**", { timeout: 10_000 });

    const budgetTab = page.locator("button, [role=tab]", { hasText: /budget/i });
    await expect(budgetTab).toBeVisible({ timeout: 10_000 });
    await budgetTab.click();

    // Should not show any error messages
    await page.waitForTimeout(2_000);
    const errorElements = page.locator("[role=alert], .error, .toast-error");
    const errorCount = await errorElements.count();
    expect(errorCount).toBe(0);

    // Should show some budget content (headings, inputs, or empty state)
    const content = await page.locator("main, [role=main], [data-testid='budget-content']").first().textContent();
    expect(content?.length).toBeGreaterThan(0);
  });
});
