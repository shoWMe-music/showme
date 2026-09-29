import { expect, test } from "@playwright/test";
import { authFile } from "./support/accounts";

/**
 * THE INTEGRATIONS SCREEN IS REACHABLE, AND HONEST ABOUT THIS DEPLOYMENT.
 *
 * `routes/Integrations.tsx` was a finished three-state screen that `router.tsx` had never been told
 * about, while Settings → Integrations told the user integrations had not shipped (QA sweep run 14).
 * The same miss had already happened once in the same feature — Google's redirect URI was routed by
 * nothing — and the note in `router.tsx` says why neither was noticed: no sidebar entry, so nothing
 * in the chrome was missing.
 *
 * A spec rather than a unit test because there is nothing to unit test: the defect was an absent
 * route and a false sentence, and both are only visible to something that drives the app.
 *
 * The local stack has no Google credentials — the three variables are optional by design — so the
 * card must say the connection is unavailable and offer NO button. That is the other half of the
 * fix: routing the screen alone would have put a Connect button in front of a 503.
 */
test.use({ storageState: authFile("operator") });

test("Settings points at the Integrations screen instead of denying it exists", async ({
  page,
}) => {
  await page.goto("/settings");
  await page.locator("main").first().waitFor({ timeout: 30_000 });

  const integrationsTab = page.getByRole("button", { name: /^Integrations$/ });
  await integrationsTab.first().click();

  // The sentence that used to be here is gone.
  await expect(page.getByText(/once integrations ship/i)).toHaveCount(0);

  await page.getByRole("link", { name: /Open Integrations/i }).click();
  await expect(page).toHaveURL(/\/integrations$/);
});

test("the screen loads and says a connection is unavailable here, with no button to press", async ({
  page,
}) => {
  await page.goto("/integrations");
  await page.locator("main").first().waitFor({ timeout: 30_000 });

  // It is the real screen, not a 404 or the shell's fallback.
  await expect(page.getByRole("heading", { name: "Integrations" })).toBeVisible();

  // No Google credentials on this deployment, so the card says so...
  await expect(page.getByText("Not available here")).toBeVisible();
  // ...and never offers what the API would refuse.
  await expect(page.getByRole("button", { name: /Connect Google Calendar/i })).toHaveCount(0);
});
