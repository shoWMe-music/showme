/**
 * One-off read-only inspection of Auth + Firestore users in prod.
 * Counts auth accounts, samples profile owner_uids, checks for user docs at any path.
 */

import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  console.error("Refusing to run with emulator host vars set.");
  process.exit(1);
}

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID ?? "showme-production";
initializeApp({ projectId: PROJECT_ID });
const auth = getAuth();
const db = getFirestore();

async function main() {
  console.log(`Inspecting ${PROJECT_ID}…\n`);

  // 1. Count Auth accounts
  let total = 0;
  const sample: { uid: string; email?: string; created: string }[] = [];
  let pageToken: string | undefined;
  do {
    const page = await auth.listUsers(1000, pageToken);
    total += page.users.length;
    if (sample.length < 10) {
      for (const u of page.users) {
        if (sample.length >= 10) break;
        sample.push({
          uid: u.uid,
          email: u.email,
          created: u.metadata.creationTime,
        });
      }
    }
    pageToken = page.pageToken;
  } while (pageToken);

  console.log(`Firebase Auth accounts: ${total}`);
  console.log("Sample (up to 10):");
  for (const s of sample) {
    console.log(`  ${s.uid}  ${s.email ?? "(no email)"}  created ${s.created}`);
  }

  // 2. For each sampled uid, does users/{uid} doc exist? Settings? Sub-anything?
  console.log("\nFirestore presence per sampled uid:");
  for (const s of sample) {
    const userDoc = await db.collection("users").doc(s.uid).get();
    const settingsDoc = await db.collection("users").doc(s.uid).collection("settings").doc("main").get();
    const subs = await db.collection("users").doc(s.uid).listCollections();
    const subList = subs.length === 0 ? "(none)" : subs.map((c) => c.id).join(", ");
    console.log(
      `  ${s.uid}  doc=${userDoc.exists}  settings/main=${settingsDoc.exists}  subs=[${subList}]`,
    );
  }

  // 3. Profile owner_uid distribution (helps understand who's actually using the app)
  const profiles = await db.collection("profiles").get();
  const ownerUids = new Map<string, number>();
  for (const p of profiles.docs) {
    const data = p.data();
    const owner = typeof data.owner_uid === "string" ? data.owner_uid : "(missing)";
    ownerUids.set(owner, (ownerUids.get(owner) ?? 0) + 1);
  }
  console.log(`\nProfile owners (${profiles.size} profiles total):`);
  for (const [uid, count] of [...ownerUids.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    console.log(`  ${uid.padEnd(40)} ${count} profile(s)`);
  }

  // 4. Profile members presence — are any uids actually members?
  let memberDocsTotal = 0;
  const memberUids = new Set<string>();
  for (const p of profiles.docs) {
    const members = await p.ref.collection("members").get();
    memberDocsTotal += members.size;
    for (const m of members.docs) {
      const u = (m.data() as { user_uid?: string; uid?: string }).user_uid ??
                (m.data() as { uid?: string }).uid ??
                m.id;
      if (typeof u === "string") memberUids.add(u);
    }
  }
  console.log(`\nProfile members: ${memberDocsTotal} member docs across ${memberUids.size} unique uids`);

  // 5. Cross-reference: how many Auth uids are referenced by profiles (as owner or member)?
  const referencedUids = new Set<string>([...memberUids, ...ownerUids.keys()]);
  referencedUids.delete("(missing)");
  let authedReferenced = 0;
  for (const uid of referencedUids) {
    try {
      await auth.getUser(uid);
      authedReferenced++;
    } catch {
      // not in auth
    }
  }
  console.log(
    `\nAuth uids referenced by profiles: ${referencedUids.size} (of which ${authedReferenced} still exist in Auth)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
