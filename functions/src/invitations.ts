import * as admin from "firebase-admin";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { sendMail, BREVO_API_KEY } from "./mail";
import { otpEmail, invitationEmail } from "./emailTemplates";
import { APP_BASE_URL } from "./appBaseUrl";

const db = () => getFirestore();

async function emailIsAlreadyRegistered(email: string): Promise<boolean> {
  try {
    await admin.auth().getUserByEmail(email);
    return true;
  } catch {
    return false;
  }
}

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

    // Defense-in-depth: never mint an invitation code (which doubles as a
    // signup link) for an email that is already a registered platform user.
    // Clicking the signup link would otherwise let the recipient overwrite
    // someone's password via createUserWithEmailAndPassword. The client is
    // expected to branch into the "add existing user directly" path before
    // calling this function — this guard catches stale clients and direct
    // callable invocations.
    if (source === "collaborator_invite" && recipientEmail) {
      const normalized = recipientEmail.toLowerCase().trim();
      if (normalized && (await emailIsAlreadyRegistered(normalized))) {
        throw new HttpsError(
          "already-exists",
          "This email is already registered. Add the user directly instead of sending a signup invite.",
        );
      }
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

    // Wave 7 (B1): auto-create a Contact card for the invited recipient and
    // link it to the new InvitationCode in a single transaction so the two
    // documents stay in sync. Skip the contact write if a contact with the
    // same email already exists for this user (idempotent guard for repeat
    // invites or reruns of the backfill helper).
    const contactsCol = db().collection("users").doc(uid).collection("contacts");
    const normalizedEmail = recipientEmail ? recipientEmail.toLowerCase().trim() : "";
    let linkedContactId: string | null = null;

    if (recipientName || normalizedEmail) {
      // Look for an existing contact whose primary contact email matches the
      // invitee. fetchContactPage stores `contacts: [{name, email, phone}, ...]`
      // alongside top-level `name`. Match on either to avoid duplicates.
      const existingByEmail = normalizedEmail
        ? await contactsCol.get().then((snap) =>
          snap.docs.find((d) => {
            const data = d.data() as Record<string, unknown>;
            const persons = Array.isArray(data.contacts) ? (data.contacts as Array<{ email?: string }>) : [];
            return persons.some((c) => (c.email ?? "").toLowerCase().trim() === normalizedEmail);
          }) ?? null,
        )
        : null;

      if (existingByEmail) {
        linkedContactId = existingByEmail.id;
      } else {
        linkedContactId = `P-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      }
    }

    await db().runTransaction(async (tx) => {
      const codeRef = db().collection("invitationCodes").doc(code);
      const contactRef =
        linkedContactId && (recipientName || normalizedEmail)
          ? contactsCol.doc(linkedContactId)
          : null;

      // ── All reads must happen before any writes (Firestore tx rule). ──
      const existingContactSnap = contactRef ? await tx.get(contactRef) : null;

      // ── Writes ──
      tx.set(codeRef, {
        code,
        status: "active",
        createdAt: FieldValue.serverTimestamp(),
        createdByUid: uid,
        recipientEmail: recipientEmail ?? null,
        recipientName: recipientName ?? null,
        recipientRole: recipientRole ?? null,
        linkedProfileId: linkedProfileId ?? null,
        linkedEventId: linkedEventId ?? null,
        linkedContactId,
        source,
        sourceCollaboratorInviteToken: sourceCollaboratorInviteToken ?? null,
        usedByUid: null,
        usedAt: null,
      });

      if (contactRef && existingContactSnap) {
        if (!existingContactSnap.exists) {
          tx.set(contactRef, {
            id: linkedContactId,
            name: recipientName || normalizedEmail || "Invited collaborator",
            type: "performer",
            contacts: [{
              name: recipientName ?? "",
              email: recipientEmail ?? "",
              phone: "",
            }],
            iban: "",
            bankName: "",
            vatId: "",
            address: "",
            notes: "",
            invitationCode: code,
            invitationStatus: "active",
            updatedAt: FieldValue.serverTimestamp(),
          });
        } else {
          // Existing contact — only stamp the invitation pointer fields.
          tx.update(contactRef, {
            invitationCode: code,
            invitationStatus: "active",
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
      }
    });

    logger.info("Invitation code created", { code, source, createdByUid: uid, linkedContactId });

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

      // Wave 7 (B1): mirror status onto the linked contact doc so the
      // creator's contact list reflects redemption without a join.
      const linkedContactId = data.linkedContactId as string | undefined;
      const createdByUid = data.createdByUid as string | undefined;
      if (linkedContactId && createdByUid) {
        const contactRef = db()
          .collection("users")
          .doc(createdByUid)
          .collection("contacts")
          .doc(linkedContactId);
        tx.set(
          contactRef,
          { invitationStatus: "used", updatedAt: FieldValue.serverTimestamp() },
          { merge: true },
        );
      }

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
        const role = recipientRole ?? "performer";
        const newProfileId = `${uid}__${role}`;
        const newProfileRef = db().collection("profiles").doc(newProfileId);

        // Create new profile with transferred data. `created: true` makes the
        // profile visible in the UI (every list/page filters by `p.created`).
        await newProfileRef.set({
          ...oldData,
          owner_uid: uid,
          unclaimed: false,
          created: true,
          updatedAt: FieldValue.serverTimestamp(),
        });

        // Create owner member doc — shape must match `ensureProfileOwnerMember`
        // in `src/lib/profiles/members.ts` (schemaVersion + updatedAt).
        await newProfileRef.collection("members").doc(uid).set({
          user_uid: uid,
          role: "owner",
          schemaVersion: 1,
          updatedAt: FieldValue.serverTimestamp(),
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
  { region: "europe-west1", secrets: [BREVO_API_KEY] },
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

    const tpl = otpEmail(otpCode);
    const result = await sendMail({
      to: normalizedEmail,
      subject: tpl.subject,
      html: tpl.html,
    });

    // If Brevo isn't configured (e.g. emulator without secret), surface the
    // code so dev flows still work. In production sends always go through.
    if (result.skipped) {
      logger.info("OTP code returned to client (BREVO_API_KEY not configured)", {
        email: normalizedEmail,
      });
      return { ok: true, devCode: otpCode };
    }

    return { ok: true };
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
  { region: "europe-west1", secrets: [BREVO_API_KEY] },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Authentication required.");
    }

    const { code, recipientEmail, recipientName, eventName, senderName, message } = request.data;

    if (!code || !recipientEmail || !recipientName || !senderName) {
      throw new HttpsError("invalid-argument", "code, recipientEmail, recipientName, and senderName are required.");
    }

    const signupLink = `${APP_BASE_URL.replace(/\/$/, "")}/signup?code=${encodeURIComponent(code)}`;

    const tpl = invitationEmail({
      recipientName,
      senderName,
      eventName,
      signupLink,
      invitationCode: code,
      message,
    });

    await sendMail({
      to: recipientEmail,
      toName: recipientName,
      subject: tpl.subject,
      html: tpl.html,
    });

    return { ok: true };
  },
);
