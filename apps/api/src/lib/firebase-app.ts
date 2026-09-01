import type { App } from "firebase-admin/app";

/**
 * The one place the Firebase Admin app is brought into existence.
 *
 * IT USED TO LIVE INSIDE THE TOKEN VERIFIER, and that was a production bug with
 * a very specific shape: `initializeApp()` ran as a SIDE EFFECT of verifying a
 * token, so the app existed only on requests that carried one. A PUBLIC route
 * needs no token, so nothing initialised Firebase — and the moment such a route
 * asked the storage signer for a URL, `getStorage()` threw "The default Firebase
 * app does not exist".
 *
 * It stayed hidden because it only bites when a public route signs something: a
 * published profile whose picture is an UPLOADED file rather than an external
 * URL. `signProfileImageUrls` short-circuits on an empty file list, so for as
 * long as nobody had uploaded a profile picture the public page was fine.
 *
 * So: initialisation belongs to the process, not to one request path. Both the
 * verifier and the signer call this, it is idempotent (`getApps()[0]`), and the
 * promise is cached so concurrent callers share one initialisation.
 */
export interface FirebaseAppConfig {
  projectId?: string;
  serviceAccount?: string;
}

/** Decode a service account passed either as raw JSON or base64-encoded JSON.
 *  Lives here because both callers need it and neither owns it. */
function decodeServiceAccount(value: string): Record<string, unknown> {
  const json = value.trim().startsWith("{") ? value : Buffer.from(value, "base64").toString("utf8");
  return JSON.parse(json);
}

let appPromise: Promise<App> | null = null;

export function ensureFirebaseApp(config: FirebaseAppConfig): Promise<App> {
  if (!appPromise) {
    appPromise = (async () => {
      const { initializeApp, cert, applicationDefault, getApps } = await import(
        "firebase-admin/app"
      );
      const existing = getApps()[0];
      if (existing) return existing;
      // When the Auth emulator is targeted (FIREBASE_AUTH_EMULATOR_HOST, read
      // automatically by firebase-admin), tokens are emulator-signed and need no
      // real credential — initialize with the project id only.
      const usingEmulator = Boolean(process.env.FIREBASE_AUTH_EMULATOR_HOST);
      if (usingEmulator) {
        return initializeApp({ projectId: config.projectId ?? "demo-showme" });
      }
      const credential = config.serviceAccount
        ? cert(decodeServiceAccount(config.serviceAccount) as never)
        : applicationDefault();
      return initializeApp({ credential, projectId: config.projectId });
    })();
  }
  return appPromise;
}

/** Test seam — lets a suite start from a clean slate. */
export function resetFirebaseAppForTests(): void {
  appPromise = null;
}
