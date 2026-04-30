/**
 * One-off: remove stale `__artist`-suffixed keys from
 * `events/{id}/meta/main.pendingDateChange.confirmations`. Left over from a
 * migration script that used set({merge:true}) — which deep-merges the nested
 * map and won't drop the renamed key. Use update() with FieldValue.delete()
 * instead.
 */
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

if (process.env.FIRESTORE_EMULATOR_HOST) { console.error("emulator vars set"); process.exit(1); }
initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? "showme-production" });
const db = getFirestore();

async function main() {
  const eventIds = ["EVT-944554", "EVT-836147"];
  for (const eid of eventIds) {
    const metaRef = db.collection("events").doc(eid).collection("meta").doc("main");
    const snap = await metaRef.get();
    const conf = (snap.data()?.pendingDateChange as { confirmations?: Record<string, unknown> } | undefined)?.confirmations ?? {};
    const stale = Object.keys(conf).filter((k) => k.endsWith("__artist"));
    if (stale.length === 0) {
      console.log(`${eid}: no stale __artist keys`);
      continue;
    }
    const updates: Record<string, FirebaseFirestore.FieldValue> = {};
    for (const k of stale) updates[`pendingDateChange.confirmations.${k}`] = FieldValue.delete();
    await metaRef.update(updates);
    console.log(`${eid}: deleted ${stale.length} stale key(s) → ${stale.join(", ")}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
