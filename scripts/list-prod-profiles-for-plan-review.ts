/**
 * Read-only audit: list every production profile and its current plan
 * (or "(none)" if no plan doc exists). Output is grouped so you can see at
 * a glance which profiles need a paid tier assigned manually before the
 * Phase 2 gating goes live.
 *
 * Pre-deploy gate: any internal / team / paying-customer profiles must have
 * the matching paid plan set via the `setPlan` callable BEFORE shipping —
 * otherwise the day Phase 2 lands, those profiles get downgraded to Free
 * and lose access to Pro features.
 *
 * Usage:
 *   FIREBASE_PROJECT_ID=showme-production npx tsx scripts/list-prod-profiles-for-plan-review.ts
 *
 *   # Emulator (sanity check the script itself):
 *   FIRESTORE_EMULATOR_HOST=localhost:8090 \
 *     npx tsx scripts/list-prod-profiles-for-plan-review.ts --allow-emulator
 *
 * No flags required for the read; pass --allow-emulator only when running
 * against the emulator.
 */

import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const args = process.argv.slice(2);
const allowEmulator = args.includes("--allow-emulator");

const emulatorHostsSet = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
if (emulatorHostsSet && !allowEmulator) {
  console.error(
    "Refusing to run with emulator host vars set. Pass --allow-emulator to override.",
  );
  process.exit(1);
}

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID ?? "showme-production";
initializeApp({ projectId: PROJECT_ID });
const db = getFirestore();

interface Row {
  profileId: string;
  name: string;
  role: string;
  ownerUid: string;
  acquired: boolean;
  isPublic: boolean;
  planType: string;
  planStatus: string;
  planSeats?: number;
  hasPlanDoc: boolean;
  eventCapCount?: number;
}

async function main(): Promise<void> {
  console.log(`Project: ${PROJECT_ID}\n`);

  const profilesSnap = await db.collection("profiles").get();
  console.log(`Scanning ${profilesSnap.size} profiles…\n`);

  const rows: Row[] = [];

  for (const p of profilesSnap.docs) {
    const data = p.data() as Record<string, unknown>;
    const role =
      (typeof data.role === "string" && data.role) ||
      (typeof data.type === "string" && data.type) ||
      "(none)";

    const planSnap = await db.collection("plans").doc(p.id).get();
    const plan = planSnap.exists ? (planSnap.data() as Record<string, unknown>) : null;

    rows.push({
      profileId: p.id,
      name: (typeof data.name === "string" && data.name) || "(unnamed)",
      role,
      ownerUid: (typeof data.owner_uid === "string" && data.owner_uid) || "(none)",
      acquired: data.acquired !== false,
      isPublic: data.isPublic === true,
      planType: plan ? (plan.type as string) : "(none)",
      planStatus: plan ? (plan.status as string) : "(none)",
      planSeats: plan && typeof plan.seats === "number" ? (plan.seats as number) : undefined,
      hasPlanDoc: !!plan,
      eventCapCount: plan && typeof plan.eventCapCount === "number" ? (plan.eventCapCount as number) : undefined,
    });
  }

  // Group by plan status for easy review.
  const byPlan = new Map<string, Row[]>();
  for (const r of rows) {
    const key = r.planType;
    if (!byPlan.has(key)) byPlan.set(key, []);
    byPlan.get(key)!.push(r);
  }

  const sections: Array<[string, string]> = [
    ["(none)", "No plan doc — will fall back to default Free of matching type"],
    ["free_operator", "Free Operator"],
    ["free_artist", "Free Artist"],
    ["operator_pro", "Operator Pro"],
    ["artist_pro", "Artist Pro"],
  ];

  for (const [key, label] of sections) {
    const list = byPlan.get(key);
    if (!list || list.length === 0) continue;
    console.log(`\n=== ${label} (${list.length}) ===`);
    list.sort((a, b) => a.name.localeCompare(b.name));
    for (const r of list) {
      const seats = r.planSeats !== undefined ? ` · seats=${r.planSeats}` : "";
      const cap = r.eventCapCount !== undefined ? ` · events=${r.eventCapCount}` : "";
      const acq = r.acquired ? "" : " · UNACQUIRED";
      const pub = r.isPublic ? " · public" : "";
      console.log(
        `  ${r.profileId.padEnd(40)} ${r.name.padEnd(28)} role=${r.role.padEnd(10)} owner=${r.ownerUid.slice(0, 14)}${seats}${cap}${acq}${pub}`,
      );
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`total profiles:           ${rows.length}`);
  console.log(`with plan doc:            ${rows.filter((r) => r.hasPlanDoc).length}`);
  console.log(`without plan doc:         ${rows.filter((r) => !r.hasPlanDoc).length}`);
  console.log(`on operator_pro:          ${(byPlan.get("operator_pro") ?? []).length}`);
  console.log(`on artist_pro:            ${(byPlan.get("artist_pro") ?? []).length}`);
  console.log(`on free_operator:         ${(byPlan.get("free_operator") ?? []).length}`);
  console.log(`on free_artist:           ${(byPlan.get("free_artist") ?? []).length}`);
  console.log("\nNext step: review each profile and decide which ones need a paid tier.");
  console.log("Use the `setPlan` callable (or the future admin UI) to assign Operator Pro / Artist Pro");
  console.log("before deploying — otherwise they'll be on Free when Phase 2 gating activates.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
