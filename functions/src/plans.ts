import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { HttpsError, onCall } from "firebase-functions/v2/https";

const db = () => admin.firestore();

// ─── Types ────────────────────────────────────────────────────────────────────

export type PlanType =
  | "free_operator"
  | "operator_pro"
  | "free_artist"
  | "artist_pro";

export type PlanStatus = "active" | "cancelled";
export type PlanSource = "manual" | "mollie";

export interface PlanHistoryEntry {
  from: PlanType | null;
  to: PlanType;
  at: string;
  by: string;
  reason?: string;
}

export interface ProfilePlan {
  profileId: string;
  type: PlanType;
  source: PlanSource;
  status: PlanStatus;
  assignedAt: string;
  assignedBy: string;
  renewalAt?: string;
  seats?: number;
  cancelReason?: string;
  history: PlanHistoryEntry[];
  // Maintained by `onEventWrittenMaintainCap` (delta-based) and corrected by
  // `getEventCapStatus` (lazy resync). Only meaningful when `type` is
  // `free_operator` — paid plans leave these undefined.
  eventCapCount?: number;
  eventCapBlocked?: boolean;
  // ISO timestamp not on the type — written via FieldValue.serverTimestamp().
}

const VALID_PLAN_TYPES: ReadonlySet<PlanType> = new Set([
  "free_operator",
  "operator_pro",
  "free_artist",
  "artist_pro",
]);

const OPERATOR_PLAN_TYPES: ReadonlySet<PlanType> = new Set([
  "free_operator",
  "operator_pro",
]);

const ARTIST_PLAN_TYPES: ReadonlySet<PlanType> = new Set([
  "free_artist",
  "artist_pro",
]);

const PAID_PLAN_TYPES: ReadonlySet<PlanType> = new Set([
  "operator_pro",
  "artist_pro",
]);

const OPERATOR_PROFILE_ROLES = new Set([
  "venue",
  "promoter",
  "organizer",
  "festival",
]);

// ─── Shared helpers (used by gating in other modules) ─────────────────────────

/**
 * Fresh-read a profile's plan from Firestore. Used by callables that need to
 * gate on plan — we deliberately avoid a custom claim for plan so that a
 * downgrade takes effect immediately for every member, with no JWT staleness
 * window.
 *
 * Returns `null` when no plan doc exists yet (legacy profile before backfill,
 * or freshly created). Callers should treat that as "free of the matching
 * type" — never as "no gate".
 */
export async function getProfilePlan(
  profileId: string,
): Promise<ProfilePlan | null> {
  if (!profileId) return null;
  const snap = await db().collection("plans").doc(profileId).get();
  if (!snap.exists) return null;
  return snap.data() as ProfilePlan;
}

/**
 * Throws HttpsError("permission-denied") unless the profile's current plan
 * is in `allowed`. Use inside any callable that performs a gated action.
 *
 * Treats missing plan docs as the matching Free tier — locked, never
 * accidentally open. The profile role is read once to decide whether
 * "missing" means free_operator or free_artist.
 */
export async function requirePlan(
  profileId: string,
  allowed: ReadonlyArray<PlanType>,
): Promise<ProfilePlan> {
  if (!profileId) {
    throw new HttpsError("invalid-argument", "profileId is required.");
  }

  const plan = await getProfilePlan(profileId);
  if (plan) {
    if (!allowed.includes(plan.type)) {
      throw new HttpsError(
        "permission-denied",
        `This action is not available on the ${plan.type} plan.`,
      );
    }
    return plan;
  }

  // No plan doc — synthesize the Free default based on profile role so
  // the gate check still runs against the right tier.
  const profileSnap = await db().collection("profiles").doc(profileId).get();
  if (!profileSnap.exists) {
    throw new HttpsError("not-found", "Profile not found.");
  }
  const data = profileSnap.data() ?? {};
  const role =
    (typeof data.role === "string" ? data.role : "") ||
    (typeof data.type === "string" ? data.type : "");
  const fallbackType: PlanType =
    role === "performer" || role === "artist"
      ? "free_artist"
      : "free_operator";
  if (!allowed.includes(fallbackType)) {
    throw new HttpsError(
      "permission-denied",
      `This action is not available on the ${fallbackType} plan.`,
    );
  }
  return {
    profileId,
    type: fallbackType,
    source: "manual",
    status: "active",
    assignedAt: new Date(0).toISOString(),
    assignedBy: "system-default",
    history: [],
  };
}

export function isPaidPlan(type: PlanType): boolean {
  return PAID_PLAN_TYPES.has(type);
}

export function isOperatorPlan(type: PlanType): boolean {
  return OPERATOR_PLAN_TYPES.has(type);
}

export function isArtistPlan(type: PlanType): boolean {
  return ARTIST_PLAN_TYPES.has(type);
}

export function defaultPlanTypeForProfileRole(
  role: string | undefined | null,
): PlanType {
  const r = (role ?? "").toLowerCase();
  if (r === "performer" || r === "artist") return "free_artist";
  return "free_operator";
}

// ─── Admin check ──────────────────────────────────────────────────────────────

/**
 * Match the existing pattern (see invitations.ts:155): an `admins/{uid}` doc
 * existing in Firestore grants admin powers. The collection itself is locked
 * by rules — clients can read admins/me (to gate UI), but no client can write.
 */
async function requireAdmin(uid: string): Promise<void> {
  if (!uid) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }
  const snap = await db().collection("admins").doc(uid).get();
  if (!snap.exists) {
    throw new HttpsError(
      "permission-denied",
      "Only shoWMe admins can change plans.",
    );
  }
}

// ─── setPlan callable ─────────────────────────────────────────────────────────

interface SetPlanData {
  profileId: string;
  /** New plan type. Required. */
  type: PlanType;
  /** Optional new status — defaults to "active" when omitted. */
  status?: PlanStatus;
  /** ISO timestamp. Paid tiers only. */
  renewalAt?: string;
  /** operator_pro only. */
  seats?: number;
  /** Free-form note added to the history entry. */
  reason?: string;
  /** Optional cancellation reason (recorded when status flips to cancelled). */
  cancelReason?: string;
}

interface SetPlanResult {
  ok: true;
  plan: ProfilePlan;
}

function validatePayload(input: SetPlanData): void {
  if (!input.profileId || typeof input.profileId !== "string") {
    throw new HttpsError("invalid-argument", "profileId is required.");
  }
  if (!input.type || !VALID_PLAN_TYPES.has(input.type)) {
    throw new HttpsError("invalid-argument", "type must be a valid PlanType.");
  }
  if (input.status && input.status !== "active" && input.status !== "cancelled") {
    throw new HttpsError("invalid-argument", "status must be 'active' or 'cancelled'.");
  }
  // Only validate seats when the plan type actually uses them. A stale
  // seats value on a non-operator_pro request is silently dropped further
  // down (see `seats` calculation in the transaction); rejecting here
  // would make the admin form fragile to lingering form state.
  if (input.type === "operator_pro" && input.seats !== undefined && input.seats !== null) {
    if (
      typeof input.seats !== "number" ||
      !Number.isFinite(input.seats) ||
      !Number.isInteger(input.seats) ||
      input.seats < 1
    ) {
      throw new HttpsError("invalid-argument", "seats must be a positive integer.");
    }
  }
  // Same idea for renewalAt — paid plans only; silently ignore on free.
  if (PAID_PLAN_TYPES.has(input.type) && input.renewalAt !== undefined && input.renewalAt !== null) {
    if (typeof input.renewalAt !== "string" || !Date.parse(input.renewalAt)) {
      throw new HttpsError("invalid-argument", "renewalAt must be an ISO 8601 string.");
    }
  }
}

function assertPlanMatchesProfileRole(profileRole: string, planType: PlanType): void {
  const role = profileRole.toLowerCase();
  if (role === "performer" || role === "artist") {
    if (!ARTIST_PLAN_TYPES.has(planType)) {
      throw new HttpsError(
        "invalid-argument",
        `Performer profiles can only be on artist plans (got ${planType}).`,
      );
    }
    return;
  }
  if (OPERATOR_PROFILE_ROLES.has(role)) {
    if (!OPERATOR_PLAN_TYPES.has(planType)) {
      throw new HttpsError(
        "invalid-argument",
        `Operator profiles can only be on operator plans (got ${planType}).`,
      );
    }
    return;
  }
  throw new HttpsError(
    "failed-precondition",
    `Profile role '${profileRole}' is not eligible for any plan.`,
  );
}

// ─── listProfilesForAdmin callable ────────────────────────────────────────────

interface ListProfilesForAdminData {
  /** Optional case-insensitive substring match against profile name. */
  search?: string;
  /** Optional plan-type filter; `"none"` returns profiles with no plan doc. */
  planType?: PlanType | "none" | "all";
  /** Optional role filter. */
  role?: string | "all";
}

interface AdminProfileRow {
  profileId: string;
  name: string;
  role: string;
  ownerUid: string;
  ownerEmail: string | null;
  acquired: boolean;
  isPublic: boolean;
  plan: ProfilePlan | null;
}

interface ListProfilesForAdminResult {
  rows: AdminProfileRow[];
  total: number;
}

/**
 * Admin-only callable: return every profile in the database alongside its
 * plan doc (if any). Used by the admin Plans page to surface what needs a
 * paid tier assigned. Bypasses the per-profile read rules — admins look at
 * everything.
 *
 * Filters are applied server-side so the client never sees profiles it
 * shouldn't be browsing. No pagination yet — the dataset is small enough
 * pre-launch that returning everything in one page is faster than
 * round-tripping cursors.
 */
export const listProfilesForAdmin = onCall<
  ListProfilesForAdminData,
  Promise<ListProfilesForAdminResult>
>(
  { region: "europe-west1" },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Sign in.");
    }
    await requireAdmin(uid);

    const search = (request.data?.search ?? "").trim().toLowerCase();
    const planType = request.data?.planType ?? "all";
    const role = request.data?.role ?? "all";

    const profilesSnap = await db().collection("profiles").get();

    // Pre-fetch plan docs for everything we'll keep. Bound concurrency so
    // a few hundred profiles don't open a few hundred parallel reads.
    const rows: AdminProfileRow[] = [];

    // Collect candidate profile docs first so we only pull plans for survivors.
    const candidates: Array<{ id: string; data: Record<string, unknown> }> = [];
    for (const p of profilesSnap.docs) {
      const data = p.data() as Record<string, unknown>;
      const r =
        (typeof data.role === "string" && data.role) ||
        (typeof data.type === "string" && data.type) ||
        "";
      const name = typeof data.name === "string" ? data.name : "";

      if (role !== "all" && r !== role) continue;
      if (search && !name.toLowerCase().includes(search) && !p.id.toLowerCase().includes(search)) continue;

      candidates.push({ id: p.id, data });
    }

    const CHUNK = 25;
    for (let i = 0; i < candidates.length; i += CHUNK) {
      const slice = candidates.slice(i, i + CHUNK);
      const plans = await Promise.all(
        slice.map((c) => db().collection("plans").doc(c.id).get()),
      );
      for (let j = 0; j < slice.length; j += 1) {
        const c = slice[j];
        const planSnap = plans[j];
        const plan = planSnap.exists ? (planSnap.data() as ProfilePlan) : null;

        if (planType !== "all") {
          if (planType === "none" && plan) continue;
          if (planType !== "none" && (!plan || plan.type !== planType)) continue;
        }

        rows.push({
          profileId: c.id,
          name:
            (typeof c.data.name === "string" && c.data.name) || "(unnamed)",
          role:
            (typeof c.data.role === "string" && c.data.role) ||
            (typeof c.data.type === "string" && c.data.type) ||
            "(none)",
          ownerUid:
            (typeof c.data.owner_uid === "string" && c.data.owner_uid) || "",
          ownerEmail: null,
          acquired: c.data.acquired !== false,
          isPublic: c.data.isPublic === true,
          plan,
        });
      }
    }

    // Hydrate owner emails for the kept rows. Auth lookups are batched
    // 100 at a time — the SDK caps `getUsers` at 100 identifiers per call.
    const uniqueUids = Array.from(new Set(rows.map((r) => r.ownerUid).filter(Boolean)));
    const emailByUid = new Map<string, string | null>();
    for (let i = 0; i < uniqueUids.length; i += 100) {
      const batch = uniqueUids.slice(i, i + 100).map((uid) => ({ uid }));
      try {
        const lookup = await admin.auth().getUsers(batch);
        for (const u of lookup.users) {
          emailByUid.set(u.uid, u.email ?? null);
        }
      } catch (err) {
        logger.warn("listProfilesForAdmin: getUsers chunk failed", {
          err: String(err),
        });
      }
    }
    for (const r of rows) {
      if (r.ownerUid) {
        r.ownerEmail = emailByUid.get(r.ownerUid) ?? null;
      }
    }

    rows.sort((a, b) => a.name.localeCompare(b.name));

    return { rows, total: rows.length };
  },
);

// ─── setPlan callable ────────────────────────────────────────────────────────

/**
 * Admin-only callable to assign / change a profile's plan. Writes the plan
 * doc and appends a history entry. No Mollie / Stripe wiring — manual
 * assignment is the only path in v1.
 *
 * Permission gate: caller must be a shoWMe admin (admins/{uid} doc exists).
 * Profile owner is not allowed to self-assign — billing is admin-only until
 * the self-serve flow lands.
 */
export const setPlan = onCall<SetPlanData, Promise<SetPlanResult>>(
  { region: "europe-west1" },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Sign in to change plans.");
    }
    await requireAdmin(uid);

    const input = request.data ?? ({} as SetPlanData);
    validatePayload(input);

    const profileSnap = await db()
      .collection("profiles")
      .doc(input.profileId)
      .get();
    if (!profileSnap.exists) {
      throw new HttpsError("not-found", "Profile not found.");
    }
    const profileData = profileSnap.data() ?? {};
    const profileRole =
      (typeof profileData.role === "string" ? profileData.role : "") ||
      (typeof profileData.type === "string" ? profileData.type : "");
    assertPlanMatchesProfileRole(profileRole, input.type);

    const planRef = db().collection("plans").doc(input.profileId);
    const nowIso = new Date().toISOString();

    let written: ProfilePlan | null = null;

    await db().runTransaction(async (tx) => {
      const existingSnap = await tx.get(planRef);
      const existing = existingSnap.exists
        ? (existingSnap.data() as ProfilePlan)
        : null;

      const fromType: PlanType | null = existing?.type ?? null;

      const historyEntry: PlanHistoryEntry = {
        from: fromType,
        to: input.type,
        at: nowIso,
        by: uid,
        ...(input.reason ? { reason: input.reason } : {}),
      };

      // seats / renewalAt only apply to specific tiers — silently drop
      // values coming in for the wrong tier rather than complaining. The
      // validator already guards the shape of these fields when relevant.
      const seats =
        input.type === "operator_pro"
          ? (input.seats ?? existing?.seats ?? 2)
          : undefined;

      const renewalAt =
        PAID_PLAN_TYPES.has(input.type) && input.renewalAt
          ? input.renewalAt
          : undefined;

      const status: PlanStatus = input.status ?? "active";

      const next: ProfilePlan = {
        profileId: input.profileId,
        type: input.type,
        source: "manual",
        status,
        assignedAt: nowIso,
        assignedBy: uid,
        history: [...(existing?.history ?? []), historyEntry],
        ...(seats !== undefined ? { seats } : {}),
        ...(renewalAt ? { renewalAt } : {}),
        ...(status === "cancelled" && input.cancelReason
          ? { cancelReason: input.cancelReason }
          : {}),
      };

      tx.set(planRef, {
        ...next,
        updatedAt: FieldValue.serverTimestamp(),
      });

      written = next;
    });

    logger.info("setPlan: completed", {
      adminUid: uid,
      profileId: input.profileId,
      to: input.type,
      status: input.status ?? "active",
    });

    return { ok: true, plan: written as unknown as ProfilePlan };
  },
);
