import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { HttpsError, onCall, onRequest } from "firebase-functions/v2/https";
// bcryptjs (pure JS) is used over native bcrypt to avoid build issues in the Cloud Functions runtime.
import * as bcrypt from "bcryptjs";
import { getMailTransport, FROM_ADDRESS } from "./mail";
import { passwordResetEmail } from "./emailTemplates";

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
export {
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
      participant_uids: admin.firestore.FieldValue.arrayUnion(uid),
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
  { region: "europe-west1" },
  async (request) => {
    const { email } = request.data;
    if (!email || typeof email !== "string") {
      throw new HttpsError("invalid-argument", "email is required.");
    }

    const trimmed = email.toLowerCase().trim();

    try {
      const link = await admin.auth().generatePasswordResetLink(trimmed, {
        url: "https://showme-production.web.app/login",
      });

      const { subject, html } = passwordResetEmail(link);
      const transport = getMailTransport();

      const info = await transport.sendMail({
        from: FROM_ADDRESS,
        to: trimmed,
        subject,
        html,
      });

      // jsonTransport returns the message as a string (when SMTP isn't configured)
      if (info.message) {
        logger.info("Password reset email (SMTP not configured, logged only)", {
          to: trimmed,
        });
      } else {
        logger.info("Password reset email sent", { to: trimmed });
      }
    } catch (err) {
      // Don't reveal whether the email exists — always return success
      logger.warn("Password reset error (suppressed for user)", { email: trimmed, error: String(err) });
    }

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
