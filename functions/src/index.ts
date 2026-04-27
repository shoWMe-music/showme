import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { HttpsError, onCall, onRequest } from "firebase-functions/v2/https";

export { exchangeRate, supportedCurrencies } from "./currencyHttp";
export { ssrRender } from "./ssr";
export {
  createInvitationCode,
  claimInvitationCode,
  sendOtpEmail,
  verifyOtp,
  sendInvitationEmail,
} from "./invitations";
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

export const joinEventAsCollaborator = onCall<{ token: string }, Promise<{ ok: true; eventId: string }>>(
  { region: "europe-west1" },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Sign in first (anonymous is fine).");
    }
    const token = request.data?.token;
    if (typeof token !== "string" || token.length < 8) {
      throw new HttpsError("invalid-argument", "Invalid invite token.");
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

export const ping = onRequest(
  { region: "europe-west1", cors: true },
  (req, res) => {
    logger.info("ping", { query: req.query });
    res.status(200).json({ ok: true, service: "showme-settle-fast-functions" });
  },
);
