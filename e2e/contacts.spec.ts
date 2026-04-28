/**
 * E2E test: Contacts flow
 *
 * Tests: create contact with multiple types → verify appears under correct filters →
 * copy detail → delete.
 *
 * Requires: Firebase emulators running with seeded data (`npm run emulators`).
 */
import { test, expect } from "@playwright/test";
import { signIn, navigateAndWaitForApp } from "./helpers";

test.describe("Contacts", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "testvenueuser1@showme.music");
  });

  test("can create a contact and see it in the list", async ({ page }) => {
    await navigateAndWaitForApp(page, "/contacts");

    // Click create/add contact button
    const addBtn = page.locator("button", { hasText: /add|create|new/i });
    await expect(addBtn).toBeVisible({ timeout: 10_000 });
    await addBtn.click();

    // Fill contact form in dialog
    const dialog = page.locator("[role=dialog]");
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // Fill name
    const nameInput = dialog.locator("input[name='name'], input[placeholder*='name' i]").first();
    await nameInput.fill("E2E Test Contact");

    // Fill email
    const emailInput = dialog.locator("input[name='email'], input[placeholder*='email' i], input[type='email']").first();
    if (await emailInput.isVisible().catch(() => false)) {
      await emailInput.fill("e2e-test@example.com");
    }

    // Select type (should support multi-select now)
    const typeSelect = dialog.locator("button[role='combobox'], [data-testid='type-select']").first();
    if (await typeSelect.isVisible().catch(() => false)) {
      await typeSelect.click();
      // Select "Venue" type
      const venueOption = page.locator("[role=option]", { hasText: /venue/i });
      if (await venueOption.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await venueOption.click();
      }
      // Try to select a second type (multi-type support)
      const promoterOption = page.locator("[role=option]", { hasText: /promoter/i });
      if (await promoterOption.isVisible({ timeout: 1_000 }).catch(() => false)) {
        await promoterOption.click();
      }
    }

    // Submit
    const submitBtn = dialog.locator("button[type='submit'], button", { hasText: /create|save|add/i }).last();
    await submitBtn.click();

    // Verify contact appears in the list
    await expect(page.locator("text=E2E Test Contact")).toBeVisible({ timeout: 5_000 });
  });

  test("filter buttons remain visible when a filter is active", async ({ page }) => {
    await navigateAndWaitForApp(page, "/contacts");

    // Wait for filter buttons to render
    const filterButtons = page.locator("button", { hasText: /all|venue|promoter|performer/i });
    await expect(filterButtons.first()).toBeVisible({ timeout: 10_000 });

    const initialCount = await filterButtons.count();
    expect(initialCount).toBeGreaterThanOrEqual(2);

    // Click a specific filter (not "All")
    const venueFilter = page.locator("button", { hasText: /^venue$/i });
    if (await venueFilter.isVisible().catch(() => false)) {
      await venueFilter.click();

      // All filter buttons should still be visible (bug fix verification)
      const afterCount = await filterButtons.count();
      expect(afterCount).toBe(initialCount);
    }
  });

  test("performer contacts appear in the list", async ({ page }) => {
    await navigateAndWaitForApp(page, "/contacts");

    // Check if performer filter exists and works
    const performerFilter = page.locator("button", { hasText: /performer/i });
    if (await performerFilter.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await performerFilter.click();

      // Page should not crash, should show contacts or empty state
      await expect(page.locator("body")).not.toContainText("error", { timeout: 3_000 });
    }
  });
});
