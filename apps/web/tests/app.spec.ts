import { expect, test, type Page } from "@playwright/test";

function trackErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource/i.test(m.text())) {
      errors.push(`console: ${m.text()}`);
    }
  });
  page.on("response", (r) => {
    if (r.status() >= 400 && r.url().startsWith("http://localhost:4174")) {
      errors.push(`http ${r.status()}: ${r.url()}`);
    }
  });
  return errors;
}

test("shell: dashboard renders with sidebar + stats, no errors", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto("/", { waitUntil: "networkidle" });

  await expect(page.locator(".sidebar")).toBeVisible();
  await expect(page.locator(".sidebar__brand")).toContainText("shoWMe");
  await expect(page.getByTestId("crumb")).toContainText("Dashboard");

  // KPI tiles from the design-system StatCard
  await expect(page.getByText("Confirmed events")).toBeVisible();
  await expect(page.getByText("Guarantees committed")).toBeVisible();

  // warm dark ground applied from shared tokens (not an unstyled page)
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe("rgb(10, 6, 4)"); // --ink-1000

  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("nav: sidebar → Events, row → Event detail", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });

  await page.locator(".sidebar__nav").getByText("Events", { exact: true }).click();
  await expect(page).toHaveURL(/\/events$/);
  await expect(page.getByText("New event")).toBeVisible();

  // open an event
  await page.getByText("Marlo Vance").first().click();
  await expect(page).toHaveURL(/\/events\/EVT-/);
  await expect(page.getByText("The Lantern Hall").first()).toBeVisible();
});

test("event detail: tabs switch content", async ({ page }) => {
  await page.goto("/events/EVT-G051", { waitUntil: "networkidle" });

  // details tab is default
  await expect(page.getByText("Guarantee vs Door")).toBeVisible();

  // settlement tab shows the reconciliation
  await page.getByText("Settlement", { exact: true }).click();
  await expect(page.getByText("Your retained share")).toBeVisible();

  // budget tab shows the break-even KPI
  await page.getByText("Budget", { exact: true }).click();
  await expect(page.getByText("Break-even")).toBeVisible();
});

test("events: status tab filters the table", async ({ page }) => {
  await page.goto("/events", { waitUntil: "networkidle" });
  const before = await page.getByText(/EVT-G0\d\d/).count();
  await page.getByRole("tab", { name: "Confirmed" }).click();
  const after = await page.getByText(/EVT-G0\d\d/).count();
  expect(after).toBeLessThan(before);
  expect(after).toBeGreaterThan(0);
});

test("topbar: theme toggle flips light/dark", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  const html = page.locator("html");
  await expect(html).not.toHaveAttribute("data-theme", "light");
  await page.getByTestId("theme-toggle").click();
  await expect(html).toHaveAttribute("data-theme", "light");
  await page.getByTestId("theme-toggle").click();
  await expect(html).not.toHaveAttribute("data-theme", "light");
});
