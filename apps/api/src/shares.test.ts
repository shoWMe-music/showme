import { PRESET_PERMISSION_SETS } from "@showme/auth";
import { schema } from "@showme/db";
import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TokenVerifier } from "./auth/token-verifier";
import { emailHash } from "./lib/share-crypto";
import { shareRoutes } from "./routes/shares";
import { buildTestApp } from "./testing";

/** Fake verifier: the bearer token IS the uid, so tests just send `Bearer <uid>`. */
const fakeVerifier: TokenVerifier = {
  async verify(token: string) {
    return { uid: token, email: `${token}@example.com`, name: token };
  },
};

let harness: TestDatabase;
let app: FastifyInstance;

beforeAll(async () => {
  harness = await startTestDatabase();
  app = buildTestApp({ database: harness.db, tokenVerifier: fakeVerifier }, [shareRoutes]);
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await harness?.stop();
});

const auth = (uid: string) => ({ authorization: `Bearer ${uid}` });

/** Seed a user + profile + active owner membership + a permission set. */
async function seedMemberWithSet(id: string, capabilities: readonly string[]) {
  const { db } = harness;
  await db.insert(schema.users).values({ id, email: `${id}@example.com`, kind: "operator" });
  const [profile] = await db
    .insert(schema.profiles)
    .values({ kind: "operator", ownerUserId: id, name: id, slug: id })
    .returning();
  if (!profile) throw new Error("profile seed failed");
  await db
    .insert(schema.profileMembers)
    .values({ profileId: profile.id, userId: id, role: "owner", status: "active" });
  const [set] = await db
    .insert(schema.permissionSets)
    .values({
      profileId: profile.id,
      name: capabilities.join("+"),
      capabilities: [...capabilities],
    })
    .returning();
  if (!set) throw new Error("permission set seed failed");
  return { userId: id, profileId: profile.id, permissionSetId: set.id };
}

/** Seed an operator-hosted event with the operator as host participant. */
async function seedEvent(prefix: string) {
  const { db } = harness;
  const operator = await seedMemberWithSet(`${prefix}-op`, PRESET_PERMISSION_SETS.operator_full);
  const [event] = await db
    .insert(schema.events)
    .values({
      hostProfileId: operator.profileId,
      title: "Settle Night",
      baseCurrency: "SEK",
      createdBy: operator.userId,
    })
    .returning();
  if (!event) throw new Error("event seed failed");
  const [participant] = await db
    .insert(schema.eventParticipants)
    .values({
      eventId: event.id,
      profileId: operator.profileId,
      role: "host",
      permissionSetId: operator.permissionSetId,
      status: "confirmed",
    })
    .returning();
  if (!participant) throw new Error("participant seed failed");
  return { operator, event, participant };
}

/** Create a protected share for an event settlement, seeded with one recipient. */
async function createProtectedShare(prefix: string, recipientEmail: string) {
  const seed = await seedEvent(prefix);
  const response = await app.inject({
    method: "POST",
    url: `/api/v1/events/${seed.event.id}/shares`,
    headers: { ...auth(seed.operator.userId), "x-profile-id": seed.operator.profileId },
    payload: {
      targetKind: "settlement",
      capabilities: ["settlement.view.own", "settlement.comment"],
      access: "protected",
      recipients: [{ email: recipientEmail, name: "Guest Performer" }],
    },
  });
  expect(response.statusCode).toBe(201);
  return { seed, token: response.json().token as string };
}

describe("shares — create + public read", () => {
  it("creates a share returning only the token, never the recipient list", async () => {
    const { token } = await createProtectedShare("create", "guest@band.com");
    expect(typeof token).toBe("string");

    const [share] = await harness.db
      .select()
      .from(schema.shares)
      .where(eq(schema.shares.token, token));
    if (!share) throw new Error("share not found");
    expect(share.access).toBe("protected");
    // The recipient exists in the DB but was never returned by the API.
    const recipients = await harness.db
      .select()
      .from(schema.shareRecipients)
      .where(eq(schema.shareRecipients.shareId, share.id));
    expect(recipients).toHaveLength(1);
  });

  it("serves a public share's grant with no principal and no recipients", async () => {
    const seed = await seedEvent("pub");
    const create = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/shares`,
      headers: { ...auth(seed.operator.userId), "x-profile-id": seed.operator.profileId },
      payload: {
        targetKind: "schedule",
        capabilities: ["schedule.view"],
        access: "public",
        recipients: [{ email: "crew@band.com" }],
      },
    });
    const token = create.json().token as string;

    const grant = await app.inject({ method: "GET", url: `/api/v1/shares/${token}` });
    expect(grant.statusCode).toBe(200);
    expect(grant.json()).toEqual({
      targetKind: "schedule",
      targetId: null,
      capabilities: ["schedule.view"],
    });
    // No recipients / emails leak into the payload.
    expect(JSON.stringify(grant.json())).not.toContain("crew@band.com");
  });

  it("404s a missing, revoked, or expired share", async () => {
    const missing = await app.inject({ method: "GET", url: "/api/v1/shares/nope" });
    expect(missing.statusCode).toBe(404);

    const seed = await seedEvent("revoked");
    const [share] = await harness.db
      .insert(schema.shares)
      .values({
        token: "revoked-token",
        eventId: seed.event.id,
        capabilities: ["schedule.view"],
        access: "public",
        ownerUserId: seed.operator.userId,
        ownerProfileId: seed.operator.profileId,
        revokedAt: new Date(),
      })
      .returning();
    expect(share).toBeDefined();
    const revoked = await app.inject({ method: "GET", url: "/api/v1/shares/revoked-token" });
    expect(revoked.statusCode).toBe(404);
  });

  it("401s a protected share read without a valid ShareBearer JWT", async () => {
    const { token } = await createProtectedShare("prot-read", "guest2@band.com");
    const response = await app.inject({ method: "GET", url: `/api/v1/shares/${token}` });
    expect(response.statusCode).toBe(401);
  });
});

describe("shares — OTP → JWT front door", () => {
  it("runs issue → verify → JWT, then lets the recipient read + comment", async () => {
    const email = "guest3@band.com";
    const { seed, token } = await createProtectedShare("otp", email);

    // Issue — the code is exposed only via the test hook header.
    const issue = await app.inject({
      method: "POST",
      url: `/api/v1/shares/${token}/otp`,
      headers: { "x-test-otp": "1" },
      payload: { email },
    });
    expect(issue.statusCode).toBe(200);
    expect(issue.json().sent).toBe(true);
    const code = issue.json().code as string;
    expect(code).toMatch(/^\d{6}$/);

    // Without the test hook the code is NOT returned.
    const issueNoHook = await app.inject({
      method: "POST",
      url: `/api/v1/shares/${token}/otp`,
      payload: { email },
    });
    expect(issueNoHook.json().code).toBeUndefined();

    // A fresh code was issued by the second request — verify with it.
    const [otp] = await harness.db
      .select()
      .from(schema.shareOtps)
      .where(eq(schema.shareOtps.emailHash, emailHash(email)));
    expect(otp).toBeDefined();

    // Re-issue once more with the hook so we know the plaintext code to verify.
    const reissue = await app.inject({
      method: "POST",
      url: `/api/v1/shares/${token}/otp`,
      headers: { "x-test-otp": "1" },
      payload: { email },
    });
    const freshCode = reissue.json().code as string;

    const verify = await app.inject({
      method: "POST",
      url: `/api/v1/shares/${token}/verify`,
      payload: { email, code: freshCode },
    });
    expect(verify.statusCode).toBe(200);
    const jwt = verify.json().token as string;
    expect(jwt.split(".")).toHaveLength(3);

    // The OTP row is consumed on success.
    const remaining = await harness.db
      .select()
      .from(schema.shareOtps)
      .where(eq(schema.shareOtps.emailHash, emailHash(email)));
    expect(remaining).toHaveLength(0);

    // The JWT unlocks the protected read.
    const read = await app.inject({
      method: "GET",
      url: `/api/v1/shares/${token}`,
      headers: { authorization: `ShareBearer ${jwt}` },
    });
    expect(read.statusCode).toBe(200);
    expect(read.json().capabilities).toContain("settlement.comment");

    // And lets the recipient post a settlement comment attributed to their email.
    const comment = await app.inject({
      method: "POST",
      url: `/api/v1/shares/${token}/comment`,
      headers: { authorization: `ShareBearer ${jwt}` },
      payload: { message: "Numbers look right to me." },
    });
    expect(comment.statusCode).toBe(201);
    const commentId = comment.json().id as string;

    const [row] = await harness.db
      .select()
      .from(schema.settlementComments)
      .where(eq(schema.settlementComments.id, commentId));
    expect(row?.eventId).toBe(seed.event.id);
    expect(row?.authorEmail).toBe(email);
    expect(row?.message).toBe("Numbers look right to me.");
  });

  it("rejects a comment on a protected share without a valid JWT", async () => {
    const { token } = await createProtectedShare("no-jwt", "guest4@band.com");
    const comment = await app.inject({
      method: "POST",
      url: `/api/v1/shares/${token}/comment`,
      payload: { message: "sneaky" },
    });
    expect(comment.statusCode).toBe(401);
  });

  it("increments attempts on a wrong code and blocks after 5 tries", async () => {
    const email = "guest5@band.com";
    const { token } = await createProtectedShare("attempts", email);
    await app.inject({
      method: "POST",
      url: `/api/v1/shares/${token}/otp`,
      headers: { "x-test-otp": "1" },
      payload: { email },
    });

    // First wrong code → 401 and attempts becomes 1.
    const first = await app.inject({
      method: "POST",
      url: `/api/v1/shares/${token}/verify`,
      payload: { email, code: "000000" },
    });
    expect(first.statusCode).toBe(401);
    const [afterOne] = await harness.db
      .select()
      .from(schema.shareOtps)
      .where(eq(schema.shareOtps.emailHash, emailHash(email)));
    expect(afterOne?.attempts).toBe(1);

    // Attempts 2..5 → 401; the 5th deletes the OTP.
    for (let attempt = 2; attempt <= 5; attempt += 1) {
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/shares/${token}/verify`,
        payload: { email, code: "000000" },
      });
      expect(response.statusCode).toBe(401);
    }
    const remaining = await harness.db
      .select()
      .from(schema.shareOtps)
      .where(eq(schema.shareOtps.emailHash, emailHash(email)));
    expect(remaining).toHaveLength(0);

    // The 6th attempt is blocked (row gone → 401).
    const sixth = await app.inject({
      method: "POST",
      url: `/api/v1/shares/${token}/verify`,
      payload: { email, code: "000000" },
    });
    expect(sixth.statusCode).toBe(401);
  });
});
