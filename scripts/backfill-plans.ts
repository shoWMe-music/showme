/**
 * Backfill `plans/{profileId}` documents for every existing profile.
 *
 * Phase 1 of the plans + pricing rollout. Each profile gets a Free plan of
 * the matching kind (operator vs artist) based on its `role` / `type` field.
 * Paid plans must be assigned manually via the `setPlan` callable after the
 * backfill — pre-launch profiles that already paid need to be promoted in a
 * follow-up step before the gating goes live.
 *
 * Usage:
 *   FIREBASE_PROJECT_ID=showme-production npx tsx scripts/backfill-plans.ts --dry
 *   FIREBASE_PROJECT_ID=showme-production npx tsx scripts/backfill-plans.ts
 *
 *   # Emulator testing:
 *   FIRESTORE_EMULATOR_HOST=localhost:8090 \
 *     npx tsx scripts/backfill-plans.ts --dry --allow-emulator
 *
 * Flags:
 *   --dry             do not write plan docs; just print what would be written
 *   --overwrite       overwrite existing plan docs (default: skip when present)
 *   --verbose         print one line per profile even when unchanged
 *   --allow-emulator  permit running against the emulator (off by default)
 */

import { initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

type PlanType =
  | "free_operator"
  | "operator_pro"
  | "free_artist"
  | "artist_pro";

interface PlanHistoryEntry {
  from: PlanType | null;
  to: PlanType;
  at: string;
  by: string;
  reason?: string;
}

interface ProfilePlan {
  profileId: string;
  type: PlanType;
  source: "manual";
  status: "active" | "cancelled";
  assignedAt: string;
  assignedBy: string;
  history: PlanHistoryEntry[];
}

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const overwrite = args.includes("--overwrite");
const verbose = args.includes("--verbose");
const allowEmulator = args.includes("--allow-emulator");

const emulatorHostsSet =
  Boolean(process.env.FIRESTORE_EMULATOR_HOST) ||
  Boolean(process.env.FIREBASE_AUTH_EMULATOR_HOST);

if (emulatorHostsSet && !allowEmulator) {
  console.error(
    "Refusing to run with emulator host vars set. Pass --allow-emulator to override.",
  );
  process.exit(1);
}

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID ?? "showme-production";
initializeApp({ projectId: PROJECT_ID });
const db = getFirestore();

const OPERATOR_PROFILE_ROLES = new Set([
  "venue",
  "promoter",
  "organizer",
  "festival",
]);

// Mirrors functions/src/eventCap.ts. Keep in sync if you change the cap shape.
const FREE_OPERATOR_EVENT_CAP = 60;
const FREE_OPERATOR_EVENT_CAP_GRACE = 6;
const HARD_CAP = FREE_OPERATOR_EVENT_CAP + FREE_OPERATOR_EVENT_CAP_GRACE;
const ROLLING_WINDOW_DAYS = 365;
const COUNTED_STATUSES = new Set(["confirmed", "concluded"]);

function defaultPlanTypeForRole(role: string): PlanType {
  const r = role.toLowerCase();
  if (r === "performer" || r === "artist") return "free_artist";
  if (OPERATOR_PROFILE_ROLES.has(r)) return "free_operator";
  return "free_operator";
}

function inRollingWindow(eventDateStr: unknown, today: Date): boolean {
  if (typeof eventDateStr !== "string" || !eventDateStr) return false;
  const eventDate = Date.parse(eventDateStr);
  if (Number.isNaN(eventDate)) return false;
  const diffMs = Math.abs(eventDate - today.getTime());
  return diffMs <= ROLLING_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * Initial precise count for a Free Operator profile's event cap. Mirrors
 * `isCountedState` in functions/src/eventCap.ts — confirmed/concluded,
 * non-archived, date within ±365 days of today. Runs once per profile so
 * the trigger's delta-based maintenance starts from an accurate baseline.
 */
async function precisionCountForCap(profileId: string, today: Date): Promise<number> {
  const snap = await db
    .collection("events")
    .where("hostProfileId", "==", profileId)
    .get();
  let count = 0;
  for (const d of snap.docs) {
    const data = d.data() as Record<string, unknown>;
    if (data.archived === true) continue;
    const status = typeof data.eventStatus === "string" ? data.eventStatus : "";
    if (!COUNTED_STATUSES.has(status)) continue;
    if (!inRollingWindow(data.date, today)) continue;
    count += 1;
  }
  return count;
}

async function main(): Promise<void> {
  console.log(`Project: ${PROJECT_ID}`);
  console.log(dry ? "Mode: DRY RUN (no Firestore writes)" : "Mode: LIVE");
  console.log(overwrite ? "Overwrite: ON" : "Overwrite: OFF (skip existing)");
  if (emulatorHostsSet) console.log("Note: emulator host vars detected (--allow-emulator).");

  const profilesSnap = await db.collection("profiles").get();
  console.log(`Scanning ${profilesSnap.size} profiles…\n`);

  let created = 0;
  let skipped = 0;
  let overwritten = 0;
  let invalid = 0;
  const invalidRows: { id: string; reason: string }[] = [];

  const nowIso = new Date().toISOString();

  for (const p of profilesSnap.docs) {
    const data = p.data() as Record<string, unknown>;
    const role =
      (typeof data.role === "string" && data.role) ||
      (typeof data.type === "string" && data.type) ||
      "";
    if (!role) {
      invalid += 1;
      invalidRows.push({ id: p.id, reason: "no role/type field" });
      continue;
    }

    const planType = defaultPlanTypeForRole(role);

    const planRef = db.collection("plans").doc(p.id);
    const existing = await planRef.get();

    if (existing.exists && !overwrite) {
      skipped += 1;
      if (verbose) {
        const cur = existing.data() as ProfilePlan;
        console.log(`  - ${p.id} skip (already on ${cur.type})`);
      }
      continue;
    }

    const planDoc: ProfilePlan = {
      profileId: p.id,
      type: planType,
      source: "manual",
      status: "active",
      assignedAt: nowIso,
      assignedBy: "system-backfill",
      history: [
        {
          from: null,
          to: planType,
          at: nowIso,
          by: "system-backfill",
          reason: "Initial Phase 1 backfill",
        },
      ],
    };

    // For Free Operator plans, seed the event-cap counter so the trigger's
    // delta-based maintenance starts from an accurate baseline. Without this,
    // the first event write would either initialize from 0 (under-count) or
    // pay the precision-count cost lazily on the first trigger fire.
    let eventCapCount: number | undefined;
    let eventCapBlocked: boolean | undefined;
    if (planType === "free_operator") {
      eventCapCount = await precisionCountForCap(p.id, new Date());
      eventCapBlocked = eventCapCount >= HARD_CAP;
    }

    if (dry) {
      const capSuffix =
        eventCapCount !== undefined ? ` cap=${eventCapCount}/${HARD_CAP}${eventCapBlocked ? " BLOCKED" : ""}` : "";
      console.log(
        `  ${existing.exists ? "[overwrite]" : "[create]   "} ${p.id} role=${role} -> ${planType}${capSuffix}`,
      );
      if (existing.exists) overwritten += 1;
      else created += 1;
      continue;
    }

    await planRef.set({
      ...planDoc,
      updatedAt: FieldValue.serverTimestamp(),
      ...(eventCapCount !== undefined ? { eventCapCount } : {}),
      ...(eventCapBlocked !== undefined ? { eventCapBlocked } : {}),
    });
    if (existing.exists) overwritten += 1;
    else created += 1;

    if (verbose) {
      console.log(
        `  ${existing.exists ? "[overwrote]" : "[created]  "} ${p.id} -> ${planType}`,
      );
    }
  }

  console.log("\n=== Summary ===");
  console.log(`profiles scanned:   ${profilesSnap.size}`);
  console.log(`plans created:      ${created}`);
  console.log(`plans overwritten:  ${overwritten}`);
  console.log(`plans skipped:      ${skipped}`);
  console.log(`invalid (no role):  ${invalid}`);
  if (invalidRows.length) {
    console.log("\nInvalid rows:");
    for (const row of invalidRows) console.log(`  ${row.id}: ${row.reason}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
