/**
 * Migrate legacy `${uid}__artist` profile doc IDs to `${uid}__performer`.
 *
 * The doc ID is the canonical reference key for events (performerProfileId,
 * hostProfileId, accessProfileIds, pendingDateChange.confirmations[id]).
 * The legacy `__artist` suffix predates the artist→performer rename and now
 * collides in fetchProfiles when the same user also owns a stub profile with
 * slot="performer", causing the artist profile to be silently dropped client-side.
 *
 * Usage:
 *   FIREBASE_PROJECT_ID=showme-production npx tsx scripts/migrate-legacy-artist-profile.ts <oldId>
 *   FIREBASE_PROJECT_ID=showme-production npx tsx scripts/migrate-legacy-artist-profile.ts --all
 *   FIREBASE_PROJECT_ID=showme-production npx tsx scripts/migrate-legacy-artist-profile.ts <oldId> --dry
 *
 * --dry prints what would happen without writing.
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
const all = args.includes("--all");
const explicitId = args.find((a) => a !== "--dry" && a !== "--all");

function newIdFromOld(oldId: string): string {
  if (!oldId.endsWith("__artist")) throw new Error(`not a legacy id: ${oldId}`);
  return oldId.replace(/__artist$/, "__performer");
}

async function findAllLegacyIds(): Promise<string[]> {
  const snap = await db.collection("profiles").get();
  return snap.docs.map((d) => d.id).filter((id) => id.endsWith("__artist"));
}

async function migrateOne(oldId: string): Promise<void> {
  const newId = newIdFromOld(oldId);
  console.log(`\n── ${oldId}  →  ${newId}`);

  const oldRef = db.collection("profiles").doc(oldId);
  const newRef = db.collection("profiles").doc(newId);

  const [oldSnap, newSnap] = await Promise.all([oldRef.get(), newRef.get()]);
  if (!oldSnap.exists) {
    console.log(`  source doc missing — skipping`);
    return;
  }
  if (newSnap.exists) {
    console.log(`  target ${newId} already exists — manual merge required, skipping`);
    return;
  }

  const data = { ...(oldSnap.data() ?? {}), slot: "performer", role: "performer" };
  console.log(`  profile body: name="${data.name}", role="${data.role}", slot="${data.slot}"`);

  // Subcollections
  const subcols = await oldRef.listCollections();
  console.log(`  subcollections: ${subcols.map((c) => c.id).join(", ") || "(none)"}`);
  const subDocs: { col: string; id: string; data: FirebaseFirestore.DocumentData }[] = [];
  for (const col of subcols) {
    const ds = await col.get();
    for (const d of ds.docs) subDocs.push({ col: col.id, id: d.id, data: d.data() });
  }
  if (subDocs.length) console.log(`  subcollection docs to copy: ${subDocs.length}`);

  // Find dependent events
  const eventsSnap = await db.collection("events").get();
  const eventsToPatch: {
    id: string;
    fields: Record<string, unknown>;
    metaPatch?: { renameKey: string };
  }[] = [];
  for (const e of eventsSnap.docs) {
    const ev = e.data() as Record<string, unknown>;
    const fields: Record<string, unknown> = {};
    if (ev.performerProfileId === oldId) fields.performerProfileId = newId;
    if (ev.hostProfileId === oldId) fields.hostProfileId = newId;
    if (Array.isArray(ev.accessProfileIds) && (ev.accessProfileIds as unknown[]).includes(oldId)) {
      fields.accessProfileIds = (ev.accessProfileIds as string[]).map((x) => (x === oldId ? newId : x));
    }
    if (Object.keys(fields).length === 0) continue;
    eventsToPatch.push({ id: e.id, fields });
  }

  // pendingDateChange map-key rename — read each candidate event's meta/main
  for (const ep of eventsToPatch) {
    const metaSnap = await db.collection("events").doc(ep.id).collection("meta").doc("main").get();
    const meta = metaSnap.data();
    const pdc = (meta?.pendingDateChange ?? null) as
      | { confirmations?: Record<string, unknown> }
      | null;
    if (pdc?.confirmations && Object.prototype.hasOwnProperty.call(pdc.confirmations, oldId)) {
      ep.metaPatch = { renameKey: oldId };
    }
  }

  console.log(`  events to patch: ${eventsToPatch.length}`);
  for (const ep of eventsToPatch) {
    console.log(`    - ${ep.id}: ${Object.keys(ep.fields).join(", ")}${ep.metaPatch ? " + meta/main.pendingDateChange.confirmations key rename" : ""}`);
  }

  if (dry) {
    console.log(`  [dry] no writes`);
    return;
  }

  // 1) Write new profile doc
  await newRef.set(data);

  // 2) Copy subcollections to new doc
  for (const sd of subDocs) {
    await newRef.collection(sd.col).doc(sd.id).set(sd.data);
  }

  // 3) Patch events
  for (const ep of eventsToPatch) {
    await db.collection("events").doc(ep.id).set(ep.fields, { merge: true });
    if (ep.metaPatch) {
      // Map-key rename: must use update() with dot-path + FieldValue.delete()
      // because set({merge:true}) deep-merges nested maps and won't drop the old key.
      const metaRef = db.collection("events").doc(ep.id).collection("meta").doc("main");
      const metaSnap = await metaRef.get();
      const pdc = (metaSnap.data()?.pendingDateChange ?? {}) as { confirmations?: Record<string, unknown> };
      const entry = pdc.confirmations?.[oldId];
      await metaRef.update({
        [`pendingDateChange.confirmations.${oldId}`]: FieldValue.delete(),
        [`pendingDateChange.confirmations.${newId}`]: entry,
      });
    }
  }

  // 4) Delete old subcollection docs
  for (const sd of subDocs) {
    await oldRef.collection(sd.col).doc(sd.id).delete();
  }

  // 5) Delete old profile doc
  await oldRef.delete();

  console.log(`  ✓ migrated`);
}

async function main() {
  if (!explicitId && !all) {
    console.error("Usage: <oldId> | --all  [--dry]");
    process.exit(1);
  }

  const ids = all ? await findAllLegacyIds() : [explicitId!];
  console.log(`Project: ${PROJECT_ID}  |  ids: ${ids.length}  |  dry=${dry}`);
  for (const id of ids) {
    try {
      await migrateOne(id);
    } catch (e) {
      console.error(`  ✗ ${id}: ${(e as Error).message}`);
    }
  }
  console.log(`\nDone.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
