import * as admin from "firebase-admin";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { sendMail, BREVO_API_KEY } from "./mail";
import { otpEmail, invitationEmail } from "./emailTemplates";
import { APP_BASE_URL } from "./appBaseUrl";

const db = () => getFirestore();

type CollaboratorPermission = "admin" | "editor" | "view_only";

const VALID_PERMISSIONS: readonly CollaboratorPermission[] = ["admin", "editor", "view_only"] as const;

function normalizePermission(raw: unknown): CollaboratorPermission {
  return VALID_PERMISSIONS.includes(raw as CollaboratorPermission)
    ? (raw as CollaboratorPermission)
    : "editor";
}

/**
 * Look up the permission stored on the original collaborator invite doc when
 * activating a claim. Falls back to "editor" if the invite is missing the
 * field (legacy) or the doc isn't present.
 */
async function resolveInvitePermission(token: string | undefined): Promise<CollaboratorPermission> {
  if (!token) return "editor";
  try {
    const snap = await db().collection("collaboratorInvites").doc(token).get();
    if (!snap.exists) return "editor";
    return normalizePermission(snap.data()?.permission);
  } catch {
    return "editor";
  }
}

/**
 * Compute the editorUids update for an event when a new collaborator joins.
 *
 * Invariants:
 *  1. editorUids gates writes via Firestore rules. View-only must stay out.
 *  2. On first population we bootstrap from the existing accessUids so
 *     pre-existing legacy collaborators don't lose write access (the rule
 *     fallback applies only while editorUids is missing entirely).
 *
 * Returns undefined when no editorUids update is needed (e.g. view-only on
 * an event that already has editorUids).
 */
export function computeEditorUidsUpdate(
  eventData: Record<string, unknown> | undefined,
  newUid: string,
  permission: CollaboratorPermission,
): unknown | undefined {
  const accessUids = Array.isArray(eventData?.accessUids) ? (eventData!.accessUids as string[]) : [];
  const hasEditorUids = Array.isArray(eventData?.editorUids);
  if (permission === "view_only") {
    if (!hasEditorUids) {
      // Freeze legacy roster so pre-existing accessUids keep editing — new
      // view-only uid stays out.
      return Array.from(new Set(accessUids));
    }
    return undefined;
  }
  if (hasEditorUids) {
    return FieldValue.arrayUnion(newUid);
  }
  return Array.from(new Set([...accessUids, newUid]));
}

/**
 * Compute the adminUids update for an event when a collaborator joins or
 * changes permission. Unlike editorUids, this array holds only non-host
 * collab-admins — host profile members get admin power via `isHostAdmin` and
 * are intentionally absent so we never have to recompute host membership
 * here.
 *
 * Returns undefined when no update is needed (e.g. non-admin tier on a doc
 * that already has the field shape we want).
 */
export function computeAdminUidsUpdate(
  eventData: Record<string, unknown> | undefined,
  newUid: string,
  permission: CollaboratorPermission,
): unknown | undefined {
  const hasAdminUids = Array.isArray(eventData?.adminUids);
  if (permission === "admin") {
    return hasAdminUids ? FieldValue.arrayUnion(newUid) : [newUid];
  }
  // Non-admin tier: if the field already exists, remove the uid in case it
  // was previously admin. If the field doesn't exist, no action — we don't
  // bootstrap from anything (host members aren't tracked here).
  if (hasAdminUids) {
    return FieldValue.arrayRemove(newUid);
  }
  return undefined;
}

// Alphabet without ambiguous characters: 0/O, 1/I/L
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function randomChar(): string {
  const idx = Math.floor(Math.random() * CODE_ALPHABET.length);
  return CODE_ALPHABET[idx];
}

/** Generate a SHOW-XXXX-XXXX code. */
export function generateCode(): string {
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
  source: "collaborator_invite" | "admin" | "team" | "venue_handoff" | "performer_offer";
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
    const inviteToken = typeof codeData.sourceCollaboratorInviteToken === "string"
      ? codeData.sourceCollaboratorInviteToken
      : undefined;
    const source = typeof codeData.source === "string" ? codeData.source : "";
    // Venue-handoff claims grant the accepter host-admin powers on the linked
    // event — they're taking over management, not joining as a side party.
    const permission: CollaboratorPermission =
      source === "venue_handoff" ? "admin" : await resolveInvitePermission(inviteToken);

    // Profile transfer logic (outside transaction)
    if (linkedProfileId) {
      const oldProfileRef = db().collection("profiles").doc(linkedProfileId);
      const oldProfileSnap = await oldProfileRef.get();

      if (oldProfileSnap.exists) {
        const oldData = oldProfileSnap.data() ?? {};
        const role = recipientRole ?? "performer";
        const newProfileId = `${uid}__${role}`;
        const newProfileRef = db().collection("profiles").doc(newProfileId);

        // Merge with existing claimed profile (venue_handoff edge case):
        // if the accepting user already owns a `{uid}__venue` (or matching
        // role) profile, DO NOT overwrite it. The stub's data is throwaway;
        // the existing profile is the canonical one. We still need to repoint
        // the event's hostProfileId to the existing profile (handled below)
        // and we still delete the stub.
        //
        // Without this, `newProfileRef.set(...)` would wipe out the venue's
        // real profile data (locations, capacities, bios, etc.) — a silent
        // data loss bug that's hard to debug after the fact.
        const existingNewProfileSnap = await newProfileRef.get();
        const existingClaimedProfile =
          existingNewProfileSnap.exists &&
          (existingNewProfileSnap.data()?.created === true) &&
          (existingNewProfileSnap.data()?.unclaimed !== true);

        if (!existingClaimedProfile) {
          // Normal path: create the profile with transferred stub data.
          // `created: true` makes the profile visible in the UI (every list/
          // page filters by `p.created`).
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
        } else {
          logger.info("Merging venue handoff onto existing claimed profile", {
            uid,
            existingProfileId: newProfileId,
            stubProfileId: linkedProfileId,
          });
          // Owner-member row may already exist from a previous claim; ensure
          // it's there without clobbering.
          await newProfileRef.collection("members").doc(uid).set(
            {
              user_uid: uid,
              role: "owner",
              schemaVersion: 1,
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true },
          );
        }

        // Update event access if linked to an event
        if (linkedEventId) {
          const eventRef = db().collection("events").doc(linkedEventId);
          const eventSnap = await eventRef.get();
          const eventData = eventSnap.exists ? (eventSnap.data() ?? {}) : {};

          const eventUpdates: Record<string, unknown> = {
            accessUids: FieldValue.arrayUnion(uid),
            accessProfileIds: FieldValue.arrayUnion(newProfileId),
          };
          const editorUidsUpdate = computeEditorUidsUpdate(eventData, uid, permission);
          if (editorUidsUpdate !== undefined) {
            eventUpdates.editorUids = editorUidsUpdate;
          }
          const adminUidsUpdate = computeAdminUidsUpdate(eventData, uid, permission);
          if (adminUidsUpdate !== undefined) {
            eventUpdates.adminUids = adminUidsUpdate;
          }

          if (source === "venue_handoff") {
            // The accepting venue takes over as host. Repoint hostProfileId
            // and clear the pending-handoff flags so the event leaves draft-
            // jail and the rule that blocks status transitions during
            // handoff stops applying.
            eventUpdates.hostProfileId = newProfileId;
            eventUpdates.pendingHostHandoff = FieldValue.delete();
            eventUpdates.pendingHostHandoffInviteEmail = FieldValue.delete();
            eventUpdates.createdByProfileId = FieldValue.delete();
          } else if (
            eventData.performerProfileId === linkedProfileId ||
            !eventData.performerProfileId
          ) {
            // Link the new profile as the performer on this event (legacy
            // performer-claim path).
            eventUpdates.performerProfileId = newProfileId;
          }

          await eventRef.update(eventUpdates);

          // Activate the collaborator row so the host's view reflects the
          // accepted invite. Best-effort — older codes may lack the token
          // pointer (e.g. signup flows that pre-date createPerformerInvitation).
          if (inviteToken) {
            try {
              await eventRef.collection("collaborators").doc(inviteToken).update({
                status: "active",
                userUid: uid,
                profileId: newProfileId,
                permission,
                updatedAt: FieldValue.serverTimestamp(),
              });
            } catch (err) {
              logger.warn("Failed to activate collaborator row on claim", {
                err: String(err),
                eventId: linkedEventId,
                inviteToken,
              });
            }
          }

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

    const signupLink = `${APP_BASE_URL.replace(/\/$/, "")}/invite?code=${encodeURIComponent(code)}`;

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

// ---------------------------------------------------------------------------
// peekInvitationCode
//
// Read-only metadata lookup used by the /invite landing page to decide how to
// render: auto-claim with existing profile, prompt to create one, or surface
// "wrong account". Auth-required so we can compare caller email to the code's
// recipientEmail without leaking PII to anonymous callers.
// ---------------------------------------------------------------------------

interface PeekInvitationCodeData {
  code: string;
}

type PeekStatus = "active" | "used" | "revoked" | "not-found";

interface PeekInvitationCodeResult {
  status: PeekStatus;
  /** True iff caller's auth email matches the code's recipientEmail. */
  emailMatches?: boolean;
  /** Caller-facing details — only included when emailMatches is true. */
  recipientEmail?: string;
  recipientName?: string;
  recipientRole?: string;
  linkedEventId?: string;
  eventName?: string;
  senderName?: string;
  /** A profile owned by the caller that matches recipientRole, if one exists. */
  matchingProfile?: { id: string; name: string; role: string };
}

export const peekInvitationCode = onCall<PeekInvitationCodeData, Promise<PeekInvitationCodeResult>>(
  { region: "europe-west1" },
  async (request) => {
    const callerUid = request.auth?.uid;
    if (!callerUid) {
      throw new HttpsError("unauthenticated", "Sign in to view this invitation.");
    }

    const { code } = request.data;
    if (!code || typeof code !== "string") {
      throw new HttpsError("invalid-argument", "code is required.");
    }

    const snap = await db().collection("invitationCodes").doc(code).get();
    if (!snap.exists) {
      return { status: "not-found" };
    }
    const data = snap.data() as Record<string, unknown>;
    const rawStatus = String(data.status || "");
    if (rawStatus !== "active") {
      return { status: (rawStatus as PeekStatus) || "revoked" };
    }

    const callerEmail = (request.auth?.token?.email || "").toLowerCase();
    const recipientEmail = String(data.recipientEmail || "").toLowerCase();
    const emailMatches = !!callerEmail && !!recipientEmail && callerEmail === recipientEmail;
    if (!emailMatches) {
      // Active but for someone else — don't leak details.
      return { status: "active", emailMatches: false };
    }

    const recipientName = typeof data.recipientName === "string" ? data.recipientName : undefined;
    const recipientRole = typeof data.recipientRole === "string" ? data.recipientRole : undefined;
    const linkedEventId = typeof data.linkedEventId === "string" ? data.linkedEventId : undefined;

    let eventName: string | undefined;
    if (linkedEventId) {
      try {
        const eventSnap = await db().collection("events").doc(linkedEventId).get();
        if (eventSnap.exists) {
          const ev = eventSnap.data() ?? {};
          eventName = typeof ev.name === "string" ? ev.name : undefined;
        }
      } catch {
        // ignore — eventName is optional
      }
    }

    let senderName: string | undefined;
    const createdByUid = typeof data.createdByUid === "string" ? data.createdByUid : undefined;
    if (createdByUid) {
      try {
        const sender = await admin.auth().getUser(createdByUid);
        senderName = sender.displayName || sender.email || undefined;
      } catch {
        // ignore
      }
    }

    let matchingProfile: { id: string; name: string; role: string } | undefined;
    if (recipientRole) {
      const profSnap = await db()
        .collection("profiles")
        .where("owner_uid", "==", callerUid)
        .where("role", "==", recipientRole)
        .get();
      for (const doc of profSnap.docs) {
        const p = doc.data() as Record<string, unknown>;
        if (p.created !== true) continue;
        if (p.unclaimed === true) continue;
        matchingProfile = {
          id: doc.id,
          name: typeof p.name === "string" ? p.name : "",
          role: typeof p.role === "string" ? p.role : "",
        };
        break;
      }
    }

    return {
      status: "active",
      emailMatches: true,
      recipientEmail,
      recipientName,
      recipientRole,
      linkedEventId,
      eventName,
      senderName,
      matchingProfile,
    };
  },
);

// ---------------------------------------------------------------------------
// claimInviteWithProfile
//
// Caller-supplied-profile variant of claimInvitationCode. Activates the
// pending collaborator row using a profile the caller already owns (either
// one they had before clicking the link, or one they just created via the
// CreateProfileDialog forced-role wizard). Deletes the stub profile that
// createPerformerInvitation seeded and marks the code used.
// ---------------------------------------------------------------------------

interface ClaimInviteWithProfileData {
  code: string;
  profileId: string;
}

interface ClaimInviteWithProfileResult {
  ok: true;
  eventId?: string;
  profileId: string;
}

export const claimInviteWithProfile = onCall<
  ClaimInviteWithProfileData,
  Promise<ClaimInviteWithProfileResult>
>(
  { region: "europe-west1" },
  async (request) => {
    const callerUid = request.auth?.uid;
    if (!callerUid) {
      throw new HttpsError("unauthenticated", "Sign in to accept the invitation.");
    }

    const { code, profileId } = request.data;
    if (!code || typeof code !== "string") {
      throw new HttpsError("invalid-argument", "code is required.");
    }
    if (!profileId || typeof profileId !== "string") {
      throw new HttpsError("invalid-argument", "profileId is required.");
    }

    // Verify the caller's profile up front so we never mark the code used on a
    // bad input. Read profile + code in parallel; both are independent.
    const [profileSnap, codeSnap] = await Promise.all([
      db().collection("profiles").doc(profileId).get(),
      db().collection("invitationCodes").doc(code).get(),
    ]);

    if (!codeSnap.exists) {
      throw new HttpsError("not-found", "Invitation code not found.");
    }
    const codeData = codeSnap.data() as Record<string, unknown>;
    if (String(codeData.status || "") !== "active") {
      throw new HttpsError("failed-precondition", "This invitation code has already been used or revoked.");
    }

    const recipientEmail = String(codeData.recipientEmail || "").toLowerCase();
    const callerEmail = (request.auth?.token?.email || "").toLowerCase();
    if (!recipientEmail || !callerEmail || recipientEmail !== callerEmail) {
      throw new HttpsError(
        "permission-denied",
        "This invitation is reserved for a different email address.",
      );
    }

    if (!profileSnap.exists) {
      throw new HttpsError("not-found", "Profile not found.");
    }
    const profileData = profileSnap.data() as Record<string, unknown>;
    if (profileData.owner_uid !== callerUid) {
      throw new HttpsError("permission-denied", "Profile is not owned by the caller.");
    }
    if (profileData.created !== true || profileData.unclaimed === true) {
      throw new HttpsError("failed-precondition", "Profile is not active.");
    }
    const recipientRole = typeof codeData.recipientRole === "string" ? codeData.recipientRole : "";
    if (recipientRole && profileData.role !== recipientRole) {
      throw new HttpsError(
        "failed-precondition",
        `Profile role must be ${recipientRole} to accept this invitation.`,
      );
    }

    const linkedEventId = typeof codeData.linkedEventId === "string" ? codeData.linkedEventId : undefined;
    const linkedProfileId = typeof codeData.linkedProfileId === "string" ? codeData.linkedProfileId : undefined;
    const inviteToken = typeof codeData.sourceCollaboratorInviteToken === "string"
      ? codeData.sourceCollaboratorInviteToken
      : undefined;
    const profileSlug = typeof profileData.slug === "string" ? profileData.slug : null;
    const permission = await resolveInvitePermission(inviteToken);

    // 1. Mark the invitation code used.
    await db().collection("invitationCodes").doc(code).update({
      status: "used",
      usedByUid: callerUid,
      usedAt: FieldValue.serverTimestamp(),
    });

    // 2. Activate the collaborator row (keyed by the original invite token) and
    //    grant event access. Best-effort — if the event or collaborator row is
    //    missing we still complete the claim so the user gets a clean exit.
    if (linkedEventId) {
      const eventRef = db().collection("events").doc(linkedEventId);
      const eventSnap = await eventRef.get();
      const existingEventData = eventSnap.exists ? eventSnap.data() : undefined;

      const eventUpdates: Record<string, unknown> = {
        accessUids: FieldValue.arrayUnion(callerUid),
        accessProfileIds: FieldValue.arrayUnion(profileId),
        updatedAt: FieldValue.serverTimestamp(),
      };
      const editorUidsUpdate = computeEditorUidsUpdate(existingEventData, callerUid, permission);
      if (editorUidsUpdate !== undefined) {
        eventUpdates.editorUids = editorUidsUpdate;
      }
      const adminUidsUpdate = computeAdminUidsUpdate(existingEventData, callerUid, permission);
      if (adminUidsUpdate !== undefined) {
        eventUpdates.adminUids = adminUidsUpdate;
      }

      try {
        await eventRef.update(eventUpdates);
      } catch (err) {
        logger.warn("Failed to grant event access on claim", {
          err: String(err),
          eventId: linkedEventId,
          callerUid,
        });
      }

      if (inviteToken) {
        try {
          await eventRef.collection("collaborators").doc(inviteToken).update({
            status: "active",
            userUid: callerUid,
            profileId,
            inviteProfileSlug: profileSlug,
            permission,
            updatedAt: FieldValue.serverTimestamp(),
          });
        } catch (err) {
          logger.warn("Failed to activate collaborator row on claim", {
            err: String(err),
            eventId: linkedEventId,
            inviteToken,
          });
        }
      }
    }

    // 3. Delete the stub profile that createPerformerInvitation seeded — but
    //    only if it's the unclaimed stub and not the profile the caller chose.
    if (linkedProfileId && linkedProfileId !== profileId) {
      const stubRef = db().collection("profiles").doc(linkedProfileId);
      try {
        const stubSnap = await stubRef.get();
        if (stubSnap.exists) {
          const stub = stubSnap.data() ?? {};
          if (stub.unclaimed === true) {
            await stubRef.delete();
          }
        }
      } catch (err) {
        logger.warn("Failed to delete stub profile on claim", {
          err: String(err),
          stubProfileId: linkedProfileId,
        });
      }
    }

    logger.info("Invitation claimed with caller-supplied profile", {
      code,
      callerUid,
      profileId,
      linkedEventId,
    });

    return { ok: true, eventId: linkedEventId, profileId };
  },
);
