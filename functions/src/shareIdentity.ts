import * as jwtLib from "jsonwebtoken";
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";

import { SHARE_JWT_SECRET } from "./shareOtpApi";

function isStringRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function lowerEmail(value: unknown): string {
  return typeof value === "string" ? value.toLowerCase().trim() : "";
}

function verifyJwtEmail(rawJwt: string, expectedToken: string): string {
  let claims: jwtLib.JwtPayload;
  try {
    const decoded = jwtLib.verify(rawJwt, SHARE_JWT_SECRET.value(), {
      algorithms: ["HS256"],
    });
    if (typeof decoded === "string") {
      throw new Error("string payload");
    }
    claims = decoded;
  } catch {
    throw new HttpsError("permission-denied", "Invalid or expired access token.");
  }
  const claimToken = typeof claims.token === "string" ? claims.token : "";
  if (claimToken !== expectedToken) {
    throw new HttpsError("permission-denied", "Access token does not match this share.");
  }
  const email = lowerEmail(claims.email);
  if (!email) {
    throw new HttpsError("permission-denied", "Recipient verification required.");
  }
  return email;
}

/**
 * Resolve the verified caller email for a share callable. Accepts either
 * a Firebase Auth identity or an OTP-JWT signed with `SHARE_JWT_SECRET`.
 * Returns a lowercased email; throws permission-denied if neither path
 * produces one.
 */
export function resolveVerifiedShareEmail(
  request: CallableRequest<unknown>,
  shareToken: string,
): string {
  const authEmail = lowerEmail(request.auth?.token?.email);
  if (authEmail) return authEmail;

  const data = request.data as { jwt?: unknown } | undefined;
  const jwt = data?.jwt;
  if (typeof jwt === "string" && jwt.length > 0) {
    return verifyJwtEmail(jwt, shareToken);
  }
  throw new HttpsError("permission-denied", "Recipient verification required.");
}

async function emailMatchesProfileMember(
  db: FirebaseFirestore.Firestore,
  profileId: string,
  email: string,
): Promise<boolean> {
  const profileRef = db.collection("profiles").doc(profileId);
  const [membersSnap, profileSnap] = await Promise.all([
    profileRef.collection("members").get(),
    profileRef.get(),
  ]);
  for (const m of membersSnap.docs) {
    const data = (m.data() ?? {}) as Record<string, unknown>;
    if (lowerEmail(data.email) === email) return true;
  }
  if (profileSnap.exists) {
    const profile = (profileSnap.data() ?? {}) as Record<string, unknown>;
    const ownerEmail = lowerEmail(profile.ownerEmail);
    if (ownerEmail && ownerEmail === email) return true;
    const ownerUid =
      typeof profile.ownerUid === "string"
        ? profile.ownerUid
        : typeof profile.owner_uid === "string"
        ? profile.owner_uid
        : "";
    if (ownerUid) {
      try {
        const userSnap = await db.collection("users").doc(ownerUid).get();
        if (userSnap.exists) {
          const userEmail = lowerEmail(((userSnap.data() ?? {}) as Record<string, unknown>).email);
          if (userEmail && userEmail === email) return true;
        }
      } catch {
        // missing users/{uid} doc is non-fatal — fall through to next check
      }
    }
  }
  return false;
}

async function emailMatchesParticipantProfile(
  db: FirebaseFirestore.Firestore,
  eventId: string,
  party: string,
  email: string,
): Promise<boolean> {
  const partyKey = party.toLowerCase().trim();
  if (!partyKey) return false;
  const participantsSnap = await db
    .collection("events").doc(eventId)
    .collection("participants").get();
  const matchedProfileIds: string[] = [];
  for (const p of participantsSnap.docs) {
    const data = (p.data() ?? {}) as Record<string, unknown>;
    const role = typeof data.role === "string" ? data.role.toLowerCase().trim() : "";
    if (role && role === partyKey) {
      const profileId = typeof data.profileId === "string" ? data.profileId : p.id;
      if (profileId) matchedProfileIds.push(profileId);
    }
  }
  for (const pid of matchedProfileIds) {
    if (await emailMatchesProfileMember(db, pid, email)) return true;
  }
  return false;
}

async function emailMatchesEventTeam(
  db: FirebaseFirestore.Firestore,
  eventId: string,
  email: string,
): Promise<boolean> {
  // The event "team" (per design §5(b)) lives as the `collaborators`
  // subcollection in this codebase — there is no inline `team[]` array on
  // the event doc. Each collaborator carries an `email` field.
  const collabSnap = await db
    .collection("events").doc(eventId)
    .collection("collaborators").get();
  for (const c of collabSnap.docs) {
    const data = (c.data() ?? {}) as Record<string, unknown>;
    if (lowerEmail(data.email) === email) return true;
  }
  return false;
}

/**
 * Throws permission-denied if `email` does not satisfy either identity path:
 *   (a) email is a member of the profile bound to the participant slot
 *       named by `party`, OR
 *   (b) email appears in the event's collaborators subcollection.
 */
export async function assertEmailMatchesParty(
  db: FirebaseFirestore.Firestore,
  eventId: string,
  party: string,
  email: string,
): Promise<void> {
  const matchesParticipant = await emailMatchesParticipantProfile(db, eventId, party, email);
  if (matchesParticipant) return;
  const matchesTeam = await emailMatchesEventTeam(db, eventId, email);
  if (matchesTeam) return;
  throw new HttpsError(
    "permission-denied",
    "Your verified email does not authorize this confirmation.",
  );
}

export { isStringRecord };
