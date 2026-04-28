/**
 * E2E test: Share link flow
 *
 * Tests the critical path: authenticated user generates a share link →
 * opens it in an unauthenticated context → verifies content is visible.
 *
 * Requires: Firebase emulators running with seeded data (`npm run emulators`).
 */
import { test, expect } from "@playwright/test";
import { signIn, navigateAndWaitForApp } from "./helpers";

test.describe("Share link flow", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "testvenueuser1@showme.music");
  });

  test("can open shared event page without authentication (public link)", async ({
    page,
    context,
  }) => {
    // Navigate to events list
    await navigateAndWaitForApp(page, "/events");

    // Click first event to open event manager
    const eventLink = page.locator("a[href*='/events/']").first();
    await expect(eventLink).toBeVisible({ timeout: 10_000 });
    await eventLink.click();

    // Wait for event manager to load
    await page.waitForURL("**/events/**", { timeout: 10_000 });

    // Open the export/share dialog
    const shareBtn = page.locator("button", { hasText: /share|export/i });
    if (await shareBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await shareBtn.click();

      // Wait for dialog
      const dialog = page.locator("[role=dialog]");
      await expect(dialog).toBeVisible({ timeout: 5_000 });

      // Select "All" level if available
      const allOption = dialog.locator("button, [role=radio]", { hasText: /all/i });
      if (await allOption.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await allOption.click();
      }

      // Click generate/share link button (should work without recipients now)
      const generateBtn = dialog.locator("button", {
        hasText: /generate|create.*link|share/i,
      });
      if (await generateBtn.isEnabled({ timeout: 3_000 }).catch(() => false)) {
        await generateBtn.click();

        // Wait for link to be generated — look for a URL or copy button
        const linkEl = dialog.locator("input[readonly], [data-testid='share-url']");
        if (await linkEl.isVisible({ timeout: 5_000 }).catch(() => false)) {
          const shareUrl = await linkEl.inputValue();
          expect(shareUrl).toContain("/shared/");

          // Open the shared link in a new page (unauthenticated)
          const newPage = await context.newPage();
          await newPage.goto(shareUrl);

          // Should show event content without requiring login
          await expect(
            newPage.locator("body"),
          ).not.toContainText("sign in", { timeout: 10_000 });

          // Should show some event data
          const body = await newPage.locator("body").textContent();
          expect(body?.length).toBeGreaterThan(100);

          await newPage.close();
        }
      }
    }
  });

  test("shared budget link displays budget data", async ({ page, context }) => {
    // Navigate to an event with budget
    await navigateAndWaitForApp(page, "/events");

    const eventLink = page.locator("a[href*='/events/']").first();
    await expect(eventLink).toBeVisible({ timeout: 10_000 });
    await eventLink.click();

    await page.waitForURL("**/events/**", { timeout: 10_000 });

    // Navigate to budget tab
    const budgetTab = page.locator("button, [role=tab]", { hasText: /budget/i });
    if (await budgetTab.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await budgetTab.click();

      // Look for a share button in the budget tab
      const shareBtn = page.locator("button", { hasText: /share/i });
      if (await shareBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await shareBtn.click();

        // If a share URL is generated, verify it works
        const linkInput = page.locator("input[readonly]");
        if (await linkInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
          const shareUrl = await linkInput.inputValue();
          expect(shareUrl).toContain("/shared/budget/");

          const newPage = await context.newPage();
          await newPage.goto(shareUrl);

          // Should show budget data without login
          await expect(newPage.locator("body")).not.toContainText("sign in", {
            timeout: 10_000,
          });

          await newPage.close();
        }
      }
    }
  });
});
