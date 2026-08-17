/**
 * Seeds the Firebase **Auth emulator** with the canonical E2E accounts, one per
 * account kind (plus a second performer). Each user is created with its uid
 * PINNED to `E2E_ACCOUNTS.*.uid` so it matches the Postgres `users.id` the DB
 * seed writes — that alignment is what lets a browser log in and have the API
 * resolve the right principal.
 *
 * Refuses to run unless `FIREBASE_AUTH_EMULATOR_HOST` is set: this must never
 * touch a real Firebase project. Idempotent — deletes any existing user with the
 * same uid first, so re-runs are clean.
 *
 *   FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
 *   tsx apps/api/src/seed-emulator-auth.ts
 */
import { E2E_ACCOUNT_LIST } from "@showme/shared";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID ?? "demo-showme";

async function main(): Promise<void> {
  if (!process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error(
      "Refusing to seed: FIREBASE_AUTH_EMULATOR_HOST is not set. This script only " +
        "targets the Firebase Auth emulator, never a real project.",
    );
  }

  // No credential needed against the emulator — the project id is enough.
  const app = initializeApp({ projectId: PROJECT_ID });
  const auth = getAuth(app);

  for (const account of E2E_ACCOUNT_LIST) {
    // Delete-then-create so uid/email/password are always exactly as declared.
    await auth.deleteUser(account.uid).catch(() => {});
    await auth.createUser({
      uid: account.uid,
      email: account.email,
      emailVerified: true,
      password: account.password,
      displayName: account.displayName,
    });
    console.log(`  auth ✓ ${account.kind.padEnd(13)} ${account.email} (uid ${account.uid})`);
  }

  console.log(`Seeded ${E2E_ACCOUNT_LIST.length} Auth-emulator users.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
