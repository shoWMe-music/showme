import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Off-platform share crypto (decisions #6, `docs/off-platform-access.md`) — PURE,
 * framework-free, unit-tested. Ports the proven constants from the old app's
 * `shareOtpApi.ts` verbatim: 6-digit salted-SHA256 OTP, 10-min TTL, 3 issues/hour,
 * 5 verify attempts, then a 24h HS256 JWT. Built entirely on `node:crypto` — no
 * npm dependency (no `jsonwebtoken`).
 */

/** OTP lifetime — 10 minutes. */
export const OTP_TTL_MS = 10 * 60 * 1000;
/** Rate-limit window — 1 hour. */
export const RATE_WINDOW_MS = 60 * 60 * 1000;
/** Max OTP issues per email inside one rate window. */
export const RATE_LIMIT = 3;
/** Max failed verify attempts on one code before the OTP is destroyed. */
export const MAX_VERIFY_ATTEMPTS = 5;
/** Minted share-JWT lifetime — 24 hours (in seconds). */
export const JWT_TTL_SECONDS = 24 * 60 * 60;

/** Normalize an email for hashing / matching: trimmed + lowercased. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** SHA256(email) hex — the `share_otps.email_hash` key (raw email is never stored). */
export function emailHash(email: string): string {
  return createHash("sha256").update(normalizeEmail(email)).digest("hex");
}

/** A fresh per-OTP salt (hex). */
export function generateSalt(): string {
  return randomBytes(16).toString("hex");
}

/** A random 6-digit numeric OTP code (as a zero-safe string, always 6 chars). */
export function generateOtpCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/** Salted SHA256 of a code: `sha256(salt + ':' + code)` hex — never store plaintext. */
export function hashOtpCode(salt: string, code: string): string {
  return createHash("sha256").update(`${salt}:${code}`).digest("hex");
}

/** Constant-time check of a code against its stored salted hash. */
export function verifyOtpCode(salt: string, code: string, storedHash: string): boolean {
  const candidate = hashOtpCode(salt, code.trim());
  const a = Buffer.from(candidate);
  const b = Buffer.from(storedHash);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The claims carried by a minted share-JWT. */
export interface ShareJwtPayload {
  token: string;
  email: string;
  iat: number; // issued-at (unix seconds)
  exp: number; // expiry (unix seconds)
}

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

/**
 * Sign an HS256 JWT (`header.payload.signature`, base64url, HMAC-SHA256) by hand.
 * `{ alg: "HS256", typ: "JWT" }` header; the payload is the given claims.
 */
export function signShareJwt(payload: ShareJwtPayload, secret: string): string {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64url(JSON.stringify(payload));
  const signingInput = `${header}.${body}`;
  const signature = createHmac("sha256", secret).update(signingInput).digest("base64url");
  return `${signingInput}.${signature}`;
}

/** Mint a 24h share-JWT for a verified `(token, email)` pair. `nowMs` is injectable for tests. */
export function mintShareJwt(
  token: string,
  email: string,
  secret: string,
  nowMs: number = Date.now(),
): string {
  const iat = Math.floor(nowMs / 1000);
  return signShareJwt(
    { token, email: normalizeEmail(email), iat, exp: iat + JWT_TTL_SECONDS },
    secret,
  );
}

/**
 * Verify an HS256 share-JWT: recompute + constant-time-compare the signature, then
 * check expiry. Returns the claims on success, or `null` for any tamper / bad
 * secret / malformed / expired token (never throws on a bad token).
 */
export function verifyShareJwt(
  jwt: string,
  secret: string,
  nowMs: number = Date.now(),
): ShareJwtPayload | null {
  const parts = jwt.split(".");
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts;
  if (!header || !body || !signature) return null;

  const expected = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  const given = Buffer.from(signature);
  const want = Buffer.from(expected);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return null;

  let payload: ShareJwtPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as ShareJwtPayload;
  } catch {
    return null;
  }
  if (typeof payload.exp !== "number" || payload.exp <= Math.floor(nowMs / 1000)) return null;
  return payload;
}
