/**
 * One-off: promote the pre-launch paying profiles to Pro tiers, mirroring
 * what the `setPlan` callable would do but without needing the deploy to be
 * live yet. Idempotent — re-running is safe; it just appends a fresh
 * history entry.
 *
 * Targets (verified by hand against the prod profile list, May 2026):
 *   Kulturhaus Insel Berlin (venue)   -> operator_pro, 2 seats
 *   The Test Venue (Ran's venue)      -> operator_pro, 2 seats
 *   Ran Nir (performer)               -> artist_pro
 *
 * Usage:
 *   FIREBASE_PROJECT_ID=showme-production npx tsx scripts/promote-launch-paid-plans.ts --dry
 *   FIREBASE_PROJECT_ID=showme-production npx tsx scripts/promote-launch-paid-plans.ts
 */

import { initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

if (process.env.FIRESTORE_EMULATOR_HOST) {
  console.error("Refusing to run against the emulator.");
  process.exit(1);
}

const dry = process.argv.includes("--dry");
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID ?? "showme-production";
initializeApp({ projectId: PROJECT_ID });
const db = getFirestore();

type PlanType = "free_operator" | "operator_pro" | "free_artist" | "artist_pro";

interface Target {
  profileId: string;
  name: string;
  type: PlanType;
  seats?: number;
}

const TARGETS: Target[] = [
  {
    profileId: "HKopPSnpurTODVGJrFnnRLMzauE2__venue",
    name: "Kulturhaus Insel Berlin",
    type: "operator_pro",
    seats: 2,
  },
  {
    profileId: "iT7pp7a7fJf2WNKbxoFFvq4Zy4A3__venue",
    name: "The Test Venue (Ran)",
    type: "operator_pro",
    seats: 2,
  },
  {
    profileId: "vi1qZjpgY3BqQfCY4VRP",
    name: "Ran Nir",
    type: "artist_pro",
  },
];

async function main(): Promise<void> {
  console.log(`Project: ${PROJECT_ID}`);
  console.log(dry ? "Mode: DRY RUN" : "Mode: LIVE");
  console.log("");

  const nowIso = new Date().toISOString();

  for (const t of TARGETS) {
    const planRef = db.collection("plans").doc(t.profileId);
    const planSnap = await planRef.get();
    if (!planSnap.exists) {
      console.error(`  SKIP ${t.profileId} (${t.name}) — no plan doc; run backfill first.`);
      continue;
    }
    const existing = planSnap.data() as Record<string, unknown>;
    const fromType = (existing.type as PlanType | undefined) ?? null;
    if (fromType === t.type) {
      console.log(`  noop ${t.profileId} (${t.name}) — already on ${t.type}`);
      continue;
    }

    const historyEntry = {
      from: fromType,
      to: t.type,
      at: nowIso,
      by: "system-launch-promotion",
      reason: "Pre-launch paid-plan assignment",
    };
    const existingHistory = Array.isArray(existing.history) ? existing.history : [];

    const payload: Record<string, unknown> = {
      profileId: t.profileId,
      type: t.type,
      source: "manual",
      status: "active",
      assignedAt: nowIso,
      assignedBy: "system-launch-promotion",
      history: [...existingHistory, historyEntry],
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (t.type === "operator_pro") {
      payload.seats = t.seats ?? 2;
      // Clear stale Free-Operator cap fields — they don't apply on a paid plan
      // and the trigger early-bails for non-free_operator types.
      payload.eventCapBlocked = FieldValue.delete();
    }

    console.log(`  ${dry ? "[would-set]" : "[set]      "} ${t.profileId} (${t.name}) -> ${t.type}`);

    if (!dry) {
      await planRef.set(payload, { merge: true });
    }
  }

  console.log("\nDone.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
