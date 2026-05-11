import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import {
  computeRankShift,
  computeDeclinePromotion,
  competingHoldIds,
  type HoldSibling,
} from "./holdRankLogic";

const db = () => admin.firestore();

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

interface EventLite {
  id: string;
  date?: string;
  venue?: string;
  roomStage?: string;
  eventStatus?: string;
  holdRank?: number;
  holdAutoPromote?: boolean;
  performerProfileId?: string;
  accessUids?: string[];
  archived?: boolean;
}

/** Read the caller's `profileIds` custom claim (set by syncUserClaims). */
function getCallerProfileIds(request: { auth?: { token?: Record<string, unknown> } }): string[] {
  const raw = request.auth?.token?.profileIds;
  if (Array.isArray(raw)) {
    return raw.filter((p): p is string => typeof p === "string" && p.length > 0);
  }
  return [];
}

/**
 * Performer test: caller is acting as the performer of this event when their
 * `profileIds` claim contains `event.performerProfileId`.
 *
 * Note: users with >16 profiles have an `overflow` flag (see profileClaims.ts)
 * — for those, the claim may not include every profile. We fall back to a
 * Firestore membership check only when the claim is absent AND the caller
 * isn't on `accessUids` (otherwise we'd over-trust an empty claim).
 */
async function isCallerPerformer(
  uid: string,
  callerProfileIds: string[],
  performerProfileId: string,
): Promise<boolean> {
  if (!performerProfileId) return false;
  if (callerProfileIds.includes(performerProfileId)) return true;

  // Fallback for overflow users — check Firestore directly.
  try {
    const profileSnap = await db().collection("profiles").doc(performerProfileId).get();
    if (!profileSnap.exists) return false;
    const data = profileSnap.data() as Record<string, unknown>;
    if (data.owner_uid === uid) return true;
    const memberSnap = await db()
      .collection("profiles")
      .doc(performerProfileId)
      .collection("members")
      .doc(uid)
      .get();
    return memberSnap.exists;
  } catch (err) {
    logger.warn("isCallerPerformer fallback failed", {
      uid,
      performerProfileId,
      err: String(err),
    });
    return false;
  }
}

async function loadEvent(eventId: string): Promise<EventLite> {
  const ref = db().collection("events").doc(eventId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "Event not found.");
  }
  return { id: snap.id, ...(snap.data() as Record<string, unknown>) } as EventLite;
}

/**
 * Query siblings for hold-ranking ops. Firestore disallows multiple
 * inequality filters and combining `!=` with `==` on different fields, so we
 * filter `archived` and `roomStage` in memory. Mirrors the client filter
 * shape at useEventMutations.ts:1480.
 */
async function querySiblings(event: EventLite, excludeId: string): Promise<HoldSibling[]> {
  if (!event.date || !event.venue) return [];
  const snap = await db()
    .collection("events")
    .where("date", "==", event.date)
    .where("venue", "==", event.venue)
    .where("eventStatus", "==", "on_hold")
    .get();
  const targetRoom = event.roomStage || "";
  const out: HoldSibling[] = [];
  for (const d of snap.docs) {
    if (d.id === excludeId) continue;
    const data = d.data() as Record<string, unknown>;
    if (data.archived === true) continue;
    const roomStage =
      typeof data.roomStage === "string" ? data.roomStage : "";
    if (roomStage !== targetRoom) continue;
    const holdRank =
      typeof data.holdRank === "number" && data.holdRank > 0 ? data.holdRank : 1;
    const holdAutoPromote =
      typeof data.holdAutoPromote === "boolean" ? data.holdAutoPromote : undefined;
    out.push({ id: d.id, holdRank, holdAutoPromote });
  }
  return out;
}

// ---------------------------------------------------------------------------
// setHoldRank
// ---------------------------------------------------------------------------

interface SetHoldRankData {
  eventId: string;
  rank: number;
}

interface SetHoldRankResult {
  ok: true;
  updated: Array<{ id: string; holdRank: number }>;
}

export const setHoldRank = onCall<SetHoldRankData, Promise<SetHoldRankResult>>(
  { region: "europe-west1" },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Sign in to update hold rank.");
    }

    const { eventId, rank } = request.data ?? ({} as SetHoldRankData);
    if (typeof eventId !== "string" || !eventId.trim()) {
      throw new HttpsError("invalid-argument", "eventId is required.");
    }
    if (typeof rank !== "number" || !Number.isFinite(rank) || rank < 1 || !Number.isInteger(rank)) {
      throw new HttpsError("invalid-argument", "rank must be a positive integer.");
    }

    const event = await loadEvent(eventId);

    if (event.eventStatus !== "on_hold") {
      throw new HttpsError(
        "failed-precondition",
        "Hold rank can only be set on events in `on_hold` status.",
      );
    }

    const accessUids = Array.isArray(event.accessUids) ? event.accessUids : [];
    if (!accessUids.includes(uid)) {
      logger.error("setHoldRank: caller not in accessUids", { uid, eventId });
      throw new HttpsError("permission-denied", "You don't have access to this event.");
    }

    // Operator-only: hold rank/auto-promote are operator settings.
    const callerProfileIds = getCallerProfileIds(request);
    const performerProfileId = event.performerProfileId || "";
    const isPerformer = await isCallerPerformer(uid, callerProfileIds, performerProfileId);
    if (isPerformer) {
      // If they're ALSO an operator (e.g. own both venue + performer profile)
      // we still allow it — the operator role should win. Detect that by
      // checking accessUids covers more than just the performer's profile
      // membership. Cheapest signal: hostProfileId membership. We approximate
      // by checking if the caller is in accessUids AND not the performer-only
      // case. If they're in accessUids but their ONLY claim is the performer
      // profile, treat as performer.
      const onlyPerformer =
        callerProfileIds.length > 0 &&
        callerProfileIds.every((pid) => pid === performerProfileId);
      if (onlyPerformer) {
        logger.error("setHoldRank: performer attempted operator action", {
          uid,
          eventId,
          performerProfileId,
        });
        throw new HttpsError(
          "permission-denied",
          "Only the operator can change hold rank or auto-promote.",
        );
      }
    }

    const oldRank = typeof event.holdRank === "number" && event.holdRank > 0 ? event.holdRank : 1;

    // Pull every sibling on the same date/venue/room (excluding the target).
    const siblings = await querySiblings(event, event.id);

    // Compute the minimal diff. Pass siblings + the target (target's old rank).
    const targetSelf: HoldSibling = {
      id: event.id,
      holdRank: oldRank,
      holdAutoPromote: event.holdAutoPromote,
    };
    const allSiblings = [...siblings, targetSelf];
    const updates = computeRankShift({
      siblings: allSiblings,
      targetId: event.id,
      oldRank,
      newRank: rank,
    });

    if (updates.length === 0) {
      logger.info("setHoldRank: no-op (rank unchanged)", { uid, eventId, rank });
      return { ok: true, updated: [] };
    }

    const batch = db().batch();
    for (const u of updates) {
      const ref = db().collection("events").doc(u.id);
      batch.update(ref, {
        holdRank: u.holdRank,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();

    logger.info("setHoldRank: updated", {
      uid,
      eventId,
      oldRank,
      newRank: rank,
      siblingCount: siblings.length,
      updates: updates.length,
    });

    return { ok: true, updated: updates };
  },
);

// ---------------------------------------------------------------------------
// confirmHold — performer accepts the hold offer
// ---------------------------------------------------------------------------

interface ConfirmHoldData {
  eventId: string;
}

interface ConfirmHoldResult {
  ok: true;
  updated: Array<{ id: string; eventStatus: string; holdRank?: number }>;
}

export const confirmHold = onCall<ConfirmHoldData, Promise<ConfirmHoldResult>>(
  { region: "europe-west1" },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Sign in to confirm a hold.");
    }

    const { eventId } = request.data ?? ({} as ConfirmHoldData);
    if (typeof eventId !== "string" || !eventId.trim()) {
      throw new HttpsError("invalid-argument", "eventId is required.");
    }

    const event = await loadEvent(eventId);

    if (event.eventStatus !== "on_hold") {
      throw new HttpsError(
        "failed-precondition",
        "Only on_hold events can be confirmed.",
      );
    }

    const performerProfileId = event.performerProfileId || "";
    if (!performerProfileId) {
      throw new HttpsError(
        "failed-precondition",
        "Event has no performer profile to confirm on behalf of.",
      );
    }

    const callerProfileIds = getCallerProfileIds(request);
    const isPerformer = await isCallerPerformer(uid, callerProfileIds, performerProfileId);
    if (!isPerformer) {
      logger.error("confirmHold: non-performer caller", {
        uid,
        eventId,
        performerProfileId,
      });
      throw new HttpsError(
        "permission-denied",
        "Only the performer can confirm a hold.",
      );
    }

    const siblings = await querySiblings(event, event.id);
    const competingIds = competingHoldIds({ siblings });

    const batch = db().batch();
    const targetRef = db().collection("events").doc(event.id);
    batch.update(targetRef, {
      eventStatus: "pending",
      updatedAt: FieldValue.serverTimestamp(),
    });

    for (const cid of competingIds) {
      const ref = db().collection("events").doc(cid);
      batch.update(ref, {
        eventStatus: "cancelled",
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();

    const updated: Array<{ id: string; eventStatus: string; holdRank?: number }> = [
      { id: event.id, eventStatus: "pending" },
      ...competingIds.map((id) => ({ id, eventStatus: "cancelled" })),
    ];

    logger.info("confirmHold: completed", {
      uid,
      eventId,
      cancelledCount: competingIds.length,
    });

    return { ok: true, updated };
  },
);

// ---------------------------------------------------------------------------
// declineHold — performer or operator drops a hold
// ---------------------------------------------------------------------------

interface DeclineHoldData {
  eventId: string;
}

interface DeclineHoldResult {
  ok: true;
  updated: Array<{ id: string; eventStatus?: string; holdRank?: number }>;
}

export const declineHold = onCall<DeclineHoldData, Promise<DeclineHoldResult>>(
  { region: "europe-west1" },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Sign in to decline a hold.");
    }

    const { eventId } = request.data ?? ({} as DeclineHoldData);
    if (typeof eventId !== "string" || !eventId.trim()) {
      throw new HttpsError("invalid-argument", "eventId is required.");
    }

    const event = await loadEvent(eventId);

    if (event.eventStatus !== "on_hold") {
      throw new HttpsError(
        "failed-precondition",
        "Only on_hold events can be declined.",
      );
    }

    const accessUids = Array.isArray(event.accessUids) ? event.accessUids : [];
    if (!accessUids.includes(uid)) {
      logger.error("declineHold: caller not in accessUids", { uid, eventId });
      throw new HttpsError("permission-denied", "You don't have access to this event.");
    }

    const removedRank =
      typeof event.holdRank === "number" && event.holdRank > 0 ? event.holdRank : 1;

    const siblings = await querySiblings(event, event.id);
    const promotions = computeDeclinePromotion({ siblings, removedRank });

    const batch = db().batch();
    const targetRef = db().collection("events").doc(event.id);
    batch.update(targetRef, {
      eventStatus: "cancelled",
      updatedAt: FieldValue.serverTimestamp(),
    });
    for (const p of promotions) {
      const ref = db().collection("events").doc(p.id);
      batch.update(ref, {
        holdRank: p.holdRank,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();

    const updated: Array<{ id: string; eventStatus?: string; holdRank?: number }> = [
      { id: event.id, eventStatus: "cancelled" },
      ...promotions.map((p) => ({ id: p.id, holdRank: p.holdRank })),
    ];

    logger.info("declineHold: completed", {
      uid,
      eventId,
      removedRank,
      promotedCount: promotions.length,
    });

    return { ok: true, updated };
  },
);
