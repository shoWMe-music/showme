import { test as setup } from "@playwright/test";
import { E2E_ACCOUNTS, type E2eAccountName } from "@showme/shared";
import { authFile } from "./support/accounts";
import { loginViaUi } from "./support/e2e";

/**
 * The `setup` project: log every E2E account in once through the real auth
 * screen and persist its Firebase session to `tests/.auth/<name>.json`. Every
 * other project depends on this and reuses the saved state via `storageState`,
 * so the suite pays for each login exactly once.
 *
 * `indexedDB: true` is required — the Firebase Web SDK stores the session in
 * IndexedDB, not cookies/localStorage, so it must be captured to restore auth.
 */
for (const name of Object.keys(E2E_ACCOUNTS) as E2eAccountName[]) {
  setup(`authenticate ${name}`, async ({ page }) => {
    await loginViaUi(page, name);
    await page.context().storageState({ path: authFile(name), indexedDB: true });
  });
}
