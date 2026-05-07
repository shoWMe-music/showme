/**
 * Backfill Firebase Auth custom claims `{ profileIds, overflow? }` for every
 * uid that is currently an owner or member of any `profiles/{id}` doc.
 *
 * Phase 2 ships an `onProfileMemberWritten`-style trigger that maintains these
 * claims going forward, but pre-existing memberships have no claim. This is
 * the one-shot backfill. Users will pick up their new claim on natural token
 * refresh (within an hour) or next sign-in — we deliberately do NOT
 * `revokeRefreshTokens` and do NOT tick any refresh-claims sentinel doc,
 * because doing so for every uid at once would cause an N-row listener storm.
 *
 * Claim shape: `{ profileIds: string[], overflow?: true }`. Capped at 16
 * profileIds (custom-claims size budget); when a uid qualifies for more, the
 * list is truncated alphabetically and `overflow: true` is set.
 *
 * Usage:
 *   FIREBASE_PROJECT_ID=showme-production npx tsx scripts/backfill-profile-claims.ts --dry
 *   FIREBASE_PROJECT_ID=showme-production npx tsx scripts/backfill-profile-claims.ts
 *
 *   # Emulator testing (Phase 2 verification):
 *   FIRESTORE_EMULATOR_HOST=localhost:8080 FIREBASE_AUTH_EMULATOR_HOST=localhost:9099 \
 *     npx tsx scripts/backfill-profile-claims.ts --dry --allow-emulator
 *
 * Flags:
 *   --dry             do not call setCustomUserClaims; just print the plan
 *   --verbose         print one line per uid even when not changing
 *   --allow-emulator  permit running against emulator hosts (off by default)
 */

import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const verbose = args.includes("--verbose");
const allowEmulator = args.includes("--allow-emulator");

const emulatorHostsSet =
  Boolean(process.env.FIRESTORE_EMULATOR_HOST) ||
  Boolean(process.env.FIREBASE_AUTH_EMULATOR_HOST);

if (emulatorHostsSet && !allowEmulator) {
  console.error(
    "Refusing to run with emulator host vars set. Pass --allow-emulator to override.",
  );
  process.exit(1);
}

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID ?? "showme-production";
initializeApp({ projectId: PROJECT_ID });
const db = getFirestore();
const auth = getAuth();

const MAX_PROFILE_IDS = 16;

async function buildUidProfileMap(): Promise<Map<string, Set<string>>> {
  const uidToProfiles = new Map<string, Set<string>>();

  const profilesSnap = await db.collection("profiles").get();
  console.log(`Scanning ${profilesSnap.size} profiles…`);

  const addPair = (uid: string, profileId: string): void => {
    if (!uid || !profileId) return;
    let set = uidToProfiles.get(uid);
    if (!set) {
      set = new Set<string>();
      uidToProfiles.set(uid, set);
    }
    set.add(profileId);
  };

  // Bound concurrency to keep peak load reasonable on large datasets.
  const CHUNK = 25;
  for (let i = 0; i < profilesSnap.docs.length; i += CHUNK) {
    const chunk = profilesSnap.docs.slice(i, i + CHUNK);
    await Promise.all(
      chunk.map(async (p) => {
        const data = p.data() as Record<string, unknown>;
        const ownerUid =
          typeof data.owner_uid === "string" && data.owner_uid
            ? data.owner_uid
            : "";
        if (ownerUid) addPair(ownerUid, p.id);

        try {
          const membersSnap = await db
            .collection("profiles")
            .doc(p.id)
            .collection("members")
            .get();
          membersSnap.forEach((m) => {
            const mData = m.data() as Record<string, unknown>;
            const uid =
              typeof mData.user_uid === "string" && mData.user_uid
                ? mData.user_uid
                : m.id;
            addPair(uid, p.id);
          });
        } catch (err) {
          console.warn(
            `  ! profile members read failed (${p.id}): ${String(err)}`,
          );
        }
      }),
    );
  }

  return uidToProfiles;
}

async function main(): Promise<void> {
  console.log(`Project: ${PROJECT_ID}`);
  console.log(dry ? "Mode: DRY RUN (no auth writes)" : "Mode: LIVE");
  if (emulatorHostsSet) console.log("Note: emulator host vars detected (--allow-emulator).");

  const uidToProfiles = await buildUidProfileMap();
  console.log(`Found ${uidToProfiles.size} uids with profile membership.\n`);

  let processed = 0;
  let assignments = 0;
  let overflowCount = 0;
  let errors = 0;
  const failures: { uid: string; err: string }[] = [];

  const uids = Array.from(uidToProfiles.keys()).sort();

  for (const uid of uids) {
    const all = Array.from(uidToProfiles.get(uid) ?? []).sort();
    const overflow = all.length > MAX_PROFILE_IDS;
    const profileIds = overflow ? all.slice(0, MAX_PROFILE_IDS) : all;

    processed += 1;
    assignments += profileIds.length;
    if (overflow) overflowCount += 1;

    if (dry) {
      console.log(
        `  ${uid} -> [${profileIds.join(",")}] overflow=${overflow}` +
          (overflow ? ` (truncated from ${all.length})` : ""),
      );
      continue;
    }

    if (verbose) {
      console.log(
        `  ${uid} -> [${profileIds.join(",")}] overflow=${overflow}`,
      );
    }

    try {
      const claims: { profileIds: string[]; overflow?: true } = { profileIds };
      if (overflow) claims.overflow = true;
      await auth.setCustomUserClaims(uid, claims);
    } catch (err) {
      errors += 1;
      const msg = String(err);
      failures.push({ uid, err: msg });
      console.warn(`  ! setCustomUserClaims failed (${uid}): ${msg}`);
    }
  }

  console.log("\n=== Summary ===");
  console.log(`uids processed:        ${processed}`);
  console.log(`profile-id assignments: ${assignments}`);
  console.log(`overflow uids:         ${overflowCount}`);
  console.log(`errors:                ${errors}`);
  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  ${f.uid}: ${f.err}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
