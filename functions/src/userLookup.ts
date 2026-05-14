import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";

import { sendMail, BREVO_API_KEY } from "./mail";
import { eventCollaboratorInviteEmail } from "./emailTemplates";
import { APP_BASE_URL } from "./appBaseUrl";
import { computeAdminUidsUpdate } from "./invitations";

const db = () => admin.firestore();

/**
 * Profile roles that map 1-to-1 to a SharedProfile.role and are subject to
 * strict role-matching during invite lookup. Other collaborator roles
 * (agent / manager / custom) are not tied to a profile shape, so any of the
 * recipient's profiles can satisfy the invite.
 */
const PROFILE_ROLES = new Set([
  "performer",
  "venue",
  "promoter",
  "organizer",
  "festival",
]);

async function findUidByEmail(email: string): Promise<{ uid: string; displayName: string | null } | null> {
  try {
    const u = await admin.auth().getUserByEmail(email);
    return { uid: u.uid, displayName: u.displayName ?? null };
  } catch {
    return null;
  }
}

interface MatchingProfile {
  id: string;
  name: string;
  role: string;
  slug?: string | null;
}

async function findProfilesForUid(uid: string): Promise<MatchingProfile[]> {
  // Profiles owned by this user — owner_uid is the canonical pointer for
  // claimed profiles. Filter `created: true` and `unclaimed: false` so we
  // never surface stub or hidden profiles.
  const snap = await db()
    .collection("profiles")
    .where("owner_uid", "==", uid)
    .get();

  const profiles: MatchingProfile[] = [];
  for (const doc of snap.docs) {
    const data = doc.data() as Record<string, unknown>;
    if (data.created !== true) continue;
    if (data.unclaimed === true) continue;
    profiles.push({
      id: doc.id,
      name: typeof data.name === "string" ? data.name : "",
      role: typeof data.role === "string" ? data.role : "",
      slug: typeof data.slug === "string" ? data.slug : null,
    });
  }
  return profiles;
}

// ---------------------------------------------------------------------------
// lookupUserForInvite
// ---------------------------------------------------------------------------

interface LookupUserForInviteData {
  email: string;
  role?: string;
}

interface LookupUserForInviteResult {
  exists: boolean;
  uid?: string;
  displayName?: string | null;
  /** True iff (a) user exists and (b) we found a profile satisfying `role`. */
  hasMatchingProfile?: boolean;
  matchingProfile?: MatchingProfile;
}

export const lookupUserForInvite = onCall<LookupUserForInviteData, Promise<LookupUserForInviteResult>>(
  { region: "europe-west1" },
  async (request) => {
    const callerUid = request.auth?.uid;
    if (!callerUid) {
      throw new HttpsError("unauthenticated", "Authentication required.");
    }

    const rawEmail = request.data?.email;
    if (!rawEmail || typeof rawEmail !== "string") {
      throw new HttpsError("invalid-argument", "email is required.");
    }
    const email = rawEmail.toLowerCase().trim();
    const role = (request.data?.role || "").toLowerCase().trim();

    const found = await findUidByEmail(email);
    if (!found) {
      return { exists: false };
    }

    const profiles = await findProfilesForUid(found.uid);

    if (!role) {
      // No role filter — the caller just wants to know if the user exists.
      return {
        exists: true,
        uid: found.uid,
        displayName: found.displayName,
        hasMatchingProfile: profiles.length > 0,
        matchingProfile: profiles[0],
      };
    }

    // Strict role-matching only applies to roles that map to a profile shape.
    if (PROFILE_ROLES.has(role)) {
      const match = profiles.find((p) => p.role === role);
      if (match) {
        return {
          exists: true,
          uid: found.uid,
          displayName: found.displayName,
          hasMatchingProfile: true,
          matchingProfile: match,
        };
      }
      return {
        exists: true,
        uid: found.uid,
        displayName: found.displayName,
        hasMatchingProfile: false,
      };
    }

    // For agent/manager/custom: any profile counts as a match.
    return {
      exists: true,
      uid: found.uid,
      displayName: found.displayName,
      hasMatchingProfile: profiles.length > 0,
      matchingProfile: profiles[0],
    };
  },
);

// ---------------------------------------------------------------------------
// addExistingUserAsCollaborator
// ---------------------------------------------------------------------------

type CollaboratorPermission = "admin" | "editor" | "view_only";

const VALID_PERMISSIONS: CollaboratorPermission[] = ["admin", "editor", "view_only"];

interface AddExistingUserAsCollaboratorData {
  eventId: string;
  email: string;
  /** Profile id of the existing user that should be linked to the event. */
  profileId: string;
  /** Display name for the collaborator entry. */
  displayName: string;
  /** Collaborator label (e.g. "Performer", "Venue"). */
  role?: string;
  /** Event role (e.g. "performer", "staff"). */
  eventRole?: string;
  /** Edit-power tier. Defaults to "editor" if missing. */
  permission?: CollaboratorPermission;
  message?: string;
  /**
   * When true, also send a notification email to the recipient. The in-app
   * notification is always written. Copy-Link callers pass false because they
   * surface the access grant via clipboard; Send-Email callers pass true.
   */
  sendEmail: boolean;
}

interface AddExistingUserAsCollaboratorResult {
  ok: true;
  collaboratorId: string;
  userUid: string;
}

export const addExistingUserAsCollaborator = onCall<
  AddExistingUserAsCollaboratorData,
  Promise<AddExistingUserAsCollaboratorResult>
>(
  { region: "europe-west1", secrets: [BREVO_API_KEY] },
  async (request) => {
    const callerUid = request.auth?.uid;
    if (!callerUid) {
      throw new HttpsError("unauthenticated", "Authentication required.");
    }

    const { eventId, email: rawEmail, profileId, displayName, role, eventRole, permission: rawPermission, message, sendEmail } = request.data || {};
    const permission: CollaboratorPermission = VALID_PERMISSIONS.includes(rawPermission as CollaboratorPermission)
      ? (rawPermission as CollaboratorPermission)
      : "editor";

    if (!eventId || typeof eventId !== "string") {
      throw new HttpsError("invalid-argument", "eventId is required.");
    }
    if (!profileId || typeof profileId !== "string") {
      throw new HttpsError("invalid-argument", "profileId is required.");
    }
    if (!rawEmail || typeof rawEmail !== "string") {
      throw new HttpsError("invalid-argument", "email is required.");
    }
    if (!displayName || typeof displayName !== "string") {
      throw new HttpsError("invalid-argument", "displayName is required.");
    }

    const email = rawEmail.toLowerCase().trim();

    // Verify caller is authorized to manage collaborators on this event.
    // Two paths, mirroring Firestore rules' `canManageEventCollaborators`:
    //   - host profile admin (owner/admin member of hostProfileId)
    //   - uid in event.adminUids (non-host collab-admin)
    // Anything weaker (editor / view-only / no membership) is rejected. This
    // closes a prior gap where any uid in accessUids could invoke this
    // callable and bypass the host-only rule on the collaborators subcollection.
    const eventRef = db().collection("events").doc(eventId);
    const eventSnap = await eventRef.get();
    if (!eventSnap.exists) {
      throw new HttpsError("not-found", "Event not found.");
    }
    const eventData = eventSnap.data() ?? {};
    const accessUids = Array.isArray(eventData.accessUids) ? (eventData.accessUids as string[]) : [];
    const adminUids = Array.isArray(eventData.adminUids) ? (eventData.adminUids as string[]) : [];
    const hostProfileId = typeof eventData.hostProfileId === "string" ? eventData.hostProfileId : "";

    let callerIsHostAdmin = false;
    if (hostProfileId) {
      try {
        const memberSnap = await db()
          .collection("profiles")
          .doc(hostProfileId)
          .collection("members")
          .doc(callerUid)
          .get();
        if (memberSnap.exists) {
          const role = String((memberSnap.data() as Record<string, unknown>)?.role ?? "");
          callerIsHostAdmin = role === "owner" || role === "admin";
        }
      } catch {
        // ignore — fall through to adminUids check
      }
    }

    if (!callerIsHostAdmin && !adminUids.includes(callerUid)) {
      throw new HttpsError(
        "permission-denied",
        "Only event admins can add collaborators.",
      );
    }

    // Verify the (email, profileId) pair maps to a real user that owns that profile.
    const found = await findUidByEmail(email);
    if (!found) {
      throw new HttpsError("not-found", "No platform user with that email.");
    }
    const profileSnap = await db().collection("profiles").doc(profileId).get();
    if (!profileSnap.exists) {
      throw new HttpsError("not-found", "Profile not found.");
    }
    const profileData = profileSnap.data() ?? {};
    if (profileData.owner_uid !== found.uid) {
      throw new HttpsError("permission-denied", "Profile does not belong to that user.");
    }
    if (profileData.created !== true || profileData.unclaimed === true) {
      throw new HttpsError("failed-precondition", "Profile is not active.");
    }

    const collaboratorId = `user-${found.uid}-${Date.now()}`;
    const invitedAt = new Date().toISOString();
    const labelRole = role || "Performer";
    const finalEventRole = eventRole || "performer";

    // Write the collaborator doc as `active` — the user is already on the
    // platform with a verified email, so there's no signup step to wait for.
    const collaboratorRef = eventRef.collection("collaborators").doc(collaboratorId);
    await collaboratorRef.set({
      clientId: collaboratorId,
      email,
      name: displayName,
      eventRole: finalEventRole,
      role: labelRole,
      permission,
      status: "active",
      invitedAt,
      userUid: found.uid,
      profileId,
      inviteProfileSlug: profileData.slug ?? null,
      schemaVersion: 1,
      invitedByUid: callerUid,
      updatedAt: FieldValue.serverTimestamp(),
    });

    // Grant the new user (and their profile) access to the event so it shows
    // up in their event list immediately.
    //
    // editorUids gates writes via Firestore rules. Two invariants we have to
    // maintain on every write:
    //
    //  1. Once editorUids is set, view-only users must NOT be in it (or they
    //     bypass the gate via the array-membership branch).
    //  2. On first population, we bootstrap from accessUids so pre-existing
    //     legacy collaborators don't lose their edit access the moment a new
    //     invite arrives (the rule falls back to accessUids only while the
    //     field is missing; once it exists, the array is authoritative).
    const eventUpdates: Record<string, unknown> = {
      accessUids: FieldValue.arrayUnion(found.uid),
      accessProfileIds: FieldValue.arrayUnion(profileId),
      updatedAt: FieldValue.serverTimestamp(),
    };
    const hasEditorUids = Array.isArray(eventData.editorUids);
    if (permission === "view_only") {
      // First time editorUids is populated, freeze the legacy roster so
      // pre-existing accessUids keep writing — the new uid stays out.
      if (!hasEditorUids) {
        eventUpdates.editorUids = Array.from(new Set(accessUids));
      }
    } else if (hasEditorUids) {
      eventUpdates.editorUids = FieldValue.arrayUnion(found.uid);
    } else {
      eventUpdates.editorUids = Array.from(new Set([...accessUids, found.uid]));
    }
    // adminUids only tracks non-host collab-admins. Host members are implicit
    // via the rule's isHostAdmin check.
    const adminUidsUpdate = computeAdminUidsUpdate(eventData, found.uid, permission);
    if (adminUidsUpdate !== undefined) {
      eventUpdates.adminUids = adminUidsUpdate;
    }
    await eventRef.update(eventUpdates);

    // Notification — let the recipient know they were added.
    let actorName = "Someone";
    try {
      const actor = await admin.auth().getUser(callerUid);
      actorName = actor.displayName || actor.email || "Someone";
    } catch {
      // ignore
    }
    const eventName = typeof eventData.name === "string" ? eventData.name : "an event";
    const venueName = typeof eventData.venue === "string" ? eventData.venue : undefined;
    const eventDate = typeof eventData.date === "string" ? eventData.date : undefined;
    const trimmedMessage = (message || "").trim();
    try {
      await db()
        .collection("users")
        .doc(found.uid)
        .collection("notifications")
        .doc()
        .set({
          type: "collaborator_added",
          title: `${actorName} added you to ${eventName}`,
          body: trimmedMessage || `You were added as ${labelRole.toLowerCase()} on "${eventName}".`,
          actorName,
          actorUid: callerUid,
          read: false,
          createdAt: new Date().toISOString(),
          eventId,
          eventName,
          link: `/events/${eventId}`,
          metadata: { eventId, profileId, role: labelRole, eventRole: finalEventRole },
        });
    } catch (err) {
      logger.error("Failed to write collaborator-added notification", {
        err,
        recipientUid: found.uid,
        eventId,
      });
    }

    // Email — let the recipient know they were added (mirrors the in-app
    // notification but ensures they see it even if they don't log in). Skipped
    // for Copy-Link flows where the inviter shares the event URL themselves.
    if (sendEmail) {
      try {
        const tpl = eventCollaboratorInviteEmail({
          recipientName: displayName,
          senderName: actorName,
          eventName,
          venueName,
          eventDate,
          role: labelRole,
          message: trimmedMessage || undefined,
          eventLink: `${APP_BASE_URL.replace(/\/$/, "")}/events/${eventId}`,
        });
        await sendMail({ to: email, toName: displayName, subject: tpl.subject, html: tpl.html });
      } catch (err) {
        logger.error("Failed to send collaborator-added email", {
          err,
          email,
          eventId,
        });
      }
    }

    logger.info("Existing user added as collaborator", {
      eventId,
      userUid: found.uid,
      profileId,
      callerUid,
    });

    return { ok: true, collaboratorId, userUid: found.uid };
  },
);
