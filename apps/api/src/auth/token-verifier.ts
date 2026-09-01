/**
 * Firebase authentication, behind an interface so the request pipeline never
 * depends on Firebase directly. Production uses `firebase-admin`; tests inject a
 * fake. The token carries only identity — the principal is resolved from
 * Postgres per request (PLAN.md: "Keep Firebase Auth; Postgres is the brain").
 */

import { ensureFirebaseApp } from "../lib/firebase-app";

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
        const { getAuth } = await import("firebase-admin/auth");
        // Initialisation moved to `lib/firebase-app` — it is a fact about the
        // PROCESS, not about verifying a token. While it lived here, a public
        // route (which carries no token) left Firebase uninitialised and the
        // storage signer threw. See that file for the whole story.
        const app = await ensureFirebaseApp({
          projectId: config.projectId,
          serviceAccount: config.serviceAccount,
        });
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
