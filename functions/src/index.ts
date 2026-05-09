import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { HttpsError, onCall, onRequest } from "firebase-functions/v2/https";
// bcryptjs (pure JS) is used over native bcrypt to avoid build issues in the Cloud Functions runtime.
import * as bcrypt from "bcryptjs";
import { sendMail, BREVO_API_KEY } from "./mail";
import {
  passwordResetEmail,
  teamMemberMessageEmail,
  verifyAndChangeEmailTemplate,
} from "./emailTemplates";
import { APP_BASE_URL } from "./appBaseUrl";

export { exchangeRate, supportedCurrencies } from "./currencyHttp";
export { ssrRender } from "./ssr";
export {
  createInvitationCode,
  claimInvitationCode,
  sendOtpEmail,
  verifyOtp,
  sendInvitationEmail,
} from "./invitations";
export { setCollaboratorInvitePassword } from "./collaboratorInvitePassword";
export { onProfileInviteCreated } from "./profileInvites";
export { onProfileMemberWritten } from "./profileMembers";
export { onProfileMemberClaimsSync } from "./profileClaims";
export {
  acceptProfileInvite,
  declineProfileInvite,
  removeProfileMember,
  setProfileMemberRole,
} from "./profileMembership";
export { lookupUserForInvite, addExistingUserAsCollaborator } from "./userLookup";
export { getPublicShare } from "./publicShareApi";
export { requestShareOtp, verifyShareOtp } from "./shareOtpApi";
export { confirmShareParty } from "./confirmShareApi";
export { submitPublicShareComment } from "./publicShares";
export {
  onEventCreated,
  onEventUpdated,
  onDealUpdated,
  onRevenueUpdated,
  onSettlementUpdated,
  onSettlementActivity,
  onEventActivity,
  onMessageSent,
  onCollaboratorAdded,
  onCollaboratorUpdated,
  onBookingRequestCreated,
  onBookingRequestUpdated,
  onEventMetaUpdated,
} from "./notifications";

if (!admin.apps.length) {
  admin.initializeApp();
}

export const joinEventAsCollaborator = onCall<
  { token: string; password: string },
  Promise<{ ok: true; eventId: string }>
>(
  { region: "europe-west1" },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Sign in first (anonymous is fine).");
    }
    const token = request.data?.token;
    const password = request.data?.password;
    if (typeof token !== "string" || token.length < 8) {
      throw new HttpsError("invalid-argument", "Invalid invite token.");
    }
    if (typeof password !== "string" || password.length === 0) {
      throw new HttpsError("invalid-argument", "Password is required.");
    }
    const db = admin.firestore();
    const invSnap = await db.collection("collaboratorInvites").doc(token).get();
    if (!invSnap.exists) {
      throw new HttpsError("not-found", "Invite not found.");
    }
    const inv = invSnap.data() as Record<string, unknown>;
    if (String(inv.status || "") !== "accepted") {
      throw new HttpsError("failed-precondition", "Invite must be accepted before joining the event.");
    }
    const passwordHash = inv.passwordHash;
    if (typeof passwordHash !== "string" || passwordHash.length === 0) {
      throw new HttpsError("failed-precondition", "Invite has no password set.");
    }
    if (!bcrypt.compareSync(password, passwordHash)) {
      throw new HttpsError("permission-denied", "Incorrect password.");
    }
    const eventId = String(inv.event_id || "");
    if (!eventId) {
      throw new HttpsError("failed-precondition", "Invite is missing event_id.");
    }
    const evSnap = await db.collection("events").doc(eventId).get();
    if (!evSnap.exists) {
      throw new HttpsError("not-found", "Event not found.");
    }
    const eventRole = (typeof inv.eventRole === "string" && inv.eventRole) || "staff";
    await db.collection("events").doc(eventId).update({
      participant_uids: FieldValue.arrayUnion(uid),
      [`participant_roles.${uid}`]: eventRole,
    });
    return { ok: true, eventId };
  },
);

// ---------------------------------------------------------------------------
// sendPasswordReset — branded password-reset email
// ---------------------------------------------------------------------------

interface SendPasswordResetData {
  email: string;
}

export const sendPasswordReset = onCall<SendPasswordResetData, Promise<{ ok: true }>>(
  { region: "europe-west1", secrets: [BREVO_API_KEY] },
  async (request) => {
    const { email } = request.data;
    if (!email || typeof email !== "string") {
      throw new HttpsError("invalid-argument", "email is required.");
    }

    const trimmed = email.toLowerCase().trim();

    try {
      const link = await admin.auth().generatePasswordResetLink(trimmed, {
        url: `${APP_BASE_URL}/login`,
      });

      const { subject, html } = passwordResetEmail(link);
      await sendMail({ to: trimmed, subject, html });
    } catch (err) {
      // Don't reveal whether the email exists — always return success
      logger.warn("Password reset error (suppressed for user)", { email: trimmed, error: String(err) });
    }

    return { ok: true };
  },
);

// ---------------------------------------------------------------------------
// sendVerifyAndChangeEmail — branded email-change confirmation
//
// Generates a Firebase verify-and-change-email action link via Admin SDK, then
// delivers it via Brevo with our own template. Auth's email credential only
// changes after the recipient clicks the link in the new inbox — proving
// ownership of the new address.
// ---------------------------------------------------------------------------

interface SendVerifyAndChangeEmailData {
  newEmail: string;
}

export const sendVerifyAndChangeEmail = onCall<
  SendVerifyAndChangeEmailData,
  Promise<{ ok: true }>
>(
  { region: "europe-west1", secrets: [BREVO_API_KEY] },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Sign in to change your email.");
    }

    const newEmail = request.data?.newEmail?.toLowerCase().trim();
    if (!newEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
      throw new HttpsError("invalid-argument", "A valid newEmail is required.");
    }

    const userRecord = await admin.auth().getUser(uid);
    const currentEmail = userRecord.email;
    if (!currentEmail) {
      throw new HttpsError(
        "failed-precondition",
        "Your account has no email on file. Contact support.",
      );
    }
    if (currentEmail.toLowerCase() === newEmail) {
      throw new HttpsError(
        "invalid-argument",
        "That's already your email address.",
      );
    }

    // Reject if the new email is already used by another auth account so we
    // don't surface a confusing "link clicked but nothing happened" later.
    try {
      const existing = await admin.auth().getUserByEmail(newEmail);
      if (existing && existing.uid !== uid) {
        throw new HttpsError(
          "already-exists",
          "That email is already in use by another account.",
        );
      }
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code !== "auth/user-not-found") {
        // Re-throw HttpsError, swallow other lookup errors silently
        if (err instanceof HttpsError) throw err;
      }
    }

    let link: string;
    try {
      link = await admin.auth().generateVerifyAndChangeEmailLink(
        currentEmail,
        newEmail,
        { url: `${APP_BASE_URL}/login` },
      );
    } catch (err) {
      logger.error("generateVerifyAndChangeEmailLink failed", {
        uid,
        currentEmail,
        newEmail,
        error: String(err),
      });
      throw new HttpsError(
        "internal",
        "Could not generate verification link. Try again.",
      );
    }

    const recipientName =
      (userRecord.displayName as string | undefined) || undefined;
    const { subject, html } = verifyAndChangeEmailTemplate({
      verifyLink: link,
      newEmail,
      recipientName,
    });
    await sendMail({ to: newEmail, toName: recipientName, subject, html });

    return { ok: true };
  },
);

// ---------------------------------------------------------------------------
// sendTeamMemberEmail — send an arbitrary message from a signed-in user to a
// team member. Reply-To is set to the sender's auth email.
// ---------------------------------------------------------------------------

interface SendTeamMemberEmailData {
  recipientEmail: string;
  recipientName: string;
  subject: string;
  body: string;
}

export const sendTeamMemberEmail = onCall<SendTeamMemberEmailData, Promise<{ ok: true }>>(
  { region: "europe-west1", secrets: [BREVO_API_KEY] },
  async (request) => {
    const uid = request.auth?.uid;
    const senderEmail = request.auth?.token?.email;
    const senderName =
      (request.auth?.token?.name as string | undefined) ||
      senderEmail ||
      "A shoWMe user";
    if (!uid || !senderEmail) {
      throw new HttpsError("unauthenticated", "Sign in to send emails.");
    }

    const { recipientEmail, recipientName, subject, body } = request.data;
    if (!recipientEmail || !recipientName || !subject?.trim() || !body?.trim()) {
      throw new HttpsError(
        "invalid-argument",
        "recipientEmail, recipientName, subject, and body are required.",
      );
    }

    const tpl = teamMemberMessageEmail({
      recipientName,
      senderName,
      senderEmail,
      subject: subject.trim(),
      body: body.trim(),
    });

    await sendMail({
      to: recipientEmail,
      toName: recipientName,
      subject: tpl.subject,
      html: tpl.html,
      replyTo: { email: senderEmail, name: senderName },
    });

    return { ok: true };
  },
);

export const ping = onRequest(
  { region: "europe-west1", cors: true },
  (req, res) => {
    logger.info("ping", { query: req.query });
    res.status(200).json({ ok: true, service: "showme-settle-fast-functions" });
  },
);
