import { type Page, expect, test } from "@playwright/test";

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

      // brand + nav present on every page (dropdown nav is .topnav after fix-list #17)
      await expect(page.locator(".topnav")).toBeVisible();
      await expect(page.locator(".brand").first()).toBeVisible();

      // design tokens applied: the warm near-black ground, not an unstyled white page
      const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
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

  // feature section role tabs get populated by feature-scroll.js (not empty)
  await expect.poll(async () => page.locator("#feat-tabs button").count()).toBeGreaterThan(0);

  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("home: problem section goes straight mess -> smart/synced (fix-list #2)", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  // Both intermediate steps removed → 2 beats: the messy problem and the synced end.
  await expect(page.locator(".chaos .chaos__beat")).toHaveCount(2);
  await expect(page.locator(".chaos")).not.toContainText("All of it, in one place");
  await expect(page.locator(".chaos")).not.toContainText("Structured, start to finish");
});

test("home: ecosystem globe spins on press-drag (fix-list #9)", async ({ page }, testInfo) => {
  // #9 is a desktop grab-and-spin; the mobile orbit is covered by M1/M2. Touch-drag
  // emulation doesn't reliably fire pointer events here, so assert on desktop.
  test.skip(testInfo.project.name === "mobile", "desktop grab-and-spin interaction");
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const orbit = page.locator("#orbit");
  await orbit.scrollIntoViewIfNeeded();
  const box = await orbit.boundingBox();
  if (!box) throw new Error("no #orbit box");
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 220, cy, { steps: 12 });
  await page.mouse.up();
  // data-yaw is written synchronously on each pointermove → off zero after a drag.
  expect(Number(await orbit.getAttribute("data-yaw"))).not.toBe(0);
});

test("home: ecosystem fits the phone viewport, no overflow (fix-list M2)", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "mobile-only responsive check");
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const orbit = page.locator("#orbit canvas#galaxy-canvas");
  await orbit.scrollIntoViewIfNeeded();
  await expect(orbit).toBeAttached();
  const vw = page.viewportSize()?.width ?? 393;
  const box = await orbit.boundingBox();
  expect(box, "canvas has a box").not.toBeNull();
  if (box) {
    expect(box.width, "canvas width fits").toBeGreaterThan(0);
    expect(box.x + box.width, "canvas does not overflow right edge").toBeLessThanOrEqual(vw + 1);
  }
  const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollW, "no horizontal page overflow").toBeLessThanOrEqual(vw + 1);
});

test("nav: single-destination items are links, Company is a dropdown (fix-list #17)", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "dropdowns collapse into the burger on phones");
  await page.goto("/", { waitUntil: "domcontentloaded" });

  // Product and Contact go one place each, so they render as plain links, not
  // as dropdowns with a single item (9850a2d).
  await expect(page.locator('.topnav__item a.topnav__link[href*="#features"]')).toBeVisible();
  await expect(page.locator('.topnav__item a.topnav__link[href*="contact.html"]')).toBeVisible();

  // Company is the one real dropdown: hidden until opened, then its links work.
  const panel = page.locator(".topnav__panel").first();
  await expect(panel).toBeHidden();
  await page.getByRole("button", { name: "Company" }).click();
  await expect(panel).toBeVisible();
  await panel.locator('a[href*="about.html"]').first().click();
  await expect(page).toHaveURL(/about\.html/);
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

test.describe("privacy: no third-party CDN calls (GDPR)", () => {
  // Fonts are self-hosted; nothing should reach out to Google Fonts / gstatic /
  // Fontshare on load — that would transfer the visitor's IP pre-consent.
  for (const path of ["/", "/cookies.html", "/privacy.html"]) {
    test(`${path}: loads no external font/CDN hosts`, async ({ page }) => {
      const offenders: string[] = [];
      page.on("request", (r) => {
        if (/googleapis\.com|gstatic\.com|fontshare\.com/.test(r.url())) offenders.push(r.url());
      });
      await page.goto(path, { waitUntil: "networkidle" });
      expect(offenders, offenders.join("\n")).toHaveLength(0);
      // and the self-hosted font actually loaded
      expect(await page.evaluate(() => document.fonts.check("16px 'Inter Tight'"))).toBe(true);
    });
  }
});

test.describe("cookie policy + consent", () => {
  test("cookies page loads with SEO basics", async ({ page }) => {
    const resp = await page.goto("/cookies.html", { waitUntil: "domcontentloaded" });
    expect(resp?.status(), "HTTP status").toBeLessThan(400);
    await expect(page).toHaveTitle(/Cookie Policy/);
    await expect(page.locator("h1")).toContainText(/Cookie Policy/);
    const canonical = page.locator('link[rel="canonical"]');
    expect(await canonical.getAttribute("href")).toMatch(/cookies$/);
  });

  test("privacy page loads with SEO basics", async ({ page }) => {
    const resp = await page.goto("/privacy.html", { waitUntil: "domcontentloaded" });
    expect(resp?.status(), "HTTP status").toBeLessThan(400);
    await expect(page).toHaveTitle(/Privacy Policy/);
    await expect(page.locator("h1")).toContainText(/Privacy Policy/);
    const canonical = page.locator('link[rel="canonical"]');
    expect(await canonical.getAttribute("href")).toMatch(/privacy$/);
    // the footer + cross-links to the privacy page resolve (no dead reference)
    await expect(page.locator('footer a[href="privacy.html"]')).toHaveCount(1);
  });

  test("consent banner shows on first visit, Accept hides it and persists", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const banner = page.locator(".cookie-consent");
    await expect(banner).toBeVisible();

    await banner.locator('[data-consent="granted"]').click();
    await expect(banner).toBeHidden();

    // choice is remembered — no banner on the next page load
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator(".cookie-consent")).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem("showme.cookie-consent"))).toBe(
      "granted",
    );
  });

  test("cookie policy page can re-open the preferences chooser", async ({ page }) => {
    // Land pre-decided so the banner doesn't auto-open.
    await page.goto("/cookies.html", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.setItem("showme.cookie-consent", "denied"));
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator(".cookie-consent")).toBeHidden();

    await page.locator("[data-cookie-preferences]").first().click();
    await expect(page.locator(".cookie-consent")).toBeVisible();
  });
});

test.describe("SEO", () => {
  for (const p of PAGES) {
    test(`${p.slug}: canonical + OpenGraph + JSON-LD`, async ({ page }) => {
      await page.goto(p.path, { waitUntil: "domcontentloaded" });

      const canonical = page.locator('link[rel="canonical"]');
      expect(await canonical.getAttribute("href")).toMatch(/^https?:\/\//);

      expect(await page.locator('meta[property="og:title"]').getAttribute("content")).toBeTruthy();
      expect(await page.locator('meta[property="og:image"]').getAttribute("content")).toMatch(
        /^https?:\/\//,
      );
      expect(await page.locator('meta[name="twitter:card"]').getAttribute("content")).toBe(
        "summary_large_image",
      );

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
