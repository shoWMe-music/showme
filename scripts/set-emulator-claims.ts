/**
 * One-off: populate `profileIds` custom claim for every emulator user, mirror
 * of the seed's syncAllClaims helper. Used when you want to fix claims without
 * a full re-seed.
 */
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8090";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
initializeApp({ projectId: "showme-local" });

const auth = getAuth();
const db = getFirestore();

async function main() {
  const list = await auth.listUsers(100);
  for (const u of list.users) {
    const ids = new Set<string>();
    const owned = await db.collection("profiles").where("owner_uid", "==", u.uid).get();
    owned.forEach((d) => { if (d.id) ids.add(d.id); });
    const members = await db.collectionGroup("members").where("user_uid", "==", u.uid).get();
    members.forEach((m) => {
      const pid = m.ref.parent.parent?.id;
      if (pid) ids.add(pid);
    });
    const sorted = Array.from(ids).sort();
    const claims: Record<string, unknown> = { profileIds: sorted.slice(0, 16) };
    if (sorted.length > 16) claims.overflow = true;
    await auth.setCustomUserClaims(u.uid, claims);
    // Ping the refresh-claims doc so the client listener picks up the new
    // token via getIdToken(true) without needing a sign-out.
    await db.collection("users").doc(u.uid).collection("_meta").doc("refreshClaims")
      .set({ ts: FieldValue.serverTimestamp() }, { merge: true });
    console.log(`${u.uid} (${u.email}): ${sorted.length} profileIds`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
