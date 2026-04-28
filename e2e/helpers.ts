import type { Page } from "@playwright/test";

const AUTH_EMULATOR = "http://127.0.0.1:9099";
const FIRESTORE_EMULATOR = "http://127.0.0.1:8090";

/**
 * Sign in via the Firebase Auth emulator REST API, then inject the auth token
 * into the app's localStorage so the app recognizes the user on load.
 */
export async function signIn(
  page: Page,
  email = "testvenueuser1@showme.music",
  password = "123456",
) {
  // Use the Auth emulator's signInWithPassword endpoint
  const res = await page.request.post(
    `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key`,
    {
      data: { email, password, returnSecureToken: true },
    },
  );

  if (!res.ok()) {
    throw new Error(`Auth emulator sign-in failed: ${res.status()} ${await res.text()}`);
  }

  const body = await res.json();
  const { idToken, refreshToken, localId } = body;

  // Store auth state in localStorage the way Firebase JS SDK expects
  // Firebase uses `firebase:authUser:<apiKey>:<appName>` key
  const authKey = "firebase:authUser:demo-api-key:[DEFAULT]";
  const authValue = JSON.stringify({
    uid: localId,
    email,
    emailVerified: true,
    spiIds: { localId },
    spiIdToken: idToken,
    spiRefreshToken: refreshToken,
    apiKey: "demo-api-key",
    appName: "[DEFAULT]",
  });

  await page.addInitScript(
    ({ key, value }: { key: string; value: string }) => {
      localStorage.setItem(key, value);
    },
    { key: authKey, value: authValue },
  );

  return { idToken, localId, email };
}

/**
 * Navigate to the app and wait for it to be fully loaded (past any loading spinners).
 */
export async function navigateAndWaitForApp(page: Page, path = "/events") {
  await page.goto(path);
  // Wait for the main layout to render (sidebar or main content area)
  await page.waitForSelector("[data-testid='app-sidebar'], main, [role='main']", {
    timeout: 15_000,
  });
}

/**
 * Clear Firestore emulator data for a fresh test run.
 */
export async function clearFirestoreData(page: Page) {
  await page.request.delete(
    `${FIRESTORE_EMULATOR}/emulator/v1/projects/showme-local/databases/(default)/documents`,
  );
}
