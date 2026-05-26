import * as admin from "firebase-admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onDocumentCreated, onDocumentUpdated } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";

import { sendMail, BREVO_API_KEY } from "./mail";
import { venueEventHandoffEmail } from "./emailTemplates";
import { APP_BASE_URL } from "./appBaseUrl";

const db = () => admin.firestore();

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Stale handoff drafts get archived after this many days. The performer is
 * warned 7 days before expiry. Picked to be generous — a venue may take
 * weeks to respond, especially during booking season.
 */
const HANDOFF_EXPIRY_DAYS = 90;
const HANDOFF_EXPIRY_WARNING_DAYS = 7;

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface EventLite {
  id: string;
  name?: string;
  date?: string;
  hostProfileId?: string;
  createdByProfileId?: string;
  pendingHostHandoff?: boolean;
  pendingHostHandoffInviteEmail?: string;
  archived?: boolean;
  createdAt?: Timestamp;
}

async function loadEvent(eventId: string): Promise<EventLite | null> {
  const snap = await db().collection("events").doc(eventId).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...(snap.data() as Record<string, unknown>) } as EventLite;
}

/**
 * Check whether the caller is allowed to manage the handoff invitation on
 * this event. The creating performer's owners/admins qualify (they own the
 * stub venue profile transiently); also any admin/owner of the
 * `createdByProfileId` performer profile so a band manager can intervene.
 */
async function assertCallerManagesHandoff(
  uid: string,
  event: EventLite,
): Promise<void> {
  if (!event.pendingHostHandoff) {
    throw new HttpsError(
      "failed-precondition",
      "This event isn't in a pending-handoff state.",
    );
  }
  const performerProfileId = event.createdByProfileId;
  if (!performerProfileId) {
    throw new HttpsError(
      "failed-precondition",
      "Event is missing its handoff-creator profile id.",
    );
  }
  const memberSnap = await db()
    .collection("profiles")
    .doc(performerProfileId)
    .collection("members")
    .doc(uid)
    .get();
  if (memberSnap.exists) {
    const role = String(memberSnap.data()?.role || "");
    if (role === "owner" || role === "admin") return;
  }
  // Owner fallback for legacy profiles missing a member doc.
  const profileSnap = await db().collection("profiles").doc(performerProfileId).get();
  if (profileSnap.exists && profileSnap.data()?.owner_uid === uid) return;

  throw new HttpsError(
    "permission-denied",
    "Only the performer that initiated this handoff can manage it.",
  );
}

interface ActiveCodeInfo {
  code: string;
  data: Record<string, unknown>;
}

/**
 * Find the active invitation code linked to this event with source
 * `venue_handoff`. Returns the most recent active code so re-issued codes
 * (after a redirect) take precedence over earlier ones.
 */
async function findActiveHandoffCode(eventId: string): Promise<ActiveCodeInfo | null> {
  const snap = await db()
    .collection("invitationCodes")
    .where("linkedEventId", "==", eventId)
    .where("source", "==", "venue_handoff")
    .where("status", "==", "active")
    .get();
  if (snap.empty) return null;
  // Pick the most-recent by createdAt.
  const sorted = snap.docs.sort((a, b) => {
    const at = (a.data().createdAt as Timestamp | undefined)?.toMillis() ?? 0;
    const bt = (b.data().createdAt as Timestamp | undefined)?.toMillis() ?? 0;
    return bt - at;
  });
  return { code: sorted[0].id, data: sorted[0].data() as Record<string, unknown> };
}

function inviteLinkFor(code: string): string {
  return `${APP_BASE_URL.replace(/\/$/, "")}/invite?code=${encodeURIComponent(code)}`;
}

async function performerNameFor(profileId: string | undefined): Promise<string> {
  if (!profileId) return "A performer";
  try {
    const snap = await db().collection("profiles").doc(profileId).get();
    if (!snap.exists) return "A performer";
    const data = snap.data() ?? {};
    return typeof data.name === "string" && data.name ? data.name : "A performer";
  } catch {
    return "A performer";
  }
}

async function notifyByEmail(
  uid: string,
  notification: {
    type: string;
    title: string;
    body: string;
    eventId?: string;
    eventName?: string;
    actorName?: string;
    actorUid?: string;
    link?: string;
    metadata?: Record<string, string>;
  },
): Promise<void> {
  try {
    await db()
      .collection("users")
      .doc(uid)
      .collection("notifications")
      .doc()
      .set({
        type: notification.type,
        title: notification.title,
        body: notification.body,
        actorName: notification.actorName ?? "shoWMe",
        actorUid: notification.actorUid ?? "",
        read: false,
        createdAt: new Date().toISOString(),
        ...(notification.eventId ? { eventId: notification.eventId } : {}),
        ...(notification.eventName ? { eventName: notification.eventName } : {}),
        ...(notification.link ? { link: notification.link } : {}),
        ...(notification.metadata ? { metadata: notification.metadata } : {}),
      });
  } catch (err) {
    logger.warn("notify write failed", { uid, type: notification.type, err: String(err) });
  }
}

async function sendHandoffEmail(opts: {
  code: string;
  recipientEmail: string;
  recipientName: string;
  performerName: string;
  eventDate?: string;
  message?: string;
}): Promise<void> {
  const tpl = venueEventHandoffEmail({
    recipientName: opts.recipientName,
    performerName: opts.performerName,
    eventDate: opts.eventDate,
    message: opts.message,
    inviteLink: inviteLinkFor(opts.code),
    invitationCode: opts.code,
  });
  await sendMail({
    to: opts.recipientEmail,
    toName: opts.recipientName,
    subject: tpl.subject,
    html: tpl.html,
  });
}

// ─── on-create notification + email ──────────────────────────────────────────
//
// Fires when a brand-new venue_handoff invitation code lands in Firestore.
// The original `createInvitationCode` callable writes the doc; this trigger
// hangs the venue notification + email off that write so the dialog code
// stays simple and the email path is idempotent (one notification per code).

export const onVenueHandoffInvitationCreated = onDocumentCreated(
  {
    document: "invitationCodes/{code}",
    region: "europe-west1",
    secrets: [BREVO_API_KEY],
  },
  async (event) => {
    const data = event.data?.data() as Record<string, unknown> | undefined;
    if (!data) return;
    if (data.source !== "venue_handoff") return;
    const code = event.params.code;
    const recipientEmail = String(data.recipientEmail || "").trim().toLowerCase();
    const recipientName = String(data.recipientName || "").trim() || "Venue";
    const linkedEventId = String(data.linkedEventId || "").trim();
    if (!recipientEmail || !linkedEventId) return;

    const ev = await loadEvent(linkedEventId);
    const performerName = await performerNameFor(ev?.createdByProfileId);
    const eventDate = ev?.date;

    // Email.
    try {
      await sendHandoffEmail({
        code,
        recipientEmail,
        recipientName,
        performerName,
        eventDate,
      });
    } catch (err) {
      logger.error("venue handoff email failed", { code, err: String(err) });
    }

    // In-app notification — only if the venue already has a shoWMe account.
    try {
      const u = await admin.auth().getUserByEmail(recipientEmail);
      if (u?.uid) {
        await notifyByEmail(u.uid, {
          type: "venue_handoff_pending",
          title: `${performerName} wants to play at ${recipientName}`,
          body: `Accept to take over management of this event${eventDate ? ` on ${eventDate}` : ""}.`,
          eventId: linkedEventId,
          eventName: ev?.name,
          actorName: performerName,
          link: `/invite?code=${encodeURIComponent(code)}`,
        });
      }
    } catch {
      // No account — email is the only channel. That's expected for new venues.
    }
  },
);

// ─── On-accept notification ──────────────────────────────────────────────────
//
// Fires when the event's pendingHostHandoff flips from true → false (i.e. the
// venue claimed the code via `claimInvitationCode`). Notifies the originating
// performer that the handoff completed.

export const onVenueHandoffAccepted = onDocumentUpdated(
  {
    document: "events/{eventId}",
    region: "europe-west1",
  },
  async (event) => {
    const before = event.data?.before?.data() as Record<string, unknown> | undefined;
    const after = event.data?.after?.data() as Record<string, unknown> | undefined;
    if (!before || !after) return;

    const wasPending = before.pendingHostHandoff === true;
    const stillPending = after.pendingHostHandoff === true;
    if (!wasPending || stillPending) return;

    const eventId = event.params.eventId;
    const performerProfileId =
      typeof before.createdByProfileId === "string" ? before.createdByProfileId : "";
    if (!performerProfileId) return;

    // Notify every member of the originating performer profile.
    const membersSnap = await db()
      .collection("profiles")
      .doc(performerProfileId)
      .collection("members")
      .get();

    const eventName = typeof after.name === "string" ? after.name : "your event";
    const venueName =
      typeof after.venue === "string" && after.venue
        ? after.venue
        : "the venue";

    await Promise.all(
      membersSnap.docs.map(async (m) => {
        const uid =
          typeof (m.data() as Record<string, unknown>).user_uid === "string"
            ? ((m.data() as Record<string, unknown>).user_uid as string)
            : m.id;
        if (!uid) return;
        await notifyByEmail(uid, {
          type: "venue_handoff_accepted",
          title: `${venueName} accepted management of ${eventName}`,
          body: "You remain on the event as a collaborator. The venue can now confirm the date.",
          eventId,
          eventName,
          actorName: venueName,
          link: `/events/${eventId}`,
        });
      }),
    );
  },
);

// ─── cancelVenueHandoff callable ─────────────────────────────────────────────
//
// Cleans up the draft event, the stub venue profile, and the invitation code
// in one shot. The performer can use this when the venue declines verbally,
// or when they want to back out before the venue responds.

interface CancelVenueHandoffData {
  eventId: string;
  reason?: string;
}

export const cancelVenueHandoff = onCall<CancelVenueHandoffData, Promise<{ ok: true }>>(
  { region: "europe-west1" },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Sign in.");

    const { eventId, reason } = request.data ?? ({} as CancelVenueHandoffData);
    if (!eventId || typeof eventId !== "string") {
      throw new HttpsError("invalid-argument", "eventId is required.");
    }

    const event = await loadEvent(eventId);
    if (!event) throw new HttpsError("not-found", "Event not found.");
    await assertCallerManagesHandoff(uid, event);

    const stubProfileId = event.hostProfileId;
    const activeCode = await findActiveHandoffCode(eventId);

    // Revoke the invitation code first so a race with the venue clicking the
    // link can't slip through.
    if (activeCode) {
      try {
        await db().collection("invitationCodes").doc(activeCode.code).update({
          status: "revoked",
          revokedAt: FieldValue.serverTimestamp(),
          revokedReason: reason ? `cancelled_by_performer:${reason.slice(0, 200)}` : "cancelled_by_performer",
        });
      } catch (err) {
        logger.warn("cancelVenueHandoff: code revoke failed", {
          eventId,
          code: activeCode.code,
          err: String(err),
        });
      }
    }

    // Delete event (host-admin via stub profile ownership lets this through).
    try {
      await db().collection("events").doc(eventId).delete();
    } catch (err) {
      logger.error("cancelVenueHandoff: event delete failed", { eventId, err: String(err) });
      throw new HttpsError("internal", "Could not delete the draft event.");
    }

    // Delete stub venue profile (only if still unclaimed).
    if (stubProfileId) {
      try {
        const stubRef = db().collection("profiles").doc(stubProfileId);
        const stubSnap = await stubRef.get();
        if (stubSnap.exists && stubSnap.data()?.unclaimed === true) {
          const membersSnap = await stubRef.collection("members").listDocuments();
          const batch = db().batch();
          for (const m of membersSnap) batch.delete(m);
          batch.delete(stubRef);
          await batch.commit();
        }
      } catch (err) {
        logger.warn("cancelVenueHandoff: stub profile cleanup failed", {
          stubProfileId,
          err: String(err),
        });
      }
    }

    // Notify the venue if they have an account.
    if (event.pendingHostHandoffInviteEmail) {
      try {
        const u = await admin.auth().getUserByEmail(event.pendingHostHandoffInviteEmail);
        if (u?.uid) {
          const performerName = await performerNameFor(event.createdByProfileId);
          await notifyByEmail(u.uid, {
            type: "venue_handoff_cancelled",
            title: `${performerName} cancelled their event invitation`,
            body: "The draft event they sent you has been removed. No action needed.",
            actorName: performerName,
          });
        }
      } catch {
        // No account — nothing to notify in-app.
      }
    }

    logger.info("cancelVenueHandoff: completed", { uid, eventId });
    return { ok: true };
  },
);

// ─── resendVenueHandoffInvitation callable ───────────────────────────────────

interface ResendVenueHandoffData {
  eventId: string;
}

export const resendVenueHandoffInvitation = onCall<
  ResendVenueHandoffData,
  Promise<{ ok: true; code: string }>
>(
  { region: "europe-west1", secrets: [BREVO_API_KEY] },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Sign in.");

    const { eventId } = request.data ?? ({} as ResendVenueHandoffData);
    if (!eventId || typeof eventId !== "string") {
      throw new HttpsError("invalid-argument", "eventId is required.");
    }

    const event = await loadEvent(eventId);
    if (!event) throw new HttpsError("not-found", "Event not found.");
    await assertCallerManagesHandoff(uid, event);

    const active = await findActiveHandoffCode(eventId);
    if (!active) {
      throw new HttpsError(
        "failed-precondition",
        "No active invitation found for this event.",
      );
    }

    const recipientEmail = String(active.data.recipientEmail || "").trim().toLowerCase();
    const recipientName = String(active.data.recipientName || "").trim() || "Venue";
    if (!recipientEmail) {
      throw new HttpsError("failed-precondition", "Invitation has no recipient email.");
    }

    const performerName = await performerNameFor(event.createdByProfileId);
    try {
      await sendHandoffEmail({
        code: active.code,
        recipientEmail,
        recipientName,
        performerName,
        eventDate: event.date,
      });
    } catch (err) {
      logger.error("resendVenueHandoffInvitation: email failed", {
        eventId,
        code: active.code,
        err: String(err),
      });
      throw new HttpsError("internal", "Could not resend the invitation email.");
    }

    logger.info("resendVenueHandoffInvitation: sent", { uid, eventId, code: active.code });
    return { ok: true, code: active.code };
  },
);

// ─── redirectVenueHandoff callable ───────────────────────────────────────────
//
// Updates the recipient email/name on the pending invitation and re-sends.
// Use case: the performer typed the wrong email, or the venue forwarded the
// invitation to a colleague who needs a fresh delivery.

interface RedirectVenueHandoffData {
  eventId: string;
  newEmail: string;
  newName?: string;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const redirectVenueHandoff = onCall<
  RedirectVenueHandoffData,
  Promise<{ ok: true; code: string }>
>(
  { region: "europe-west1", secrets: [BREVO_API_KEY] },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Sign in.");

    const { eventId, newEmail, newName } = request.data ?? ({} as RedirectVenueHandoffData);
    if (!eventId || typeof eventId !== "string") {
      throw new HttpsError("invalid-argument", "eventId is required.");
    }
    const normalizedEmail = String(newEmail || "").trim().toLowerCase();
    if (!normalizedEmail || !EMAIL_REGEX.test(normalizedEmail)) {
      throw new HttpsError("invalid-argument", "A valid newEmail is required.");
    }

    const event = await loadEvent(eventId);
    if (!event) throw new HttpsError("not-found", "Event not found.");
    await assertCallerManagesHandoff(uid, event);

    const active = await findActiveHandoffCode(eventId);
    if (!active) {
      throw new HttpsError("failed-precondition", "No active invitation found.");
    }

    const recipientName = String(newName || active.data.recipientName || "").trim() || "Venue";

    // Update the code + event in one batch.
    const batch = db().batch();
    batch.update(db().collection("invitationCodes").doc(active.code), {
      recipientEmail: normalizedEmail,
      recipientName,
    });
    batch.update(db().collection("events").doc(eventId), {
      pendingHostHandoffInviteEmail: normalizedEmail,
      updatedAt: FieldValue.serverTimestamp(),
    });
    await batch.commit();

    const performerName = await performerNameFor(event.createdByProfileId);
    try {
      await sendHandoffEmail({
        code: active.code,
        recipientEmail: normalizedEmail,
        recipientName,
        performerName,
        eventDate: event.date,
      });
    } catch (err) {
      logger.error("redirectVenueHandoff: email failed", {
        eventId,
        code: active.code,
        err: String(err),
      });
      // Don't undo — the redirect succeeded data-wise. Caller can resend.
    }

    logger.info("redirectVenueHandoff: completed", {
      uid,
      eventId,
      code: active.code,
      to: normalizedEmail,
    });
    return { ok: true, code: active.code };
  },
);

// ─── Scheduled reaper: archive stale handoffs ───────────────────────────────
//
// Runs daily. Finds events with `pendingHostHandoff: true` whose `createdAt`
// is older than `HANDOFF_EXPIRY_DAYS`. Cancels them (same flow as the
// performer-initiated cancel, minus the auth check).
//
// Also warns the performer 7 days before expiry so they get a chance to
// resend before it lapses.

export const cleanupStaleVenueHandoffs = onSchedule(
  {
    schedule: "every 24 hours",
    region: "europe-west1",
    timeZone: "UTC",
  },
  async () => {
    const now = Date.now();
    const expiryThresholdMs = now - HANDOFF_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
    const warnThresholdMs = now - (HANDOFF_EXPIRY_DAYS - HANDOFF_EXPIRY_WARNING_DAYS) * 24 * 60 * 60 * 1000;

    const snap = await db()
      .collection("events")
      .where("pendingHostHandoff", "==", true)
      .get();

    let expired = 0;
    let warned = 0;
    let skipped = 0;

    for (const doc of snap.docs) {
      const data = doc.data() as Record<string, unknown>;
      const createdAt = data.createdAt as Timestamp | undefined;
      if (!createdAt) {
        skipped += 1;
        continue;
      }
      const createdMs = createdAt.toMillis();
      const isExpired = createdMs <= expiryThresholdMs;
      const needsWarning =
        !isExpired &&
        createdMs <= warnThresholdMs &&
        data.expiryWarningSentAt == null;

      const eventId = doc.id;
      const performerProfileId =
        typeof data.createdByProfileId === "string" ? data.createdByProfileId : "";

      if (isExpired) {
        // Expire: revoke any active code, delete event + stub. Mirrors
        // cancelVenueHandoff but without the caller-uid check.
        try {
          const active = await findActiveHandoffCode(eventId);
          if (active) {
            await db().collection("invitationCodes").doc(active.code).update({
              status: "revoked",
              revokedAt: FieldValue.serverTimestamp(),
              revokedReason: "expired_unaccepted",
            });
          }

          const stubProfileId = typeof data.hostProfileId === "string" ? data.hostProfileId : "";
          await db().collection("events").doc(eventId).delete();

          if (stubProfileId) {
            const stubRef = db().collection("profiles").doc(stubProfileId);
            const stubSnap = await stubRef.get();
            if (stubSnap.exists && stubSnap.data()?.unclaimed === true) {
              const members = await stubRef.collection("members").listDocuments();
              const batch = db().batch();
              for (const m of members) batch.delete(m);
              batch.delete(stubRef);
              await batch.commit();
            }
          }

          // Notify performer members.
          if (performerProfileId) {
            const eventName = typeof data.name === "string" ? data.name : "your draft event";
            const members = await db()
              .collection("profiles")
              .doc(performerProfileId)
              .collection("members")
              .get();
            await Promise.all(
              members.docs.map((m) => {
                const uid =
                  typeof (m.data() as Record<string, unknown>).user_uid === "string"
                    ? ((m.data() as Record<string, unknown>).user_uid as string)
                    : m.id;
                if (!uid) return Promise.resolve();
                return notifyByEmail(uid, {
                  type: "venue_handoff_cancelled",
                  title: `${eventName} expired`,
                  body: "The venue didn't respond within 90 days. The draft has been removed; you can create a new one if you'd like.",
                  actorName: "shoWMe",
                });
              }),
            );
          }

          expired += 1;
        } catch (err) {
          logger.error("cleanupStaleVenueHandoffs: expire failed", {
            eventId,
            err: String(err),
          });
        }
      } else if (needsWarning) {
        try {
          // Mark warning sent first so a partial failure doesn't re-spam.
          await db().collection("events").doc(eventId).update({
            expiryWarningSentAt: FieldValue.serverTimestamp(),
          });

          if (performerProfileId) {
            const eventName = typeof data.name === "string" ? data.name : "your draft event";
            const members = await db()
              .collection("profiles")
              .doc(performerProfileId)
              .collection("members")
              .get();
            await Promise.all(
              members.docs.map((m) => {
                const uid =
                  typeof (m.data() as Record<string, unknown>).user_uid === "string"
                    ? ((m.data() as Record<string, unknown>).user_uid as string)
                    : m.id;
                if (!uid) return Promise.resolve();
                return notifyByEmail(uid, {
                  type: "venue_handoff_expiring",
                  title: `${eventName} invitation expires in 7 days`,
                  body: "Resend the invitation or cancel the draft if it's no longer needed.",
                  eventId,
                  eventName,
                  link: `/events/${eventId}`,
                });
              }),
            );
          }
          warned += 1;
        } catch (err) {
          logger.error("cleanupStaleVenueHandoffs: warn failed", {
            eventId,
            err: String(err),
          });
        }
      }
    }

    logger.info("cleanupStaleVenueHandoffs: summary", {
      scanned: snap.size,
      expired,
      warned,
      skipped,
    });
  },
);
