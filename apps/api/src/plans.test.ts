import { schema } from "@showme/db";
import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TokenVerifier } from "./auth/token-verifier";
import { COLLABORATION_INVITE_CREDITS } from "./lib/entitlements";
import { planRoutes } from "./routes/plans";
import { buildTestApp } from "./testing";

/** Fake verifier: the bearer token IS the uid (mirrors app.test.ts). */
const fakeVerifier: TokenVerifier = {
  async verify(token: string) {
    return { uid: token, email: `${token}@example.showme.test`, name: token };
  },
};

let harness: TestDatabase;
let app: FastifyInstance;

beforeAll(async () => {
  harness = await startTestDatabase();
  app = buildTestApp({ database: harness.db, tokenVerifier: fakeVerifier }, [planRoutes]);
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await harness?.stop();
});

const auth = (uid: string) => ({ authorization: `Bearer ${uid}` });

let seq = 0;
/** Seed a user + owned profile + owner membership (the caller can act on it). */
async function seedOwnedProfile(kind: "operator" | "performer") {
  const { db } = harness;
  const id = `plan-${kind}-${seq++}`;
  await db.insert(schema.users).values({ id, email: `${id}@example.showme.test`, kind });
  const [profile] = await db
    .insert(schema.profiles)
    .values({ kind, ownerUserId: id, name: id, slug: id })
    .returning();
  if (!profile) throw new Error("profile seed failed");
  await db
    .insert(schema.profileMembers)
    .values({ profileId: profile.id, userId: id, role: "owner", status: "active" });
  return { profileId: profile.id, ownerUserId: id };
}

/** Seed a bare user with no membership anywhere. */
async function seedStranger() {
  const id = `plan-stranger-${seq++}`;
  await harness.db
    .insert(schema.users)
    .values({ id, email: `${id}@example.showme.test`, kind: "operator" });
  return id;
}

describe("GET /plans/:profileId", () => {
  it("returns a computed default plan + credit balance for a member with no plan row", async () => {
    const operator = await seedOwnedProfile("operator");
    // The balance is the standing allowance plus the ledger, so a spend of four
    // reads as four fewer — not as four.
    await harness.db
      .insert(schema.creditLedger)
      .values({ profileId: operator.profileId, delta: -4, reason: "invite:seeded" });

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/plans/${operator.profileId}`,
      headers: auth(operator.ownerUserId),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      profileId: operator.profileId,
      tier: "free_operator",
      status: "active",
      creditBalance: COLLABORATION_INVITE_CREDITS - 4,
    });
  });

  it("404s a non-member (no existence leak)", async () => {
    const operator = await seedOwnedProfile("operator");
    const stranger = await seedStranger();

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/plans/${operator.profileId}`,
      headers: auth(stranger),
    });
    expect(response.statusCode).toBe(404);
  });
});

describe("POST /plans/:profileId/request", () => {
  it("records a requested tier change and audits it (owner)", async () => {
    const operator = await seedOwnedProfile("operator");

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/plans/${operator.profileId}/request`,
      headers: { ...auth(operator.ownerUserId), "x-profile-id": operator.profileId },
      payload: { tier: "operator_pro" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "requested", requestedTier: "operator_pro" });

    const [plan] = await harness.db
      .select()
      .from(schema.plans)
      .where(eq(schema.plans.profileId, operator.profileId));
    expect(plan?.status).toBe("requested");
    expect(plan?.tier).toBe("free_operator"); // current tier unchanged — no grant

    const audit = await harness.db
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.targetId, operator.profileId),
          eq(schema.auditLog.action, "plan.request"),
        ),
      );
    expect(audit).toHaveLength(1);
  });
});

describe("GET /profiles/:id/cap-status", () => {
  it("returns the entitlement snapshot for a member", async () => {
    const operator = await seedOwnedProfile("operator");

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/profiles/${operator.profileId}/cap-status`,
      headers: auth(operator.ownerUserId),
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.createEvent).toMatchObject({ allowed: true, used: 0, limit: 3 });
    expect(body.sendOffer.allowed).toBe(true);
    // Seats, so the roster screen can show the ceiling instead of letting
    // somebody hit it: a fresh free profile has one seat and the owner in it.
    expect(body.seats).toMatchObject({ limit: 1 });
    expect(body.spamSuspended).toBe(false);
    // A profile that has never sent an invitation is at its full allowance.
    expect(body.credits).toBe(COLLABORATION_INVITE_CREDITS);
  });

  it("404s a non-member", async () => {
    const operator = await seedOwnedProfile("operator");
    const stranger = await seedStranger();

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/profiles/${operator.profileId}/cap-status`,
      headers: auth(stranger),
    });
    expect(response.statusCode).toBe(404);
  });
});
