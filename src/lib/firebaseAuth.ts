import type { Auth } from "firebase/auth";
import { connectAuthEmulator, getAuth, signOut } from "firebase/auth";

import { getFirebaseApp } from "@/integrations/firebase/app";
import { shouldConnectFirebaseEmulators } from "@/integrations/firebase/config";

let cached: Auth | null = null;
let authEmulatorConnected = false;

export function getAuthClient(): Auth {
  if (!cached) {
    cached = getAuth(getFirebaseApp());
    if (shouldConnectFirebaseEmulators() && !authEmulatorConnected) {
      const url =
        import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_URL ??
        "http://localhost:9099";
      connectAuthEmulator(cached, url, { disableWarnings: true });
      authEmulatorConnected = true;
    }
  }
  return cached;
}

export async function signOutUser(): Promise<void> {
  await signOut(getAuthClient());
}
