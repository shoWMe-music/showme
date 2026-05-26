import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { HttpsError, onCall } from "firebase-functions/v2/https";

import { sendMail, BREVO_API_KEY } from "./mail";
import type { PlanType } from "./plans";

const db = () => admin.firestore();

/**
 * Email destination for plan-change requests. The Brevo sender is fixed to
 * `no-reply@showme-google.se` (see mail.ts), so this is the actual recipient
 * sales should monitor. Override via env if we ever move to a dedicated
 * inbox — `PLAN_REQUEST_INBOX`.
 */
const PLAN_REQUEST_INBOX = process.env.PLAN_REQUEST_INBOX || "booking.showme@gmail.com";

const VALID_PLAN_TYPES: ReadonlySet<PlanType> = new Set([
  "free_operator",
  "operator_pro",
  "free_artist",
  "artist_pro",
]);

const VALID_ACTIONS: ReadonlySet<string> = new Set([
  "upgrade",
  "downgrade",
  "seats",
  "cancel",
]);

interface RequestPlanChangeData {
  profileId: string;
  profileName: string;
  action: "upgrade" | "downgrade" | "seats" | "cancel";
  currentPlan: PlanType;
  requestedPlan: PlanType | null;
  seats?: number;
  message?: string;
}

interface RequestPlanChangeResult {
  ok: true;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Authenticated callable that fires a plan-change request email to the
 * shoWMe sales inbox. This is the manual-tier replacement for Mollie
 * self-serve — sales replies, takes payment out-of-band, then runs the
 * admin `setPlan` callable to flip the plan doc.
 *
 * Permission gate: the caller must be the OWNER of the named profile.
 * Admins of the profile cannot mutate billing per the design decision.
 */
export const requestPlanChange = onCall<
  RequestPlanChangeData,
  Promise<RequestPlanChangeResult>
>(
  { region: "europe-west1", secrets: [BREVO_API_KEY] },
  async (request) => {
    const uid = request.auth?.uid;
    const senderEmail = request.auth?.token?.email;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Sign in to request a plan change.");
    }

    const input = request.data ?? ({} as RequestPlanChangeData);
    if (!input.profileId || typeof input.profileId !== "string") {
      throw new HttpsError("invalid-argument", "profileId is required.");
    }
    if (!input.action || !VALID_ACTIONS.has(input.action)) {
      throw new HttpsError("invalid-argument", "action must be upgrade/downgrade/seats/cancel.");
    }
    if (!input.currentPlan || !VALID_PLAN_TYPES.has(input.currentPlan)) {
      throw new HttpsError("invalid-argument", "currentPlan must be a valid PlanType.");
    }
    if (input.requestedPlan !== null && input.requestedPlan !== undefined && !VALID_PLAN_TYPES.has(input.requestedPlan)) {
      throw new HttpsError("invalid-argument", "requestedPlan must be a valid PlanType or null.");
    }

    // Owner gate — must own the profile.
    const profileSnap = await db().collection("profiles").doc(input.profileId).get();
    if (!profileSnap.exists) {
      throw new HttpsError("not-found", "Profile not found.");
    }
    const profileData = profileSnap.data() ?? {};
    if (profileData.owner_uid !== uid) {
      throw new HttpsError(
        "permission-denied",
        "Only the profile owner can request billing changes.",
      );
    }

    const senderName =
      (typeof request.auth?.token?.name === "string" && request.auth.token.name) ||
      senderEmail ||
      "shoWMe user";

    const subject = `[Plan ${input.action}] ${input.profileName || input.profileId}`;

    const html = `
      <p>A profile owner just requested a plan change.</p>
      <table style="border-collapse:collapse;">
        <tr><td><strong>Profile</strong></td><td>${escapeHtml(input.profileName || "(unnamed)")}<br/><code>${escapeHtml(input.profileId)}</code></td></tr>
        <tr><td><strong>Action</strong></td><td>${escapeHtml(input.action)}</td></tr>
        <tr><td><strong>Current plan</strong></td><td>${escapeHtml(input.currentPlan)}</td></tr>
        <tr><td><strong>Requested plan</strong></td><td>${escapeHtml(input.requestedPlan ?? "(none)")}</td></tr>
        ${input.seats ? `<tr><td><strong>Seats</strong></td><td>${input.seats}</td></tr>` : ""}
        <tr><td><strong>Owner</strong></td><td>${escapeHtml(senderName)} &lt;${escapeHtml(senderEmail ?? "")}&gt;<br/><code>${escapeHtml(uid)}</code></td></tr>
      </table>
      ${input.message?.trim()
        ? `<h3 style="margin-top:1.25em;">Notes</h3><p style="white-space:pre-wrap;">${escapeHtml(input.message.trim())}</p>`
        : ""}
      <hr/>
      <p style="color:#777;font-size:12px;">Reply to this email to reach the owner directly.</p>
    `;

    try {
      await sendMail({
        to: PLAN_REQUEST_INBOX,
        subject,
        html,
        ...(senderEmail
          ? { replyTo: { email: senderEmail, name: senderName } }
          : {}),
      });
    } catch (err) {
      logger.error("requestPlanChange: send failed", {
        err: String(err),
        profileId: input.profileId,
      });
      throw new HttpsError(
        "internal",
        "Could not send the request. Please email us directly.",
      );
    }

    logger.info("requestPlanChange: sent", {
      uid,
      profileId: input.profileId,
      action: input.action,
      currentPlan: input.currentPlan,
      requestedPlan: input.requestedPlan ?? null,
    });

    return { ok: true };
  },
);
