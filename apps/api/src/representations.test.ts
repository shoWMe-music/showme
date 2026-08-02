import { schema } from "@showme/db";
import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TokenVerifier } from "./auth/token-verifier";
import { representationRoutes } from "./routes/representations";
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
  app = buildTestApp({ database: harness.db, tokenVerifier: fakeVerifier }, [representationRoutes]);
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await harness?.stop();
});

const auth = (uid: string) => ({ authorization: `Bearer ${uid}` });

let seq = 0;
/** Seed a user who owns a profile of `kind`, with an active owner membership. */
async function seedProfile(kind: "agent" | "performer" | "operator"): Promise<{
  userId: string;
  profileId: string;
}> {
  const { db } = harness;
  const userId = `${kind}-${seq++}`;
  await db.insert(schema.users).values({ id: userId, email: `${userId}@example.com`, kind });
  const [profile] = await db
    .insert(schema.profiles)
    .values({ kind, ownerUserId: userId, name: userId, slug: userId })
    .returning();
  if (!profile) throw new Error("profile seed failed");
  await db
    .insert(schema.profileMembers)
    .values({ profileId: profile.id, userId, role: "owner", status: "active" });
  return { userId, profileId: profile.id };
}

describe("representations — agent↔performer standing agreement (#14)", () => {
  it("agent proposes (auto-confirmed, status proposed), performer accepts → active", async () => {
    const agent = await seedProfile("agent");
    const performer = await seedProfile("performer");

    const proposed = await app.inject({
      method: "POST",
      url: "/api/v1/representations",
      headers: auth(agent.userId),
      payload: {
        agentProfileId: agent.profileId,
        performerProfileId: performer.profileId,
        region: ["SE", "NO"],
        commissionRate: 1000,
        proposedBy: "agent",
      },
    });
    expect(proposed.statusCode).toBe(201);
    expect(proposed.json().status).toBe("proposed");
    expect(proposed.json().confirmedByAgent).toBe(true);
    expect(proposed.json().confirmedByPerformer).toBe(false);
    const representationId = proposed.json().id;

    // The proposer (agent) cannot accept — only the counterparty may.
    const selfAccept = await app.inject({
      method: "PATCH",
      url: `/api/v1/representations/${representationId}`,
      headers: auth(agent.userId),
      payload: { action: "accept" },
    });
    expect(selfAccept.statusCode).toBe(403);

    const accepted = await app.inject({
      method: "PATCH",
      url: `/api/v1/representations/${representationId}`,
      headers: auth(performer.userId),
      payload: { action: "accept" },
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().status).toBe("active");
    expect(accepted.json().confirmedByAgent).toBe(true);
    expect(accepted.json().confirmedByPerformer).toBe(true);

    const audit = (
      await harness.db
        .select()
        .from(schema.auditLog)
        .where(eq(schema.auditLog.targetId, representationId))
    )
      .map((row) => row.action)
      .sort();
    expect(audit).toEqual(["representation.accept", "representation.propose"]);
  });

  it("rejects a second overlapping-region proposal for the same performer → 409", async () => {
    const agentA = await seedProfile("agent");
    const agentB = await seedProfile("agent");
    const performer = await seedProfile("performer");

    // First representation, activated.
    const first = await app.inject({
      method: "POST",
      url: "/api/v1/representations",
      headers: auth(agentA.userId),
      payload: {
        agentProfileId: agentA.profileId,
        performerProfileId: performer.profileId,
        region: ["SE"],
        commissionRate: 1000,
        proposedBy: "agent",
      },
    });
    await app.inject({
      method: "PATCH",
      url: `/api/v1/representations/${first.json().id}`,
      headers: auth(performer.userId),
      payload: { action: "accept" },
    });

    // A different agent proposes an overlapping region for the same performer.
    const overlap = await app.inject({
      method: "POST",
      url: "/api/v1/representations",
      headers: auth(agentB.userId),
      payload: {
        agentProfileId: agentB.profileId,
        performerProfileId: performer.profileId,
        region: ["SE", "DK"],
        commissionRate: 1500,
        proposedBy: "agent",
      },
    });
    expect(overlap.statusCode).toBe(409);

    // A disjoint region for the same performer is allowed.
    const disjoint = await app.inject({
      method: "POST",
      url: "/api/v1/representations",
      headers: auth(agentB.userId),
      payload: {
        agentProfileId: agentB.profileId,
        performerProfileId: performer.profileId,
        region: ["DK"],
        commissionRate: 1500,
        proposedBy: "agent",
      },
    });
    expect(disjoint.statusCode).toBe(201);
  });

  it("a counter re-stamps the proposer and clears the other side's confirmation", async () => {
    const agent = await seedProfile("agent");
    const performer = await seedProfile("performer");

    const proposed = await app.inject({
      method: "POST",
      url: "/api/v1/representations",
      headers: auth(agent.userId),
      payload: {
        agentProfileId: agent.profileId,
        performerProfileId: performer.profileId,
        region: ["SE"],
        commissionRate: 1000,
        proposedBy: "agent",
      },
    });
    const representationId = proposed.json().id;

    // Performer counters with a lower rate.
    const countered = await app.inject({
      method: "PATCH",
      url: `/api/v1/representations/${representationId}`,
      headers: auth(performer.userId),
      payload: { action: "counter", commissionRate: 800 },
    });
    expect(countered.statusCode).toBe(200);
    expect(countered.json().status).toBe("proposed");
    expect(countered.json().proposedBy).toBe("performer");
    expect(countered.json().commissionRate).toBe(800);
    expect(countered.json().confirmedByPerformer).toBe(true);
    expect(countered.json().confirmedByAgent).toBe(false); // cleared by the counter

    // Now the agent accepts the countered terms → active.
    const accepted = await app.inject({
      method: "PATCH",
      url: `/api/v1/representations/${representationId}`,
      headers: auth(agent.userId),
      payload: { action: "accept" },
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().status).toBe("active");
  });

  it("terminate sets status terminated + effective date", async () => {
    const agent = await seedProfile("agent");
    const performer = await seedProfile("performer");

    const proposed = await app.inject({
      method: "POST",
      url: "/api/v1/representations",
      headers: auth(agent.userId),
      payload: {
        agentProfileId: agent.profileId,
        performerProfileId: performer.profileId,
        region: ["SE"],
        commissionRate: 1000,
        proposedBy: "agent",
      },
    });
    const representationId = proposed.json().id;

    const effectiveAt = "2026-12-31T00:00:00.000Z";
    const terminated = await app.inject({
      method: "PATCH",
      url: `/api/v1/representations/${representationId}`,
      headers: auth(performer.userId),
      payload: { action: "terminate", terminatedEffectiveAt: effectiveAt },
    });
    expect(terminated.statusCode).toBe(200);
    expect(terminated.json().status).toBe("terminated");
    expect(terminated.json().terminatedEffectiveAt).toBe(effectiveAt);
    expect(terminated.json().terminatedAt).not.toBeNull();
    expect(terminated.json().terminatedBy).toBe(performer.userId);
  });

  it("lists representations for either side the caller controls", async () => {
    const agent = await seedProfile("agent");
    const performer = await seedProfile("performer");
    await app.inject({
      method: "POST",
      url: "/api/v1/representations",
      headers: auth(agent.userId),
      payload: {
        agentProfileId: agent.profileId,
        performerProfileId: performer.profileId,
        region: ["FR"],
        commissionRate: 1000,
        proposedBy: "agent",
      },
    });

    const asAgent = await app.inject({
      method: "GET",
      url: "/api/v1/representations",
      headers: auth(agent.userId),
    });
    expect(asAgent.statusCode).toBe(200);
    expect(asAgent.json().length).toBeGreaterThanOrEqual(1);

    const asPerformer = await app.inject({
      method: "GET",
      url: "/api/v1/representations",
      headers: auth(performer.userId),
    });
    expect(asPerformer.statusCode).toBe(200);
    expect(
      asPerformer
        .json()
        .some((row: { agentProfileId: string }) => row.agentProfileId === agent.profileId),
    ).toBe(true);
  });

  it("403s a caller who controls neither side", async () => {
    const agent = await seedProfile("agent");
    const performer = await seedProfile("performer");
    const stranger = await seedProfile("operator");

    const proposed = await app.inject({
      method: "POST",
      url: "/api/v1/representations",
      headers: auth(agent.userId),
      payload: {
        agentProfileId: agent.profileId,
        performerProfileId: performer.profileId,
        region: ["ES"],
        commissionRate: 1000,
        proposedBy: "agent",
      },
    });
    const representationId = proposed.json().id;

    // Stranger cannot terminate someone else's representation.
    const terminate = await app.inject({
      method: "PATCH",
      url: `/api/v1/representations/${representationId}`,
      headers: auth(stranger.userId),
      payload: { action: "terminate" },
    });
    expect(terminate.statusCode).toBe(403);

    // Stranger cannot propose as a side they do not control.
    const propose = await app.inject({
      method: "POST",
      url: "/api/v1/representations",
      headers: auth(stranger.userId),
      payload: {
        agentProfileId: agent.profileId,
        performerProfileId: performer.profileId,
        region: ["PT"],
        commissionRate: 1000,
        proposedBy: "agent",
      },
    });
    expect(propose.statusCode).toBe(403);
  });
});
