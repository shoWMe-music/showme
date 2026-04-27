/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN: string;
  readonly VITE_FIREBASE_PROJECT_ID: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID: string;
  readonly VITE_FIREBASE_APP_ID: string;
  readonly VITE_FIREBASE_MEASUREMENT_ID?: string;
  readonly VITE_USE_FIREBASE_EMULATORS?: string;
  readonly VITE_FIRESTORE_EMULATOR_HOST?: string;
  readonly VITE_FIRESTORE_EMULATOR_PORT?: string;
  readonly VITE_STORAGE_EMULATOR_HOST?: string;
  readonly VITE_STORAGE_EMULATOR_PORT?: string;
  readonly VITE_FUNCTIONS_EMULATOR_HOST?: string;
  readonly VITE_FUNCTIONS_EMULATOR_PORT?: string;
  readonly VITE_FIREBASE_AUTH_EMULATOR_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
