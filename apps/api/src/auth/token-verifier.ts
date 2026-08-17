/**
 * Firebase authentication, behind an interface so the request pipeline never
 * depends on Firebase directly. Production uses `firebase-admin`; tests inject a
 * fake. The token carries only identity — the principal is resolved from
 * Postgres per request (PLAN.md: "Keep Firebase Auth; Postgres is the brain").
 */

export interface FirebaseUser {
  uid: string;
  email?: string;
  /** Firebase `email_verified` — gates claim-on-signup (only a verified email
   * may inherit a stub's events; an unverified one could be anyone's). */
  emailVerified?: boolean;
  name?: string;
}

export interface TokenVerifier {
  verify(idToken: string): Promise<FirebaseUser>;
}

/** Decode a service account passed either as raw JSON or base64-encoded JSON. */
function decodeServiceAccount(value: string): Record<string, unknown> {
  const json = value.trim().startsWith("{") ? value : Buffer.from(value, "base64").toString("utf8");
  return JSON.parse(json);
}

/**
 * The real verifier. `firebase-admin` is imported lazily so tests (and typecheck)
 * never load it, and so a missing credential only fails when a token is actually
 * verified — not at boot. Add `FIREBASE_PROJECT_ID` / `FIREBASE_SERVICE_ACCOUNT`
 * to the environment when ready; until then this simply isn't exercised.
 */
export function createFirebaseTokenVerifier(config: {
  projectId?: string;
  serviceAccount?: string;
}): TokenVerifier {
  let authPromise: Promise<import("firebase-admin/auth").Auth> | null = null;

  const resolveAuth = () => {
    if (!authPromise) {
      authPromise = (async () => {
        const { initializeApp, cert, applicationDefault, getApps } = await import(
          "firebase-admin/app"
        );
        const { getAuth } = await import("firebase-admin/auth");
        // When the Auth emulator is targeted (FIREBASE_AUTH_EMULATOR_HOST, read
        // automatically by firebase-admin), tokens are emulator-signed and need
        // no real credential — initialize with the project id only. Otherwise use
        // the service account / application-default credential as in production.
        const usingEmulator = !!process.env.FIREBASE_AUTH_EMULATOR_HOST;
        const app =
          getApps()[0] ??
          initializeApp(
            usingEmulator
              ? { projectId: config.projectId ?? "demo-showme" }
              : {
                  credential: config.serviceAccount
                    ? cert(decodeServiceAccount(config.serviceAccount))
                    : applicationDefault(),
                  projectId: config.projectId,
                },
          );
        return getAuth(app);
      })();
    }
    return authPromise;
  };

  return {
    async verify(idToken: string): Promise<FirebaseUser> {
      const auth = await resolveAuth();
      const decoded = await auth.verifyIdToken(idToken);
      return {
        uid: decoded.uid,
        email: decoded.email,
        emailVerified: decoded.email_verified,
        name: typeof decoded.name === "string" ? decoded.name : undefined,
      };
    },
  };
}
