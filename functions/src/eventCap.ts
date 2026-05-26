import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onDocumentWritten } from "firebase-functions/v2/firestore";

import { getProfilePlan, type PlanType, type ProfilePlan } from "./plans";

const db = () => admin.firestore();

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Per the pricing PDF: 60 confirmed events / year on Free Operator.
 */
export const FREE_OPERATOR_EVENT_CAP = 60;

/**
 * "Soft cap with grace period at month-end" — concrete interpretation: allow
 * events 61–66 (six over the cap), then hard block. Anything above this is
 * rejected by both the recount trigger and the callable / rule gate.
 */
export const FREE_OPERATOR_EVENT_CAP_GRACE = 6;

const HARD_CAP = FREE_OPERATOR_EVENT_CAP + FREE_OPERATOR_EVENT_CAP_GRACE;

const COUNTED_STATUSES = new Set(["confirmed", "concluded"]);

const PAID_PLAN_TYPES = new Set<PlanType>(["operator_pro", "artist_pro"]);

const ROLLING_WINDOW_DAYS = 365;

// ─── Counting primitives ─────────────────────────────────────────────────────

function inRollingWindow(eventDateStr: unknown, today: Date): boolean {
  if (typeof eventDateStr !== "string" || !eventDateStr) return false;
  const eventDate = Date.parse(eventDateStr);
  if (Number.isNaN(eventDate)) return false;
  const diffMs = Math.abs(eventDate - today.getTime());
  return diffMs <= ROLLING_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * True iff the event in its current shape contributes to the host's cap:
 * non-archived, status in {confirmed, concluded}, and date within ±365 days
 * of today.
 */
function isCountedState(
  data: Record<string, unknown> | undefined,
  today: Date,
): boolean {
  if (!data) return false;
  if (data.archived === true) return false;
  const status = typeof data.eventStatus === "string" ? data.eventStatus : "";
  if (!COUNTED_STATUSES.has(status)) return false;
  if (!inRollingWindow(data.date, today)) return false;
  return true;
}

/**
 * Precise count: scan every event for this host and tally the ones that
 * meet `isCountedState`. Used by the lazy-resync path in `getEventCapStatus`
 * — never on the event-write hot path.
 */
export async function countEventsForCap(profileId: string): Promise<number> {
  if (!profileId) return 0;
  const snap = await db()
    .collection("events")
    .where("hostProfileId", "==", profileId)
    .get();
  const today = new Date();
  let count = 0;
  for (const d of snap.docs) {
    if (isCountedState(d.data() as Record<string, unknown>, today)) count += 1;
  }
  return count;
}

interface CapState {
  count: number;
  cap: number;
  graceCap: number;
  remaining: number;
  inGrace: boolean;
  blocked: boolean;
  applies: boolean;
}

async function hostsEvents(profileId: string): Promise<boolean> {
  const snap = await db().collection("profiles").doc(profileId).get();
  if (!snap.exists) return false;
  const data = snap.data() ?? {};
  const role =
    (typeof data.role === "string" ? data.role : "") ||
    (typeof data.type === "string" ? data.type : "");
  return role === "venue" || role === "promoter" || role === "organizer" || role === "festival";
}

function stateFromCount(count: number, applies: boolean): CapState {
  if (!applies) {
    return {
      count: 0,
      cap: FREE_OPERATOR_EVENT_CAP,
      graceCap: HARD_CAP,
      remaining: Number.POSITIVE_INFINITY,
      inGrace: false,
      blocked: false,
      applies: false,
    };
  }
  return {
    count,
    cap: FREE_OPERATOR_EVENT_CAP,
    graceCap: HARD_CAP,
    remaining: Math.max(0, HARD_CAP - count),
    inGrace: count > FREE_OPERATOR_EVENT_CAP && count < HARD_CAP,
    blocked: count >= HARD_CAP,
    applies: true,
  };
}

/**
 * Read the stored counter (no recount). Used by the rule-style fast path.
 * Falls back to a precise count if no stored value exists yet.
 */
export async function readCapStateFast(profileId: string): Promise<CapState> {
  const plan = await getProfilePlan(profileId);
  const applies = plan ? plan.type === "free_operator" : await hostsEvents(profileId);
  if (!applies) return stateFromCount(0, false);
  const stored = plan && typeof plan.eventCapCount === "number" ? plan.eventCapCount : null;
  if (stored !== null) return stateFromCount(stored, true);
  // No counter on the plan doc yet — fall back to precise count so the first
  // caller sees a real number rather than 0.
  const precise = await countEventsForCap(profileId);
  return stateFromCount(precise, true);
}

/**
 * Precise cap state + resync. Pulls every confirmed/concluded event for the
 * host (O(N)), writes the corrected counter back to the plan doc, and
 * returns the fresh state. This is the lazy-resync entry point that fixes
 * any drift the trigger may have accumulated (events that fell out of the
 * rolling window, missed boundary crossings, etc.).
 */
export async function computeAndResyncCapState(profileId: string): Promise<CapState> {
  const plan = await getProfilePlan(profileId);
  const applies = plan ? plan.type === "free_operator" : await hostsEvents(profileId);
  if (!applies) return stateFromCount(0, false);

  const count = await countEventsForCap(profileId);
  const state = stateFromCount(count, true);

  // Only write if the plan doc exists — don't auto-create one for legacy
  // profiles missing a backfill. `setPlan` is the authoritative creation path.
  if (plan) {
    try {
      await db().collection("plans").doc(profileId).update({
        eventCapCount: state.count,
        eventCapBlocked: state.blocked,
        eventCapLastComputedAt: FieldValue.serverTimestamp(),
      });
    } catch (err) {
      logger.warn("computeAndResyncCapState: plan update failed", {
        profileId,
        err: String(err),
      });
    }
  }
  return state;
}

// ─── getEventCapStatus callable ──────────────────────────────────────────────

interface GetEventCapStatusData {
  profileId: string;
}

export const getEventCapStatus = onCall<GetEventCapStatusData, Promise<CapState>>(
  { region: "europe-west1" },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Sign in to read cap status.");
    }
    const { profileId } = request.data ?? ({} as GetEventCapStatusData);
    if (!profileId || typeof profileId !== "string") {
      throw new HttpsError("invalid-argument", "profileId is required.");
    }

    // Authorize: caller must be a member of the profile (anyone with read
    // access to the plan doc).
    const memberSnap = await db()
      .collection("profiles")
      .doc(profileId)
      .collection("members")
      .doc(uid)
      .get();
    if (!memberSnap.exists) {
      // Owner shortcut — legacy profiles may lack the row.
      const profileSnap = await db().collection("profiles").doc(profileId).get();
      if (!profileSnap.exists) {
        throw new HttpsError("not-found", "Profile not found.");
      }
      const data = profileSnap.data() ?? {};
      if (data.owner_uid !== uid) {
        throw new HttpsError("permission-denied", "Not a member of this profile.");
      }
    }

    // The callable always does a precise resync — when a human asks, give
    // them the truth and correct any trigger drift while we're at it.
    return await computeAndResyncCapState(profileId);
  },
);

// ─── Status-change trigger: O(1) delta-based counter ─────────────────────────
//
// Replaces the previous per-write recount (which scanned every event for the
// host on each fire — ~60 reads at the steady state). The new shape:
//
//   - Compute whether the event was/is "counted" (status + archived + date).
//   - If the boundary didn't move AND the host didn't change → no-op (0 reads).
//   - Otherwise apply ±1 to plan.eventCapCount inside a transaction so the
//     blocked flag stays consistent with the count.
//
// Drift is corrected lazily by the `getEventCapStatus` callable — it does a
// precise count and overwrites whenever a human looks at the number.

interface ProfileDelta {
  profileId: string;
  delta: number; // -1, 0, or +1 per profile
}

function computeProfileDeltas(
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown> | undefined,
): ProfileDelta[] {
  const today = new Date();
  const wasCounted = isCountedState(before, today);
  const isCounted = isCountedState(after, today);

  const beforeHost = typeof before?.hostProfileId === "string" ? before.hostProfileId : "";
  const afterHost = typeof after?.hostProfileId === "string" ? after.hostProfileId : "";

  // Accumulate per-profile deltas so a host-change handles old/new correctly.
  const deltas = new Map<string, number>();
  if (wasCounted && beforeHost) {
    deltas.set(beforeHost, (deltas.get(beforeHost) ?? 0) - 1);
  }
  if (isCounted && afterHost) {
    deltas.set(afterHost, (deltas.get(afterHost) ?? 0) + 1);
  }

  return Array.from(deltas.entries())
    .filter(([, delta]) => delta !== 0)
    .map(([profileId, delta]) => ({ profileId, delta }));
}

async function applyDelta(profileId: string, delta: number): Promise<void> {
  const planRef = db().collection("plans").doc(profileId);

  await db().runTransaction(async (tx) => {
    const planSnap = await tx.get(planRef);
    if (!planSnap.exists) {
      // No plan doc yet — backfill hasn't run for this profile.
      // Don't auto-create; let `setPlan` or the backfill script own creation.
      return;
    }
    const plan = planSnap.data() as ProfilePlan;
    if (plan.type !== "free_operator") {
      // Paid or artist plan — cap doesn't apply, nothing to maintain.
      return;
    }

    const current = typeof plan.eventCapCount === "number" ? plan.eventCapCount : null;
    let nextCount: number;
    if (current === null) {
      // First time we're touching this counter — initialize via precise count
      // (one-time O(N) cost per profile, amortized across all future writes).
      // The actual event change is already reflected in `events/` at this
      // point, so the precise count includes our +/- 1 — no further delta.
      nextCount = await countEventsForCap(profileId);
    } else {
      nextCount = Math.max(0, current + delta);
    }
    const nextBlocked = nextCount >= HARD_CAP;

    tx.update(planRef, {
      eventCapCount: nextCount,
      eventCapBlocked: nextBlocked,
      eventCapLastComputedAt: FieldValue.serverTimestamp(),
    });
  });
}

export const onEventWrittenMaintainCap = onDocumentWritten(
  {
    document: "events/{eventId}",
    region: "europe-west1",
  },
  async (event) => {
    const before = event.data?.before?.data() as Record<string, unknown> | undefined;
    const after = event.data?.after?.data() as Record<string, unknown> | undefined;

    const deltas = computeProfileDeltas(before, after);
    if (deltas.length === 0) return; // most writes hit this no-op path

    for (const { profileId, delta } of deltas) {
      try {
        await applyDelta(profileId, delta);
      } catch (err) {
        logger.error("onEventWrittenMaintainCap: applyDelta failed", {
          profileId,
          delta,
          err: String(err),
        });
      }
    }
  },
);

// ─── Helpers re-exported for use elsewhere ───────────────────────────────────

export function isPaidPlanType(type: PlanType | null | undefined): boolean {
  return !!type && PAID_PLAN_TYPES.has(type);
}
