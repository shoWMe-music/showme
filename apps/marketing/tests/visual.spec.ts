import { expect, test } from "@playwright/test";
import { gotoFrozen } from "./helpers/visual";

/**
 * LAYER 1 — appearance regression, by ASSERTION not pixel-diff.
 *
 * Full-section pixel snapshots proved unreliable on this animation-heavy site (see
 * the note in animations.spec.ts). For static content — colour, copy, structure —
 * a computed-style / text assertion is both deterministic AND more precise than a
 * pixel diff: it says exactly WHAT changed.
 *
 * These double as permanent guards for Ran's 2026-08-17 fix list: each encodes the
 * shipped state, so a regression that reverts an item turns the guard red.
 */

const rgb = (el: HTMLElement) => getComputedStyle(el).color;

test("brand wordmark is visible on every page", async ({ page }) => {
  for (const path of ["/", "/product.html", "/about.html", "/contact.html"]) {
    await gotoFrozen(page, path, 300);
    await expect(page.locator(".brand").first()).toBeVisible();
  }
});

test("brand wordmark colour is consistent across pages (fix-list #16)", async ({ page }) => {
  // #16: contact rendered the wordmark yellow. Assert every page matches the
  // homepage's colour — relational, so it survives a brand-colour change but
  // catches a one-page divergence.
  await gotoFrozen(page, "/", 300);
  const expected = await page.locator(".brand").first().evaluate(rgb);

  for (const path of ["/product.html", "/about.html", "/contact.html"]) {
    await gotoFrozen(page, path, 300);
    const actual = await page.locator(".brand").first().evaluate(rgb);
    expect(actual, `${path} header wordmark colour should match the homepage`).toBe(expected);
  }
});

test("hero: subheader split out, body has no em dash (fix-list #1, #3)", async ({ page }) => {
  await gotoFrozen(page, "/", 300);
  const subheader = await page.locator(".hero__subheader").first().innerText();
  const sub = await page.locator(".hero__sub").first().innerText();
  expect(subheader, "subheader carries the lead line").toContain("all in one place");
  expect(subheader, "no em dash in the hero subheader").not.toContain("—");
  expect(sub, "body dropped into its own paragraph").toContain("single collaborative");
  expect(sub, "no em dashes in body copy").not.toContain("—");
});

test("no em dashes in rendered copy, site-wide (fix-list #3)", async ({ page }) => {
  for (const path of ["/", "/product.html", "/about.html", "/contact.html"]) {
    await gotoFrozen(page, path, 300);
    const title = await page.title();
    expect(title, `${path} <title> has no em dash`).not.toContain("—");
    const bodyText = await page.locator("body").innerText();
    expect(bodyText, `${path} visible copy has no em dash`).not.toContain("—");
  }
});

test("role tab renamed Professional -> Team and Crew (fix-list #7)", async ({ page }) => {
  await gotoFrozen(page, "/", 300);
  const tabs = await page.locator("#feat-tabs").innerText();
  expect(tabs, "role tab reads Team and Crew").toContain("Team and Crew");
  expect(tabs, "no Professional tab remains").not.toContain("Professional");
});

test("pricing lists Unlimited templates on the operator Pro plan (fix-list #10)", async ({
  page,
}) => {
  await gotoFrozen(page, "/", 300);
  const pricing = page.locator("#pricing");
  await pricing.scrollIntoViewIfNeeded();
  await expect(pricing).toContainText(/unlimited templates/i);
});

test("footer tagline is the simplified copy (fix-list #12)", async ({ page }) => {
  for (const path of ["/", "/about.html", "/contact.html", "/product.html"]) {
    await gotoFrozen(page, path, 300);
    const footer = await page.locator(".footer").first().innerText();
    expect(footer, `${path} footer uses the shortened line`).toContain(
      "Early access available now",
    );
    expect(footer, `${path} footer dropped the long tagline`).not.toContain("Scandinavia");
  }
});

test("Why section is the event-center animation (fix-list #18)", async ({ page }) => {
  await gotoFrozen(page, "/", 300);
  const why = page.locator("#why");
  await expect(why).toContainText(/make the event the center/i);
  await expect(why).not.toContainText(/layer between/i);
  const stage = page.locator("#why-center .stage");
  await expect(stage.locator(".node")).toHaveText("Event");
  await expect(stage.locator(".chip")).toHaveCount(4);
  // 8 pulses: one inward + one outward per party (bidirectional flow).
  await expect(stage.locator(".pulse")).toHaveCount(8);
  expect(await why.innerText(), "no em dash in Why copy").not.toContain("—");
});

test("ecosystem galaxy thins its node set on mobile (fix-list M1)", async ({ page }) => {
  await gotoFrozen(page, "/", 300);
  const count = Number(await page.locator("#orbit").getAttribute("data-node-count"));
  const width = page.viewportSize()?.width ?? 1280;
  if (width < 640) {
    expect(count, "phones show a thinned, legible node set").toBeLessThanOrEqual(16);
  } else {
    expect(count, "desktop shows the full ecosystem").toBe(23);
  }
});
