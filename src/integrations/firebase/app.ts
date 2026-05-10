import type { FirebaseApp } from "firebase/app";
import { getApps, initializeApp } from "firebase/app";
import type { Firestore } from "firebase/firestore";
import {
  connectFirestoreEmulator,
  initializeFirestore,
  getFirestore,
} from "firebase/firestore";
import type { FirebaseStorage } from "firebase/storage";
import { connectStorageEmulator, getStorage } from "firebase/storage";
import type { Functions } from "firebase/functions";
import { connectFunctionsEmulator, getFunctions } from "firebase/functions";
import { getFirebaseWebConfig, shouldConnectFirebaseEmulators } from "./config";

let firestoreEmulatorConnected = false;
let storageEmulatorConnected = false;
let functionsEmulatorConnected = false;

export function getFirebaseApp(): FirebaseApp {
  const apps = getApps();
  if (apps.length > 0) {
    return apps[0];
  }
  return initializeApp(getFirebaseWebConfig());
}

let firestoreInstance: Firestore | null = null;

export function getFirestoreDb(): Firestore {
  if (firestoreInstance) return firestoreInstance;

  const app = getFirebaseApp();

  // ignoreUndefinedProperties strips nested `undefined` before write — the
  // emulator tolerates them but the real backend rejects, which silently
  // breaks any save with an optional field cleared to undefined (e.g.
  // SubVenue.sittingCapacity).
  // Against the emulator, force long-polling: WebChannel is flaky there and
  // the auto-detect path adds multi-second stalls before falling back. In
  // prod, auto-detect is fine.
  const useEmulators = shouldConnectFirebaseEmulators();
  const db = initializeFirestore(app, {
    ...(useEmulators
      ? { experimentalForceLongPolling: true }
      : { experimentalAutoDetectLongPolling: true }),
    ignoreUndefinedProperties: true,
  });

  if (useEmulators && !firestoreEmulatorConnected) {
    const host = import.meta.env.VITE_FIRESTORE_EMULATOR_HOST ?? "127.0.0.1";
    const port = Number(import.meta.env.VITE_FIRESTORE_EMULATOR_PORT ?? "8090");
    connectFirestoreEmulator(db, host, port);
    firestoreEmulatorConnected = true;
  }

  firestoreInstance = db;
  return db;
}

export function getFirebaseStorage(): FirebaseStorage {
  const storage = getStorage(getFirebaseApp());

  if (shouldConnectFirebaseEmulators() && !storageEmulatorConnected) {
    const host = import.meta.env.VITE_STORAGE_EMULATOR_HOST ?? "127.0.0.1";
    const port = Number(import.meta.env.VITE_STORAGE_EMULATOR_PORT ?? "9199");
    connectStorageEmulator(storage, host, port);
    storageEmulatorConnected = true;
  }

  return storage;
}

export function getFirebaseFunctions(): Functions {
  const f = getFunctions(getFirebaseApp(), "europe-west1");

  if (shouldConnectFirebaseEmulators() && !functionsEmulatorConnected) {
    const host = import.meta.env.VITE_FUNCTIONS_EMULATOR_HOST ?? "127.0.0.1";
    const port = Number(import.meta.env.VITE_FUNCTIONS_EMULATOR_PORT ?? "5001");
    connectFunctionsEmulator(f, host, port);
    functionsEmulatorConnected = true;
  }

  return f;
}
