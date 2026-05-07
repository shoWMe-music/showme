import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { randomUUID } from "node:crypto";

if (!admin.apps.length) {
  admin.initializeApp();
}

interface SubmitCommentAttachment {
  name: string;
  size: number;
  type: string;
  data: string; // base64-encoded file body
}

interface SubmitCommentData {
  token: string;
  message: string;
  reviewerName: string;
  date: string;
  attachments?: SubmitCommentAttachment[];
}

interface StoredAttachment {
  name: string;
  size: number;
  type: string;
  fileUrl: string;
}

const MAX_ATTACHMENTS = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

function sanitizeName(name: string): string {
  return name.replace(/[^\w.\-]+/g, "_").slice(0, 120) || "file";
}

export const submitPublicShareComment = onCall<
  SubmitCommentData,
  Promise<{ ok: true }>
>(
  { region: "europe-west1", memory: "512MiB" },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Sign in to submit a comment.");
    }

    const { token, message, reviewerName, date, attachments = [] } = request.data ?? {};

    if (typeof token !== "string" || token.length < 4) {
      throw new HttpsError("invalid-argument", "Invalid share token.");
    }
    if (typeof message !== "string" || !message.trim()) {
      throw new HttpsError("invalid-argument", "Comment message is required.");
    }
    if (typeof reviewerName !== "string" || !reviewerName.trim()) {
      throw new HttpsError("invalid-argument", "Reviewer name is required.");
    }
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new HttpsError("invalid-argument", "date must be YYYY-MM-DD.");
    }
    if (!Array.isArray(attachments) || attachments.length > MAX_ATTACHMENTS) {
      throw new HttpsError("invalid-argument", `At most ${MAX_ATTACHMENTS} attachments allowed.`);
    }

    const db = admin.firestore();
    const shareSnap = await db.collection("publicShares").doc(token).get();
    if (!shareSnap.exists) {
      throw new HttpsError("not-found", "Share link not found.");
    }
    const share = shareSnap.data() as Record<string, unknown>;
    const eventId = typeof share.eventId === "string" ? share.eventId : "";
    if (!eventId) {
      throw new HttpsError("failed-precondition", "Share has no associated event.");
    }

    const settlementRef = db
      .collection("events").doc(eventId)
      .collection("settlement").doc("main");
    const settlementSnap = await settlementRef.get();
    if (!settlementSnap.exists) {
      throw new HttpsError("not-found", "Settlement not found for this event.");
    }

    const bucket = admin.storage().bucket();
    const stored: StoredAttachment[] = [];

    for (const a of attachments) {
      if (!a || typeof a.data !== "string" || typeof a.name !== "string") {
        throw new HttpsError("invalid-argument", "Each attachment requires name and data.");
      }
      const buf = Buffer.from(a.data, "base64");
      if (buf.length === 0) {
        throw new HttpsError("invalid-argument", `Attachment ${a.name} is empty or not valid base64.`);
      }
      if (buf.length > MAX_FILE_BYTES) {
        throw new HttpsError("invalid-argument", `Attachment ${a.name} exceeds 10 MB.`);
      }
      const safeName = sanitizeName(a.name);
      const objectPath = `events/${eventId}/comments/${Date.now()}-${randomUUID()}-${safeName}`;
      const downloadToken = randomUUID();
      const file = bucket.file(objectPath);
      await file.save(buf, {
        contentType: a.type || "application/octet-stream",
        resumable: false,
        metadata: {
          metadata: { firebaseStorageDownloadTokens: downloadToken },
        },
      });
      const fileUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(objectPath)}?alt=media&token=${downloadToken}`;
      stored.push({
        name: a.name,
        size: typeof a.size === "number" && a.size > 0 ? a.size : buf.length,
        type: a.type || a.name.split(".").pop() || "file",
        fileUrl,
      });
    }

    const newComment: Record<string, unknown> = {
      party: reviewerName.trim(),
      message: message.trim(),
      date,
    };
    if (stored.length > 0) {
      newComment.attachments = stored;
    }

    await db.runTransaction(async (tx) => {
      const cur = await tx.get(settlementRef);
      const data = (cur.exists ? cur.data() : {}) || {};
      const comments = Array.isArray(data.comments) ? data.comments : [];
      tx.update(settlementRef, {
        comments: [...comments, newComment],
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    // Append activity entry (best-effort)
    try {
      await db.collection("events").doc(eventId).collection("activity").add({
        kind: "comment_added",
        actor: reviewerName.trim(),
        actorUid: uid,
        via: "public_share",
        token,
        details: { party: reviewerName.trim(), attachmentCount: stored.length },
        createdAt: FieldValue.serverTimestamp(),
      });
    } catch (err) {
      logger.warn("submitPublicShareComment: failed to write activity", { err: String(err) });
    }

    // Refresh public share snapshot so the review page reflects the new comment
    try {
      const [eventDocSnap, dealSnap, revenueSnap, refreshedSettlementSnap] = await Promise.all([
        db.collection("events").doc(eventId).get(),
        db.collection("events").doc(eventId).collection("deal").doc("main").get(),
        db.collection("events").doc(eventId).collection("revenue").doc("main").get(),
        settlementRef.get(),
      ]);
      if (eventDocSnap.exists && dealSnap.exists && revenueSnap.exists && refreshedSettlementSnap.exists) {
        await db.collection("publicShares").doc(token).set(
          {
            snapshot: {
              event: { id: eventId, ...eventDocSnap.data() },
              deal: dealSnap.data(),
              revenue: revenueSnap.data(),
              settlement: refreshedSettlementSnap.data(),
            },
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      }
    } catch (err) {
      logger.warn("submitPublicShareComment: failed to refresh share snapshot", { err: String(err) });
    }

    return { ok: true };
  },
);
