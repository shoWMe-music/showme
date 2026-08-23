import { expect, test } from "@playwright/test";
import { authFile } from "./support/accounts";

/**
 * The create-event button must ALWAYS open the wizard.
 *
 * Reported from production, never reproduced: a click that did nothing. Every
 * surface was checked by hand and each one opened, so what this spec pins is the
 * one mechanism that could produce that symptom silently — `setOpen(true)` when
 * `open` is already `true` is a no-op, so a state desync would leave a live
 * button that does nothing at all. The provider now bumps a key on every open, so
 * a click always mounts a fresh wizard; these tests fail if that is undone.
 *
 * Operator only: `canCreateEvent` hides the button for the other kinds, which
 * `kinds.spec.ts` covers.
 */
test.use({ storageState: authFile("operator") });

/** The wizard, identified the way a user identifies it — by what it says. */
const wizard = (page: import("@playwright/test").Page) =>
  page.getByRole("dialog", { name: /create new event/i });

const topbarButton = (page: import("@playwright/test").Page) =>
  page.getByRole("button", { name: "New event", exact: true }).first();

async function waitForShell(page: import("@playwright/test").Page) {
  await page
    .getByRole("button", { name: /Dashboard/i })
    .first()
    .waitFor();
}

// Every screen the topbar is on — the button travels with the shell, so a
// regression on one route is a regression on all of them, but a stacking or
// portal bug would not be.
for (const route of ["/", "/events", "/calendar", "/settlements", "/requests", "/tasks"]) {
  test(`opens from the topbar on ${route}`, async ({ page }) => {
    await page.goto(route);
    await waitForShell(page);

    await topbarButton(page).click();

    await expect(wizard(page)).toBeVisible();
    await expect(wizard(page).getByText("Create New Event")).toBeVisible();
  });
}

test("opens again after being closed — twice over", async ({ page }) => {
  await page.goto("/");
  await waitForShell(page);

  for (let attempt = 1; attempt <= 3; attempt++) {
    await topbarButton(page).click();
    await expect(wizard(page), `attempt ${attempt} should open the wizard`).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(wizard(page)).toBeHidden();
  }
});

test("every open is a FRESH wizard, not the last one re-shown", async ({ page }) => {
  await page.goto("/");
  await waitForShell(page);

  // This is the observable consequence of the provider keying the wizard on an
  // open counter — the thing that makes a click always mount a modal instead of
  // setting an already-true flag. If the key is removed, the abandoned draft
  // below survives into the next open and this fails.
  await topbarButton(page).click();
  await expect(wizard(page)).toBeVisible();
  await page.getByPlaceholder("e.g. Nils Frahm").fill("Abandoned draft");
  await page.keyboard.press("Escape");
  await expect(wizard(page)).toBeHidden();

  await topbarButton(page).click();
  await expect(wizard(page)).toBeVisible();
  await expect(page.getByPlaceholder("e.g. Nils Frahm")).toHaveValue("");
});

test("Escape and the backdrop both close it", async ({ page }) => {
  await page.goto("/");
  await waitForShell(page);

  await topbarButton(page).click();
  await expect(wizard(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(wizard(page)).toBeHidden();

  await topbarButton(page).click();
  await expect(wizard(page)).toBeVisible();
  // The backdrop is the dialog element itself; click its top-left corner, which
  // is outside the panel.
  await wizard(page).click({ position: { x: 5, y: 5 } });
  await expect(wizard(page)).toBeHidden();
});

test("the Events screen's own buttons open the same wizard", async ({ page }) => {
  await page.goto("/events");
  await waitForShell(page);

  await page.getByRole("button", { name: "New event", exact: true }).last().click();
  await expect(wizard(page)).toBeVisible();
});

test("the Calendar's Create Event button opens it too", async ({ page }) => {
  await page.goto("/calendar");
  await waitForShell(page);

  await page.getByRole("button", { name: "Create Event", exact: true }).click();
  await expect(wizard(page)).toBeVisible();
});
