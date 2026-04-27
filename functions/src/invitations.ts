import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { HttpsError, onCall } from "firebase-functions/v2/https";

const db = () => getFirestore();

// Alphabet without ambiguous characters: 0/O, 1/I/L
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function randomChar(): string {
  const idx = Math.floor(Math.random() * CODE_ALPHABET.length);
  return CODE_ALPHABET[idx];
}

/** Generate a SHOW-XXXX-XXXX code. */
function generateCode(): string {
  let part1 = "";
  let part2 = "";
  for (let i = 0; i < 4; i++) {
    part1 += randomChar();
    part2 += randomChar();
  }
  return `SHOW-${part1}-${part2}`;
}

// ---------------------------------------------------------------------------
// createInvitationCode
// ---------------------------------------------------------------------------

interface CreateInvitationCodeData {
  recipientEmail?: string;
  recipientName?: string;
  recipientRole?: string;
  linkedProfileId?: string;
  linkedEventId?: string;
  source: "collaborator_invite" | "admin" | "team";
  sourceCollaboratorInviteToken?: string;
}

export const createInvitationCode = onCall<CreateInvitationCodeData, Promise<{ code: string }>>(
  { region: "europe-west1" },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Authentication required.");
    }

    const {
      recipientEmail,
      recipientName,
      recipientRole,
      linkedProfileId,
      linkedEventId,
      source,
      sourceCollaboratorInviteToken,
    } = request.data;

    if (!source) {
      throw new HttpsError("invalid-argument", "source is required.");
    }

    // Admin-only guard
    if (source === "admin") {
      const adminSnap = await db().collection("admins").doc(uid).get();
      if (!adminSnap.exists) {
        throw new HttpsError("permission-denied", "Only admins can create admin invitation codes.");
      }
    }

    // Generate a unique code (retry on collision)
    let code = generateCode();
    let attempts = 0;
    while (attempts < 10) {
      const existing = await db().collection("invitationCodes").doc(code).get();
      if (!existing.exists) break;
      code = generateCode();
      attempts++;
    }
    if (attempts >= 10) {
      throw new HttpsError("internal", "Failed to generate a unique invitation code.");
    }

    await db().collection("invitationCodes").doc(code).set({
      code,
      status: "active",
      createdAt: FieldValue.serverTimestamp(),
      createdByUid: uid,
      recipientEmail: recipientEmail ?? null,
      recipientName: recipientName ?? null,
      recipientRole: recipientRole ?? null,
      linkedProfileId: linkedProfileId ?? null,
      linkedEventId: linkedEventId ?? null,
      source,
      sourceCollaboratorInviteToken: sourceCollaboratorInviteToken ?? null,
      usedByUid: null,
      usedAt: null,
    });

    logger.info("Invitation code created", { code, source, createdByUid: uid });

    return { code };
  },
);

// ---------------------------------------------------------------------------
// claimInvitationCode
// ---------------------------------------------------------------------------

interface ClaimInvitationCodeData {
  code: string;
}

interface ClaimInvitationCodeResult {
  linkedProfileId?: string;
  linkedEventId?: string;
  recipientName?: string;
  recipientRole?: string;
}

export const claimInvitationCode = onCall<ClaimInvitationCodeData, Promise<ClaimInvitationCodeResult>>(
  { region: "europe-west1" },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Authentication required.");
    }

    const { code } = request.data;
    if (!code || typeof code !== "string") {
      throw new HttpsError("invalid-argument", "code is required.");
    }

    const codeRef = db().collection("invitationCodes").doc(code);

    // Atomically claim the code inside a transaction
    const codeData = await db().runTransaction(async (tx) => {
      const snap = await tx.get(codeRef);
      if (!snap.exists) {
        throw new HttpsError("not-found", "Invitation code not found.");
      }
      const data = snap.data() as Record<string, unknown>;

      if (data.status !== "active") {
        throw new HttpsError("failed-precondition", "This invitation code has already been used or revoked.");
      }

      // If code is tied to a specific email, enforce it
      if (data.recipientEmail) {
        const callerEmail = request.auth?.token?.email;
        if (
          !callerEmail ||
          String(data.recipientEmail).toLowerCase() !== callerEmail.toLowerCase()
        ) {
          throw new HttpsError(
            "permission-denied",
            "This invitation code is reserved for a different email address.",
          );
        }
      }

      tx.update(codeRef, {
        status: "used",
        usedByUid: uid,
        usedAt: FieldValue.serverTimestamp(),
      });

      return data;
    });

    const linkedProfileId = codeData.linkedProfileId as string | undefined;
    const linkedEventId = codeData.linkedEventId as string | undefined;
    const recipientName = codeData.recipientName as string | undefined;
    const recipientRole = codeData.recipientRole as string | undefined;

    // Profile transfer logic (outside transaction)
    if (linkedProfileId) {
      const oldProfileRef = db().collection("profiles").doc(linkedProfileId);
      const oldProfileSnap = await oldProfileRef.get();

      if (oldProfileSnap.exists) {
        const oldData = oldProfileSnap.data() ?? {};
        const role = recipientRole ?? "artist";
        const newProfileId = `${uid}__${role}`;
        const newProfileRef = db().collection("profiles").doc(newProfileId);

        // Create new profile with transferred data
        await newProfileRef.set({
          ...oldData,
          owner_uid: uid,
          unclaimed: false,
        });

        // Create owner member doc
        await newProfileRef.collection("members").doc(uid).set({
          user_uid: uid,
          role: "owner",
          joinedAt: FieldValue.serverTimestamp(),
        });

        // Update event access if linked to an event
        if (linkedEventId) {
          const eventRef = db().collection("events").doc(linkedEventId);
          const eventSnap = await eventRef.get();
          const eventData = eventSnap.exists ? (eventSnap.data() ?? {}) : {};

          const eventUpdates: Record<string, unknown> = {
            accessUids: FieldValue.arrayUnion(uid),
            accessProfileIds: FieldValue.arrayUnion(newProfileId),
          };

          // Link the new profile as the performer on this event
          if (
            eventData.performerProfileId === linkedProfileId ||
            !eventData.performerProfileId
          ) {
            eventUpdates.performerProfileId = newProfileId;
          }

          await eventRef.update(eventUpdates);

          // For multi-performer events, also update the child event that
          // references the old stub profile so the performer is properly linked.
          if (eventData.isMultiPerformer && Array.isArray(eventData.childEventIds)) {
            for (const childId of eventData.childEventIds as string[]) {
              const childRef = db().collection("events").doc(childId);
              const childSnap = await childRef.get();
              if (!childSnap.exists) continue;
              const childData = childSnap.data() ?? {};
              if (childData.performerProfileId === linkedProfileId || childData.artist === recipientName) {
                await childRef.update({
                  performerProfileId: newProfileId,
                  accessUids: FieldValue.arrayUnion(uid),
                  accessProfileIds: FieldValue.arrayUnion(newProfileId),
                });
                break;
              }
            }
          }
        }

        // Delete old profile's members subcollection
        const oldMembersSnap = await oldProfileRef.collection("members").listDocuments();
        const batch = db().batch();
        for (const memberDoc of oldMembersSnap) {
          batch.delete(memberDoc);
        }
        // Delete old profile doc
        batch.delete(oldProfileRef);
        await batch.commit();

        logger.info("Profile transferred", {
          oldProfileId: linkedProfileId,
          newProfileId,
          newOwnerUid: uid,
        });

        return {
          linkedProfileId: newProfileId,
          linkedEventId: linkedEventId ?? undefined,
          recipientName: recipientName ?? undefined,
          recipientRole: recipientRole ?? undefined,
        };
      }
    }

    return {
      linkedProfileId: linkedProfileId ?? undefined,
      linkedEventId: linkedEventId ?? undefined,
      recipientName: recipientName ?? undefined,
      recipientRole: recipientRole ?? undefined,
    };
  },
);

// ---------------------------------------------------------------------------
// sendOtpEmail
// ---------------------------------------------------------------------------

interface SendOtpEmailData {
  email: string;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const sendOtpEmail = onCall<SendOtpEmailData, Promise<{ ok: true; devCode?: string }>>(
  { region: "europe-west1" },
  async (request) => {
    // No auth required — user hasn't signed in yet
    const { email } = request.data;

    if (!email || typeof email !== "string" || !EMAIL_REGEX.test(email)) {
      throw new HttpsError("invalid-argument", "A valid email address is required.");
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Rate limit: max 3 OTPs per email per hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentOtps = await db()
      .collection("otpCodes")
      .where("email", "==", normalizedEmail)
      .where("createdAt", ">", Timestamp.fromDate(oneHourAgo))
      .get();

    if (recentOtps.size >= 3) {
      throw new HttpsError(
        "resource-exhausted",
        "Too many verification codes requested. Please try again later.",
      );
    }

    // Generate 6-digit numeric code
    const otpCode = String(Math.floor(100000 + Math.random() * 900000));

    const now = Timestamp.now();
    const expiresAt = Timestamp.fromMillis(now.toMillis() + 10 * 60 * 1000);

    await db().collection("otpCodes").add({
      email: normalizedEmail,
      code: otpCode,
      createdAt: now,
      expiresAt,
      verified: false,
      attempts: 0,
    });

    // TODO: Send actual email — for now just log the OTP
    logger.info("OTP code generated (email sending not yet implemented)", {
      email: normalizedEmail,
      code: otpCode,
    });

    // Return the code directly until email sending is implemented
    // TODO: Remove devCode from production response once SMTP emails are live
    return { ok: true, devCode: otpCode };
  },
);

// ---------------------------------------------------------------------------
// verifyOtp
// ---------------------------------------------------------------------------

interface VerifyOtpData {
  email: string;
  code: string;
}

export const verifyOtp = onCall<VerifyOtpData, Promise<{ ok: true }>>(
  { region: "europe-west1" },
  async (request) => {
    // No auth required
    const { email, code } = request.data;

    if (!email || typeof email !== "string") {
      throw new HttpsError("invalid-argument", "email is required.");
    }
    if (!code || typeof code !== "string") {
      throw new HttpsError("invalid-argument", "code is required.");
    }

    const normalizedEmail = email.toLowerCase().trim();
    const now = Timestamp.now();

    // Find matching OTP: same email, same code, not expired, not verified
    const otpQuery = await db()
      .collection("otpCodes")
      .where("email", "==", normalizedEmail)
      .where("code", "==", code)
      .where("verified", "==", false)
      .get();

    // Filter to non-expired results and check attempts
    for (const doc of otpQuery.docs) {
      const data = doc.data();
      const expiresAt = data.expiresAt as Timestamp;

      if (expiresAt.toMillis() < now.toMillis()) {
        continue; // expired
      }

      const attempts = (data.attempts as number) ?? 0;

      if (attempts >= 5) {
        throw new HttpsError("resource-exhausted", "Too many verification attempts. Request a new code.");
      }

      // Increment attempts
      await doc.ref.update({
        attempts: FieldValue.increment(1),
      });

      if (data.code === code) {
        // Match! Mark as verified
        await doc.ref.update({ verified: true });
        logger.info("OTP verified", { email: normalizedEmail });
        return { ok: true };
      }
    }

    throw new HttpsError("invalid-argument", "Invalid or expired code");
  },
);

// ---------------------------------------------------------------------------
// sendInvitationEmail
// ---------------------------------------------------------------------------

interface SendInvitationEmailData {
  code: string;
  recipientEmail: string;
  recipientName: string;
  eventName?: string;
  senderName: string;
  message?: string;
}

export const sendInvitationEmail = onCall<SendInvitationEmailData, Promise<{ ok: true }>>(
  { region: "europe-west1" },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Authentication required.");
    }

    const { code, recipientEmail, recipientName, eventName, senderName, message } = request.data;

    if (!code || !recipientEmail || !recipientName || !senderName) {
      throw new HttpsError("invalid-argument", "code, recipientEmail, recipientName, and senderName are required.");
    }

    // TODO: Send actual email — for now just log the content
    logger.info("Invitation email (sending not yet implemented)", {
      to: recipientEmail,
      recipientName,
      senderName,
      code,
      eventName: eventName ?? null,
      message: message ?? null,
      sentByUid: uid,
    });

    return { ok: true };
  },
);
