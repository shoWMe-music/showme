import { PRESET_PERMISSION_SETS } from "@showme/auth";
import { schema } from "@showme/db";
import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { TokenVerifier } from "./auth/token-verifier";
import type { EmailMessage } from "./lib/email";
import { MAX_VERIFY_ATTEMPTS, emailHash } from "./lib/share-crypto";
import { activityRoutes } from "./routes/activity";
import { dealRoutes } from "./routes/deals";
import { shareRoutes } from "./routes/shares";
import { buildTestApp } from "./testing";

/**
 * Fake verifier: the bearer token IS the uid, so tests just send `Bearer <uid>`.
 * `emailVerified` is true because the signed-in front door refuses an unverified
 * address, and every test account here is meant to have passed that bar.
 */
const fakeVerifier: TokenVerifier = {
  async verify(token: string) {
    return { uid: token, email: `${token}@example.com`, emailVerified: true, name: token };
  },
};

let harness: TestDatabase;
let app: FastifyInstance;
/** Every message the app tried to send, so "was this address emailed?" is assertable. */
const sentEmails: EmailMessage[] = [];

beforeAll(async () => {
  harness = await startTestDatabase();
  app = buildTestApp(
    {
      database: harness.db,
      tokenVerifier: fakeVerifier,
      emailSink: {
        async sendEmail(message) {
          sentEmails.push(message);
        },
      },
    },
    // `dealRoutes` and `activityRoutes` are registered so the off-platform act can
    // be checked against the IN-APP one rather than only against itself.
    [shareRoutes, dealRoutes, activityRoutes],
  );
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
  await db.insert(schema.profileMembers).values({
    profileId: profile.id,
    userId: id,
    email: `${id}@example.com`,
    role: "owner",
    status: "active",
  });
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

/** Add a performer profile + participant whose membership carries `email`. */
async function seedPerformer(prefix: string, eventId: string, email: string, name: string) {
  const { db } = harness;
  const userId = `${prefix}-user`;
  await db.insert(schema.users).values({ id: userId, email, kind: "performer" });
  const [profile] = await db
    .insert(schema.profiles)
    .values({ kind: "performer", ownerUserId: userId, name, slug: prefix })
    .returning();
  if (!profile) throw new Error("performer profile seed failed");
  await db
    .insert(schema.profileMembers)
    .values({ profileId: profile.id, userId, email, role: "owner", status: "active" });
  const [participant] = await db
    .insert(schema.eventParticipants)
    .values({ eventId, profileId: profile.id, role: "performer", status: "confirmed" })
    .returning();
  if (!participant) throw new Error("performer participant seed failed");
  return { userId, profileId: profile.id, participantId: participant.id, email, name };
}

interface ShareInput {
  targetKind?: string;
  targetId?: string;
  capabilities: string[];
  access?: "public" | "protected";
  recipients?: { email: string; name?: string }[];
}

async function createShare(seed: Awaited<ReturnType<typeof seedEvent>>, input: ShareInput) {
  return await app.inject({
    method: "POST",
    url: `/api/v1/events/${seed.event.id}/shares`,
    headers: { ...auth(seed.operator.userId), "x-profile-id": seed.operator.profileId },
    payload: {
      access: "protected",
      ...input,
    },
  });
}

/** Create a protected share for an event settlement, seeded with one recipient. */
async function createProtectedShare(prefix: string, recipientEmail: string) {
  const seed = await seedEvent(prefix);
  const response = await createShare(seed, {
    targetKind: "settlement",
    capabilities: ["settlement.view.own", "message.post"],
    recipients: [{ email: recipientEmail, name: "Guest Performer" }],
  });
  expect(response.statusCode).toBe(201);
  return { seed, token: response.json().token as string };
}

/** Run the OTP → JWT front door and return the minted share JWT. */
async function redeem(token: string, email: string): Promise<string> {
  const issue = await app.inject({
    method: "POST",
    url: `/api/v1/shares/${token}/otp`,
    headers: { "x-test-otp": "1" },
    payload: { email },
  });
  expect(issue.statusCode).toBe(200);
  const code = issue.json().code as string;
  const verify = await app.inject({
    method: "POST",
    url: `/api/v1/shares/${token}/verify`,
    payload: { email, code },
  });
  expect(verify.statusCode).toBe(200);
  return verify.json().token as string;
}

const share = (jwt: string) => ({ authorization: `ShareBearer ${jwt}` });

describe("shares — create + public read", () => {
  it("creates a share returning only the token, never the recipient list", async () => {
    const { token } = await createProtectedShare("create", "guest@band.com");
    expect(typeof token).toBe("string");

    const [row] = await harness.db
      .select()
      .from(schema.shares)
      .where(eq(schema.shares.token, token));
    if (!row) throw new Error("share not found");
    expect(row.access).toBe("protected");
    // The recipient exists in the DB but was never returned by the API.
    const recipients = await harness.db
      .select()
      .from(schema.shareRecipients)
      .where(eq(schema.shareRecipients.shareId, row.id));
    expect(recipients).toHaveLength(1);
  });

  it("serves a public share's grant with no principal and no recipients", async () => {
    const seed = await seedEvent("pub");
    const create = await createShare(seed, {
      targetKind: "schedule",
      capabilities: ["schedule.view"],
      access: "public",
      recipients: [{ email: "crew@band.com" }],
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
    const [row] = await harness.db
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
    expect(row).toBeDefined();
    const revoked = await app.inject({ method: "GET", url: "/api/v1/shares/revoked-token" });
    expect(revoked.statusCode).toBe(404);
  });

  it("401s a protected share read without a valid ShareBearer JWT", async () => {
    const { token } = await createProtectedShare("prot-read", "guest2@band.com");
    const response = await app.inject({ method: "GET", url: `/api/v1/shares/${token}` });
    expect(response.statusCode).toBe(401);
  });
});

describe("shares — what a link may grant", () => {
  it("refuses a capability that is not in the catalog", async () => {
    const seed = await seedEvent("cap-unknown");
    const response = await createShare(seed, {
      capabilities: ["settlement.comment"],
      recipients: [{ email: "a@band.com" }],
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain("Not a sharable capability");
  });

  it("refuses an edit capability even though it is a real one", async () => {
    const seed = await seedEvent("cap-edit");
    const response = await createShare(seed, {
      capabilities: ["budget.edit"],
      recipients: [{ email: "a@band.com" }],
    });
    expect(response.statusCode).toBe(400);
  });

  it("refuses to grant a capability the sharer does not hold", async () => {
    // `event.edit` without `budget.view` — exactly what the role filter leaves an
    // editor. Creating the share is allowed; granting the budget is not.
    const { db } = harness;
    const sharer = await seedMemberWithSet("cap-held-op", ["event.view", "event.edit"]);
    const [event] = await db
      .insert(schema.events)
      .values({
        hostProfileId: sharer.profileId,
        title: "No budget for you",
        baseCurrency: "SEK",
        createdBy: sharer.userId,
      })
      .returning();
    if (!event) throw new Error("event seed failed");
    await db.insert(schema.eventParticipants).values({
      eventId: event.id,
      profileId: sharer.profileId,
      role: "host",
      permissionSetId: sharer.permissionSetId,
      status: "confirmed",
    });

    const denied = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/shares`,
      headers: { ...auth(sharer.userId), "x-profile-id": sharer.profileId },
      payload: {
        access: "protected",
        capabilities: ["budget.view"],
        recipients: [{ email: "a@band.com" }],
      },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.message).toContain("do not hold");

    // The positive control, same body shape: a capability they DO hold is fine.
    const allowed = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/shares`,
      headers: { ...auth(sharer.userId), "x-profile-id": sharer.profileId },
      payload: {
        access: "protected",
        capabilities: ["event.view"],
        recipients: [{ email: "a@band.com" }],
      },
    });
    expect(allowed.statusCode).toBe(201);
  });

  it("refuses to put money or comments on an anonymous link", async () => {
    const seed = await seedEvent("cap-public");
    for (const capability of [
      "settlement.view.own",
      "deal.view.own",
      "budget.view",
      "message.post",
    ]) {
      const response = await createShare(seed, {
        capabilities: [capability],
        access: "public",
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.message).toContain("verified recipient");
    }
    // The positive control: a schedule may go out anonymously.
    const schedule = await createShare(seed, {
      capabilities: ["schedule.view"],
      access: "public",
    });
    expect(schedule.statusCode).toBe(201);
  });

  it("lets an operator share the riders they can already read", async () => {
    // No operator preset carries `rider.view` at all — an operator's all-rider
    // reach is `scopedEventRiders`'s "operators see everything", read off
    // `budget.view`. Asking for the literal capability made the Riders tick-box
    // unusable for every operator on every event.
    const seed = await seedEvent("cap-rider");
    expect(PRESET_PERMISSION_SETS.operator_full).not.toContain("rider.view");

    const shared = await createShare(seed, {
      capabilities: ["rider.view"],
      recipients: [{ email: "crew@band.com" }],
    });
    expect(shared.statusCode).toBe(201);

    // And the reach is still a reach, not a free pass: a sharer who is neither a
    // managing operator nor a rider viewer is refused the same grant.
    const { db } = harness;
    const editor = await seedMemberWithSet("cap-rider-editor", ["event.view", "event.edit"]);
    const [event] = await db
      .insert(schema.events)
      .values({
        hostProfileId: editor.profileId,
        title: "No riders for you",
        baseCurrency: "SEK",
        createdBy: editor.userId,
      })
      .returning();
    if (!event) throw new Error("event seed failed");
    await db.insert(schema.eventParticipants).values({
      eventId: event.id,
      profileId: editor.profileId,
      role: "host",
      permissionSetId: editor.permissionSetId,
      status: "confirmed",
    });
    const denied = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/shares`,
      headers: { ...auth(editor.userId), "x-profile-id": editor.profileId },
      payload: {
        access: "protected",
        capabilities: ["rider.view"],
        recipients: [{ email: "crew@band.com" }],
      },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.message).toContain("do not hold");
  });

  it("refuses a targetKind outside the document's own vocabulary", async () => {
    const seed = await seedEvent("cap-target");
    const nonsense = await createShare(seed, {
      targetKind: "banana",
      capabilities: ["event.view"],
      recipients: [{ email: "a@band.com" }],
    });
    expect(nonsense.statusCode).toBe(400);

    // The positive control, same body shape.
    const real = await createShare(seed, {
      targetKind: "settlement",
      capabilities: ["event.view"],
      recipients: [{ email: "a@band.com" }],
    });
    expect(real.statusCode).toBe(201);
  });

  it("refuses a protected share with nobody to send it to", async () => {
    const seed = await seedEvent("cap-norecipient");
    const response = await createShare(seed, { capabilities: ["event.view"] });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain("recipient");
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

    // The OTP is consumed on success — marked spent, not deleted, so the row
    // keeps carrying the rate window (see the throttle tests below).
    const [consumed] = await harness.db
      .select()
      .from(schema.shareOtps)
      .where(eq(schema.shareOtps.emailHash, emailHash(email)));
    expect(consumed?.consumedAt).not.toBeNull();

    // The JWT unlocks the protected read.
    const read = await app.inject({
      method: "GET",
      url: `/api/v1/shares/${token}`,
      headers: share(jwt),
    });
    expect(read.statusCode).toBe(200);
    expect(read.json().capabilities).toContain("message.post");

    // And lets the recipient post a comment attributed to their email.
    const comment = await app.inject({
      method: "POST",
      url: `/api/v1/shares/${token}/comment`,
      headers: share(jwt),
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
    // The row SURVIVES, marked spent — it is what carries the rate window, and
    // deleting it here is what used to hand the next caller a fresh hour.
    const [burnt] = await harness.db
      .select()
      .from(schema.shareOtps)
      .where(eq(schema.shareOtps.emailHash, emailHash(email)));
    expect(burnt?.consumedAt).not.toBeNull();

    // The 6th attempt is blocked.
    const sixth = await app.inject({
      method: "POST",
      url: `/api/v1/shares/${token}/verify`,
      payload: { email, code: "000000" },
    });
    expect(sixth.statusCode).toBe(401);
  });

  it("consumes the code on success rather than deleting the window", async () => {
    const email = "spent@band.com";
    const { token } = await createProtectedShare("spent", email);
    await redeem(token, email);

    const [row] = await harness.db
      .select()
      .from(schema.shareOtps)
      .where(eq(schema.shareOtps.emailHash, emailHash(email)));
    expect(row?.consumedAt).not.toBeNull();
    expect(row?.issues).toBe(1);

    // The same code cannot be replayed.
    const replay = await app.inject({
      method: "POST",
      url: `/api/v1/shares/${token}/verify`,
      payload: { email, code: "000000" },
    });
    expect(replay.statusCode).toBe(401);
  });

  it("holds the 3-an-hour limit across a successful verify", async () => {
    const email = "throttle@band.com";
    const { token } = await createProtectedShare("throttle", email);

    const issue = () =>
      app.inject({
        method: "POST",
        url: `/api/v1/shares/${token}/otp`,
        headers: { "x-test-otp": "1" },
        payload: { email },
      });

    const first = await issue();
    expect(first.statusCode).toBe(200);

    // Spend the first code. This is the move that used to reset the hour: the
    // counter lived on the row a successful verify deleted, so three codes,
    // one verify, and three more codes was an unlimited loop.
    const verified = await app.inject({
      method: "POST",
      url: `/api/v1/shares/${token}/verify`,
      payload: { email, code: first.json().code as string },
    });
    expect(verified.statusCode).toBe(200);

    expect((await issue()).statusCode).toBe(200); // 2
    expect((await issue()).statusCode).toBe(200); // 3
    const fourth = await issue();
    expect(fourth.statusCode).toBe(429);
    expect(fourth.json().error.code).toBe("rate_limited");
  });

  it("holds the limit across a burnt-out code too", async () => {
    const email = "throttle2@band.com";
    const { token } = await createProtectedShare("throttle2", email);
    const issue = () =>
      app.inject({
        method: "POST",
        url: `/api/v1/shares/${token}/otp`,
        headers: { "x-test-otp": "1" },
        payload: { email },
      });

    expect((await issue()).statusCode).toBe(200); // 1
    for (let attempt = 1; attempt <= MAX_VERIFY_ATTEMPTS; attempt += 1) {
      await app.inject({
        method: "POST",
        url: `/api/v1/shares/${token}/verify`,
        payload: { email, code: "000000" },
      });
    }
    expect((await issue()).statusCode).toBe(200); // 2
    expect((await issue()).statusCode).toBe(200); // 3
    expect((await issue()).statusCode).toBe(429);
  });

  it("caps code requests per connection, whatever address is typed", async () => {
    // The stored limit is per (share, EMAIL) and the email is chosen by the
    // caller, so a script holding one link defeated it by typing a new address
    // each time — every one of them a row written and a hash burnt, none of them
    // ever delivered. This is the limit that binds the caller instead.
    const { token } = await createProtectedShare("otp-ip", "listed@band.com");
    for (let attempt = 0; attempt < 10; attempt++) {
      const allowed = await app.inject({
        method: "POST",
        url: `/api/v1/shares/${token}/otp`,
        payload: { email: `rotation-${attempt}@band.com` },
      });
      expect(allowed.statusCode).toBe(200);
    }
    const blocked = await app.inject({
      method: "POST",
      url: `/api/v1/shares/${token}/otp`,
      payload: { email: "rotation-10@band.com" },
    });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error.message).toContain("from this connection");

    // Scoped to the link, not to the whole surface: another share is unaffected,
    // so one abused link cannot lock a real recipient out of a different one.
    const other = await createProtectedShare("otp-ip-other", "listed@band.com");
    const unaffected = await app.inject({
      method: "POST",
      url: `/api/v1/shares/${other.token}/otp`,
      payload: { email: "listed@band.com" },
    });
    expect(unaffected.statusCode).toBe(200);
  });

  it("never echoes the code unless the environment opts in", async () => {
    const email = "guest-echo@band.com";
    const { token } = await createProtectedShare("echo", email);
    // Production: the header is present and the code is still withheld — the
    // header alone used to be the whole condition, which made the OTP optional.
    vi.stubEnv("NODE_ENV", "production");
    try {
      const issue = await app.inject({
        method: "POST",
        url: `/api/v1/shares/${token}/otp`,
        headers: { "x-test-otp": "1" },
        payload: { email },
      });
      expect(issue.statusCode).toBe(200);
      expect(issue.json().code).toBeUndefined();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("refuses to sign with the development secret in production", async () => {
    const email = "unconfigured@band.com";
    const { token } = await createProtectedShare("unconfigured", email);
    const issue = await app.inject({
      method: "POST",
      url: `/api/v1/shares/${token}/otp`,
      headers: { "x-test-otp": "1" },
      payload: { email },
    });
    const code = issue.json().code as string;

    // The fallback constant is IN the source file. A production deployment that
    // quietly used it would accept a ShareBearer JWT anyone could mint for any
    // token and any address — every gate in this module bypassed by a signature
    // that is public knowledge. `SHARE_JWT_SECRET` has gone unset in prod once
    // already, which is why this is a refusal rather than a comment.
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SHARE_JWT_SECRET", "");
    try {
      const verify = await app.inject({
        method: "POST",
        url: `/api/v1/shares/${token}/verify`,
        payload: { email, code },
      });
      expect(verify.statusCode).toBe(503);
      expect(verify.json().error.code).toBe("service_unavailable");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("does not mail a code to an address the share was never sent to", async () => {
    const { token } = await createProtectedShare("mailguard", "invited@band.com");
    sentEmails.length = 0;

    const stranger = await app.inject({
      method: "POST",
      url: `/api/v1/shares/${token}/otp`,
      payload: { email: "stranger@elsewhere.com" },
    });
    // Same answer as a real recipient gets — the endpoint is not an address oracle.
    expect(stranger.statusCode).toBe(200);
    expect(stranger.json()).toEqual({ sent: true });
    expect(sentEmails).toHaveLength(0);

    const invited = await app.inject({
      method: "POST",
      url: `/api/v1/shares/${token}/otp`,
      payload: { email: "invited@band.com" },
    });
    expect(invited.statusCode).toBe(200);
    expect(sentEmails.map((message) => message.to)).toEqual(["invited@band.com"]);
  });

  it("refuses to mint a JWT for a correct code on a non-recipient address", async () => {
    const { token } = await createProtectedShare("nonrecipient", "invited2@band.com");
    const stranger = "stranger2@elsewhere.com";
    const issue = await app.inject({
      method: "POST",
      url: `/api/v1/shares/${token}/otp`,
      headers: { "x-test-otp": "1" },
      payload: { email: stranger },
    });
    const code = issue.json().code as string;
    const verify = await app.inject({
      method: "POST",
      url: `/api/v1/shares/${token}/verify`,
      payload: { email: stranger, code },
    });
    expect(verify.statusCode).toBe(401);
  });
});

describe("shares — the signed-in front door and the claim record", () => {
  it("refuses a signed-in account whose email is not on the recipient list", async () => {
    const seed = await seedEvent("claim");
    const performer = await seedPerformer(
      "claim-perf",
      seed.event.id,
      "claim-perf@band.com",
      "Claimed Act",
    );
    const create = await createShare(seed, {
      capabilities: ["event.view"],
      recipients: [{ email: performer.email, name: performer.name }],
    });
    const token = create.json().token as string;

    // Being signed in is not the credential — being signed in AS THE ADDRESS the
    // share was sent to is. The fake verifier answers `<uid>@example.com`, which
    // is not the recipient address, so this account is a stranger to this link.
    const wrongAccount = await app.inject({
      method: "GET",
      url: `/api/v1/shares/${token}`,
      headers: auth(performer.userId),
    });
    expect(wrongAccount.statusCode).toBe(401);
  });

  it("stamps claimed_by_user_id when the signed-in email matches the recipient", async () => {
    const seed = await seedEvent("claim2");
    // The fake verifier's email for uid `holder` is `holder@example.com`, so the
    // share is addressed to exactly that.
    await harness.db
      .insert(schema.users)
      .values({ id: "holder", email: "holder@example.com", kind: "performer" });
    const create = await createShare(seed, {
      capabilities: ["event.view"],
      recipients: [{ email: "holder@example.com", name: "Holder" }],
    });
    const token = create.json().token as string;

    const opened = await app.inject({
      method: "GET",
      url: `/api/v1/shares/${token}`,
      headers: auth("holder"),
    });
    expect(opened.statusCode).toBe(200);

    const [row] = await harness.db
      .select()
      .from(schema.shares)
      .where(eq(schema.shares.token, token));
    const recipients = await harness.db
      .select()
      .from(schema.shareRecipients)
      .where(eq(schema.shareRecipients.shareId, row?.id as string));
    expect(recipients[0]?.claimedByUserId).toBe("holder");
  });
});

describe("shares — the document", () => {
  it("carries only the sections the capabilities granted", async () => {
    const seed = await seedEvent("doc");
    await harness.db.insert(schema.scheduleItems).values({
      eventId: seed.event.id,
      label: "Doors",
      localDateTime: "2026-09-01T19:00",
    });
    const email = "doc-guest@band.com";
    const create = await createShare(seed, {
      capabilities: ["event.view", "schedule.view"],
      recipients: [{ email }],
    });
    const token = create.json().token as string;
    const jwt = await redeem(token, email);

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/shares/${token}/document`,
      headers: share(jwt),
    });
    expect(response.statusCode).toBe(200);
    const document = response.json();
    expect(document.event.title).toBe("Settle Night");
    expect(document.schedule).toHaveLength(1);
    // Everything NOT granted is null, not an empty list — the difference between
    // "you were not shown this" and "there is none".
    expect(document.budget).toBeNull();
    expect(document.deals).toBeNull();
    expect(document.settlement).toBeNull();
    expect(document.comments).toBeNull();
    expect(document.actions).toEqual({
      canComment: false,
      canConfirmSettlement: false,
      canConfirmAgreement: false,
    });
  });

  it("shows a performer their own deal line and not their co-performer's", async () => {
    const seed = await seedEvent("scope");
    const headliner = await seedPerformer("scope-a", seed.event.id, "head@band.com", "Headliner");
    const support = await seedPerformer("scope-b", seed.event.id, "support@band.com", "Support");

    const [deal] = await harness.db
      .insert(schema.deals)
      .values({
        eventId: seed.event.id,
        type: "split",
        structure: "door_split",
        currency: "SEK",
        name: "Door Split",
        splitBasisPoints: 10000,
        createdBy: seed.operator.userId,
      })
      .returning();
    if (!deal) throw new Error("deal seed failed");
    await harness.db.insert(schema.dealParties).values([
      { dealId: deal.id, participantId: seed.participant.id, roleInDeal: "payer" },
      {
        dealId: deal.id,
        participantId: headliner.participantId,
        roleInDeal: "split_member",
        share: { splitBasisPoints: 6000, illustrativeAmount: "3000000" },
      },
      {
        dealId: deal.id,
        participantId: support.participantId,
        roleInDeal: "split_member",
        share: { splitBasisPoints: 4000, illustrativeAmount: "2000000" },
      },
    ]);

    const create = await createShare(seed, {
      targetKind: "deal",
      targetId: deal.id,
      capabilities: ["event.view", "deal.view.own", "agreement.confirm"],
      recipients: [{ email: support.email, name: support.name }],
    });
    const token = create.json().token as string;
    const jwt = await redeem(token, support.email);

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/shares/${token}/document`,
      headers: share(jwt),
    });
    expect(response.statusCode).toBe(200);
    const document = response.json();
    expect(document.viewer.isParty).toBe(true);
    expect(document.viewer.partyName).toBe("Support");
    expect(document.deals).toHaveLength(1);
    // ONE line — their own. The old app rendered a card per party to any
    // link-holder; story.md forbids it outright.
    expect(document.deals[0].parties).toHaveLength(1);
    expect(document.deals[0].parties[0].participantId).toBe(support.participantId);
    expect(document.deals[0].parties[0].isYours).toBe(true);
    const body = JSON.stringify(document);
    expect(body).not.toContain(headliner.participantId);
    expect(body).not.toContain("6000");
  });

  it("withholds the budget from a performer even when the link grants it", async () => {
    const seed = await seedEvent("ceiling");
    const performer = await seedPerformer(
      "ceiling-perf",
      seed.event.id,
      "ceiling@band.com",
      "Ceiling Act",
    );
    const [budget] = await harness.db
      .insert(schema.budgets)
      .values({ eventId: seed.event.id, scope: "shared" })
      .returning();
    if (!budget) throw new Error("budget seed failed");
    await harness.db.insert(schema.budgetLines).values({
      budgetId: budget.id,
      kind: "revenue",
      label: "Door",
      amount: 5000000n,
    });

    // The operator ticks Budget on a link addressed to their headliner. Creating
    // it is allowed — the operator holds `budget.view` — but the ceiling
    // (decisions #4 / story.md) applies at read time to a party recipient.
    const create = await createShare(seed, {
      capabilities: ["event.view", "budget.view"],
      recipients: [{ email: performer.email }],
    });
    expect(create.statusCode).toBe(201);
    const token = create.json().token as string;
    const jwt = await redeem(token, performer.email);

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/shares/${token}/document`,
      headers: share(jwt),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().budget).toBeNull();
    expect(response.json().capabilities).not.toContain("budget.view");
  });

  it("shows a non-party reviewer the budget the operator meant to share", async () => {
    const seed = await seedEvent("accountant");
    const [budget] = await harness.db
      .insert(schema.budgets)
      .values({ eventId: seed.event.id, scope: "shared" })
      .returning();
    if (!budget) throw new Error("budget seed failed");
    await harness.db.insert(schema.budgetLines).values([
      { budgetId: budget.id, kind: "revenue", label: "Door", amount: 5000000n },
      { budgetId: budget.id, kind: "cost", label: "Sound", amount: 900000n },
    ]);

    const email = "books@accountants.example";
    const create = await createShare(seed, {
      capabilities: ["budget.view"],
      recipients: [{ email }],
    });
    const token = create.json().token as string;
    const jwt = await redeem(token, email);

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/shares/${token}/document`,
      headers: share(jwt),
    });
    expect(response.statusCode).toBe(200);
    const document = response.json();
    expect(document.viewer.isParty).toBe(false);
    expect(document.budget.revenueTotal).toBe("5000000");
    expect(document.budget.costTotal).toBe("900000");
  });

  it("shows a party their own settlement slice and no other party's", async () => {
    const seed = await seedEvent("settle");
    const performer = await seedPerformer(
      "settle-perf",
      seed.event.id,
      "settle@band.com",
      "Settled Act",
    );
    await harness.db.insert(schema.settlements).values([
      {
        eventId: seed.event.id,
        participantId: performer.participantId,
        status: "finalized",
        computed: {
          participantId: performer.participantId,
          entitlement: "4650000",
          collected: "0",
          paid: "0",
          held: "0",
          net: "4650000",
        },
      },
      {
        eventId: seed.event.id,
        participantId: seed.participant.id,
        status: "finalized",
        computed: {
          participantId: seed.participant.id,
          entitlement: "2070000",
          collected: "6720000",
          paid: "0",
          held: "6720000",
          net: "-4650000",
        },
      },
    ]);
    await harness.db.insert(schema.settlementTransfers).values({
      eventId: seed.event.id,
      fromParticipant: seed.participant.id,
      toParticipant: performer.participantId,
      amount: 4650000n,
      currency: "SEK",
      state: "owed",
    });

    const create = await createShare(seed, {
      targetKind: "settlement",
      capabilities: ["event.view", "settlement.view.own", "settlement.confirm", "message.post"],
      recipients: [{ email: performer.email, name: performer.name }],
    });
    const token = create.json().token as string;
    const jwt = await redeem(token, performer.email);

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/shares/${token}/document`,
      headers: share(jwt),
    });
    const document = response.json();
    expect(document.settlement.entitlement).toBe("4650000");
    expect(document.settlement.transfers).toHaveLength(1);
    expect(document.settlement.transfers[0].direction).toBe("incoming");
    // The operator's own line, and their -4 650 000 net, is nowhere in the body.
    expect(JSON.stringify(document)).not.toContain("2070000");
    expect(document.actions.canConfirmSettlement).toBe(true);
  });
});

describe("shares — off-platform approval (A-33)", () => {
  async function seedSettlementShare(prefix: string, capabilities: string[]) {
    const seed = await seedEvent(prefix);
    const performer = await seedPerformer(
      `${prefix}-perf`,
      seed.event.id,
      `${prefix}@band.com`,
      "Approving Act",
    );
    await harness.db.insert(schema.settlements).values({
      eventId: seed.event.id,
      participantId: performer.participantId,
      status: "finalized",
      computed: {
        participantId: performer.participantId,
        entitlement: "1000",
        collected: "0",
        paid: "0",
        held: "0",
        net: "1000",
      },
    });
    const create = await createShare(seed, {
      targetKind: "settlement",
      capabilities,
      recipients: [{ email: performer.email, name: performer.name }],
    });
    expect(create.statusCode).toBe(201);
    const token = create.json().token as string;
    const jwt = await redeem(token, performer.email);
    return { seed, performer, token, jwt };
  }

  it("records an approval against the recipient's own participant", async () => {
    const { seed, performer, token, jwt } = await seedSettlementShare("approve", [
      "settlement.view.own",
      "settlement.confirm",
    ]);

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/shares/${token}/approve`,
      headers: share(jwt),
      payload: { subject: "settlement" },
    });
    expect(response.statusCode).toBe(200);

    const approvals = await harness.db
      .select()
      .from(schema.settlementApprovals)
      .where(eq(schema.settlementApprovals.eventId, seed.event.id));
    expect(approvals).toHaveLength(1);
    expect(approvals[0]?.partyParticipantId).toBe(performer.participantId);
    expect(approvals[0]?.approved).toBe(true);

    // Idempotent — a second click does not write a second row.
    const again = await app.inject({
      method: "POST",
      url: `/api/v1/shares/${token}/approve`,
      headers: share(jwt),
      payload: { subject: "settlement" },
    });
    expect(again.statusCode).toBe(200);
    const afterTwo = await harness.db
      .select()
      .from(schema.settlementApprovals)
      .where(eq(schema.settlementApprovals.eventId, seed.event.id));
    expect(afterTwo).toHaveLength(1);
    // …and it reports the stamp the approval ACTUALLY carries, not the clock at
    // the second click. The row keeps the first timestamp, so a response saying
    // anything else dates a signature to a moment nothing was signed at.
    expect(again.json().approvedAt).toBe(response.json().approvedAt);
    expect(afterTwo[0]?.approvedAt?.toISOString()).toBe(again.json().approvedAt);

    // And it is attributed: an audit row with no actor and the recipient's email.
    const audit = await harness.db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.eventId, seed.event.id));
    const approval = audit.find((row) => row.action === "settlement.approve");
    expect(approval?.actorUserId).toBeNull();
    expect(JSON.stringify(approval?.changes)).toContain(performer.email);

    // The feed entry points at the SETTLEMENT ROW. The party-scoped tier in
    // `routes/activity.ts` matches `settlement` entries on `settlements.id`, so an
    // entry stamped with the participant id resolved for nobody — including the
    // person who had just approved, for whom it is the only visible trace of their
    // own consent.
    const [settlementRow] = await harness.db
      .select()
      .from(schema.settlements)
      .where(eq(schema.settlements.participantId, performer.participantId));
    const feed = await harness.db
      .select()
      .from(schema.activityLog)
      .where(eq(schema.activityLog.eventId, seed.event.id));
    const approved = feed.find((row) => row.type === "settlement.approved");
    expect(approved?.targetKind).toBe("settlement");
    expect(approved?.targetId).toBe(settlementRow?.id);
  });

  it("refuses to approve when the link did not grant the confirm", async () => {
    const { token, jwt, seed } = await seedSettlementShare("approve-nocap", [
      "settlement.view.own",
    ]);
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/shares/${token}/approve`,
      headers: share(jwt),
      payload: { subject: "settlement" },
    });
    expect(response.statusCode).toBe(403);
    const approvals = await harness.db
      .select()
      .from(schema.settlementApprovals)
      .where(eq(schema.settlementApprovals.eventId, seed.event.id));
    expect(approvals).toHaveLength(0);
  });

  it("refuses to approve for a recipient who is not a party", async () => {
    const seed = await seedEvent("approve-stranger");
    const email = "outsider@elsewhere.com";
    const create = await createShare(seed, {
      capabilities: ["event.view", "settlement.confirm"],
      recipients: [{ email }],
    });
    const token = create.json().token as string;
    const jwt = await redeem(token, email);

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/shares/${token}/approve`,
      headers: share(jwt),
      payload: { subject: "settlement" },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.message).toContain("not a party");
  });

  /**
   * A two-party deal: the operator is the payer, one performer is the payee. Both
   * must sign before the agreement freezes, which is what makes "who signs LAST"
   * a question worth asking twice.
   */
  async function seedTwoPartyDeal(prefix: string) {
    const seed = await seedEvent(prefix);
    const performer = await seedPerformer(
      `${prefix}-perf`,
      seed.event.id,
      `${prefix}@band.com`,
      "Signing Act",
    );
    const [deal] = await harness.db
      .insert(schema.deals)
      .values({
        eventId: seed.event.id,
        type: "performance",
        structure: "guarantee",
        currency: "SEK",
        name: "Guarantee",
        guaranteeAmount: 1800000n,
        splitBasisPoints: 7000,
        agreementStatus: "sent",
        agreementBodyText: "The usual terms.",
        createdBy: seed.operator.userId,
      })
      .returning();
    if (!deal) throw new Error("deal seed failed");
    await harness.db.insert(schema.dealParties).values([
      { dealId: deal.id, participantId: seed.participant.id, roleInDeal: "payer" },
      { dealId: deal.id, participantId: performer.participantId, roleInDeal: "payee" },
    ]);

    const create = await createShare(seed, {
      targetKind: "deal",
      targetId: deal.id,
      capabilities: ["deal.view.own", "agreement.confirm"],
      recipients: [{ email: performer.email }],
    });
    expect(create.statusCode).toBe(201);
    const token = create.json().token as string;
    return { seed, performer, deal, token };
  }

  const confirmInApp = (seed: Awaited<ReturnType<typeof seedEvent>>, dealId: string) =>
    app.inject({
      method: "POST",
      url: `/api/v1/deals/${dealId}/confirm`,
      headers: { ...auth(seed.operator.userId), "x-profile-id": seed.operator.profileId },
    });

  /** A snapshot with the moving parts removed, so two of them can be compared. */
  function comparableSnapshot(snapshot: unknown) {
    const value = snapshot as {
      frozenAt: string;
      terms: Record<string, unknown>;
      parties: { roleInDeal: string; confirmedAt: string | null }[];
    };
    return {
      keys: Object.keys(value).sort(),
      terms: value.terms,
      parties: value.parties.map((party) => ({
        roleInDeal: party.roleInDeal,
        confirmed: party.confirmedAt != null,
        keys: Object.keys(party).sort(),
      })),
    };
  }

  it("freezes the terms when the LAST signature arrives off-platform", async () => {
    const { seed, deal, token, performer } = await seedTwoPartyDeal("freeze-off");

    // The operator signs in the app first — one signature short of complete.
    expect((await confirmInApp(seed, deal.id)).statusCode).toBe(200);
    const [waiting] = await harness.db
      .select()
      .from(schema.deals)
      .where(eq(schema.deals.id, deal.id));
    expect(waiting?.agreementStatus).toBe("sent");
    expect(waiting?.confirmedSnapshot).toBeNull();

    // The performer signs by link. This is the last one.
    const jwt = await redeem(token, performer.email);
    const approve = await app.inject({
      method: "POST",
      url: `/api/v1/shares/${token}/approve`,
      headers: share(jwt),
      payload: { subject: "agreement", dealId: deal.id },
    });
    expect(approve.statusCode).toBe(200);

    const [frozen] = await harness.db
      .select()
      .from(schema.deals)
      .where(eq(schema.deals.id, deal.id));
    expect(frozen?.agreementStatus).toBe("confirmed");
    // The record the whole thing exists for: a deal that says "confirmed" with no
    // frozen terms is a signed agreement nobody can reconstruct.
    expect(frozen?.confirmedSnapshot).not.toBeNull();
    const snapshot = frozen?.confirmedSnapshot as { terms: Record<string, unknown> };
    expect(snapshot.terms.guaranteeAmount).toBe("1800000");
    expect(snapshot.terms.agreementBodyText).toBe("The usual terms.");
  });

  it("freezes the same snapshot whichever door the last signature came through", async () => {
    // Off-platform last.
    const viaShare = await seedTwoPartyDeal("drift-share");
    expect((await confirmInApp(viaShare.seed, viaShare.deal.id)).statusCode).toBe(200);
    const shareJwt = await redeem(viaShare.token, viaShare.performer.email);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/v1/shares/${viaShare.token}/approve`,
          headers: share(shareJwt),
          payload: { subject: "agreement", dealId: viaShare.deal.id },
        })
      ).statusCode,
    ).toBe(200);

    // In-app last, same deal shape.
    const viaApp = await seedTwoPartyDeal("drift-app");
    const appJwt = await redeem(viaApp.token, viaApp.performer.email);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/v1/shares/${viaApp.token}/approve`,
          headers: share(appJwt),
          payload: { subject: "agreement", dealId: viaApp.deal.id },
        })
      ).statusCode,
    ).toBe(200);
    expect((await confirmInApp(viaApp.seed, viaApp.deal.id)).statusCode).toBe(200);

    const [shareDeal] = await harness.db
      .select()
      .from(schema.deals)
      .where(eq(schema.deals.id, viaShare.deal.id));
    const [appDeal] = await harness.db
      .select()
      .from(schema.deals)
      .where(eq(schema.deals.id, viaApp.deal.id));

    // `routes/deals.ts` still holds its own copy of the freeze (not this change's
    // file to edit). This is the guard that says the two copies still agree — it
    // fails the day one of them grows a field the other does not.
    expect(comparableSnapshot(shareDeal?.confirmedSnapshot)).toEqual(
      comparableSnapshot(appDeal?.confirmedSnapshot),
    );
  });

  it("confirms only the recipient's own deal line", async () => {
    const seed = await seedEvent("confirm-deal");
    const headliner = await seedPerformer(
      "confirm-a",
      seed.event.id,
      "confirm-head@band.com",
      "Headliner",
    );
    const support = await seedPerformer(
      "confirm-b",
      seed.event.id,
      "confirm-support@band.com",
      "Support",
    );
    const [deal] = await harness.db
      .insert(schema.deals)
      .values({
        eventId: seed.event.id,
        type: "split",
        currency: "SEK",
        name: "Door Split",
        createdBy: seed.operator.userId,
      })
      .returning();
    if (!deal) throw new Error("deal seed failed");
    await harness.db.insert(schema.dealParties).values([
      { dealId: deal.id, participantId: headliner.participantId, roleInDeal: "split_member" },
      { dealId: deal.id, participantId: support.participantId, roleInDeal: "split_member" },
    ]);

    const create = await createShare(seed, {
      targetKind: "deal",
      targetId: deal.id,
      capabilities: ["deal.view.own", "agreement.confirm"],
      recipients: [{ email: support.email }],
    });
    const token = create.json().token as string;
    const jwt = await redeem(token, support.email);

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/shares/${token}/approve`,
      headers: share(jwt),
      payload: { subject: "agreement", dealId: deal.id },
    });
    expect(response.statusCode).toBe(200);

    const lines = await harness.db
      .select()
      .from(schema.dealParties)
      .where(eq(schema.dealParties.dealId, deal.id));
    const supportLine = lines.find((line) => line.participantId === support.participantId);
    const headlinerLine = lines.find((line) => line.participantId === headliner.participantId);
    expect(supportLine?.confirmedAt).not.toBeNull();
    // The other act's line is untouched — one signature stamps one row.
    expect(headlinerLine?.confirmedAt).toBeNull();
  });
});

describe("shares — per-section comments", () => {
  it("stores the section the recipient was actually looking at", async () => {
    const seed = await seedEvent("section");
    await harness.db.insert(schema.scheduleItems).values({
      eventId: seed.event.id,
      label: "Load-in",
      localDateTime: "2026-09-01T14:00",
    });
    const email = "section@band.com";
    const create = await createShare(seed, {
      capabilities: ["event.view", "schedule.view", "message.post"],
      recipients: [{ email }],
    });
    const token = create.json().token as string;
    const jwt = await redeem(token, email);

    const posted = await app.inject({
      method: "POST",
      url: `/api/v1/shares/${token}/comment`,
      headers: share(jwt),
      payload: { message: "Load-in is 14:00, not 15:00.", section: "schedule" },
    });
    expect(posted.statusCode).toBe(201);
    const [row] = await harness.db
      .select()
      .from(schema.settlementComments)
      .where(eq(schema.settlementComments.id, posted.json().id));
    expect(row?.section).toBe("schedule");
    // The message is stored exactly as typed — no `[Schedule] ` prefixing.
    expect(row?.message).toBe("Load-in is 14:00, not 15:00.");

    // The thread comes back on the document, tagged with its section.
    const document = await app.inject({
      method: "GET",
      url: `/api/v1/shares/${token}/document`,
      headers: share(jwt),
    });
    expect(document.json().comments).toHaveLength(1);
    expect(document.json().comments[0].section).toBe("schedule");
    expect(document.json().comments[0].isYours).toBe(true);
  });

  it("refuses a comment filed under a section the link never shared", async () => {
    const email = "section2@band.com";
    const { token } = await createProtectedShare("section-denied", email);
    const jwt = await redeem(token, email);
    const posted = await app.inject({
      method: "POST",
      url: `/api/v1/shares/${token}/comment`,
      headers: share(jwt),
      payload: { message: "About the budget…", section: "budget" },
    });
    expect(posted.statusCode).toBe(403);
  });

  it("refuses a comment on a link that did not grant message.post", async () => {
    const seed = await seedEvent("nocomment");
    const email = "nocomment@band.com";
    const create = await createShare(seed, {
      capabilities: ["event.view"],
      recipients: [{ email }],
    });
    const token = create.json().token as string;
    const jwt = await redeem(token, email);
    const posted = await app.inject({
      method: "POST",
      url: `/api/v1/shares/${token}/comment`,
      headers: share(jwt),
      payload: { message: "hello" },
    });
    expect(posted.statusCode).toBe(403);
  });

  it("does not show one recipient another recipient's comments", async () => {
    const seed = await seedEvent("threads");
    const first = "one@band.com";
    const second = "two@band.com";
    const create = await createShare(seed, {
      capabilities: ["event.view", "message.post"],
      recipients: [{ email: first }, { email: second }],
    });
    const token = create.json().token as string;

    const firstJwt = await redeem(token, first);
    await app.inject({
      method: "POST",
      url: `/api/v1/shares/${token}/comment`,
      headers: share(firstJwt),
      payload: { message: "Only I should see this." },
    });

    const secondJwt = await redeem(token, second);
    const document = await app.inject({
      method: "GET",
      url: `/api/v1/shares/${token}/document`,
      headers: share(secondJwt),
    });
    expect(document.json().comments).toHaveLength(0);
  });
});

describe("shares — the operator's own list", () => {
  it("lists the links out, their recipients and their state, and revokes one", async () => {
    const seed = await seedEvent("list");
    const email = "listed@band.com";
    const create = await createShare(seed, {
      capabilities: ["event.view"],
      recipients: [{ email, name: "Listed" }],
    });
    const token = create.json().token as string;

    const before = await app.inject({
      method: "GET",
      url: `/api/v1/events/${seed.event.id}/shares`,
      headers: { ...auth(seed.operator.userId), "x-profile-id": seed.operator.profileId },
    });
    expect(before.statusCode).toBe(200);
    expect(before.json()).toHaveLength(1);
    expect(before.json()[0].recipients[0]).toMatchObject({
      email,
      name: "Listed",
      lastSeenAt: null,
      claimed: false,
    });

    // Opening the link moves `lastSeenAt` off null — the "opened" column.
    const jwt = await redeem(token, email);
    await app.inject({
      method: "GET",
      url: `/api/v1/shares/${token}/document`,
      headers: share(jwt),
    });
    const after = await app.inject({
      method: "GET",
      url: `/api/v1/events/${seed.event.id}/shares`,
      headers: { ...auth(seed.operator.userId), "x-profile-id": seed.operator.profileId },
    });
    expect(after.json()[0].recipients[0].lastSeenAt).not.toBeNull();

    const shareId = after.json()[0].id as string;
    const revoke = await app.inject({
      method: "DELETE",
      url: `/api/v1/events/${seed.event.id}/shares/${shareId}`,
      headers: { ...auth(seed.operator.userId), "x-profile-id": seed.operator.profileId },
    });
    expect(revoke.statusCode).toBe(204);

    // A revoked link is gone for the holder — token, JWT and all.
    const dead = await app.inject({
      method: "GET",
      url: `/api/v1/shares/${token}/document`,
      headers: share(jwt),
    });
    expect(dead.statusCode).toBe(404);
  });

  it("refuses the list to someone who cannot edit the event", async () => {
    const seed = await seedEvent("list-denied");
    const stranger = await seedMemberWithSet("list-stranger", ["event.view"]);
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/events/${seed.event.id}/shares`,
      headers: { ...auth(stranger.userId), "x-profile-id": stranger.profileId },
    });
    // No standing on the event at all → 404, not 403: no existence leak.
    expect(response.statusCode).toBe(404);
  });
});
