import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { onDocumentWritten } from "firebase-functions/v2/firestore";

const db = () => admin.firestore();

// Token-size budget: Firebase custom claims plus auth metadata must fit
// under 1KB. 16 profile IDs leaves comfortable headroom for IDs in the
// 20–24 char range. Phase 3 rules will fall back to `accessUids` for
// overflow users.
const PROFILE_IDS_CLAIM_CAP = 16;

/**
 * Compute the canonical list of profileIds this user has access to:
 * profiles they own + profiles they're a member of. Deduplicated, sorted
 * lexicographically for stable output. If length > 16, truncate to the
 * first 16 and flag overflow.
 */
export async function computeUserProfileIds(
  uid: string,
): Promise<{ profileIds: string[]; overflow: boolean }> {
  if (!uid) return { profileIds: [], overflow: false };

  const ids = new Set<string>();

  // Owner profiles.
  const ownerSnap = await db()
    .collection("profiles")
    .where("owner_uid", "==", uid)
    .get();
  ownerSnap.forEach((d) => {
    if (d.id) ids.add(d.id);
  });

  // Member-of profiles via collectionGroup query on `members`.
  const memberSnap = await db()
    .collectionGroup("members")
    .where("user_uid", "==", uid)
    .get();
  memberSnap.forEach((m) => {
    const profileRef = m.ref.parent.parent;
    if (!profileRef) return;
    if (profileRef.id) ids.add(profileRef.id);
  });

  const sorted = Array.from(ids).sort();
  if (sorted.length > PROFILE_IDS_CLAIM_CAP) {
    return {
      profileIds: sorted.slice(0, PROFILE_IDS_CLAIM_CAP),
      overflow: true,
    };
  }
  return { profileIds: sorted, overflow: false };
}

/**
 * Sync this user's `profileIds` custom claim and tick the
 * `users/{uid}/_meta/refreshClaims` doc so the client listener pulls a fresh
 * ID token via `getIdToken(true)` (silent refresh, no re-login).
 *
 * Idempotent: skips both the auth claim write AND the refresh-ping if the
 * claim is already current. Without this guard, every member-doc write fires
 * the trigger which writes a fresh ping which makes the client refresh its
 * token. During bulk membership changes (seed, bulk invite) the client
 * thrashes — every token refresh aborts in-flight Firestore writes, so any
 * concurrent event create gets stuck behind the storm.
 *
 * Do NOT call `revokeRefreshTokens` here — that invalidates the active
 * session and forces the user back to /login on the next token refresh,
 * which is exactly what happens immediately after invite-accept signup.
 */
export async function syncUserClaims(uid: string): Promise<void> {
  if (!uid) return;
  try {
    const { profileIds, overflow } = await computeUserProfileIds(uid);

    const claims: Record<string, unknown> = { profileIds };
    if (overflow) claims.overflow = true;

    // Compare against the user's existing claims — if identical, this trigger
    // run is a no-op and we MUST NOT touch the refresh-ping doc.
    const userRecord = await admin.auth().getUser(uid);
    const existing = (userRecord.customClaims ?? {}) as Record<string, unknown>;
    const existingProfileIds = Array.isArray(existing.profileIds)
      ? (existing.profileIds as string[])
      : [];
    const existingOverflow = existing.overflow === true;
    const sameProfileIds =
      existingProfileIds.length === profileIds.length &&
      existingProfileIds.every((id, i) => id === profileIds[i]);
    if (sameProfileIds && existingOverflow === overflow) {
      logger.info("syncUserClaims: no-op (claim unchanged)", {
        uid,
        profileIdCount: profileIds.length,
      });
      return;
    }

    await admin.auth().setCustomUserClaims(uid, claims);
    await db()
      .collection("users")
      .doc(uid)
      .collection("_meta")
      .doc("refreshClaims")
      .set({ ts: FieldValue.serverTimestamp() }, { merge: true });

    logger.info("syncUserClaims: claim updated", {
      uid,
      profileIdCount: profileIds.length,
      overflow,
    });
  } catch (err) {
    logger.error("syncUserClaims: failed", {
      uid,
      err: String(err),
    });
    throw err;
  }
}

/**
 * Resync a user's `profileIds` custom claim whenever their membership in any
 * profile changes. Independent of the existing `onProfileMemberWritten`
 * trigger (which maintains the denormalized `accessUids` array on events) —
 * both fire on the same path and do their own work.
 *
 * Phase 2 ships invisibly: the claim is populated and kept fresh, but no
 * Firestore Rule reads it yet. Phase 3 will switch rules over.
 */
export const onProfileMemberClaimsSync = onDocumentWritten(
  {
    document: "profiles/{profileId}/members/{memberUid}",
    region: "europe-west1",
  },
  async (event) => {
    const before = event.data?.before?.data() as
      | Record<string, unknown>
      | undefined;
    const after = event.data?.after?.data() as
      | Record<string, unknown>
      | undefined;

    const beforeUid =
      before && typeof before.user_uid === "string" ? before.user_uid : "";
    const afterUid =
      after && typeof after.user_uid === "string" ? after.user_uid : "";

    // Skip cosmetic role-only changes — the user's *list* of profileIds is
    // unchanged. Symmetric with the role-skip in `onProfileMemberWritten`.
    if (before && after && beforeUid && afterUid && beforeUid === afterUid) {
      return;
    }

    const uid = beforeUid || afterUid || event.params.memberUid;
    if (!uid) {
      logger.warn("onProfileMemberClaimsSync: no uid resolved", {
        profileId: event.params.profileId,
        memberUid: event.params.memberUid,
      });
      return;
    }

    try {
      await syncUserClaims(uid);
    } catch (err) {
      logger.error("onProfileMemberClaimsSync: failed", {
        uid,
        profileId: event.params.profileId,
        err: String(err),
      });
      throw err;
    }
  },
);
