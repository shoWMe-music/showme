#!/usr/bin/env node
/**
 * Drive the running local stack AS A REAL SEEDED USER: mint a genuine Firebase
 * Auth **emulator** ID token, then call the API with it. The point is that every
 * request resolves a real principal, real memberships and real capabilities —
 * the thing a unit test with a hand-built context cannot prove.
 *
 * Needs `pnpm dev` up (API :8080, auth emulator :9099).
 *
 *   node .claude/skills/verify-e2e/api-as.mjs <account> <METHOD> <path> [body] [actingProfileId]
 *   node .claude/skills/verify-e2e/api-as.mjs agent GET /events
 *   node .claude/skills/verify-e2e/api-as.mjs operator PATCH /events/<id> '{"status":"concluded"}'
 *
 * `<account>` is a key below, a bare email, or `anonymous` for the public routes.
 * Paths are relative to `/api/v1`. Exit code is 0 for 2xx, 1 otherwise, so a
 * probe can be chained in a shell.
 *
 * Import it for a scripted battery — the usual shape is one `check()` per rule
 * asserting BOTH the status and the reason (see the skill: a refusal only counts
 * when it refuses for the stated reason):
 *
 *   import { call } from "./api-as.mjs";
 *   const { status, body } = await call("operator", "POST", "/offers", payload, profileId);
 */
const AUTH_EMULATOR =
  "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key";
const API = "http://127.0.0.1:8080/api/v1";

/** Mirrors `packages/shared/src/e2e-accounts.ts` — the source of truth for these. */
const EMAILS = {
  operator: "operator@e2e.showme.test",
  performerA: "performer.a@e2e.showme.test",
  performerB: "performer.b@e2e.showme.test",
  teamAndCrew: "professional@e2e.showme.test",
  agent: "agent@e2e.showme.test",
  // The second operator, co-promoting one show. It was missing here while it
  // existed in the seed, so any probe naming it died on INVALID_EMAIL.
  coHost: "co.host@e2e.showme.test",
};
const PASSWORD = "Test123!pass";

const tokenCache = new Map();

/** A real emulator ID token for a seeded account. Cached per email per process. */
export async function tokenFor(account) {
  const email = EMAILS[account] ?? account;
  const cached = tokenCache.get(email);
  if (cached) return cached;

  const response = await fetch(AUTH_EMULATOR, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD, returnSecureToken: true }),
  });
  const payload = await response.json();
  if (!payload.idToken) {
    throw new Error(`sign-in failed for ${email}: ${JSON.stringify(payload)}`);
  }
  tokenCache.set(email, payload.idToken);
  return payload.idToken;
}

/**
 * One authenticated call. `account` may be `"anonymous"` for the public routes.
 *
 * `actingProfileId` becomes the `x-profile-id` header — the profile the caller is
 * acting AS, which the web app sends on every request. Routes that resolve an
 * acting profile (offers, plans, anything charging a plan) answer a confusing
 * "Select a profile to send the offer from" without it, which reads exactly like
 * the feature refusing. Pass it whenever the route cares.
 */
export async function call(account, method, path, body, actingProfileId) {
  const idToken = account === "anonymous" ? null : await tokenFor(account);
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      // Only when there IS a body — Fastify rejects an empty body that claims JSON
      // (`FST_ERR_CTP_EMPTY_JSON_BODY`), and that 400 is easy to misread as the rule.
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(idToken ? { authorization: `Bearer ${idToken}` } : {}),
      ...(actingProfileId ? { "x-profile-id": actingProfileId } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: response.status, body: parsed };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [account, method, path, rawBody, actingProfileId] = process.argv.slice(2);
  if (!account || !method || !path) {
    console.error("usage: api-as.mjs <account> <METHOD> <path> [jsonBody] [actingProfileId]");
    process.exit(2);
  }
  const result = await call(
    account,
    method,
    path,
    rawBody ? JSON.parse(rawBody) : undefined,
    actingProfileId,
  );
  console.log(result.status);
  console.log(JSON.stringify(result.body, null, 2));
  process.exit(result.status >= 200 && result.status < 300 ? 0 : 1);
}
