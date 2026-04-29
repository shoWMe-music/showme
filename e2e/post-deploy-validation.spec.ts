/**
 * Post-deploy validation: verify the 5 issue-fix routes and a few doc items
 * are actually wired up. Runs against the running local dev server (PORT=8080)
 * and against prod.
 */
import { test, expect } from "@playwright/test";

const LOCAL = "http://localhost:8080";
const PROD = "https://showme-production.web.app";

test.describe.configure({ mode: "serial" });

for (const env of [
  { name: "local", base: LOCAL },
  { name: "prod", base: PROD },
]) {
  test.describe(`${env.name} (${env.base})`, () => {
    test("Issue #7: /request-date/$slug renders BookingWidgetPage (no auth)", async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (err) => errors.push(err.message));
      page.on("console", (msg) => {
        if (msg.type() === "error") errors.push(msg.text());
      });

      const resp = await page.goto(`${env.base}/request-date/nonexistent-slug-xyz`, { waitUntil: "domcontentloaded" });
      expect(resp?.status()).toBeLessThan(500);

      // Wait for either "not found" copy or the request form
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
      const body = (await page.locator("body").textContent()) ?? "";

      // Should NOT be the generic 404 page; should be SPA-rendered booking widget
      expect(body.toLowerCase()).not.toContain("page not found");

      // Either the form rendered or the explicit "Profile not found" message
      const isWidget =
        body.toLowerCase().includes("profile not found") ||
        body.toLowerCase().includes("request date") ||
        body.toLowerCase().includes("request a date");
      expect(isWidget, `Body did not look like booking widget. First 300 chars: ${body.slice(0, 300)}`).toBeTruthy();

      expect(errors.filter((e) => !e.includes("favicon")).slice(0, 5)).toEqual([]);
    });

    test("Issue #10: /review/$token renders snapshot review page", async ({ page }) => {
      const resp = await page.goto(`${env.base}/review/fake-token-validation`, { waitUntil: "domcontentloaded" });
      expect(resp?.status()).toBeLessThan(500);

      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
      const body = (await page.locator("body").textContent()) ?? "";

      // SPA should render — either "not found" / "expired" / similar copy, NOT generic 404
      expect(body.toLowerCase()).not.toContain("page not found");

      const isReviewPage =
        body.toLowerCase().includes("settlement") ||
        body.toLowerCase().includes("expired") ||
        body.toLowerCase().includes("not found") ||
        body.toLowerCase().includes("invalid");
      expect(isReviewPage, `Body first 300: ${body.slice(0, 300)}`).toBeTruthy();
    });

    test("Cloud Function: setCollaboratorInvitePassword endpoint reachable", async ({ request }) => {
      // We only check that the function exists. A 401/UNAUTHENTICATED is the
      // expected shape — a 404 would mean the function wasn't deployed.
      // (Local test calls prod since we don't run a functions emulator here.)
      const resp = await request.post(
        `https://europe-west1-showme-production.cloudfunctions.net/setCollaboratorInvitePassword`,
        { data: { data: {} } },
      );
      // Reachable means not 404. 401 or 400 is fine.
      expect(resp.status()).not.toBe(404);
    });
  });
}
