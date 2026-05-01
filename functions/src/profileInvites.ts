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

/**
 * Send the profile-admin invite email when a new doc lands in profileInvites.
 * The client just writes the invite record; this trigger handles delivery so
 * the recipient knows to sign in. The invite is auto-claimed on next login —
 * no code or signup link is needed in the email body.
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

    const email = (data.email as string | undefined)?.trim();
    const profileName = (data.profileName as string | undefined) || "a profile";
    const role = (data.role as "admin" | "editor" | undefined) || "admin";
    const invitedByUid = (data.invitedByUid as string | undefined) || "";

    if (!email) {
      logger.warn("profileInvites doc missing email — skipping email send", {
        inviteId: event.params.inviteId,
      });
      return;
    }

    const senderName = await resolveActorName(invitedByUid);
    const tpl = profileAdminInviteEmail({
      recipientEmail: email,
      profileName,
      senderName,
      role,
      appBaseUrl: APP_BASE_URL,
    });

    try {
      await sendMail({
        to: email,
        subject: tpl.subject,
        html: tpl.html,
      });
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
  },
);
