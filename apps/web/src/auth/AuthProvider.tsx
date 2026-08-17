import { ApiError, postApiV1AuthSession } from "@showme/api-client";
import {
  type User,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  updateProfile,
} from "firebase/auth";
import { type ReactNode, createContext, useContext, useEffect, useMemo, useState } from "react";
import { setActiveProfileId } from "../lib/activeProfile";
import { auth, googleProvider } from "./firebase";

export type AccountKind = "operator" | "performer" | "team_and_crew" | "agent";

export interface Session {
  userId: string;
  email: string | null;
  kind: AccountKind;
  isAdmin: boolean;
  memberships: { profileId: string; kind: AccountKind; role: string }[];
}

/**
 * - `loading`    — resolving the persisted Firebase session.
 * - `anon`       — no Firebase user; show the auth screen.
 * - `onboarding` — Firebase user exists but setup is incomplete: either no
 *                  Postgres account yet (needs a kind) OR an account with no
 *                  profile yet. The typeform onboarding covers both.
 * - `authed`     — provisioned account WITH at least one profile.
 */
type Status = "loading" | "anon" | "onboarding" | "authed";

interface AuthContextValue {
  status: Status;
  user: User | null;
  session: Session | null;
  signInEmail(email: string, password: string): Promise<void>;
  signUpEmail(email: string, password: string): Promise<void>;
  signInGoogle(): Promise<void>;
  signOut(): Promise<void>;
  /** Provision the Postgres account (users row) with the chosen kind + name. */
  provisionAccount(kind: AccountKind, name: string): Promise<Session>;
  /** Re-read the session; flips to `authed` once a first profile exists. */
  refreshSession(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Read the session with no kind. Returns null when the user has no account yet (400). */
async function fetchSession(): Promise<Session | null> {
  try {
    return (await postApiV1AuthSession({})) as Session;
  } catch (error) {
    if (error instanceof ApiError && error.status === 400) return null;
    throw error;
  }
}

function statusForSession(session: Session | null): Status {
  if (!session) return "onboarding"; // authenticated, but no Postgres account yet
  if (session.memberships.length === 0) return "onboarding"; // account, but no profile
  return "authed";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    // Fires on load (persisted session) and on every sign-in / sign-out.
    return onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      if (!nextUser) {
        setSession(null);
        setStatus("anon");
        return;
      }
      try {
        const next = await fetchSession();
        setSession(next);
        setStatus(statusForSession(next));
      } catch (error) {
        // A transient error shouldn't strand the user — send them through
        // onboarding, which re-provisions on submit.
        console.error("[auth] session fetch failed", error);
        setStatus("onboarding");
      }
    });
  }, []);

  // Keep the acting profile (X-Profile-Id for profile-scoped mutations) in sync
  // with the session. Defaults to the first membership; a profile switcher can
  // override it later.
  useEffect(() => {
    setActiveProfileId(session?.memberships[0]?.profileId ?? null);
  }, [session]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      session,
      async signInEmail(email, password) {
        await signInWithEmailAndPassword(auth, email, password);
      },
      async signUpEmail(email, password) {
        await createUserWithEmailAndPassword(auth, email, password);
        // onAuthStateChanged → fetchSession → onboarding (no account yet).
      },
      async signInGoogle() {
        await signInWithPopup(auth, googleProvider);
      },
      async signOut() {
        await firebaseSignOut(auth);
      },
      async provisionAccount(kind, name) {
        if (auth.currentUser && name) {
          await updateProfile(auth.currentUser, { displayName: name }).catch(() => {});
        }
        const next = (await postApiV1AuthSession({ kind, name })) as Session;
        setSession(next); // status stays `onboarding` — the flow finishes it
        return next;
      },
      async refreshSession() {
        const next = await fetchSession();
        setSession(next);
        setStatus(statusForSession(next));
      },
    }),
    [status, user, session],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within <AuthProvider>");
  return context;
}
