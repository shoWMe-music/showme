import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import {
  computeEventAccessUids,
  recomputeAccessUidsForEvents,
} from "./profileMembers";

// Touch the import so eslint/tsc don't drop it; computeEventAccessUids is
// re-exported here implicitly to keep the public surface explicit for callers
// that want to recompute a single event's access set in the future.
void computeEventAccessUids;

interface AcceptProfileInviteData {
  inviteId: string;
}

interface AcceptProfileInviteResult {
  ok: true;
  profileId: string;
  eventsUpdated: number;
}

/**
 * Accept a profile invite synchronously. Writes the member doc, deletes the
 * invite, then awaits a full recompute of `accessUids` on every event whose
 * `accessProfileIds` includes this profile. The client can show a "loading
 * new profile data" modal until this resolves.
 */
export const acceptProfileInvite = onCall<
  AcceptProfileInviteData,
  Promise<AcceptProfileInviteResult>
>(
  { region: "europe-west1" },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Sign in to accept an invite.");
    }

    const callerEmail = request.auth?.token?.email;
    if (typeof callerEmail !== "string" || !callerEmail) {
      throw new HttpsError("failed-precondition", "Account email missing.");
    }

    const inviteId = request.data?.inviteId;
    if (typeof inviteId !== "string" || !inviteId.trim()) {
      throw new HttpsError("invalid-argument", "inviteId is required.");
    }

    const db = admin.firestore();
    const inviteRef = db.collection("profileInvites").doc(inviteId);
    const inviteSnap = await inviteRef.get();
    if (!inviteSnap.exists) {
      throw new HttpsError("not-found", "Invite not found.");
    }

    const invite = inviteSnap.data() as Record<string, unknown>;
    const profileId =
      typeof invite.profileId === "string" ? invite.profileId : "";
    const inviteEmail =
      typeof invite.email === "string" ? invite.email : "";
    const role =
      typeof invite.role === "string" ? invite.role : "";
    const invitedByUid =
      typeof invite.invitedByUid === "string" && invite.invitedByUid
        ? invite.invitedByUid
        : "self-accept";

    if (!profileId || !inviteEmail) {
      throw new HttpsError("failed-precondition", "Invite is malformed.");
    }

    const expectedInviteId = `${profileId}_${inviteEmail.toLowerCase()}`;
    if (inviteId !== expectedInviteId) {
      throw new HttpsError("failed-precondition", "Invite id mismatch.");
    }

    if (callerEmail.toLowerCase() !== inviteEmail.toLowerCase()) {
      throw new HttpsError(
        "permission-denied",
        "This invite is for a different email.",
      );
    }

    if (role !== "admin" && role !== "editor") {
      throw new HttpsError("failed-precondition", "Invalid invite role.");
    }

    const memberRef = db
      .collection("profiles")
      .doc(profileId)
      .collection("members")
      .doc(uid);

    const batch = db.batch();
    batch.set(memberRef, {
      user_uid: uid,
      email: inviteEmail.toLowerCase(),
      role,
      addedAt: FieldValue.serverTimestamp(),
      addedByUid: invitedByUid,
    });
    batch.delete(inviteRef);
    await batch.commit();

    let eventsUpdated = 0;
    try {
      eventsUpdated = await recomputeAccessUidsForEvents(profileId);
    } catch (err) {
      logger.warn("acceptProfileInvite: recompute failed (member doc was written)", {
        profileId,
        uid,
        err: String(err),
      });
    }

    // Notify the invite sender (and the profile owner if different) so they
    // see the joined member without polling. Refresh of the members list is
    // driven client-side by useNotificationInvalidator on `profile_member_joined`.
    try {
      const profileSnap = await db.collection("profiles").doc(profileId).get();
      const profile = (profileSnap.data() ?? {}) as Record<string, unknown>;
      const ownerUid =
        typeof profile.owner_uid === "string" ? profile.owner_uid : "";
      const profileName =
        typeof profile.name === "string" && profile.name
          ? profile.name
          : "your profile";

      const recipients = new Set<string>();
      if (invitedByUid && invitedByUid !== "self-accept") recipients.add(invitedByUid);
      if (ownerUid) recipients.add(ownerUid);
      recipients.delete(uid);

      if (recipients.size > 0) {
        let acceptorName = "Someone";
        try {
          const acceptor = await admin.auth().getUser(uid);
          acceptorName = acceptor.displayName || acceptor.email || "Someone";
        } catch {
          // best-effort
        }

        const roleLabel = role === "admin" ? "an admin" : "an editor";
        const now = new Date().toISOString();
        const batch = db.batch();
        for (const recipientUid of recipients) {
          const ref = db
            .collection("users").doc(recipientUid)
            .collection("notifications").doc();
          batch.set(ref, {
            type: "profile_member_joined",
            title: `${acceptorName} joined ${profileName}`,
            body: `${acceptorName} accepted your invite as ${roleLabel}.`,
            actorName: acceptorName,
            actorUid: uid,
            read: false,
            createdAt: now,
            link: "/settings#profile-access",
            metadata: { profileId, role },
          });
        }
        await batch.commit();
      }
    } catch (err) {
      logger.warn("acceptProfileInvite: failed to write join notifications", {
        profileId,
        uid,
        err: String(err),
      });
    }

    logger.info("acceptProfileInvite: completed", {
      profileId,
      uid,
      role,
      eventsUpdated,
    });

    return { ok: true, profileId, eventsUpdated };
  },
);

interface DeclineProfileInviteData {
  inviteId: string;
}

interface DeclineProfileInviteResult {
  ok: true;
}

/**
 * Decline a profile invite. Deletes the invite doc and writes a
 * `profile_invite_declined` notification to the inviter and the profile owner
 * (deduped, actor excluded). Mirrors `acceptProfileInvite` so the sender
 * sees the outcome without polling.
 */
export const declineProfileInvite = onCall<
  DeclineProfileInviteData,
  Promise<DeclineProfileInviteResult>
>(
  { region: "europe-west1" },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Sign in to decline an invite.");
    }

    const callerEmail = request.auth?.token?.email;
    if (typeof callerEmail !== "string" || !callerEmail) {
      throw new HttpsError("failed-precondition", "Account email missing.");
    }

    const inviteId = request.data?.inviteId;
    if (typeof inviteId !== "string" || !inviteId.trim()) {
      throw new HttpsError("invalid-argument", "inviteId is required.");
    }

    const db = admin.firestore();
    const inviteRef = db.collection("profileInvites").doc(inviteId);
    const inviteSnap = await inviteRef.get();
    if (!inviteSnap.exists) {
      throw new HttpsError("not-found", "Invite not found.");
    }

    const invite = inviteSnap.data() as Record<string, unknown>;
    const profileId =
      typeof invite.profileId === "string" ? invite.profileId : "";
    const inviteEmail =
      typeof invite.email === "string" ? invite.email : "";
    const role =
      typeof invite.role === "string" ? invite.role : "";
    const invitedByUid =
      typeof invite.invitedByUid === "string" && invite.invitedByUid
        ? invite.invitedByUid
        : "";

    if (!profileId || !inviteEmail) {
      throw new HttpsError("failed-precondition", "Invite is malformed.");
    }
    if (callerEmail.toLowerCase() !== inviteEmail.toLowerCase()) {
      throw new HttpsError(
        "permission-denied",
        "This invite is for a different email.",
      );
    }

    await inviteRef.delete();

    try {
      const profileSnap = await db.collection("profiles").doc(profileId).get();
      const profile = (profileSnap.data() ?? {}) as Record<string, unknown>;
      const ownerUid =
        typeof profile.owner_uid === "string" ? profile.owner_uid : "";
      const profileName =
        typeof profile.name === "string" && profile.name
          ? profile.name
          : "your profile";

      const recipients = new Set<string>();
      if (invitedByUid) recipients.add(invitedByUid);
      if (ownerUid) recipients.add(ownerUid);
      recipients.delete(uid);

      if (recipients.size > 0) {
        let declinerName = "Someone";
        try {
          const decliner = await admin.auth().getUser(uid);
          declinerName = decliner.displayName || decliner.email || "Someone";
        } catch {
          // best-effort
        }

        const roleLabel = role === "admin" ? "an admin" : "an editor";
        const now = new Date().toISOString();
        const batch = db.batch();
        for (const recipientUid of recipients) {
          const ref = db
            .collection("users").doc(recipientUid)
            .collection("notifications").doc();
          batch.set(ref, {
            type: "profile_invite_declined",
            title: `${declinerName} declined your invite`,
            body: `${declinerName} declined your invite to ${profileName} as ${roleLabel}.`,
            actorName: declinerName,
            actorUid: uid,
            read: false,
            createdAt: now,
            link: "/settings#profile-access",
            metadata: { profileId, role, email: inviteEmail.toLowerCase() },
          });
        }
        await batch.commit();
      }
    } catch (err) {
      logger.warn("declineProfileInvite: failed to write decline notifications", {
        profileId,
        uid,
        err: String(err),
      });
    }

    logger.info("declineProfileInvite: completed", { profileId, uid });
    return { ok: true };
  },
);

interface RemoveProfileMemberData {
  profileId: string;
  memberUid: string;
}

interface RemoveProfileMemberResult {
  ok: true;
  eventsUpdated: number;
}

/**
 * Remove a member from a profile and synchronously reconcile event-access
 * denormalization. Refuses to remove the owner.
 */
export const removeProfileMember = onCall<
  RemoveProfileMemberData,
  Promise<RemoveProfileMemberResult>
>(
  { region: "europe-west1" },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Sign in to manage members.");
    }

    const profileId = request.data?.profileId;
    const memberUid = request.data?.memberUid;
    if (typeof profileId !== "string" || !profileId.trim()) {
      throw new HttpsError("invalid-argument", "profileId is required.");
    }
    if (typeof memberUid !== "string" || !memberUid.trim()) {
      throw new HttpsError("invalid-argument", "memberUid is required.");
    }

    const db = admin.firestore();
    const profileRef = db.collection("profiles").doc(profileId);
    const profileSnap = await profileRef.get();
    if (!profileSnap.exists) {
      throw new HttpsError("not-found", "Profile not found.");
    }
    const profile = profileSnap.data() as Record<string, unknown>;
    const ownerUid =
      typeof profile.owner_uid === "string" ? profile.owner_uid : "";

    // Self-removal is always allowed for non-owner members. The owner check
    // below still blocks owners from removing themselves.
    let authorized = ownerUid === uid || uid === memberUid;
    if (!authorized) {
      const callerMemberSnap = await profileRef
        .collection("members")
        .doc(uid)
        .get();
      if (callerMemberSnap.exists) {
        const callerMember = callerMemberSnap.data() as Record<string, unknown>;
        if (callerMember.role === "admin") authorized = true;
      }
    }
    if (!authorized) {
      throw new HttpsError(
        "permission-denied",
        "Only the profile owner or an admin can remove members.",
      );
    }

    if (memberUid === ownerUid) {
      throw new HttpsError(
        "failed-precondition",
        "Cannot remove the profile owner.",
      );
    }

    const memberRef = profileRef.collection("members").doc(memberUid);
    const memberSnap = await memberRef.get();
    if (!memberSnap.exists) {
      logger.info("removeProfileMember: noop (member already absent)", {
        profileId,
        memberUid,
      });
      return { ok: true, eventsUpdated: 0 };
    }

    await memberRef.delete();

    let eventsUpdated = 0;
    try {
      eventsUpdated = await recomputeAccessUidsForEvents(profileId);
    } catch (err) {
      logger.warn("removeProfileMember: recompute failed (member doc was deleted)", {
        profileId,
        memberUid,
        err: String(err),
      });
    }

    // Notify the removed user (they need to know access changed) plus the
    // remaining profile members for visibility, excluding the actor.
    try {
      const profileName =
        typeof profile.name === "string" && profile.name
          ? profile.name
          : "your profile";

      const remaining = await profileRef.collection("members").get();
      const recipients = new Set<string>();
      recipients.add(memberUid);
      for (const m of remaining.docs) if (m.id) recipients.add(m.id);
      recipients.delete(uid);

      if (recipients.size > 0) {
        let actorName = "Someone";
        try {
          const actor = await admin.auth().getUser(uid);
          actorName = actor.displayName || actor.email || "Someone";
        } catch {
          // best-effort
        }

        const isSelfRemoval = uid === memberUid;
        const now = new Date().toISOString();
        const batch = db.batch();
        for (const recipientUid of recipients) {
          const ref = db
            .collection("users").doc(recipientUid)
            .collection("notifications").doc();
          const isRemoved = recipientUid === memberUid;
          let title: string;
          let body: string;
          if (isSelfRemoval) {
            title = `${actorName} left ${profileName}`;
            body = `${actorName} removed themselves from ${profileName}.`;
          } else if (isRemoved) {
            title = `You were removed from ${profileName}`;
            body = `${actorName} removed your access to ${profileName}.`;
          } else {
            title = `Member removed from ${profileName}`;
            body = `${actorName} removed a member from ${profileName}.`;
          }
          batch.set(ref, {
            type: "profile_member_removed",
            title,
            body,
            actorName,
            actorUid: uid,
            read: false,
            createdAt: now,
            link: "/settings#profile-access",
            metadata: { profileId, memberUid },
          });
        }
        await batch.commit();
      }
    } catch (err) {
      logger.warn("removeProfileMember: failed to write removed notifications", {
        profileId,
        memberUid,
        err: String(err),
      });
    }

    logger.info("removeProfileMember: completed", {
      profileId,
      memberUid,
      eventsUpdated,
    });

    return { ok: true, eventsUpdated };
  },
);

interface ProfileMemberInfo {
  uid: string;
  role: "owner" | "admin" | "editor";
  email?: string;
  displayName?: string;
}

interface ProfileInviteRecord {
  id: string;
  profileId: string;
  profileName: string;
  email: string;
  role: "admin" | "editor";
  invitedAt: string;
  invitedByUid: string;
}

interface ProfileMembershipBatchEntry {
  profileId: string;
  members: ProfileMemberInfo[];
  invites: ProfileInviteRecord[];
}

interface GetProfileMembershipBatchData {
  profileIds: string[];
}

interface GetProfileMembershipBatchResult {
  entries: ProfileMembershipBatchEntry[];
}

const MAX_BATCH_PROFILE_IDS = 50;

/**
 * Read members + pending invites for many profiles in one round-trip. The
 * client-side `useQueries` fan-out used to fire 2×N HTTP requests, which is
 * particularly painful against the local emulator where forced long-polling
 * uses a fresh connection per request and quickly hits the browser's
 * 6-connection per-origin limit.
 *
 * Server-side runs with admin privileges so we don't pay the rules-engine
 * cost (`isProfileMember` exists checks on every list). Authorization here
 * mirrors the rules: caller must be a member of each profile to see members,
 * and an admin/owner to see invites.
 */
export const getProfileMembershipBatch = onCall<
  GetProfileMembershipBatchData,
  Promise<GetProfileMembershipBatchResult>
>(
  { region: "europe-west1" },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Sign in to load profile members.");
    }

    const raw = request.data?.profileIds;
    if (!Array.isArray(raw)) {
      throw new HttpsError("invalid-argument", "profileIds must be an array.");
    }
    const profileIds = Array.from(
      new Set(
        raw.filter((id): id is string => typeof id === "string" && id.trim().length > 0),
      ),
    );
    if (profileIds.length === 0) {
      return { entries: [] };
    }
    if (profileIds.length > MAX_BATCH_PROFILE_IDS) {
      throw new HttpsError(
        "invalid-argument",
        `profileIds exceeds limit of ${MAX_BATCH_PROFILE_IDS}.`,
      );
    }

    const db = admin.firestore();

    const entries = await Promise.all(
      profileIds.map(async (profileId): Promise<ProfileMembershipBatchEntry | null> => {
        const profileRef = db.collection("profiles").doc(profileId);

        const callerMemberSnap = await profileRef
          .collection("members")
          .doc(uid)
          .get();
        if (!callerMemberSnap.exists) return null;

        const callerRole =
          typeof (callerMemberSnap.data() as Record<string, unknown>).role === "string"
            ? ((callerMemberSnap.data() as Record<string, unknown>).role as string)
            : "";
        const canSeeInvites = callerRole === "owner" || callerRole === "admin";

        const [membersSnap, invitesSnap] = await Promise.all([
          profileRef.collection("members").get(),
          canSeeInvites
            ? db
                .collection("profileInvites")
                .where("profileId", "==", profileId)
                .get()
            : Promise.resolve(null),
        ]);

        const members: ProfileMemberInfo[] = membersSnap.docs.map((d) => {
          const data = d.data() as Record<string, unknown>;
          const role =
            data.role === "owner" || data.role === "admin" || data.role === "editor"
              ? (data.role as "owner" | "admin" | "editor")
              : "editor";
          return {
            uid: d.id,
            role,
            email: typeof data.email === "string" ? data.email : undefined,
            displayName:
              typeof data.displayName === "string" ? data.displayName : undefined,
          };
        });

        const invites: ProfileInviteRecord[] = invitesSnap
          ? invitesSnap.docs.map((d) => {
              const data = d.data() as Record<string, unknown>;
              return {
                id: d.id,
                profileId:
                  typeof data.profileId === "string" ? data.profileId : profileId,
                profileName:
                  typeof data.profileName === "string" ? data.profileName : "",
                email: typeof data.email === "string" ? data.email : "",
                role:
                  data.role === "admin" || data.role === "editor"
                    ? (data.role as "admin" | "editor")
                    : "editor",
                invitedAt:
                  typeof data.invitedAt === "string" ? data.invitedAt : "",
                invitedByUid:
                  typeof data.invitedByUid === "string" ? data.invitedByUid : "",
              };
            })
          : [];

        return { profileId, members, invites };
      }),
    );

    return {
      entries: entries.filter((e): e is ProfileMembershipBatchEntry => e !== null),
    };
  },
);

interface SetProfileMemberRoleData {
  profileId: string;
  memberUid: string;
  role: "admin" | "editor";
}

interface SetProfileMemberRoleResult {
  ok: true;
}

/**
 * Change a member's role on a profile (admin/editor only — owner cannot be
 * downgraded). Authorized by profile owner or another admin. Writes a
 * `profile_member_role_changed` notification to the affected member so their
 * Profile Access tab badge updates without a manual refresh.
 */
export const setProfileMemberRole = onCall<
  SetProfileMemberRoleData,
  Promise<SetProfileMemberRoleResult>
>(
  { region: "europe-west1" },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Sign in to manage members.");
    }

    const profileId = request.data?.profileId;
    const memberUid = request.data?.memberUid;
    const role = request.data?.role;
    if (typeof profileId !== "string" || !profileId.trim()) {
      throw new HttpsError("invalid-argument", "profileId is required.");
    }
    if (typeof memberUid !== "string" || !memberUid.trim()) {
      throw new HttpsError("invalid-argument", "memberUid is required.");
    }
    if (role !== "admin" && role !== "editor") {
      throw new HttpsError("invalid-argument", "role must be admin or editor.");
    }

    const db = admin.firestore();
    const profileRef = db.collection("profiles").doc(profileId);
    const profileSnap = await profileRef.get();
    if (!profileSnap.exists) {
      throw new HttpsError("not-found", "Profile not found.");
    }
    const profile = profileSnap.data() as Record<string, unknown>;
    const ownerUid =
      typeof profile.owner_uid === "string" ? profile.owner_uid : "";

    let authorized = ownerUid === uid;
    if (!authorized) {
      const callerMemberSnap = await profileRef
        .collection("members")
        .doc(uid)
        .get();
      if (callerMemberSnap.exists) {
        const callerMember = callerMemberSnap.data() as Record<string, unknown>;
        if (callerMember.role === "admin") authorized = true;
      }
    }
    if (!authorized) {
      throw new HttpsError(
        "permission-denied",
        "Only the profile owner or an admin can change member roles.",
      );
    }

    if (memberUid === ownerUid) {
      throw new HttpsError(
        "failed-precondition",
        "Cannot change the profile owner's role.",
      );
    }

    const memberRef = profileRef.collection("members").doc(memberUid);
    const memberSnap = await memberRef.get();
    if (!memberSnap.exists) {
      throw new HttpsError("not-found", "Member not found on this profile.");
    }
    const previousRole =
      typeof (memberSnap.data() as Record<string, unknown>).role === "string"
        ? ((memberSnap.data() as Record<string, unknown>).role as string)
        : "";

    if (previousRole === role) {
      // No-op: already at the target role. Skip the write and the notification
      // so the affected user isn't pinged for a change that didn't happen.
      return { ok: true };
    }

    await memberRef.set(
      { role, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );

    if (memberUid !== uid) {
      try {
        const profileName =
          typeof profile.name === "string" && profile.name
            ? profile.name
            : "your profile";

        let actorName = "Someone";
        try {
          const actor = await admin.auth().getUser(uid);
          actorName = actor.displayName || actor.email || "Someone";
        } catch {
          // best-effort
        }

        const roleLabel = role === "admin" ? "an admin" : "an editor";
        const ref = db
          .collection("users").doc(memberUid)
          .collection("notifications").doc();
        await ref.set({
          type: "profile_member_role_changed",
          title: `Your role on ${profileName} changed`,
          body: `${actorName} made you ${roleLabel} of ${profileName}.`,
          actorName,
          actorUid: uid,
          read: false,
          createdAt: new Date().toISOString(),
          link: "/settings#profile-access",
          metadata: { profileId, role, previousRole },
        });
      } catch (err) {
        logger.warn("setProfileMemberRole: failed to write role-change notification", {
          profileId,
          memberUid,
          err: String(err),
        });
      }
    }

    logger.info("setProfileMemberRole: completed", {
      profileId,
      memberUid,
      role,
      previousRole,
    });

    return { ok: true };
  },
);
