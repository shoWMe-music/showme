import { createHmac, randomBytes } from "node:crypto";
import { deriveSubkey, equalsConstantTime } from "./token-encryption";

/**
 * THE `state` PARAMETER — the only thing standing between this flow and an
 * attacker attaching THEIR calendar to somebody else's shoWMe account.
 *
 * THE ATTACK, concretely, because "CSRF" undersells it. An attacker runs the
 * consent screen against their own Google account, stops at the redirect, and
 * keeps the authorization `code` instead of spending it. They then get a signed-in
 * victim's browser to hit our callback carrying that code — a link, an image, a
 * page they control. Without `state`, the API happily exchanges the code and files
 * the resulting refresh token against the VICTIM's account. From then on the
 * victim's availability is driven by a calendar the attacker writes: block every
 * night before a tour announcement, or watch the victim promote the attacker's
 * entries into real shows. The mirror image is just as bad — a victim's code
 * landing on an attacker's account hands over their whole calendar.
 *
 * THE DEFENCE: the state is a MAC'd assertion that says WHO STARTED THIS FLOW,
 * and the callback refuses to proceed unless the caller presenting the code is
 * that same person. The attacker's state names the attacker; the victim's session
 * names the victim; they do not match and the exchange never happens.
 *
 * WHY IT IS SIGNED AND NOT STORED. A random nonce in a table would work and would
 * cost a write, a read, a delete and a reaper for the ones nobody comes back for.
 * An HMAC over the claims is stateless and verifies in microseconds, and the
 * claims are exactly what the check needs: the user, the profile the connection
 * is for, the redirect it was authorized against, and when it was issued.
 *
 * THE KEY is a subkey of `CALENDAR_TOKEN_ENCRYPTION_KEY`, domain-separated by
 * label — never the encryption key itself, because one key doing two jobs is how
 * two sound primitives become one unsound system.
 *
 * WHAT IT IS NOT. It is not a bearer token: it carries no authority, and the
 * callback authenticates the caller with a Firebase token in the ordinary way and
 * then compares. It is also not a replay defence on its own — that is Google's
 * job, an authorization code is single-use — but the fifteen-minute lifetime keeps
 * the window in which a leaked state is worth anything down to the length of one
 * consent screen.
 *
 * `nonce` makes two flows started in the same second by the same user distinct,
 * so a state is never a reusable constant even before the clock moves.
 */

/** Domain separation for the MAC key — bump the suffix if the format changes. */
const STATE_KEY_LABEL = "showme:oauth-state:v1";

/** How long a consent screen may sit open before its state stops being accepted. */
export const OAUTH_STATE_LIFETIME_MILLISECONDS = 15 * 60 * 1000;

/** What the state asserts. Everything here is checked, nothing is trusted blindly. */
export interface OAuthStateClaims {
  /** The user who started the flow. The callback must be the same person. */
  userId: string;
  /** The profile whose availability the connection will feed. */
  profileId: string;
  /** The redirect the code was authorized against — the exchange must reuse it. */
  redirectUri: string;
  /** Milliseconds since the epoch, at issue. */
  issuedAt: number;
  /** Random per flow, so two states from one user in one second still differ. */
  nonce: string;
}

/** Why a state was refused. The route maps every one of these to a 400. */
export class OAuthStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OAuthStateError";
  }
}

function base64UrlEncode(value: Buffer): string {
  return value.toString("base64url");
}

function macFor(secret: string, payload: string): Buffer {
  return createHmac("sha256", deriveSubkey(secret, STATE_KEY_LABEL)).update(payload).digest();
}

/**
 * Mint a state for a flow this user is starting now. Returns the opaque string to
 * hand Google as `state`.
 */
export function signOAuthState(
  secret: string,
  claims: Omit<OAuthStateClaims, "issuedAt" | "nonce">,
  now: Date = new Date(),
): string {
  const complete: OAuthStateClaims = {
    ...claims,
    issuedAt: now.getTime(),
    nonce: randomBytes(16).toString("base64url"),
  };
  const payload = base64UrlEncode(Buffer.from(JSON.stringify(complete), "utf8"));
  return `${payload}.${base64UrlEncode(macFor(secret, payload))}`;
}

/**
 * Check a state and return what it claims. Throws `OAuthStateError` unless the
 * MAC verifies AND the state is still inside its lifetime.
 *
 * It deliberately does NOT check who the caller is — that comparison belongs to
 * the route, which knows the authenticated principal. Splitting them keeps this
 * module free of Fastify and makes both halves testable on their own.
 */
export function verifyOAuthState(
  secret: string,
  state: string,
  now: Date = new Date(),
): OAuthStateClaims {
  const separator = state.lastIndexOf(".");
  if (separator <= 0) throw new OAuthStateError("Malformed state");

  const payload = state.slice(0, separator);
  const presentedMac = Buffer.from(state.slice(separator + 1), "base64url");

  // Constant-time, because a byte-at-a-time comparison on a MAC is a forgery
  // oracle for anyone able to time the response.
  if (!equalsConstantTime(presentedMac, macFor(secret, payload))) {
    throw new OAuthStateError("State signature does not verify");
  }

  let claims: OAuthStateClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw new OAuthStateError("Malformed state");
  }

  if (
    typeof claims.userId !== "string" ||
    typeof claims.profileId !== "string" ||
    typeof claims.redirectUri !== "string" ||
    typeof claims.issuedAt !== "number"
  ) {
    throw new OAuthStateError("Malformed state");
  }

  const age = now.getTime() - claims.issuedAt;
  // A future-dated state is as wrong as an expired one: it means the clock moved
  // or somebody is trying something, and neither is a reason to continue.
  if (age < -60_000 || age > OAUTH_STATE_LIFETIME_MILLISECONDS) {
    throw new OAuthStateError("This connection attempt has expired — start again");
  }

  return claims;
}
