import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { onDocumentCreated } from "firebase-functions/v2/firestore";

import { sendMail, BREVO_API_KEY } from "./mail";
import { profileAdminInviteEmail } from "./emailTemplates";

const APP_BASE_URL = process.env.APP_BASE_URL || "https://showme-production.web.app";

async function resolveActorName(uid: string): Promise<string> {
  if (!uid) return "Someone";
  try {
    const u = await admin.auth().getUser(uid);
    return u.displayName || u.email || "Someone";
  } catch {
    return "Someone";
  }
}

async function findUidByEmail(email: string): Promise<string | null> {
  try {
    const u = await admin.auth().getUserByEmail(email);
    return u.uid;
  } catch {
    return null;
  }
}

/**
 * Send the profile-admin invite email when a new doc lands in profileInvites,
 * and — if the invitee already has an account — auto-claim membership and
 * notify them so the new profile appears in their app immediately.
 *
 * For invitees without an account, we leave the invite doc in place; the
 * client claims it after sign-up via `claimProfileInvites`.
 */
export const onProfileInviteCreated = onDocumentCreated(
  {
    document: "profileInvites/{inviteId}",
    region: "europe-west1",
    secrets: [BREVO_API_KEY],
  },
  async (event) => {
    const data = event.data?.data();
    if (!data) return;

    const email = (data.email as string | undefined)?.trim().toLowerCase();
    const profileId = (data.profileId as string | undefined) || "";
    const profileName = (data.profileName as string | undefined) || "a profile";
    const role = (data.role as "admin" | "editor" | undefined) || "admin";
    const invitedByUid = (data.invitedByUid as string | undefined) || "";

    if (!email) {
      logger.warn("profileInvites doc missing email — skipping", {
        inviteId: event.params.inviteId,
      });
      return;
    }

    const senderName = await resolveActorName(invitedByUid);

    // 1. Email — always send so the recipient gets a heads-up
    const tpl = profileAdminInviteEmail({
      recipientEmail: email,
      profileName,
      senderName,
      role,
      appBaseUrl: APP_BASE_URL,
    });
    try {
      await sendMail({ to: email, subject: tpl.subject, html: tpl.html });
      logger.info("Profile-admin invite email sent", {
        inviteId: event.params.inviteId,
        email,
        profileName,
      });
    } catch (err) {
      logger.error("Failed to send profile-admin invite email", {
        err,
        inviteId: event.params.inviteId,
        email,
      });
    }

    // 2. Auto-claim if the recipient already has an account
    if (!profileId) return;
    const recipientUid = await findUidByEmail(email);
    if (!recipientUid) return; // new user — client claims after sign-up

    const db = admin.firestore();
    try {
      await db
        .collection("profiles").doc(profileId)
        .collection("members").doc(recipientUid)
        .set({
          user_uid: recipientUid,
          role,
          email,
          displayName: (await admin.auth().getUser(recipientUid)).displayName || email,
          schemaVersion: 1,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

      // Delete the now-claimed invite so it stops appearing in pending lists
      await event.data?.ref.delete();

      // Notification — drives the client to refresh profiles & shows in the bell
      await db
        .collection("users").doc(recipientUid)
        .collection("notifications").doc()
        .set({
          type: "profile_invite",
          title: `${senderName} added you to ${profileName}`,
          body: `You're now a${role === "admin" ? "n admin" : "n editor"} of ${profileName}.`,
          actorName: senderName,
          actorUid: invitedByUid,
          read: false,
          createdAt: new Date().toISOString(),
          link: "/settings#profile-access",
          metadata: { profileId, role },
        });

      logger.info("Auto-claimed profile invite for existing user", {
        inviteId: event.params.inviteId,
        recipientUid,
        profileId,
      });
    } catch (err) {
      logger.error("Failed to auto-claim profile invite", {
        err,
        inviteId: event.params.inviteId,
        recipientUid,
        profileId,
      });
    }
  },
);
