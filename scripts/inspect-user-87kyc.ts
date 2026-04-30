import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
if (process.env.FIRESTORE_EMULATOR_HOST) { console.error("emulator vars set"); process.exit(1); }
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID ?? "showme-production";
initializeApp({ projectId: PROJECT_ID });
const db = getFirestore();
async function main() {
  const uid = "87kycTI0GkSyQEAVWnEpIrMNlP13";
  const userSnap = await db.collection("users").doc(uid).get();
  console.log(`=== users/${uid} ===`);
  console.log(JSON.stringify(userSnap.data() ?? null, null, 2));
  const subcols = await db.collection("users").doc(uid).listCollections();
  console.log(`\nusers/${uid} subcollections: ${subcols.map(c=>c.id).join(", ")}`);
  // All profiles owned by uid, sorted to match Firestore default order
  const all = await db.collection("profiles").where("owner_uid", "==", uid).get();
  console.log(`\n=== ALL profiles owned by ${uid} (in Firestore default order) ===`);
  for (const d of all.docs) {
    const raw = d.data();
    console.log(`docId="${d.id}"  slot="${raw.slot}"  role="${raw.role}"  name="${raw.name}"`);
  }
}
main().catch(e=>{console.error(e);process.exit(1);});
