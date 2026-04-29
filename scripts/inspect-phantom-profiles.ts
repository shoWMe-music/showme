import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

if (process.env.FIRESTORE_EMULATOR_HOST) process.exit(1);
initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? "showme-production" });
const db = getFirestore();

const PIDS = ["NfBOOnLcF6axU6pfsJC5k5njuTN2__artist", "S1RyyrrepjCzlc3XqE5J"];

async function main() {
  for (const pid of PIDS) {
    const ref = db.collection("profiles").doc(pid);
    const snap = await ref.get();
    console.log(`\nprofiles/${pid}`);
    console.log(`  exists=${snap.exists}`);
    const subs = await ref.listCollections();
    for (const s of subs) {
      const docs = await s.listDocuments();
      console.log(`  /${s.id}  ${docs.length} doc(s)`);
      for (const d of docs.slice(0, 5)) {
        const dsnap = await d.get();
        const data = dsnap.data();
        const preview = data ? JSON.stringify(data).slice(0, 180) : "(implicit)";
        console.log(`    ${d.id}: ${preview}`);
      }
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
