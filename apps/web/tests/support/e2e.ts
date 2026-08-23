import { type Browser, type Page, expect } from "@playwright/test";
import { E2E_ACCOUNTS, type E2eAccountName } from "@showme/shared";
import { authFile } from "./accounts";

/**
 * Shared E2E helpers.
 *
 * - `loginViaUi` drives the real auth screen (used once per account by the
 *   `setup` project to mint the saved session, and available to any test that
 *   wants to exercise the login form itself).
 * - `openAs` opens a fresh browser context already authenticated as a given
 *   account by loading its saved `storageState` — the building block for
 *   two-users-interacting tests (open two contexts, one per account).
 */

/** Fill in and submit the sign-in form, then wait for the app shell to render. */
export async function loginViaUi(page: Page, name: E2eAccountName): Promise<void> {
  const account = E2E_ACCOUNTS[name];
  // NOT `waitUntil: "networkidle"`: once the shell mounts it opens a long-lived SSE
  // connection to the stream service, which the dev stack now runs — so there is
  // always a request in flight and "network idle" never arrives. The explicit
  // element wait below is the real readiness signal anyway.
  await page.goto("/");
  await page.getByPlaceholder("you@email.com").fill(account.email);
  await page.getByPlaceholder("Password").fill(account.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  // The shell has rendered once the sidebar nav is present.
  await page
    .getByRole("button", { name: /Dashboard/i })
    .first()
    .waitFor({ timeout: 30_000 });
}

/**
 * Open a new authenticated context for `name` using its saved session. Firebase
 * persists auth in IndexedDB, so we restore it (`indexedDB: true` was used when
 * saving). Returns the context (close it when done) and a ready page on "/".
 */
export async function openAs(
  browser: Browser,
  name: E2eAccountName,
): Promise<{ context: Awaited<ReturnType<Browser["newContext"]>>; page: Page }> {
  const context = await browser.newContext({ storageState: authFile(name) });
  const page = await context.newPage();
  // NOT `waitUntil: "networkidle"`: once the shell mounts it opens a long-lived SSE
  // connection to the stream service, which the dev stack now runs — so there is
  // always a request in flight and "network idle" never arrives. The explicit
  // element wait below is the real readiness signal anyway.
  await page.goto("/");
  await page
    .getByRole("button", { name: /Dashboard/i })
    .first()
    .waitFor({ timeout: 30_000 });
  return { context, page };
}

export { expect };
