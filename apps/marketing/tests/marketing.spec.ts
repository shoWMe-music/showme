import { expect, test, type Page } from "@playwright/test";

/** Collect uncaught JS errors + real console errors (ignoring external font/CDN noise). */
function trackErrors(page: Page) {
  const errors: string[] = [];
  // Uncaught JS exceptions are always our bug.
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    // Resource load failures are handled below (same-origin only) — the console
    // message for those doesn't carry the failing URL, so we can't tell whose it is here.
    if (/Failed to load resource/i.test(text)) return;
    errors.push(`console: ${text}`);
  });
  // A 4xx/5xx for one of OUR OWN files is a real bug; external CDN fonts flaking is not.
  page.on("response", (r) => {
    if (r.status() >= 400 && r.url().startsWith("http://localhost:4173")) {
      errors.push(`http ${r.status()}: ${r.url()}`);
    }
  });
  return errors;
}

const PAGES = [
  { path: "/", title: /shoWMe/, slug: "index" },
  { path: "/product.html", title: /Product/, slug: "product" },
  { path: "/about.html", title: /About/, slug: "about" },
  { path: "/contact.html", title: /Contact/, slug: "contact" },
];

test.describe("every page", () => {
  for (const p of PAGES) {
    test(`${p.slug}: loads, SEO basics, no JS errors`, async ({ page }) => {
      const errors = trackErrors(page);
      const resp = await page.goto(p.path, { waitUntil: "domcontentloaded" });
      expect(resp?.status(), "HTTP status").toBeLessThan(400);

      await expect(page).toHaveTitle(p.title);
      await expect(page.locator("html")).toHaveAttribute("lang", "en");
      const desc = page.locator('head meta[name="description"]');
      expect(await desc.getAttribute("content")).toBeTruthy();

      // brand + nav present on every page
      await expect(page.locator("nav#nav")).toBeVisible();
      await expect(page.locator(".brand").first()).toBeVisible();

      // design tokens applied: the warm near-black ground, not an unstyled white page
      const bg = await page.evaluate(
        () => getComputedStyle(document.body).backgroundColor,
      );
      expect(bg).not.toBe("rgba(0, 0, 0, 0)");

      expect(errors, errors.join("\n")).toHaveLength(0);
    });
  }
});

test("home: hero + ecosystem + feature visuals render", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });

  // hero canvas has real pixels
  const hero = page.locator("#hero-canvas");
  await expect(hero).toBeAttached();
  const heroW = await hero.evaluate((c: HTMLCanvasElement) => c.width);
  expect(heroW).toBeGreaterThan(0);

  // ecosystem galaxy builds its canvas inside #orbit
  await expect(page.locator("#orbit canvas#galaxy-canvas")).toBeAttached();

  // feature visuals get populated by JS (not empty)
  await expect
    .poll(async () =>
      page.locator("#calendar-visual .cal-wrap").count(),
    )
    .toBeGreaterThan(0);

  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("home: chaos → order shows the real event-manager panel", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const stage = page.locator("#chaos-stage");
  await stage.scrollIntoViewIfNeeded();
  // toggle to the "with shoWMe" state
  const orderBtn = page.locator('#chaos-stage .chaos__toggle button[data-state="order"]');
  if (await orderBtn.count()) await orderBtn.click();
  await expect(page.locator("#chaos-stage .evm.on")).toBeVisible({ timeout: 6000 });
  // it renders the settlement pane by default
  await expect(page.locator("#chaos-stage .evm__title")).toContainText(/Vance/);
});

test("product: real product screenshots actually load", async ({ page }) => {
  await page.goto("/product.html", { waitUntil: "domcontentloaded" });
  const shots = page.locator('img[src*="/assets/shots/"]');
  const n = await shots.count();
  expect(n).toBeGreaterThan(0);
  // first shot decoded to real pixels
  const w = await shots.first().evaluate((img: HTMLImageElement) => img.naturalWidth);
  expect(w).toBeGreaterThan(0);
});

test("nav: product link navigates", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "nav links collapse on phone widths by design");
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator('nav#nav a[href="product.html"]').first().click();
  await expect(page).toHaveURL(/product\.html$/);
  await expect(page.locator("h1, .display, .hero").first()).toBeVisible();
});

test("contact: early-access form present with email field", async ({ page }) => {
  await page.goto("/contact.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("form").first()).toBeVisible();
  await expect(page.locator('input[type="email"]').first()).toBeVisible();
});

test("contact: form submit shows success state", async ({ page }) => {
  await page.goto("/contact.html", { waitUntil: "domcontentloaded" });
  await page.fill('input[name="name"]', "Test Operator");
  await page.fill('input[name="email"]', "test@example.com");
  await page.fill('textarea[name="message"]', "We run a 400-cap venue and want in.");
  await page.click('form#contactForm button[type="submit"]');
  await expect(page.locator("#cok")).toBeVisible();
  await expect(page.locator("#contactForm")).toHaveAttribute("data-submitted", "true");
});

test.describe("SEO", () => {
  for (const p of PAGES) {
    test(`${p.slug}: canonical + OpenGraph + JSON-LD`, async ({ page }) => {
      await page.goto(p.path, { waitUntil: "domcontentloaded" });

      const canonical = page.locator('link[rel="canonical"]');
      expect(await canonical.getAttribute("href")).toMatch(/^https?:\/\//);

      expect(await page.locator('meta[property="og:title"]').getAttribute("content")).toBeTruthy();
      expect(await page.locator('meta[property="og:image"]').getAttribute("content")).toMatch(/^https?:\/\//);
      expect(await page.locator('meta[name="twitter:card"]').getAttribute("content")).toBe("summary_large_image");

      // every JSON-LD block is valid JSON with a schema.org @type
      const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
      expect(blocks.length).toBeGreaterThan(0);
      for (const b of blocks) {
        const obj = JSON.parse(b);
        expect(obj["@context"]).toContain("schema.org");
        expect(obj["@type"]).toBeTruthy();
      }
    });
  }
});
