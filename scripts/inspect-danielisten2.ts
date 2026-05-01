/**
 * One-off prod inspection: dumps the public profile with slug "danielisten2"
 * and all events that *should* show up under "Coming Events" on its public page,
 * plus any events that name-match but were filtered out by the
 * `fetchPublishedEvents` pre-filter (published + confirmed + non-archived).
 * Read-only.
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

const SLUG = "danielisten2";

async function main() {
  console.log(`Inspecting ${PROJECT_ID} :: profile slug=${SLUG}\n`);

  // 1. Find profile by slug
  const profSnap = await db
    .collection("profiles")
    .where("slug", "==", SLUG)
    .limit(5)
    .get();
  if (profSnap.empty) {
    console.log("No profile found with that slug.");
    return;
  }
  console.log(`=== profiles where slug=${SLUG} (${profSnap.size}) ===`);
  for (const d of profSnap.docs) {
    const p = d.data() as Record<string, unknown>;
    console.log(JSON.stringify({
      docId: d.id,
      slot: p.slot,
      type: p.type,
      role: p.role,
      name: p.name,
      slug: p.slug,
      isPublic: p.isPublic,
      created: p.created,
      owner_uid: p.owner_uid,
    }, null, 2));
  }

  const profileDoc = profSnap.docs[0];
  const profileId = profileDoc.id;
  const profile = profileDoc.data() as Record<string, unknown>;
  const profileName = (profile.name as string | undefined)?.toLowerCase() ?? "";
  const ownerUid = profile.owner_uid as string | undefined;

  console.log(`\nUsing profileId=${profileId}, name=${JSON.stringify(profileName)}, owner_uid=${ownerUid}\n`);

  // 2. Events where this profile is host
  const byHost = await db
    .collection("events")
    .where("hostProfileId", "==", profileId)
    .limit(50)
    .get();
  console.log(`=== events where hostProfileId=${profileId} (${byHost.size}) ===`);
  for (const d of byHost.docs) summarizeEvent(d.id, d.data());

  // 3. Events where this profile is performer
  const byPerf = await db
    .collection("events")
    .where("performerProfileId", "==", profileId)
    .limit(50)
    .get();
  console.log(`\n=== events where performerProfileId=${profileId} (${byPerf.size}) ===`);
  for (const d of byPerf.docs) summarizeEvent(d.id, d.data());

  // 4. Events where this profile appears in accessProfileIds
  const byAccess = await db
    .collection("events")
    .where("accessProfileIds", "array-contains", profileId)
    .limit(50)
    .get();
  console.log(`\n=== events where accessProfileIds contains ${profileId} (${byAccess.size}) ===`);
  for (const d of byAccess.docs) summarizeEvent(d.id, d.data());

  // 5. All events owned by this user (regardless of profile linkage)
  if (ownerUid) {
    const byOwner = await db
      .collection("events")
      .where("accessUids", "array-contains", ownerUid)
      .limit(50)
      .get();
    console.log(`\n=== events where accessUids contains owner ${ownerUid} (${byOwner.size}) ===`);
    for (const d of byOwner.docs) summarizeEvent(d.id, d.data());
  }

  // 6. Name-substring scan over the most recent 200 events (mirrors the page's
  //    fetchPublishedEvents window) — what the legacy fallback would catch.
  const recent = await db
    .collection("events")
    .orderBy("date", "desc")
    .limit(200)
    .get();
  const matches = recent.docs.filter((d) => {
    const e = d.data() as Record<string, unknown>;
    const venue = ((e.venue as string) ?? "").toLowerCase();
    const artist = ((e.artist as string) ?? "").toLowerCase();
    const operator = ((e.operator as string) ?? "").toLowerCase();
    return profileName && (
      venue.includes(profileName) ||
      artist.includes(profileName) ||
      operator.includes(profileName)
    );
  });
  console.log(`\n=== name-substring matches in newest 200 events for "${profileName}" (${matches.length}) ===`);
  for (const d of matches) summarizeEvent(d.id, d.data());

  // 7. Show what fetchPublishedEvents would have actually returned
  const published = await db
    .collection("events")
    .where("published", "==", true)
    .where("eventStatus", "==", "confirmed")
    .orderBy("date", "desc")
    .limit(200)
    .get();
  console.log(`\n=== fetchPublishedEvents window: published=true + eventStatus=confirmed, newest 200 (${published.size}) ===`);
  console.log(`(filtered to those involving profileId=${profileId} OR name "${profileName}")`);
  const today = new Date().toISOString().split("T")[0];
  let matched = 0;
  for (const d of published.docs) {
    const e = d.data() as Record<string, unknown>;
    if (e.archived === true) continue;
    const venue = ((e.venue as string) ?? "").toLowerCase();
    const artist = ((e.artist as string) ?? "").toLowerCase();
    const operator = ((e.operator as string) ?? "").toLowerCase();
    const accessIds = (e.accessProfileIds as string[] | undefined) ?? [];
    const hits =
      e.hostProfileId === profileId ||
      e.performerProfileId === profileId ||
      accessIds.includes(profileId) ||
      (profileName && (venue.includes(profileName) || artist.includes(profileName) || operator.includes(profileName)));
    if (!hits) continue;
    matched++;
    console.log(`- ${d.id} date=${e.date} future=${(e.date as string) >= today} archived=${e.archived ?? false} published=${e.published} status=${e.eventStatus}`);
  }
  console.log(`Matched ${matched} candidate(s) in the published+confirmed window.`);
}

function summarizeEvent(id: string, e: Record<string, unknown>) {
  console.log(`- ${id}: date=${e.date} status=${e.eventStatus} published=${e.published} archived=${e.archived ?? false} venue=${JSON.stringify(e.venue)} artist=${JSON.stringify(e.artist)} operator=${JSON.stringify(e.operator)} hostPid=${e.hostProfileId} perfPid=${e.performerProfileId}`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
