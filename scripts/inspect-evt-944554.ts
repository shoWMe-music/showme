/**
 * One-off prod inspection: dumps event EVT-944554's top-level doc + meta/main
 * + the performer profile referenced on the event, and any matching profile
 * docs by name "Danielisten". Read-only.
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

async function main() {
  const eventId = "EVT-944554";
  console.log(`Inspecting ${PROJECT_ID} :: ${eventId}\n`);

  const evRef = db.collection("events").doc(eventId);
  const evSnap = await evRef.get();
  if (!evSnap.exists) {
    console.log("Event not found.");
    return;
  }
  const ev = evSnap.data() as Record<string, unknown>;
  console.log("=== events/" + eventId + " ===");
  console.log(JSON.stringify({
    id: ev.id,
    name: ev.name,
    artist: ev.artist,
    performerProfileId: ev.performerProfileId,
    hostProfileId: ev.hostProfileId,
    accessProfileIds: ev.accessProfileIds,
    accessUids: ev.accessUids,
    owner_uid: ev.owner_uid,
    primary_owner_uid: ev.primary_owner_uid,
    eventStatus: ev.eventStatus,
    isMultiPerformer: ev.isMultiPerformer,
    childEventIds: ev.childEventIds,
    parentEventId: ev.parentEventId,
    operatorType: ev.operatorType,
  }, null, 2));

  const metaSnap = await evRef.collection("meta").doc("main").get();
  console.log("\n=== events/" + eventId + "/meta/main ===");
  console.log(JSON.stringify(metaSnap.data() ?? null, null, 2));

  // Collaborators
  const collabSnap = await evRef.collection("collaborators").get();
  console.log("\n=== events/" + eventId + "/collaborators (" + collabSnap.size + ") ===");
  for (const d of collabSnap.docs) {
    console.log(JSON.stringify(d.data(), null, 2));
  }

  // Profile referenced by performerProfileId
  const performerProfileId = ev.performerProfileId as string | undefined;
  if (performerProfileId) {
    const profSnap = await db.collection("profiles").doc(performerProfileId).get();
    console.log("\n=== profiles/" + performerProfileId + " ===");
    if (!profSnap.exists) {
      console.log("(does not exist)");
    } else {
      const p = profSnap.data() as Record<string, unknown>;
      console.log(JSON.stringify({
        id: profSnap.id,
        name: p.name,
        owner_uid: p.owner_uid,
        type: p.type,
        role: p.role,
      }, null, 2));
    }
  } else {
    console.log("\n(no performerProfileId on event)");
  }

  // Any profile named "Danielisten"
  console.log("\n=== profiles where name == 'Danielisten' ===");
  const byName = await db.collection("profiles").where("name", "==", "Danielisten").get();
  console.log(`(${byName.size} match)`);
  for (const d of byName.docs) {
    const p = d.data();
    console.log(JSON.stringify({
      id: d.id,
      name: p.name,
      owner_uid: p.owner_uid,
      type: p.type,
      role: p.role,
    }, null, 2));
  }

  // For each accessUid, list their profiles (so we can see what userProfileIds would compute to)
  const accessUids = (ev.accessUids as string[]) ?? [];
  for (const uid of accessUids) {
    console.log(`\n=== profiles where owner_uid == '${uid}' ===`);
    const q = await db.collection("profiles").where("owner_uid", "==", uid).get();
    console.log(`(${q.size} match)`);
    for (const d of q.docs) {
      const p = d.data();
      console.log(JSON.stringify({
        id: d.id,
        name: p.name,
        owner_uid: p.owner_uid,
        type: p.type,
        role: p.role,
      }, null, 2));
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
