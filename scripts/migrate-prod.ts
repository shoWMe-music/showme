/**
 * Production migration:
 *   - Cascade-delete every top-level collection except `users`, `profiles`, `admins`
 *   - users/* and profiles/* are kept entirely (every subcollection), per the
 *     "keep users and profiles" rule — even orphan share_tokens etc.
 *   - Field-level migration: profile docs missing `type` get it backfilled from
 *     `role` or `slot` (Firestore rules require `type` for event-host checks)
 *   - Firebase Auth accounts are NEVER touched
 *
 * Modes:
 *   tsx scripts/migrate-prod.ts                 → dry-run (default)
 *   tsx scripts/migrate-prod.ts --confirm       → execute
 *
 * Auth: ADC via `gcloud auth application-default login`. Project hardcoded to
 * `showme-production`; override with FIREBASE_PROJECT_ID env if needed.
 *
 * Note: users/{uid} parent docs don't exist in Firestore (the app only writes
 * sub-docs). User discovery uses Firebase Auth's listUsers() to enumerate uids.
 */

import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import {
  FieldValue,
  getFirestore,
  type CollectionReference,
  type DocumentReference,
} from "firebase-admin/firestore";

// ── Config ────────────────────────────────────────────────────────────────────

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID ?? "showme-production";
const CONFIRM = process.argv.includes("--confirm");

const KEEP_TOPLEVEL = new Set(["users", "profiles", "admins"]);

// Manual decisions from migration audit (see chat history of 2026-04-29).
const PHANTOM_PROMOTE: { pid: string; fields: Record<string, unknown>; reason: string }[] = [
  {
    pid: "NfBOOnLcF6axU6pfsJC5k5njuTN2__artist",
    fields: { type: "performer", role: "performer", slot: "artist" },
    reason: "Implicit parent — promote to explicit; `type` required by Firestore rules",
  },
];

const PHANTOM_DELETE: { pid: string; reason: string }[] = [
  {
    pid: "S1RyyrrepjCzlc3XqE5J",
    reason: "Orphan implicit profile, no event/notification refs; 1 stranded team-member doc",
  },
];

const SUBCOLLECTION_WIPES: { path: string; reason: string }[] = [
  {
    path: "profiles/NfBOOnLcF6axU6pfsJC5k5njuTN2__artist/notifications",
    reason: "22 orphan notifications referencing soon-to-be-deleted events",
  },
];

// ── Safety guards ─────────────────────────────────────────────────────────────

if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  console.error(
    "Refusing to run with emulator host vars set. Unset FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST.",
  );
  process.exit(1);
}

initializeApp({ projectId: PROJECT_ID });
const db = getFirestore();
const auth = getAuth();
db.settings({ ignoreUndefinedProperties: true });

// ── Helpers ───────────────────────────────────────────────────────────────────

async function countCollectionExplicit(ref: CollectionReference): Promise<number> {
  // count() only counts docs with explicit fields. Implicit parents (docs that exist
  // only because their subcollections do) are NOT counted here.
  const snap = await ref.count().get();
  return snap.data().count;
}

async function listAllDocs(ref: CollectionReference): Promise<DocumentReference[]> {
  // listDocuments() returns BOTH explicit-field docs and implicit parent docs
  // (i.e. docs that exist only because they have subcollections). This is what
  // we need for cascade deletion — count()/get() would miss implicit parents.
  return await ref.listDocuments();
}

async function listSubcollections(docRef: DocumentReference): Promise<CollectionReference[]> {
  return await docRef.listCollections();
}

async function recursiveDeleteDoc(docRef: DocumentReference): Promise<void> {
  // firestore.recursiveDelete() deletes the doc and every descendant doc/subcollection.
  await db.recursiveDelete(docRef);
}

async function deleteCollection(ref: CollectionReference): Promise<number> {
  const refs = await listAllDocs(ref);
  for (const docRef of refs) {
    await recursiveDeleteDoc(docRef);
  }
  return refs.length;
}

function fmt(n: number): string {
  return n.toLocaleString();
}

// ── Discovery ─────────────────────────────────────────────────────────────────

interface ColInfo {
  name: string;
  explicit: number;
  total: number; // explicit + implicit parents
}

interface Plan {
  toplevelDelete: ColInfo[];
  toplevelKeep: ColInfo[];
  authAccounts: number;
  userSubcollectionsKept: { uid: string; subs: { name: string; explicit: number; total: number }[] }[];
  profileBackfills: { pid: string; field: string; from: string; to: string }[];
  subcollectionWipes: { path: string; docs: number; reason: string }[];
  phantomDelete: { pid: string; subcollections: { name: string; total: number }[]; reason: string }[];
  phantomPromote: { pid: string; fields: Record<string, unknown>; reason: string }[];
}

async function inspectCollection(ref: CollectionReference): Promise<ColInfo> {
  const explicit = await countCollectionExplicit(ref);
  const all = await listAllDocs(ref);
  return { name: ref.id, explicit, total: all.length };
}

async function buildPlan(): Promise<Plan> {
  const plan: Plan = {
    toplevelDelete: [],
    toplevelKeep: [],
    authAccounts: 0,
    userSubcollectionsKept: [],
    profileBackfills: [],
    subcollectionWipes: [],
    phantomDelete: [],
    phantomPromote: [],
  };

  const top = await db.listCollections();
  for (const col of top) {
    const info = await inspectCollection(col);
    if (KEEP_TOPLEVEL.has(col.id)) {
      plan.toplevelKeep.push(info);
    } else {
      plan.toplevelDelete.push(info);
    }
  }

  // Enumerate users via Auth (users/{uid} parent docs are implicit in Firestore).
  let pageToken: string | undefined;
  do {
    const page = await auth.listUsers(1000, pageToken);
    plan.authAccounts += page.users.length;
    for (const u of page.users) {
      const userRef = db.collection("users").doc(u.uid);
      const subs = await listSubcollections(userRef);
      const subInfo: { name: string; explicit: number; total: number }[] = [];
      for (const s of subs) {
        const info = await inspectCollection(s);
        subInfo.push({ name: s.id, explicit: info.explicit, total: info.total });
      }
      if (subInfo.length > 0) {
        plan.userSubcollectionsKept.push({ uid: u.uid, subs: subInfo });
      }
    }
    pageToken = page.pageToken;
  } while (pageToken);

  // Profile field-compat checks (subcollections all kept).
  // Use listDocuments() so any implicit-parent profile is included.
  const profileRefs = await listAllDocs(db.collection("profiles"));
  for (const profileRef of profileRefs) {
    const profileDoc = await profileRef.get();
    if (!profileDoc.exists) {
      // Implicit parent — has subcollections but no fields. Worth flagging but not fatal.
      console.warn(`  ! profile ${profileRef.id} is an implicit parent (no fields)`);
      continue;
    }
    const data = profileDoc.data();
    if (typeof data.type !== "string" || data.type.length === 0) {
      const fallback =
        typeof data.role === "string" && data.role.length > 0
          ? data.role
          : typeof data.slot === "string" && data.slot.length > 0
            ? data.slot
            : "";
      if (fallback.length > 0) {
        plan.profileBackfills.push({
          pid: profileDoc.id,
          field: "type",
          from: "(missing)",
          to: fallback,
        });
      }
    }
  }

  // Subcollection wipes — count docs to be removed.
  for (const wipe of SUBCOLLECTION_WIPES) {
    const refs = await listAllDocs(db.collection(wipe.path));
    plan.subcollectionWipes.push({ path: wipe.path, docs: refs.length, reason: wipe.reason });
  }

  // Phantom delete — collect subcollection sizes for visibility.
  for (const ph of PHANTOM_DELETE) {
    const ref = db.collection("profiles").doc(ph.pid);
    const subs = await ref.listCollections();
    const subInfo: { name: string; total: number }[] = [];
    for (const s of subs) {
      const docs = await listAllDocs(s);
      subInfo.push({ name: s.id, total: docs.length });
    }
    plan.phantomDelete.push({ pid: ph.pid, subcollections: subInfo, reason: ph.reason });
  }

  // Phantom promote — passthrough; nothing to discover.
  for (const ph of PHANTOM_PROMOTE) {
    plan.phantomPromote.push({ pid: ph.pid, fields: ph.fields, reason: ph.reason });
  }

  return plan;
}

function printPlan(plan: Plan): void {
  console.log("");
  console.log("════════════════════════════════════════════════════════════════════");
  console.log(`Project: ${PROJECT_ID}`);
  console.log(`Mode:    ${CONFIRM ? "EXECUTE (--confirm)" : "DRY-RUN (no writes)"}`);
  console.log("════════════════════════════════════════════════════════════════════");

  const fmtCol = (c: ColInfo): string => {
    const phantom = c.total - c.explicit;
    const phantomNote = phantom > 0 ? `  (+${phantom} implicit-parent)` : "";
    return `${c.name.padEnd(28)} ${fmt(c.total).padStart(8)} docs${phantomNote}`;
  };

  console.log("\nTop-level collections — KEEP:");
  for (const c of plan.toplevelKeep) {
    console.log(`  ${fmtCol(c)}`);
  }

  console.log("\nTop-level collections — DELETE:");
  if (plan.toplevelDelete.length === 0) {
    console.log("  (none)");
  } else {
    for (const c of plan.toplevelDelete) {
      console.log(`  ${fmtCol(c)} (cascade)`);
    }
  }

  console.log(`\nFirebase Auth accounts (untouched): ${plan.authAccounts}`);

  console.log("\nusers/{uid}/* subcollections — KEPT (per instruction):");
  if (plan.userSubcollectionsKept.length === 0) {
    console.log("  (none discovered)");
  } else {
    const grouped: Record<string, { explicit: number; total: number; users: number }> = {};
    for (const u of plan.userSubcollectionsKept) {
      for (const s of u.subs) {
        grouped[s.name] = grouped[s.name] ?? { explicit: 0, total: 0, users: 0 };
        grouped[s.name].explicit += s.explicit;
        grouped[s.name].total += s.total;
        grouped[s.name].users += 1;
      }
    }
    for (const [sub, agg] of Object.entries(grouped).sort((a, b) => b[1].total - a[1].total)) {
      const phantom = agg.total - agg.explicit;
      const phantomNote = phantom > 0 ? `  (+${phantom} implicit-parent)` : "";
      console.log(`  ${sub.padEnd(28)} ${fmt(agg.total).padStart(8)} docs across ${agg.users} users${phantomNote}`);
    }
  }

  console.log("\nprofiles/{pid} field backfills:");
  if (plan.profileBackfills.length === 0) {
    console.log("  (none)");
  } else {
    for (const b of plan.profileBackfills) {
      console.log(`  ${b.pid.padEnd(40)} ${b.field}: ${b.from} → ${b.to}`);
    }
  }

  console.log("\nSubcollection WIPES (delete all docs under path):");
  if (plan.subcollectionWipes.length === 0) {
    console.log("  (none)");
  } else {
    for (const w of plan.subcollectionWipes) {
      console.log(`  ${w.path}  (${fmt(w.docs)} docs)`);
      console.log(`    reason: ${w.reason}`);
    }
  }

  console.log("\nPhantom profile DELETE (recursive):");
  if (plan.phantomDelete.length === 0) {
    console.log("  (none)");
  } else {
    for (const p of plan.phantomDelete) {
      const subSummary = p.subcollections.length === 0
        ? "no subcollections"
        : p.subcollections.map((s) => `${s.name}=${fmt(s.total)}`).join(", ");
      console.log(`  profiles/${p.pid}  (${subSummary})`);
      console.log(`    reason: ${p.reason}`);
    }
  }

  console.log("\nPhantom profile PROMOTE (set fields on implicit parent):");
  if (plan.phantomPromote.length === 0) {
    console.log("  (none)");
  } else {
    for (const p of plan.phantomPromote) {
      console.log(`  profiles/${p.pid}  ← ${JSON.stringify(p.fields)}`);
      console.log(`    reason: ${p.reason}`);
    }
  }

  console.log("");
}

// ── Execution ─────────────────────────────────────────────────────────────────

async function execute(plan: Plan): Promise<void> {
  console.log("Executing migration…\n");

  // 1. Drop top-level collections (cascade)
  for (const c of plan.toplevelDelete) {
    process.stdout.write(`  Deleting top-level "${c.name}" (${fmt(c.total)} docs, cascade)… `);
    const n = await deleteCollection(db.collection(c.name));
    console.log(`done (${fmt(n)} root docs).`);
  }

  // 2. Subcollection wipes (e.g. orphan notifications)
  for (const w of plan.subcollectionWipes) {
    process.stdout.write(`  Wiping ${w.path} (${fmt(w.docs)} docs)… `);
    const n = await deleteCollection(db.collection(w.path));
    console.log(`done (${fmt(n)} docs).`);
  }

  // 3. Phantom profile delete (recursive — removes all remaining subcollection docs too)
  for (const p of plan.phantomDelete) {
    process.stdout.write(`  Recursively deleting profiles/${p.pid}… `);
    await db.recursiveDelete(db.collection("profiles").doc(p.pid));
    console.log(`done.`);
  }

  // 4. Phantom profile promote (turn implicit parent into explicit doc)
  for (const p of plan.phantomPromote) {
    await db.collection("profiles").doc(p.pid).set(
      {
        ...p.fields,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    console.log(`  profiles/${p.pid} promoted (${Object.keys(p.fields).join(", ")})`);
  }

  // 5. Profile field backfills
  for (const b of plan.profileBackfills) {
    await db.collection("profiles").doc(b.pid).set(
      {
        [b.field]: b.to,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    console.log(`  profiles/${b.pid}.${b.field} ← ${b.to}`);
  }

  console.log("\nMigration complete.");
}

// ── Entry ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Connecting to ${PROJECT_ID}…`);
  const plan = await buildPlan();
  printPlan(plan);

  if (!CONFIRM) {
    console.log("Dry-run only. Re-run with --confirm to execute.");
    return;
  }

  // Final fail-safe: require typing the project id back via a env var to actually delete.
  if (process.env.MIGRATE_PROD_I_AM_SURE !== PROJECT_ID) {
    console.log(
      `--confirm given, but MIGRATE_PROD_I_AM_SURE env var must equal "${PROJECT_ID}" to actually delete. Aborting.`,
    );
    process.exit(1);
  }

  await execute(plan);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
