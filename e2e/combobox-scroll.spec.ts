import { test, expect } from "@playwright/test";

test.describe("Combobox dropdown scroll", () => {
  test("pagination: shows 5 items then loads more on click", async ({ page }) => {
    await page.goto("/fixture.html");
    await page.waitForSelector("[data-testid=open-dialog]", { timeout: 10_000 });
    await page.click("[data-testid=open-dialog]");
    await page.waitForSelector("[role=dialog]");

    const input = page.locator("[role=dialog] input[placeholder*='Search']");
    await input.click();

    const popover = page.locator("[data-radix-popper-content-wrapper] [data-side]");
    await expect(popover).toBeVisible({ timeout: 3_000 });

    const options = popover.locator("[role=option]");
    expect(await options.count()).toBe(5);
    await expect(popover.locator("button", { hasText: /show.*more/i })).toBeVisible();
  });

  test("scroll works after loading all items", async ({ page }) => {
    await page.goto("/fixture.html");
    await page.waitForSelector("[data-testid=open-dialog]", { timeout: 10_000 });
    await page.click("[data-testid=open-dialog]");
    await page.waitForSelector("[role=dialog]");

    const input = page.locator("[role=dialog] input[placeholder*='Search']");
    await input.click();

    const popover = page.locator("[data-radix-popper-content-wrapper] [data-side]");
    await expect(popover).toBeVisible({ timeout: 3_000 });

    while (await popover.locator("button", { hasText: /show.*more/i }).isVisible()) {
      await popover.locator("button", { hasText: /show.*more/i }).click();
    }

    const info = await popover.evaluate((el) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      overflowY: getComputedStyle(el).overflowY,
    }));
    expect(info.scrollHeight).toBeGreaterThan(info.clientHeight);

    await popover.evaluate((el) => { el.scrollTop = 0; });
    await popover.evaluate((el) => el.scrollBy(0, 100));
    const scrollTop = await popover.evaluate((el) => el.scrollTop);
    expect(scrollTop).toBeGreaterThan(0);
  });

  test("mouse wheel scrolls the dropdown", async ({ page }) => {
    await page.goto("/fixture.html");
    await page.waitForSelector("[data-testid=open-dialog]", { timeout: 10_000 });
    await page.click("[data-testid=open-dialog]");
    await page.waitForSelector("[role=dialog]");

    const input = page.locator("[role=dialog] input[placeholder*='Search']");
    await input.click();

    const popover = page.locator("[data-radix-popper-content-wrapper] [data-side]");
    await expect(popover).toBeVisible({ timeout: 3_000 });

    while (await popover.locator("button", { hasText: /show.*more/i }).isVisible()) {
      await popover.locator("button", { hasText: /show.*more/i }).click();
    }

    await popover.evaluate((el) => { el.scrollTop = 0; });

    const box = await popover.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.wheel(0, 150);
    await page.waitForTimeout(300);

    const scrollTop = await popover.evaluate((el) => el.scrollTop);
    expect(scrollTop).toBeGreaterThan(0);
  });
});
