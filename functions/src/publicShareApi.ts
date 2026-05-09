import * as admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import { CallableRequest, HttpsError, onCall } from "firebase-functions/v2/https";
import * as jwtLib from "jsonwebtoken";

import { SHARE_JWT_SECRET } from "./shareOtpApi";

if (!admin.apps.length) {
  admin.initializeApp();
}

interface GetPublicShareData {
  token: string;
  jwt?: string;
}

type PublicShareAccess = "public" | "protected";

interface PublicShareResponse {
  share: Record<string, unknown> & { id: string };
}

function isStringRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function lowerEmail(value: unknown): string {
  return typeof value === "string" ? value.toLowerCase().trim() : "";
}

function recipientEmails(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const r of raw) {
    if (isStringRecord(r)) {
      const e = lowerEmail(r.email);
      if (e) out.push(e);
    }
  }
  return out;
}

export async function handleGetPublicShare(
  request: CallableRequest<GetPublicShareData>,
): Promise<PublicShareResponse> {
  const token = request.data?.token;
  const jwt = request.data?.jwt;
  if (typeof token !== "string" || token.trim().length === 0) {
    throw new HttpsError("invalid-argument", "token is required.");
  }

  const db = getFirestore();
  const snap = await db.collection("publicShares").doc(token).get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "Share link not found.");
  }

  const raw = (snap.data() ?? {}) as Record<string, unknown>;
  // Defensive: never echo OTP subcollection data even if a future writer inlines it.
  const { otp: _otp, ...rest } = raw;
  const share = { ...rest, id: snap.id };

  // Legacy compat: docs missing `access` are treated as "protected" so they
  // never leak via the public path; new docs always set `access` explicitly.
  const accessRaw = raw.access;
  const access: PublicShareAccess =
    accessRaw === "public" ? "public" : "protected";

  if (access === "public") {
    return { share };
  }

  const callerEmail = lowerEmail(request.auth?.token?.email);
  const callerUid = request.auth?.uid ?? "";
  const ownerUid = typeof raw.ownerUid === "string" ? raw.ownerUid : "";
  const allowed = recipientEmails(raw.recipients);

  if (callerUid && ownerUid && callerUid === ownerUid) {
    return { share };
  }
  if (callerEmail && allowed.includes(callerEmail)) {
    return { share };
  }

  if (typeof jwt === "string" && jwt.length > 0) {
    let claims: jwtLib.JwtPayload;
    try {
      const decoded = jwtLib.verify(jwt, SHARE_JWT_SECRET.value(), {
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
    const claimEmail = lowerEmail(claims.email);
    if (claimToken !== token) {
      throw new HttpsError("permission-denied", "Access token does not match this share.");
    }
    if (!claimEmail || !allowed.includes(claimEmail)) {
      throw new HttpsError("permission-denied", "Recipient verification required.");
    }
    return { share };
  }

  throw new HttpsError("permission-denied", "Recipient verification required.");
}

export const getPublicShare = onCall<GetPublicShareData, Promise<PublicShareResponse>>(
  { region: "europe-west1", memory: "256MiB", secrets: [SHARE_JWT_SECRET] },
  handleGetPublicShare,
);
