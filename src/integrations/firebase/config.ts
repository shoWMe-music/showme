import type { FirebaseOptions } from "firebase/app";

const REQUIRED_KEYS = [
  "VITE_FIREBASE_API_KEY",
  "VITE_FIREBASE_AUTH_DOMAIN",
  "VITE_FIREBASE_PROJECT_ID",
  "VITE_FIREBASE_STORAGE_BUCKET",
  "VITE_FIREBASE_MESSAGING_SENDER_ID",
  "VITE_FIREBASE_APP_ID",
] as const;

function missingProductionFirebaseKeys(): (typeof REQUIRED_KEYS)[number][] {
  return REQUIRED_KEYS.filter((key) => {
    const value = import.meta.env[key];
    return typeof value !== "string" || value.trim() === "";
  });
}

function allProductionFirebaseKeysMissing(): boolean {
  return missingProductionFirebaseKeys().length === REQUIRED_KEYS.length;
}

/**
 * In dev, use the Firebase emulator suite when explicitly enabled, or when no
 * production web SDK env vars are set (implicit local mode — no `.env` needed).
 */
export function shouldConnectFirebaseEmulators(): boolean {
  if (!import.meta.env.DEV) return false;
  if (import.meta.env.VITE_USE_FIREBASE_EMULATORS === "true") return true;
  return allProductionFirebaseKeysMissing();
}

function getEmulatorFirebaseConfig(): FirebaseOptions {
  const projectId =
    import.meta.env.VITE_FIREBASE_PROJECT_ID?.trim() || "showme-local";
  return {
    apiKey: "demo-api-key",
    authDomain: "localhost",
    projectId,
    storageBucket: `${projectId}.appspot.com`,
    messagingSenderId: "000000000000",
    appId: "1:000000000000:web:0000000000000000000000",
  };
}

export function getFirebaseWebConfig(): FirebaseOptions {
  if (import.meta.env.VITE_USE_FIREBASE_EMULATORS === "true") {
    return getEmulatorFirebaseConfig();
  }

  if (import.meta.env.DEV && allProductionFirebaseKeysMissing()) {
    return getEmulatorFirebaseConfig();
  }

  const config: FirebaseOptions = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
  };

  const measurementId = import.meta.env.VITE_FIREBASE_MEASUREMENT_ID;
  if (measurementId) {
    config.measurementId = measurementId;
  }

  const missing = missingProductionFirebaseKeys();
  if (missing.length > 0) {
    throw new Error(
      `Firebase is not configured. Set these in .env: ${missing.join(", ")}`,
    );
  }

  return config;
}
