/**
 * Backfill `target_profile_id` on every `inboundBookingRequests/{id}` doc that
 * predates the field being written by the public request form.
 *
 * Resolution: `target_profile_slug` (already on every doc) → look up
 * `profiles where slug == target_profile_slug limit 1` → write that profile's
 * id into `target_profile_id`. The new client query / Firestore rule both read
 * `target_profile_id`, so any doc without it is invisible to profile admins
 * (only the owner sees it via the legacy `owner_uid` rule path).
 *
 * Profile slug → id is cached in-process to keep large scans cheap; the same
 * slug usually appears many times (one slug per venue, one request per night).
 *
 * Idempotent: docs already carrying a non-empty `target_profile_id` are
 * skipped, so re-runs are safe.
 *
 * Usage:
 *   FIREBASE_PROJECT_ID=showme-production npx tsx \
 *     scripts/backfill-booking-request-target-profile-id.ts --dry
 *   FIREBASE_PROJECT_ID=showme-production npx tsx \
 *     scripts/backfill-booking-request-target-profile-id.ts
 *
 *   --dry       print planned writes without committing
 *   --verbose   include skipped rows in the log
 *
 * Unresolved slugs (orphaned — the matching profile was renamed or deleted)
 * are logged as warnings and counted in the summary; they're not treated as
 * errors because they pre-date the slug becoming a stable identifier.
 */

import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  console.error("Refusing to run with emulator host vars set.");
  process.exit(1);
}

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID ?? "showme-production";
initializeApp({ projectId: PROJECT_ID });
const db = getFirestore();

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const verbose = args.includes("--verbose");

const slugCache = new Map<string, string | null>();

async function resolveProfileIdBySlug(slug: string): Promise<string | null> {
  if (slugCache.has(slug)) return slugCache.get(slug)!;
  const snap = await db
    .collection("profiles")
    .where("slug", "==", slug)
    .limit(1)
    .get();
  const id = snap.empty ? null : snap.docs[0].id;
  slugCache.set(slug, id);
  return id;
}

async function main() {
  console.log(`Project: ${PROJECT_ID}`);
  console.log(dry ? "Mode: DRY RUN (no writes)" : "Mode: LIVE");

  const allDocs = await db.collection("inboundBookingRequests").get();
  console.log(`Scanning ${allDocs.size} inbound booking requests…\n`);

  let scanned = 0;
  let alreadySet = 0;
  let backfilled = 0;
  let unresolved = 0;
  let missingSlug = 0;
  const failures: { id: string; err: string }[] = [];

  // Process in chunks so peak concurrency stays bounded while we still
  // benefit from the slug cache when many requests target the same profile.
  const CHUNK = 25;
  for (let i = 0; i < allDocs.docs.length; i += CHUNK) {
    const chunk = allDocs.docs.slice(i, i + CHUNK);
    await Promise.all(
      chunk.map(async (d) => {
        scanned += 1;
        const data = d.data() as Record<string, unknown>;
        const existing = typeof data.target_profile_id === "string" ? data.target_profile_id : "";
        if (existing) {
          alreadySet += 1;
          if (verbose) console.log(`  = ${d.id}: already has target_profile_id=${existing}`);
          return;
        }
        const slug = typeof data.target_profile_slug === "string" ? data.target_profile_slug.trim() : "";
        if (!slug) {
          missingSlug += 1;
          console.warn(`  ! ${d.id}: no target_profile_slug — cannot resolve`);
          return;
        }
        let profileId: string | null = null;
        try {
          profileId = await resolveProfileIdBySlug(slug);
        } catch (err) {
          failures.push({ id: d.id, err: String(err) });
          return;
        }
        if (!profileId) {
          unresolved += 1;
          console.warn(`  ? ${d.id}: slug "${slug}" did not resolve to any profile (orphaned, skipping)`);
          return;
        }
        console.log(`  + ${d.id}: ${slug} -> ${profileId}`);
        if (dry) {
          backfilled += 1;
          return;
        }
        try {
          await d.ref.update({ target_profile_id: profileId });
          backfilled += 1;
        } catch (err) {
          failures.push({ id: d.id, err: String(err) });
        }
      }),
    );
  }

  console.log("\n=== Summary ===");
  console.log(`scanned:       ${scanned}`);
  console.log(`already set:   ${alreadySet}`);
  console.log(`backfilled:    ${backfilled}${dry ? " (would-write)" : ""}`);
  console.log(`unresolved:    ${unresolved}`);
  console.log(`missing slug:  ${missingSlug}`);
  console.log(`failed:        ${failures.length}`);
  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  ${f.id}: ${f.err}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
