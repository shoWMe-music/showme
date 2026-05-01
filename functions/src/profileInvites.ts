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
 * On a new profileInvites doc: send the email and — if the recipient already
 * has an account — also write an in-app notification so they can accept the
 * invite from Settings → Profile Access without logging in via the email link.
 *
 * The invite doc itself is left in place; the recipient explicitly accepts or
 * declines from the banner on the Profile Access tab.
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

    // Resolve the recipient first so we can skip the onboarding email when
    // they already have an account — sending the OTP / signup email to an
    // existing user creates a confusing dual onboarding flow and is the
    // password-overwrite vector this trigger should never enable.
    const recipientUid = await findUidByEmail(email);

    // Email — only for genuinely new users.
    if (!recipientUid) {
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
    }

    // In-app notification — only if the recipient already has an account
    if (!profileId) return;
    if (!recipientUid) return;

    try {
      await admin.firestore()
        .collection("users").doc(recipientUid)
        .collection("notifications").doc()
        .set({
          type: "profile_invite",
          title: `${senderName} invited you to ${profileName}`,
          body: `Accept the invite to become a${role === "admin" ? "n admin" : "n editor"} of ${profileName}.`,
          actorName: senderName,
          actorUid: invitedByUid,
          read: false,
          createdAt: new Date().toISOString(),
          link: "/settings#profile-access",
          metadata: { profileId, role },
        });
    } catch (err) {
      logger.error("Failed to write profile-invite notification", {
        err,
        recipientUid,
        profileId,
      });
    }
  },
);
