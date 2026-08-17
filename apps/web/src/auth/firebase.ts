import { initializeApp } from "firebase/app";
import { GoogleAuthProvider, connectAuthEmulator, getAuth } from "firebase/auth";

/**
 * Firebase client init. Config comes from `VITE_FIREBASE_*` (non-secret client
 * config). The API verifies the ID tokens minted here against the same project.
 */
const firebaseApp = initializeApp({
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
});

export const auth = getAuth(firebaseApp);
export const googleProvider = new GoogleAuthProvider();

// E2E / local: point Auth at the Firebase emulator when a host is configured
// (e.g. `127.0.0.1:9099`). Never set in production, so prod auth is untouched.
const authEmulatorHost = import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_HOST;
if (authEmulatorHost) {
  connectAuthEmulator(auth, `http://${authEmulatorHost}`, { disableWarnings: true });
}
