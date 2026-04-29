import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? "showme-production" });
const db = getFirestore();

const PID = "S1RyyrrepjCzlc3XqE5J";

async function main() {
  console.log(`Investigating profiles/${PID}…\n`);

  // 1. All subcollections + every doc with full data
  const ref = db.collection("profiles").doc(PID);
  console.log(`exists=${(await ref.get()).exists}`);
  const subs = await ref.listCollections();
  for (const s of subs) {
    const docs = await s.listDocuments();
    console.log(`\n/${s.id}  ${docs.length} doc(s)`);
    for (const d of docs) {
      const snap = await d.get();
      console.log(`  ${d.id}: ${JSON.stringify(snap.data(), null, 2).slice(0, 400)}`);
    }
  }

  // 2. Cross-reference: any event with hostProfileId or accessProfileIds containing this pid?
  console.log("\nSearching events for references…");
  const evHost = await db.collection("events").where("hostProfileId", "==", PID).get();
  console.log(`  hostProfileId: ${evHost.size} events`);
  for (const e of evHost.docs) {
    console.log(`    ${e.id}: ${(e.data() as { name?: string }).name ?? "(no name)"}`);
  }
  const evAccess = await db.collection("events").where("accessProfileIds", "array-contains", PID).get();
  console.log(`  accessProfileIds: ${evAccess.size} events`);

  // 3. Cross-reference: notifications anywhere mentioning this pid?
  console.log("\nSearching profile notifications for references…");
  const allProfiles = await db.collection("profiles").listDocuments();
  let notifHits = 0;
  for (const p of allProfiles) {
    const notifs = await p.collection("notifications").listDocuments();
    for (const n of notifs) {
      const data = (await n.get()).data() as Record<string, unknown> | undefined;
      if (!data) continue;
      const blob = JSON.stringify(data);
      if (blob.includes(PID)) {
        notifHits++;
        console.log(`  profiles/${p.id}/notifications/${n.id}: ${blob.slice(0, 200)}`);
      }
    }
  }
  console.log(`  total: ${notifHits} notifications mention this pid`);

  // 4. Look at the actual team member email — search for that email anywhere
  console.log("\nSearching for kulturhais-insel@gmail.com…");
  const teamSnap = await ref.collection("team").get();
  for (const t of teamSnap.docs) {
    console.log(`  team member: ${JSON.stringify(t.data())}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
