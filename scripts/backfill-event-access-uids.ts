/**
 * Backfill `accessUids` on every `events/{id}` doc to the canonical set:
 *   owner_uid + members of every accessProfileId on the event
 *   + every active collaborator userUid.
 *
 * Used once after deploying the `onProfileMemberWritten` trigger to repair
 * historic drift (e.g. ran@ran-nir.com being added as admin to a performer
 * profile after that profile's events were already created — the events'
 * accessUids never picked up his uid, so his event-list query returns 0).
 *
 * Mirrors `computeEventAccessUids` in functions/src/profileMembers.ts. Keep
 * the two in sync.
 *
 * Usage:
 *   FIREBASE_PROJECT_ID=showme-production npx tsx scripts/backfill-event-access-uids.ts --dry
 *   FIREBASE_PROJECT_ID=showme-production npx tsx scripts/backfill-event-access-uids.ts
 *
 * --dry prints planned changes without writing.
 */

import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

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

async function computeEventAccessUids(
  eventId: string,
  ev: FirebaseFirestore.DocumentData,
): Promise<string[]> {
  const accessProfileIds: string[] = Array.isArray(ev.accessProfileIds)
    ? (ev.accessProfileIds as string[]).filter((p) => typeof p === "string" && p)
    : [];
  const owner_uid = typeof ev.owner_uid === "string" ? ev.owner_uid : "";

  const uids = new Set<string>();
  if (owner_uid) uids.add(owner_uid);

  await Promise.all(
    accessProfileIds.map(async (pid) => {
      try {
        const snap = await db
          .collection("profiles")
          .doc(pid)
          .collection("members")
          .get();
        snap.forEach((m) => {
          const data = m.data() as Record<string, unknown>;
          const u =
            typeof data.user_uid === "string" && data.user_uid
              ? data.user_uid
              : m.id;
          if (u) uids.add(u);
        });
      } catch (err) {
        console.warn(`  ! profile members read failed (${pid}):`, String(err));
      }
    }),
  );

  try {
    const collabSnap = await db
      .collection("events")
      .doc(eventId)
      .collection("collaborators")
      .get();
    collabSnap.forEach((c) => {
      const data = c.data() as Record<string, unknown>;
      if (String(data.status ?? "") !== "active") return;
      const u = typeof data.userUid === "string" ? data.userUid : "";
      if (u) uids.add(u);
    });
  } catch (err) {
    console.warn(`  ! collaborators read failed (${eventId}):`, String(err));
  }

  return Array.from(uids);
}

function setsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = new Set(a);
  for (const v of b) if (!sa.has(v)) return false;
  return true;
}

async function main() {
  console.log(`Project: ${PROJECT_ID}`);
  console.log(dry ? "Mode: DRY RUN (no writes)" : "Mode: LIVE");

  const allEvents = await db.collection("events").get();
  console.log(`Scanning ${allEvents.size} events…\n`);

  let scanned = 0;
  let updated = 0;
  let unchanged = 0;
  const failures: { eventId: string; err: string }[] = [];

  // Process in chunks to keep peak concurrency bounded.
  const CHUNK = 25;
  for (let i = 0; i < allEvents.docs.length; i += CHUNK) {
    const chunk = allEvents.docs.slice(i, i + CHUNK);
    await Promise.all(
      chunk.map(async (d) => {
        scanned += 1;
        const ev = d.data();
        const next = await computeEventAccessUids(d.id, ev);
        const prev: string[] = Array.isArray(ev.accessUids)
          ? (ev.accessUids as string[])
          : [];
        if (setsEqual(prev, next)) {
          unchanged += 1;
          if (verbose) console.log(`  = ${d.id}: unchanged (${next.length} uids)`);
          return;
        }
        const added = next.filter((u) => !prev.includes(u));
        const removed = prev.filter((u) => !next.includes(u));
        console.log(
          `  ~ ${d.id}: ${prev.length} -> ${next.length}` +
            (added.length ? ` +${added.length} (${added.join(",")})` : "") +
            (removed.length ? ` -${removed.length} (${removed.join(",")})` : ""),
        );
        if (dry) {
          updated += 1;
          return;
        }
        try {
          await d.ref.update({
            accessUids: next,
            updatedAt: FieldValue.serverTimestamp(),
          });
          updated += 1;
        } catch (err) {
          failures.push({ eventId: d.id, err: String(err) });
        }
      }),
    );
  }

  console.log("\n=== Summary ===");
  console.log(`scanned:   ${scanned}`);
  console.log(`updated:   ${updated}`);
  console.log(`unchanged: ${unchanged}`);
  console.log(`failed:    ${failures.length}`);
  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  ${f.eventId}: ${f.err}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
