import * as admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { defineSecret } from "firebase-functions/params";
import { CallableRequest, HttpsError, onCall } from "firebase-functions/v2/https";
import { createHash, randomBytes } from "node:crypto";
import * as jwt from "jsonwebtoken";

import { sendMail, BREVO_API_KEY } from "./mail";
import { shareOtpEmail } from "./emailTemplates";

if (!admin.apps.length) {
  admin.initializeApp();
}

export const SHARE_JWT_SECRET = defineSecret("SHARE_JWT_SECRET");

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OTP_TTL_MS = 10 * 60 * 1000;
const RATE_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT = 3;
const MAX_ATTEMPTS = 5;
const JWT_TTL_SECONDS = 24 * 60 * 60;

function isStringRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recipientEmails(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const r of raw) {
    if (isStringRecord(r) && typeof r.email === "string") {
      const e = r.email.toLowerCase().trim();
      if (e) out.push(e);
    }
  }
  return out;
}

function emailHash(email: string): string {
  return createHash("sha256").update(email).digest("hex");
}

function hashCode(salt: string, code: string): string {
  return createHash("sha256").update(`${salt}:${code}`).digest("hex");
}

function generateCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

interface RateWindow {
  startedAt: number;
  count: number;
}

interface OtpDoc {
  codeHash: string;
  salt: string;
  expiresAt: number;
  attempts: number;
  createdAt: number;
  rateWindow: RateWindow;
}

interface RequestShareOtpData {
  token: string;
  email: string;
}

interface VerifyShareOtpData {
  token: string;
  email: string;
  code: string;
}

export async function handleRequestShareOtp(
  request: CallableRequest<RequestShareOtpData>,
): Promise<{ ok: true }> {
  const token = request.data?.token;
  const rawEmail = request.data?.email;
  if (typeof token !== "string" || token.trim().length === 0) {
    throw new HttpsError("invalid-argument", "token is required.");
  }
  if (typeof rawEmail !== "string" || !EMAIL_REGEX.test(rawEmail)) {
    throw new HttpsError("invalid-argument", "A valid email address is required.");
  }
  const email = rawEmail.toLowerCase().trim();

  const db = getFirestore();
  const shareRef = db.collection("publicShares").doc(token);
  const shareSnap = await shareRef.get();
  if (!shareSnap.exists) {
    throw new HttpsError("permission-denied", "Recipient verification required.");
  }
  const shareData = (shareSnap.data() ?? {}) as Record<string, unknown>;
  const allowed = recipientEmails(shareData.recipients);
  if (!allowed.includes(email)) {
    throw new HttpsError("permission-denied", "Recipient verification required.");
  }

  const otpRef = shareRef.collection("otp").doc(emailHash(email));
  const now = Date.now();

  const otpSnap = await otpRef.get();
  let rateWindow: RateWindow = { startedAt: now, count: 0 };
  if (otpSnap.exists) {
    const prev = (otpSnap.data() ?? {}) as Partial<OtpDoc>;
    if (prev.rateWindow && typeof prev.rateWindow.startedAt === "number") {
      const windowAge = now - prev.rateWindow.startedAt;
      if (windowAge < RATE_WINDOW_MS) {
        rateWindow = {
          startedAt: prev.rateWindow.startedAt,
          count: typeof prev.rateWindow.count === "number" ? prev.rateWindow.count : 0,
        };
      }
    }
  }

  if (rateWindow.count >= RATE_LIMIT) {
    throw new HttpsError(
      "resource-exhausted",
      "Too many verification codes requested. Please try again later.",
    );
  }
  rateWindow = { startedAt: rateWindow.startedAt, count: rateWindow.count + 1 };

  const code = generateCode();
  const salt = randomBytes(16).toString("hex");
  const doc: OtpDoc = {
    codeHash: hashCode(salt, code),
    salt,
    expiresAt: now + OTP_TTL_MS,
    attempts: 0,
    createdAt: now,
    rateWindow,
  };
  await otpRef.set(doc);

  let eventName = "your shared event";
  const eventId = typeof shareData.eventId === "string" ? shareData.eventId : "";
  if (eventId) {
    try {
      const eventSnap = await db.collection("events").doc(eventId).get();
      if (eventSnap.exists) {
        const ev = (eventSnap.data() ?? {}) as Record<string, unknown>;
        if (typeof ev.name === "string" && ev.name.trim()) {
          eventName = ev.name.trim();
        }
      }
    } catch (err) {
      logger.warn("share OTP: event lookup failed", { eventId, error: String(err) });
    }
  }

  const tpl = shareOtpEmail({ code, eventName, expiresInMin: OTP_TTL_MS / 60000 });
  await sendMail({
    to: email,
    subject: tpl.subject,
    html: tpl.html,
  });

  return { ok: true };
}

export async function handleVerifyShareOtp(
  request: CallableRequest<VerifyShareOtpData>,
): Promise<{ jwt: string }> {
  const token = request.data?.token;
  const rawEmail = request.data?.email;
  const code = request.data?.code;
  if (typeof token !== "string" || token.trim().length === 0) {
    throw new HttpsError("invalid-argument", "token is required.");
  }
  if (typeof rawEmail !== "string" || !EMAIL_REGEX.test(rawEmail)) {
    throw new HttpsError("invalid-argument", "A valid email address is required.");
  }
  if (typeof code !== "string" || code.trim().length === 0) {
    throw new HttpsError("invalid-argument", "code is required.");
  }
  const email = rawEmail.toLowerCase().trim();

  const db = getFirestore();
  const otpRef = db
    .collection("publicShares")
    .doc(token)
    .collection("otp")
    .doc(emailHash(email));

  const snap = await otpRef.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "Verification code not found.");
  }
  const doc = (snap.data() ?? {}) as Partial<OtpDoc>;
  const now = Date.now();
  if (typeof doc.expiresAt !== "number" || doc.expiresAt < now) {
    await otpRef.delete();
    throw new HttpsError("not-found", "Verification code not found.");
  }
  const attempts = typeof doc.attempts === "number" ? doc.attempts : 0;
  if (attempts >= MAX_ATTEMPTS) {
    await otpRef.delete();
    throw new HttpsError(
      "resource-exhausted",
      "Too many attempts. Request a new verification code.",
    );
  }

  if (
    typeof doc.salt !== "string" ||
    typeof doc.codeHash !== "string" ||
    hashCode(doc.salt, code.trim()) !== doc.codeHash
  ) {
    const nextAttempts = attempts + 1;
    if (nextAttempts >= MAX_ATTEMPTS) {
      // Delete on the 5th failed attempt to prevent timing analysis on
      // subsequent guesses against a known-stale doc.
      await otpRef.delete();
    } else {
      await otpRef.update({ attempts: nextAttempts });
    }
    throw new HttpsError("permission-denied", "Incorrect verification code.");
  }

  await otpRef.delete();

  const nowSec = Math.floor(now / 1000);
  const signed = jwt.sign(
    { token, email, iat: nowSec, exp: nowSec + JWT_TTL_SECONDS },
    SHARE_JWT_SECRET.value(),
    { algorithm: "HS256" },
  );

  return { jwt: signed };
}

export const requestShareOtp = onCall<RequestShareOtpData, Promise<{ ok: true }>>(
  { region: "europe-west1", memory: "256MiB", secrets: [BREVO_API_KEY] },
  handleRequestShareOtp,
);

export const verifyShareOtp = onCall<VerifyShareOtpData, Promise<{ jwt: string }>>(
  { region: "europe-west1", memory: "256MiB", secrets: [SHARE_JWT_SECRET] },
  handleVerifyShareOtp,
);
