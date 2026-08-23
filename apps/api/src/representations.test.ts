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
async function seedProfile(kind: "agent" | "performer" | "operator" | "team_and_crew"): Promise<{
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

  // ── A-16 · only an agent may represent, only a performer may be represented ──
  // story.md draws the crew/agent line here: crew are paid a FIXED FEE, "contrast
  // the agent, who takes a percentage of someone else's income". A representation
  // IS that percentage, so these are not lenient cases — they are a different
  // product. Before the fix, agent→team_and_crew ran all the way to a delegation
  // flag on the crew participant.
  it("rejects a representation over a team_and_crew profile → 400", async () => {
    const agent = await seedProfile("agent");
    const crew = await seedProfile("team_and_crew");

    const proposed = await app.inject({
      method: "POST",
      url: "/api/v1/representations",
      headers: auth(agent.userId),
      payload: {
        agentProfileId: agent.profileId,
        performerProfileId: crew.profileId,
        region: ["SE"],
        commissionRate: 1000,
        proposedBy: "agent",
      },
    });
    expect(proposed.statusCode).toBe(400);
    expect(proposed.json().error.message).toContain("performer");
    expect(proposed.json().error.message).toContain("team_and_crew");
  });

  it("rejects an operator profile standing as the agent side → 400", async () => {
    const operator = await seedProfile("operator");
    const performer = await seedProfile("performer");

    const proposed = await app.inject({
      method: "POST",
      url: "/api/v1/representations",
      headers: auth(operator.userId),
      payload: {
        agentProfileId: operator.profileId,
        performerProfileId: performer.profileId,
        region: ["SE"],
        commissionRate: 1000,
        proposedBy: "agent",
      },
    });
    expect(proposed.statusCode).toBe(400);
    expect(proposed.json().error.message).toContain('kind "agent"');
  });

  it("re-asserts the kinds at ACCEPT — the binding moment, not just at propose", async () => {
    // A row that predates the rule (written straight to the table) must still not
    // be allowed to become binding.
    const operator = await seedProfile("operator");
    const performer = await seedProfile("performer");
    const [row] = await harness.db
      .insert(schema.representations)
      .values({
        agentProfileId: operator.profileId,
        performerProfileId: performer.profileId,
        region: ["SE"],
        commissionRate: 1000,
        proposedBy: "agent",
        status: "proposed",
        confirmedByAgent: true,
      })
      .returning();
    if (!row) throw new Error("representation seed failed");

    const accepted = await app.inject({
      method: "PATCH",
      url: `/api/v1/representations/${row.id}`,
      headers: auth(performer.userId),
      payload: { action: "accept" },
    });
    expect(accepted.statusCode).toBe(400);

    const [after] = await harness.db
      .select()
      .from(schema.representations)
      .where(eq(schema.representations.id, row.id));
    expect(after?.status).toBe("proposed"); // never activated
  });

  // ── A-17 · the disjoint invariant holds at ACCEPT, not only at propose ───────
  it("refuses the second accept when two offers over one region were raised while both were inactive", async () => {
    const agentA = await seedProfile("agent");
    const agentB = await seedProfile("agent");
    const performer = await seedProfile("performer");

    const propose = (agent: { userId: string; profileId: string }, commissionRate: number) =>
      app.inject({
        method: "POST",
        url: "/api/v1/representations",
        headers: auth(agent.userId),
        payload: {
          agentProfileId: agent.profileId,
          performerProfileId: performer.profileId,
          region: ["DE"],
          commissionRate,
          proposedBy: "agent",
        },
      });

    // Both proposals are raised BEFORE either is accepted, so both pass the
    // propose-time check against an empty active set.
    const first = await propose(agentA, 1000);
    const second = await propose(agentB, 2500);
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);

    const acceptFirst = await app.inject({
      method: "PATCH",
      url: `/api/v1/representations/${first.json().id}`,
      headers: auth(performer.userId),
      payload: { action: "accept" },
    });
    expect(acceptFirst.statusCode).toBe(200);
    expect(acceptFirst.json().status).toBe("active");

    const acceptSecond = await app.inject({
      method: "PATCH",
      url: `/api/v1/representations/${second.json().id}`,
      headers: auth(performer.userId),
      payload: { action: "accept" },
    });
    expect(acceptSecond.statusCode).toBe(409);
    expect(acceptSecond.json().error.message).toContain("DE");
    expect(acceptSecond.json().error.message).toContain(agentA.profileId);

    // The performer is left with exactly ONE active agent on DE.
    const rows = await harness.db
      .select()
      .from(schema.representations)
      .where(eq(schema.representations.performerProfileId, performer.profileId));
    expect(rows.filter((row) => row.status === "active")).toHaveLength(1);
  });

  it("still activates a second offer over a DISJOINT region", async () => {
    const agentA = await seedProfile("agent");
    const agentB = await seedProfile("agent");
    const performer = await seedProfile("performer");

    const propose = (agent: { userId: string; profileId: string }, region: string[]) =>
      app.inject({
        method: "POST",
        url: "/api/v1/representations",
        headers: auth(agent.userId),
        payload: {
          agentProfileId: agent.profileId,
          performerProfileId: performer.profileId,
          region,
          commissionRate: 1000,
          proposedBy: "agent",
        },
      });

    const first = await propose(agentA, ["AT"]);
    const second = await propose(agentB, ["BE"]);
    const acceptFirst = await app.inject({
      method: "PATCH",
      url: `/api/v1/representations/${first.json().id}`,
      headers: auth(performer.userId),
      payload: { action: "accept" },
    });
    const acceptSecond = await app.inject({
      method: "PATCH",
      url: `/api/v1/representations/${second.json().id}`,
      headers: auth(performer.userId),
      payload: { action: "accept" },
    });
    expect(acceptFirst.json().status).toBe("active");
    expect(acceptSecond.statusCode).toBe(200);
    expect(acceptSecond.json().status).toBe("active");
  });

  // ── A-18 · commission terms are validated, not free text ────────────────────
  describe("commission terms are validated (A-18)", () => {
    const validTerms = {
      region: ["SE"],
      commissionRate: 1000,
      proposedBy: "agent" as const,
    };

    async function proposeWith(overrides: Record<string, unknown>) {
      const agent = await seedProfile("agent");
      const performer = await seedProfile("performer");
      return app.inject({
        method: "POST",
        url: "/api/v1/representations",
        headers: auth(agent.userId),
        payload: {
          agentProfileId: agent.profileId,
          performerProfileId: performer.profileId,
          ...validTerms,
          ...overrides,
        },
      });
    }

    it("rejects invented country codes, country names and empty strings, naming the offender", async () => {
      const response = await proposeWith({ region: ["ATLANTIS", "sweden", ""] });
      expect(response.statusCode).toBe(400);
      const message = JSON.stringify(response.json());
      expect(message).toContain("ATLANTIS");
      expect(message).toContain("SWEDEN");
    });

    it("normalizes a valid territory to uppercase and de-duplicates it", async () => {
      const response = await proposeWith({ region: [" se ", "SE", "no"] });
      expect(response.statusCode).toBe(201);
      expect(response.json().region).toEqual(["SE", "NO"]);
    });

    it("rejects a 99% commission and any rate above 50%", async () => {
      const response = await proposeWith({ commissionRate: 9900 });
      expect(response.statusCode).toBe(400);
      expect(JSON.stringify(response.json())).toContain("5000");
      expect((await proposeWith({ commissionRate: 5001 })).statusCode).toBe(400);
      expect((await proposeWith({ commissionRate: 5000 })).statusCode).toBe(201);
    });

    it("rejects a negative or zero commission", async () => {
      expect((await proposeWith({ commissionRate: -1000 })).statusCode).toBe(400);
      expect((await proposeWith({ commissionRate: 0 })).statusCode).toBe(400);
    });

    it("rejects merchandise/publishing as a commissionable basis (story.md:69)", async () => {
      const response = await proposeWith({ commissionableBasis: "merchandise_and_publishing" });
      expect(response.statusCode).toBe(400);
      expect(JSON.stringify(response.json())).toContain("merchandise_and_publishing");
    });

    it("defaults the basis to the only one the commission engine can compute", async () => {
      const response = await proposeWith({});
      expect(response.statusCode).toBe(201);
      expect(response.json().commissionableBasis).toBe("deal_income");
    });

    it("rejects a worldwide agreement that also lists countries", async () => {
      const response = await proposeWith({ isWorldwide: true, region: ["SE"] });
      expect(response.statusCode).toBe(400);
      expect(JSON.stringify(response.json())).toContain("worldwide");
    });

    it("rejects a territory that covers nothing, and accepts a clean worldwide one", async () => {
      expect((await proposeWith({ region: [] })).statusCode).toBe(400);
      const worldwide = await proposeWith({ isWorldwide: true, region: [] });
      expect(worldwide.statusCode).toBe(201);
      expect(worldwide.json().isWorldwide).toBe(true);
    });

    it("applies the same validation to a COUNTER's term edits", async () => {
      const agent = await seedProfile("agent");
      const performer = await seedProfile("performer");
      const proposed = await app.inject({
        method: "POST",
        url: "/api/v1/representations",
        headers: auth(agent.userId),
        payload: {
          agentProfileId: agent.profileId,
          performerProfileId: performer.profileId,
          ...validTerms,
        },
      });
      const counter = (payload: Record<string, unknown>) =>
        app.inject({
          method: "PATCH",
          url: `/api/v1/representations/${proposed.json().id}`,
          headers: auth(performer.userId),
          payload: { action: "counter", ...payload },
        });

      expect((await counter({ commissionRate: 9900 })).statusCode).toBe(400);
      expect((await counter({ region: ["nowhere"] })).statusCode).toBe(400);
      expect((await counter({ commissionableBasis: "merch" })).statusCode).toBe(400);
      // Merged-terms coherence: flipping worldwide on while a country list stands.
      expect((await counter({ isWorldwide: true })).statusCode).toBe(400);
      expect((await counter({ commissionRate: 800 })).statusCode).toBe(200);
    });
  });

  // ── A-19 · a future-dated termination is a notice period, not an ending ──────
  it("keeps a future-dated termination PENDING: still active, nothing revoked", async () => {
    const agent = await seedProfile("agent");
    const performer = await seedProfile("performer");
    const proposed = await app.inject({
      method: "POST",
      url: "/api/v1/representations",
      headers: auth(agent.userId),
      payload: {
        agentProfileId: agent.profileId,
        performerProfileId: performer.profileId,
        region: ["IT"],
        commissionRate: 1000,
        proposedBy: "agent",
      },
    });
    const representationId = proposed.json().id;
    await app.inject({
      method: "PATCH",
      url: `/api/v1/representations/${representationId}`,
      headers: auth(performer.userId),
      payload: { action: "accept" },
    });

    const effectiveAt = "2027-06-01T00:00:00.000Z";
    const notice = await app.inject({
      method: "PATCH",
      url: `/api/v1/representations/${representationId}`,
      headers: auth(performer.userId),
      payload: { action: "terminate", terminatedEffectiveAt: effectiveAt },
    });
    expect(notice.statusCode).toBe(200);
    // The agreement runs to its agreed end — the agent is still working it.
    expect(notice.json().status).toBe("active");
    expect(notice.json().terminatedEffectiveAt).toBe(effectiveAt);
    expect(notice.json().terminatedAt).not.toBeNull();
    expect(notice.json().terminatedBy).toBe(performer.userId);

    // …and it still holds the territory: a successor cannot be activated over it
    // until the notice expires.
    const successor = await seedProfile("agent");
    const rival = await app.inject({
      method: "POST",
      url: "/api/v1/representations",
      headers: auth(successor.userId),
      payload: {
        agentProfileId: successor.profileId,
        performerProfileId: performer.profileId,
        region: ["IT"],
        commissionRate: 1200,
        proposedBy: "agent",
      },
    });
    expect(rival.statusCode).toBe(409);

    // An immediate termination on top of the notice ends it now.
    const now = await app.inject({
      method: "PATCH",
      url: `/api/v1/representations/${representationId}`,
      headers: auth(performer.userId),
      payload: { action: "terminate" },
    });
    expect(now.json().status).toBe("terminated");
  });

  it("terminates immediately for a past-dated effective moment", async () => {
    const agent = await seedProfile("agent");
    const performer = await seedProfile("performer");
    const proposed = await app.inject({
      method: "POST",
      url: "/api/v1/representations",
      headers: auth(agent.userId),
      payload: {
        agentProfileId: agent.profileId,
        performerProfileId: performer.profileId,
        region: ["IE"],
        commissionRate: 1000,
        proposedBy: "agent",
      },
    });
    await app.inject({
      method: "PATCH",
      url: `/api/v1/representations/${proposed.json().id}`,
      headers: auth(performer.userId),
      payload: { action: "accept" },
    });

    const terminated = await app.inject({
      method: "PATCH",
      url: `/api/v1/representations/${proposed.json().id}`,
      headers: auth(performer.userId),
      payload: { action: "terminate", terminatedEffectiveAt: "2026-01-01T00:00:00.000Z" },
    });
    expect(terminated.json().status).toBe("terminated");
  });
});
