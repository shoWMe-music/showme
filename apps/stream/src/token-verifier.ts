/**
 * Firebase authentication, behind an interface so the SSE service never depends on
 * Firebase directly. Production uses `firebase-admin`; tests inject a fake. The
 * token carries only identity — the stream is scoped to the resolved `uid`
 * (PLAN.md: "the token carries only `uid`").
 *
 * Mirrors `apps/api/src/auth/token-verifier.ts`; the two services are deployed
 * separately, so the small interface is duplicated rather than shared.
 */

export interface FirebaseUser {
  uid: string;
  email?: string;
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
 * never eagerly load it, and so a missing credential only fails when a token is
 * actually verified — not at boot.
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
        // automatically by firebase-admin), tokens are emulator-signed and need no
        // real credential — initialize with the project id only. Without this the
        // service cannot verify a seeded local user, so the SSE stream is
        // untestable against the dev stack. Mirrors the API verifier.
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
        name: typeof decoded.name === "string" ? decoded.name : undefined,
      };
    },
  };
}
