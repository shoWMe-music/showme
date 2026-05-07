import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { onDocumentWritten } from "firebase-functions/v2/firestore";

const db = () => admin.firestore();

/**
 * Compute the canonical accessUids set for an event:
 *   owner_uid + all members of every profile in accessProfileIds
 *   + every active collaborator userUid.
 *
 * Used by the profile-member trigger and the admin backfill. Recomputing on
 * every change is symmetric across create/delete and self-heals any drift.
 */
export async function computeEventAccessUids(
  eventId: string,
  ev: FirebaseFirestore.DocumentData,
): Promise<string[]> {
  const accessProfileIds: string[] = Array.isArray(ev.accessProfileIds)
    ? (ev.accessProfileIds as string[]).filter((p) => typeof p === "string" && p)
    : [];
  const owner_uid =
    typeof ev.owner_uid === "string" ? ev.owner_uid : "";

  const uids = new Set<string>();
  if (owner_uid) uids.add(owner_uid);

  // Members of every accessProfileId on the event.
  await Promise.all(
    accessProfileIds.map(async (pid) => {
      try {
        const snap = await db()
          .collection("profiles")
          .doc(pid)
          .collection("members")
          .get();
        snap.forEach((m) => {
          const data = m.data() as Record<string, unknown>;
          const u =
            typeof data.user_uid === "string" && data.user_uid
              ? data.user_uid
              : m.id;
          if (u) uids.add(u);
        });
      } catch (err) {
        logger.warn("computeEventAccessUids: profile members read failed", {
          eventId,
          profileId: pid,
          err: String(err),
        });
      }
    }),
  );

  // Active collaborators (status normalized to "active" in db.ts).
  try {
    const collabSnap = await db()
      .collection("events")
      .doc(eventId)
      .collection("collaborators")
      .get();
    collabSnap.forEach((c) => {
      const data = c.data() as Record<string, unknown>;
      const status = String(data.status ?? "");
      if (status !== "active") return;
      const u = typeof data.userUid === "string" ? data.userUid : "";
      if (u) uids.add(u);
    });
  } catch (err) {
    logger.warn("computeEventAccessUids: collaborators read failed", {
      eventId,
      err: String(err),
    });
  }

  return Array.from(uids);
}

export async function recomputeAccessUidsForEvents(profileId: string): Promise<number> {
  if (!profileId) return 0;
  const evSnap = await db()
    .collection("events")
    .where("accessProfileIds", "array-contains", profileId)
    .get();
  if (evSnap.empty) return 0;

  let updated = 0;
  await Promise.all(
    evSnap.docs.map(async (d) => {
      const ev = d.data();
      const next = await computeEventAccessUids(d.id, ev);
      const prev: string[] = Array.isArray(ev.accessUids)
        ? (ev.accessUids as string[])
        : [];
      // Skip the write if nothing changed (avoids touching updatedAt for noise).
      const same =
        prev.length === next.length &&
        new Set(prev).size === new Set([...prev, ...next]).size;
      if (same) return;
      try {
        await d.ref.update({
          accessUids: next,
          updatedAt: FieldValue.serverTimestamp(),
        });
        updated += 1;
      } catch (err) {
        logger.warn("recomputeAccessUidsForEvents: update failed", {
          eventId: d.id,
          err: String(err),
        });
      }
    }),
  );
  return updated;
}

/**
 * Maintain accessUids on every event whose accessProfileIds includes this
 * profile, in response to membership churn on the profile.
 *
 * Why recompute (vs. arrayUnion / arrayRemove): on delete, the removed user
 * may still have access via another profile in accessProfileIds, via a
 * collaborator entry, or as owner_uid. Recomputing from scratch is the only
 * safe symmetric path.
 */
export const onProfileMemberWritten = onDocumentWritten(
  {
    document: "profiles/{profileId}/members/{memberUid}",
    region: "europe-west1",
  },
  async (event) => {
    const profileId = event.params.profileId;
    if (!profileId) return;

    const before = event.data?.before?.data() as Record<string, unknown> | undefined;
    const after = event.data?.after?.data() as Record<string, unknown> | undefined;

    // Skip purely-cosmetic role changes (role doesn't affect access — the rule
    // checks existence of the member doc, not the role).
    if (before && after) {
      const beforeUid =
        typeof before.user_uid === "string" ? before.user_uid : event.params.memberUid;
      const afterUid =
        typeof after.user_uid === "string" ? after.user_uid : event.params.memberUid;
      if (beforeUid === afterUid) return;
    }

    try {
      const updated = await recomputeAccessUidsForEvents(profileId);
      logger.info("onProfileMemberWritten: accessUids resync done", {
        profileId,
        memberUid: event.params.memberUid,
        eventsUpdated: updated,
      });
    } catch (err) {
      logger.error("onProfileMemberWritten: failed", {
        profileId,
        err: String(err),
      });
    }
  },
);

// One-time backfill of historic events lives in
// `scripts/backfill-event-access-uids.ts` — run via Admin SDK / ADC, not
// callable, to avoid needing an admin gate at runtime.
