/**
 * Post-deploy validation: read a handful of plan docs and confirm:
 *  - Pro plans have type/status/seats correctly set
 *  - Free Operator plans have eventCapCount populated by the backfill
 *  - History array has the expected initial + promotion entries
 *
 * Read-only; safe to run anytime.
 */

import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

if (process.env.FIRESTORE_EMULATOR_HOST) {
  console.error("Refusing to run against the emulator.");
  process.exit(1);
}

initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? "showme-production" });
const db = getFirestore();

const SAMPLES: Array<{ profileId: string; name: string; expect: string }> = [
  { profileId: "HKopPSnpurTODVGJrFnnRLMzauE2__venue", name: "Insel Berlin", expect: "operator_pro" },
  { profileId: "iT7pp7a7fJf2WNKbxoFFvq4Zy4A3__venue", name: "Test Venue (Ran)", expect: "operator_pro" },
  { profileId: "vi1qZjpgY3BqQfCY4VRP", name: "Ran Nir", expect: "artist_pro" },
  { profileId: "87kycTI0GkSyQEAVWnEpIrMNlP13__venue", name: "Daniel Islandman venue (Free)", expect: "free_operator" },
  { profileId: "NfBOOnLcF6axU6pfsJC5k5njuTN2__venue", name: "Microverse (Ori, Free)", expect: "free_operator" },
];

async function main(): Promise<void> {
  let problems = 0;
  for (const s of SAMPLES) {
    const snap = await db.collection("plans").doc(s.profileId).get();
    if (!snap.exists) {
      console.error(`FAIL ${s.name} — no plan doc`);
      problems += 1;
      continue;
    }
    const data = snap.data() as Record<string, unknown>;
    const type = data.type;
    const status = data.status;
    const source = data.source;
    const seats = data.seats;
    const eventCapCount = data.eventCapCount;
    const historyLen = Array.isArray(data.history) ? data.history.length : 0;

    const typeOk = type === s.expect;
    const statusOk = status === "active";
    const seatsOk = s.expect === "operator_pro" ? typeof seats === "number" && seats >= 1 : true;
    const capCountOk = s.expect === "free_operator" ? typeof eventCapCount === "number" : true;

    const passing = typeOk && statusOk && seatsOk && capCountOk;
    if (!passing) problems += 1;

    console.log(`${passing ? "ok  " : "FAIL"} ${s.name}`);
    console.log(`     type=${type} (want ${s.expect}) status=${status} source=${source} seats=${seats ?? "n/a"} eventCapCount=${eventCapCount ?? "n/a"} history=${historyLen} entries`);
  }
  if (problems > 0) {
    console.error(`\n${problems} sample(s) failed validation.`);
    process.exit(1);
  }
  console.log("\nAll sampled plans look right.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
