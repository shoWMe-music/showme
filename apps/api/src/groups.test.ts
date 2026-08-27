import { PRESET_PERMISSION_SETS } from "@showme/auth";
import { schema } from "@showme/db";
import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TokenVerifier } from "./auth/token-verifier";
import { groupRoutes } from "./routes/groups";
import { participantRoutes } from "./routes/participants";
import { buildTestApp } from "./testing";

const fakeVerifier: TokenVerifier = {
  async verify(token: string) {
    return { uid: token, email: `${token}@example.showme.test`, name: token };
  },
};

let harness: TestDatabase;
let app: FastifyInstance;

beforeAll(async () => {
  harness = await startTestDatabase();
  app = buildTestApp({ database: harness.db, tokenVerifier: fakeVerifier }, [
    groupRoutes,
    participantRoutes,
  ]);
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await harness?.stop();
});

const auth = (uid: string) => ({ authorization: `Bearer ${uid}` });

/** Seed a user + owned profile + owner membership + a permission set. */
async function seedMember(
  id: string,
  kind: "operator" | "performer" | "team_and_crew" | "agent",
  capabilities: readonly string[],
) {
  const { db } = harness;
  await db.insert(schema.users).values({ id, email: `${id}@example.showme.test`, kind });
  const [profile] = await db
    .insert(schema.profiles)
    .values({ kind, ownerUserId: id, name: id, slug: id })
    .returning();
  if (!profile) throw new Error("profile seed failed");
  await db
    .insert(schema.profileMembers)
    .values({ profileId: profile.id, userId: id, role: "owner", status: "active" });
  const [set] = await db
    .insert(schema.permissionSets)
    .values({ profileId: profile.id, name: id, capabilities: [...capabilities] })
    .returning();
  if (!set) throw new Error("permission set seed failed");
  return { userId: id, profileId: profile.id, permissionSetId: set.id };
}

async function seedEvent(
  hostProfileId: string,
  createdBy: string,
  participants: {
    profileId: string;
    permissionSetId: string;
    role: string;
    /** e.g. `{ delegatedToAgentProfileId }` — a performer handed to their agent. */
    details?: Record<string, unknown>;
  }[],
) {
  const { db } = harness;
  const [event] = await db
    .insert(schema.events)
    .values({ hostProfileId, title: "Crew Night", baseCurrency: "SEK", createdBy })
    .returning();
  if (!event) throw new Error("event seed failed");
  const rows = await db
    .insert(schema.eventParticipants)
    .values(
      participants.map((p) => ({
        eventId: event.id,
        profileId: p.profileId,
        role: p.role as "host",
        permissionSetId: p.permissionSetId,
        status: "confirmed" as const,
        ...(p.details ? { details: p.details } : {}),
      })),
    )
    .returning();
  return { event, participants: rows };
}

describe("groups — CRUD (decisions #12)", () => {
  it("creates a group, adds members, and reads it back", async () => {
    await seedMember("gc-op", "operator", PRESET_PERMISSION_SETS.operator_full);

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/groups",
      headers: auth("gc-op"),
      payload: { name: "Production Crew" },
    });
    expect(created.statusCode).toBe(201);
    const groupId = created.json().id;

    const withMember = await app.inject({
      method: "POST",
      url: `/api/v1/groups/${groupId}/members`,
      headers: auth("gc-op"),
      payload: { email: "sound@example.showme.test", roleLabel: "Sound engineer" },
    });
    expect(withMember.statusCode).toBe(200);
    expect(withMember.json().members).toHaveLength(1);

    const list = await app.inject({ method: "GET", url: "/api/v1/groups", headers: auth("gc-op") });
    expect(list.json()).toHaveLength(1);
    expect(list.json()[0].name).toBe("Production Crew");
  });

  it("404s a group the caller does not own (no leak)", async () => {
    const owner = await seedMember("go-owner", "operator", PRESET_PERMISSION_SETS.operator_full);
    await seedMember("go-stranger", "operator", PRESET_PERMISSION_SETS.operator_full);
    const { db } = harness;
    const [group] = await db
      .insert(schema.groups)
      .values({ ownerUserId: owner.userId, name: "Private" })
      .returning();

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/groups/${group?.id}`,
      headers: auth("go-stranger"),
    });
    expect(response.statusCode).toBe(404);
  });
});

describe("groups — assign to event (crew per member)", () => {
  it("operator assign creates crew per member, sponsored by the host; skips off-platform", async () => {
    const { db } = harness;
    const operator = await seedMember("ga-op", "operator", PRESET_PERMISSION_SETS.operator_full);
    // An on-platform team_and_crew member with a technical permission set as their default.
    const soundEng = await seedMember(
      "ga-sound",
      "team_and_crew",
      PRESET_PERMISSION_SETS.crew_technical,
    );

    const [group] = await db
      .insert(schema.groups)
      .values({ ownerUserId: operator.userId, name: "Production Crew" })
      .returning();
    if (!group) throw new Error("group seed failed");
    await db.insert(schema.groupMembers).values([
      {
        groupId: group.id,
        userId: soundEng.userId,
        roleLabel: "Sound",
        defaultPermissionSetId: soundEng.permissionSetId,
      },
      { groupId: group.id, email: "bar@example.showme.test", roleLabel: "Bartender" }, // off-platform
    ]);

    const { event, participants } = await seedEvent(operator.profileId, operator.userId, [
      { profileId: operator.profileId, permissionSetId: operator.permissionSetId, role: "host" },
    ]);
    const hostPart = participants[0]?.id as string;

    const assigned = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/groups`,
      headers: auth("ga-op"),
      payload: { groupId: group.id },
    });
    expect(assigned.statusCode).toBe(200);
    const body = assigned.json();
    expect(body.assigned).toHaveLength(1); // only the on-platform member
    expect(body.skippedNoProfile).toHaveLength(1); // the email-only bartender

    // The crew participant references the member's OWN profile, sponsored by the host.
    const [crew] = await db
      .select()
      .from(schema.eventParticipants)
      .where(
        and(
          eq(schema.eventParticipants.eventId, event.id),
          eq(schema.eventParticipants.profileId, soundEng.profileId),
        ),
      );
    expect(crew?.role).toBe("crew");
    expect(crew?.permissionSetId).toBe(soundEng.permissionSetId); // per-member default carried
    const details = crew?.details as { sourceGroupId: string; sponsorParticipantId: string };
    expect(details.sourceGroupId).toBe(group.id);
    expect(details.sponsorParticipantId).toBe(hostPart); // operator-sponsored → all-rider reach
  });

  it("a performer brings their OWN sub-hire crew, sponsored by themselves", async () => {
    const { db } = harness;
    const operator = await seedMember("gp-op", "operator", PRESET_PERMISSION_SETS.operator_full);
    const performer = await seedMember("gp-pf", "performer", PRESET_PERMISSION_SETS.performer);
    const tech = await seedMember(
      "gp-tech",
      "team_and_crew",
      PRESET_PERMISSION_SETS.crew_technical,
    );

    const [group] = await db
      .insert(schema.groups)
      .values({ ownerUserId: performer.userId, name: "My techs" })
      .returning();
    if (!group) throw new Error("group seed failed");
    await db
      .insert(schema.groupMembers)
      .values({ groupId: group.id, userId: tech.userId, roleLabel: "Backline" });

    const { event, participants } = await seedEvent(operator.profileId, operator.userId, [
      { profileId: operator.profileId, permissionSetId: operator.permissionSetId, role: "host" },
      {
        profileId: performer.profileId,
        permissionSetId: performer.permissionSetId,
        role: "performer",
      },
    ]);
    const performerPart = participants.find((p) => p.profileId === performer.profileId)
      ?.id as string;

    const assigned = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/groups`,
      headers: auth("gp-pf"), // the performer, via crew.submit
      payload: { groupId: group.id },
    });
    expect(assigned.statusCode).toBe(200);
    expect(assigned.json().assigned).toHaveLength(1);

    const [crew] = await db
      .select()
      .from(schema.eventParticipants)
      .where(
        and(
          eq(schema.eventParticipants.eventId, event.id),
          eq(schema.eventParticipants.profileId, tech.profileId),
        ),
      );
    const details = crew?.details as { sponsorParticipantId: string };
    // Sponsored by the PERFORMER → the crew's rider reach is the performer's own only.
    expect(details.sponsorParticipantId).toBe(performerPart);
    // No permission set (member had no default) → the bare crew floor, least-privilege.
    expect(crew?.permissionSetId).toBeNull();
  });

  it("unassign soft-removes the group's crew", async () => {
    const { db } = harness;
    const operator = await seedMember("gu-op", "operator", PRESET_PERMISSION_SETS.operator_full);
    const tech = await seedMember(
      "gu-tech",
      "team_and_crew",
      PRESET_PERMISSION_SETS.crew_technical,
    );
    const [group] = await db
      .insert(schema.groups)
      .values({ ownerUserId: operator.userId, name: "Crew" })
      .returning();
    if (!group) throw new Error("group seed failed");
    await db.insert(schema.groupMembers).values({ groupId: group.id, userId: tech.userId });
    const { event } = await seedEvent(operator.profileId, operator.userId, [
      { profileId: operator.profileId, permissionSetId: operator.permissionSetId, role: "host" },
    ]);
    await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/groups`,
      headers: auth("gu-op"),
      payload: { groupId: group.id },
    });

    const removed = await app.inject({
      method: "DELETE",
      url: `/api/v1/events/${event.id}/groups/${group.id}`,
      headers: auth("gu-op"),
    });
    expect(removed.statusCode).toBe(200);
    expect(removed.json().removed).toBe(1);

    const [crew] = await db
      .select()
      .from(schema.eventParticipants)
      .where(
        and(
          eq(schema.eventParticipants.eventId, event.id),
          eq(schema.eventParticipants.profileId, tech.profileId),
        ),
      );
    expect(crew?.status).toBe("removed");
  });

  it("refuses a member who names nobody, instead of a bare foreign-key 500", async () => {
    const operator = await seedMember("gnm-op", "operator", PRESET_PERMISSION_SETS.operator_full);
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/groups",
      headers: auth("gnm-op"),
      payload: { name: "Typo crew" },
    });
    const groupId = created.json().id;

    const unknownUser = await app.inject({
      method: "POST",
      url: `/api/v1/groups/${groupId}/members`,
      headers: auth("gnm-op"),
      payload: { userId: "nobody-by-that-name" },
    });
    expect(unknownUser.statusCode).toBe(400);
    expect(unknownUser.json().error.message).toMatch(/real userId/);

    const unknownSet = await app.inject({
      method: "POST",
      url: `/api/v1/groups/${groupId}/members`,
      headers: auth("gnm-op"),
      payload: { userId: operator.userId, defaultPermissionSetId: crypto.randomUUID() },
    });
    expect(unknownSet.statusCode).toBe(400);

    // The real thing still lands.
    const good = await app.inject({
      method: "POST",
      url: `/api/v1/groups/${groupId}/members`,
      headers: auth("gnm-op"),
      payload: { userId: operator.userId },
    });
    expect(good.statusCode).toBe(200);
    expect(good.json().members).toHaveLength(1);
  });

  it("an agent brings crew too, sponsored by the agent's own participant", async () => {
    const { db } = harness;
    const operator = await seedMember("gag-op", "operator", PRESET_PERMISSION_SETS.operator_full);
    const agent = await seedMember("gag-agent", "agent", PRESET_PERMISSION_SETS.agent);
    const tech = await seedMember(
      "gag-tech",
      "team_and_crew",
      PRESET_PERMISSION_SETS.crew_technical,
    );

    const [group] = await db
      .insert(schema.groups)
      .values({ ownerUserId: agent.userId, name: "Agent's crew" })
      .returning();
    if (!group) throw new Error("group seed failed");
    await db.insert(schema.groupMembers).values({ groupId: group.id, userId: tech.userId });

    // An agent only ever stands on an event as the projection of a LIVE
    // representation (decisions #14) — the participant row alone grants nothing
    // (audit A-19), so the fixture seeds the client it is here for.
    const client = await seedMember("gag-act", "performer", PRESET_PERMISSION_SETS.performer);
    const { event, participants } = await seedEvent(operator.profileId, operator.userId, [
      { profileId: operator.profileId, permissionSetId: operator.permissionSetId, role: "host" },
      { profileId: agent.profileId, permissionSetId: agent.permissionSetId, role: "agent" },
      {
        profileId: client.profileId,
        permissionSetId: client.permissionSetId,
        role: "performer",
        details: { delegatedToAgentProfileId: agent.profileId },
      },
    ]);
    await db.insert(schema.representations).values({
      agentProfileId: agent.profileId,
      performerProfileId: client.profileId,
      isWorldwide: true,
      commissionRate: 1000,
      commissionableBasis: "deal_income",
      proposedBy: "agent",
      status: "active",
      confirmedByAgent: true,
      confirmedByPerformer: true,
    });
    const agentPart = participants.find((p) => p.profileId === agent.profileId)?.id as string;

    const assigned = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/groups`,
      headers: auth("gag-agent"), // the agent, via crew.submit
      payload: { groupId: group.id },
    });
    expect(assigned.statusCode).toBe(200);
    expect(assigned.json().assigned).toHaveLength(1);

    const [crew] = await db
      .select()
      .from(schema.eventParticipants)
      .where(
        and(
          eq(schema.eventParticipants.eventId, event.id),
          eq(schema.eventParticipants.profileId, tech.profileId),
        ),
      );
    const details = crew?.details as { sponsorParticipantId: string };
    expect(details.sponsorParticipantId).toBe(agentPart); // sponsored by the agent
  });

  it("forbids a crew member (no crew.manage/submit) from assigning a group", async () => {
    const { db } = harness;
    const operator = await seedMember("gf-op", "operator", PRESET_PERMISSION_SETS.operator_full);
    const crewPerson = await seedMember(
      "gf-crew",
      "team_and_crew",
      PRESET_PERMISSION_SETS.crew_schedule_only,
    );
    const [group] = await db
      .insert(schema.groups)
      .values({ ownerUserId: crewPerson.userId, name: "Their group" })
      .returning();
    const { event } = await seedEvent(operator.profileId, operator.userId, [
      { profileId: operator.profileId, permissionSetId: operator.permissionSetId, role: "host" },
      {
        profileId: crewPerson.profileId,
        permissionSetId: crewPerson.permissionSetId,
        role: "crew",
      },
    ]);

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/groups`,
      headers: auth("gf-crew"),
      payload: { groupId: group?.id },
    });
    expect(response.statusCode).toBe(403);
  });
});

describe("groups — the grant_admin entitlement gate (paid plans only)", () => {
  /** An operator + their event + a group holding one on-platform crew member. */
  async function seedAssignable(prefix: string, crewDefaultPermissionSetId?: string) {
    const { db } = harness;
    const operator = await seedMember(
      `${prefix}-op`,
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const crew = await seedMember(
      `${prefix}-crew`,
      "team_and_crew",
      PRESET_PERMISSION_SETS.crew_technical,
    );
    const [group] = await db
      .insert(schema.groups)
      .values({ ownerUserId: operator.userId, name: `${prefix} crew` })
      .returning();
    if (!group) throw new Error("group seed failed");
    await db.insert(schema.groupMembers).values({
      groupId: group.id,
      userId: crew.userId,
      roleLabel: "Sound",
      defaultPermissionSetId: crewDefaultPermissionSetId ?? crew.permissionSetId,
    });
    const { event } = await seedEvent(operator.profileId, operator.userId, [
      { profileId: operator.profileId, permissionSetId: operator.permissionSetId, role: "host" },
    ]);
    return { operator, crew, group, event };
  }

  /** Assert the assignment wrote no crew participant for `profileId`. */
  async function expectNoParticipant(eventId: string, profileId: string) {
    const rows = await harness.db
      .select()
      .from(schema.eventParticipants)
      .where(
        and(
          eq(schema.eventParticipants.eventId, eventId),
          eq(schema.eventParticipants.profileId, profileId),
        ),
      );
    expect(rows).toHaveLength(0);
  }

  it("403s an OVERRIDE permission set that confers admin authority on a free host", async () => {
    const { operator, crew, group, event } = await seedAssignable("gga-override");

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/groups`,
      headers: auth("gga-override-op"),
      // The operator's own operator_full bundle, applied to every crew member.
      payload: { groupId: group.id, permissionSetId: operator.permissionSetId },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.message).toBe("Granting admin requires a paid plan");
    await expectNoParticipant(event.id, crew.profileId);
  });

  it("403s a member DEFAULT that confers admin authority on a free host", async () => {
    const { db } = harness;
    const holder = await seedMember(
      "gga-default-holder",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    // The crew member's stored default IS an admin-grade bundle — no override needed.
    const { crew, group, event } = await seedAssignable("gga-default", holder.permissionSetId);

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/groups`,
      headers: auth("gga-default-op"),
      payload: { groupId: group.id },
    });
    expect(response.statusCode).toBe(403);
    await expectNoParticipant(event.id, crew.profileId);

    // Nothing about the group itself was touched by the refusal.
    const members = await db
      .select()
      .from(schema.groupMembers)
      .where(eq(schema.groupMembers.groupId, group.id));
    expect(members).toHaveLength(1);
  });

  it("lets a PAID host apply the same admin-grade override", async () => {
    const { operator, crew, group, event } = await seedAssignable("gga-paid");
    await harness.db
      .insert(schema.plans)
      .values({ profileId: operator.profileId, tier: "operator_pro" });

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/groups`,
      headers: auth("gga-paid-op"),
      payload: { groupId: group.id, permissionSetId: operator.permissionSetId },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().assigned).toHaveLength(1);

    const [participant] = await harness.db
      .select()
      .from(schema.eventParticipants)
      .where(
        and(
          eq(schema.eventParticipants.eventId, event.id),
          eq(schema.eventParticipants.profileId, crew.profileId),
        ),
      );
    expect(participant?.permissionSetId).toBe(operator.permissionSetId);
  });

  it("never charges a free host for ordinary crew tiers (override or default)", async () => {
    const { db } = harness;
    const { operator, group, event } = await seedAssignable("gga-plain");
    const [scheduleOnly] = await db
      .insert(schema.permissionSets)
      .values({
        profileId: operator.profileId,
        name: "crew_schedule_only",
        capabilities: [...PRESET_PERMISSION_SETS.crew_schedule_only],
      })
      .returning();
    if (!scheduleOnly) throw new Error("permission set seed failed");

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/groups`,
      headers: auth("gga-plain-op"),
      payload: { groupId: group.id, permissionSetId: scheduleOnly.id },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().assigned).toHaveLength(1);
  });
});

/**
 * The In-House Management tab's private half (`PATCH …/crew/:pid/in-house`).
 *
 * `participantRoutes` is registered ALONGSIDE `groupRoutes` in this suite's app
 * on purpose: the claim under test is not "the PATCH refuses a performer", it is
 * "what the operator writes here never reaches the bill" — and the read side of
 * that sentence is `GET /events/:id/participants`. Proving it needs both routes
 * in one app, or the privacy is asserted rather than shown.
 */
describe("in-house — the operator's private block on a crew member", () => {
  async function seedInHouseEvent(prefix: string) {
    const operator = await seedMember(
      `${prefix}-op`,
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const performer = await seedMember(
      `${prefix}-perf`,
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );
    const agent = await seedMember(`${prefix}-agent`, "agent", PRESET_PERMISSION_SETS.agent);
    const crew = await seedMember(
      `${prefix}-crew`,
      "team_and_crew",
      PRESET_PERMISSION_SETS.crew_schedule_only,
    );
    // A LIVE representation behind the agent row, not just the row. Without it
    // `effectiveEventCapabilities` skips an `agent` participation entirely
    // (decisions #14: the projection is a candidate, the agreement is the
    // authority) and the agent 404s — a refusal that would prove nothing about
    // this route. The performer is stamped as delegated to match, which is the
    // shape the e2e seed uses for a represented act.
    await harness.db.insert(schema.representations).values({
      agentProfileId: agent.profileId,
      performerProfileId: performer.profileId,
      region: ["SE"],
      proposedBy: "agent",
      status: "active",
      confirmedByAgent: true,
      confirmedByPerformer: true,
    });
    const seeded = await seedEvent(operator.profileId, operator.userId, [
      { profileId: operator.profileId, permissionSetId: operator.permissionSetId, role: "host" },
      {
        profileId: performer.profileId,
        permissionSetId: performer.permissionSetId,
        role: "performer",
        details: { delegatedToAgentProfileId: agent.profileId },
      },
      { profileId: agent.profileId, permissionSetId: agent.permissionSetId, role: "agent" },
      {
        profileId: crew.profileId,
        permissionSetId: crew.permissionSetId,
        role: "crew",
        // The stamp `assignGroupToEvent` writes, and the reason this route merges
        // rather than replaces: it scopes the crew member's rider visibility.
        details: { sponsorParticipantId: "00000000-0000-4000-8000-000000000abc" },
      },
    ]);
    const crewParticipant = seeded.participants.find((row) => row.role === "crew");
    const performerParticipant = seeded.participants.find((row) => row.role === "performer");
    const agentParticipant = seeded.participants.find((row) => row.role === "agent");
    if (!crewParticipant || !performerParticipant || !agentParticipant) {
      throw new Error("in-house seed failed");
    }
    return {
      operator,
      performer,
      agent,
      crew,
      event: seeded.event,
      crewParticipant,
      performerParticipant,
    };
  }

  it("stores a call time and a private note, merged into the existing details", async () => {
    const { event, crewParticipant } = await seedInHouseEvent("ih-write");

    const saved = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${event.id}/crew/${crewParticipant.id}/in-house`,
      headers: auth("ih-write-op"),
      payload: { callTime: "17:00", privateNote: "Has the venue key. Park round the back." },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toEqual({
      participantId: crewParticipant.id,
      callTime: "17:00",
      privateNote: "Has the venue key. Park round the back.",
    });

    // The state, not just the response — and specifically that the sponsor stamp
    // survived, because losing it would silently rescope who this person's riders
    // come from.
    const [row] = await harness.db
      .select()
      .from(schema.eventParticipants)
      .where(eq(schema.eventParticipants.id, crewParticipant.id));
    expect(row?.details).toEqual({
      sponsorParticipantId: "00000000-0000-4000-8000-000000000abc",
      callTime: "17:00",
      privateNote: "Has the venue key. Park round the back.",
    });
  });

  it("clears one field with null and leaves the rest of the blob alone", async () => {
    const { event, crewParticipant } = await seedInHouseEvent("ih-clear");

    await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${event.id}/crew/${crewParticipant.id}/in-house`,
      headers: auth("ih-clear-op"),
      payload: { callTime: "16:30", privateNote: "Bring the spare XLR" },
    });
    const cleared = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${event.id}/crew/${crewParticipant.id}/in-house`,
      headers: auth("ih-clear-op"),
      payload: { callTime: null },
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().callTime).toBeNull();
    expect(cleared.json().privateNote).toBe("Bring the spare XLR");

    // A cleared field DELETES its key rather than storing a null, so the blob
    // reads exactly as it did before anyone typed a call time in.
    const [row] = await harness.db
      .select()
      .from(schema.eventParticipants)
      .where(eq(schema.eventParticipants.id, crewParticipant.id));
    expect(row?.details).toEqual({
      sponsorParticipantId: "00000000-0000-4000-8000-000000000abc",
      privateNote: "Bring the spare XLR",
    });
  });

  it("refuses the performer, the act's agent and the crew member themselves", async () => {
    const { event, crewParticipant } = await seedInHouseEvent("ih-deny");

    for (const uid of ["ih-deny-perf", "ih-deny-agent", "ih-deny-crew"]) {
      const denied = await app.inject({
        method: "PATCH",
        url: `/api/v1/events/${event.id}/crew/${crewParticipant.id}/in-house`,
        headers: auth(uid),
        payload: { privateNote: "let me in" },
      });
      // 403, not 404: each of them holds `event.view`, so the event exists for
      // them — it is `crew.manage` they do not have. Asserting the MESSAGE, not
      // the bare status, so a refusal for some other reason cannot pass as this one.
      expect(denied.statusCode).toBe(403);
      expect(denied.json().error.message).toBe("Missing capability: crew.manage");
    }
  });

  it("never leaks the private note to the performer or the agent", async () => {
    const { event, crewParticipant } = await seedInHouseEvent("ih-leak");

    await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${event.id}/crew/${crewParticipant.id}/in-house`,
      headers: auth("ih-leak-op"),
      payload: { callTime: "15:00", privateNote: "Paying her cash, do not mention on the night" },
    });

    // The operator's own read carries it — the positive control, without which
    // "absent from the payload" would only prove the write failed.
    const asOperator = await app.inject({
      method: "GET",
      url: `/api/v1/events/${event.id}/participants`,
      headers: auth("ih-leak-op"),
    });
    const operatorCrewRow = asOperator
      .json()
      .find((row: { id: string }) => row.id === crewParticipant.id);
    expect(operatorCrewRow.details).toMatchObject({
      callTime: "15:00",
      privateNote: "Paying her cash, do not mention on the night",
    });

    for (const uid of ["ih-leak-perf", "ih-leak-agent"]) {
      const response = await app.inject({
        method: "GET",
        url: `/api/v1/events/${event.id}/participants`,
        headers: auth(uid),
      });
      expect(response.statusCode).toBe(200);
      // Not "the field is empty" — the WHOLE `details` key is absent from every
      // row, and the note text appears nowhere in the serialized body at all.
      for (const row of response.json()) {
        expect(row.details).toBeUndefined();
      }
      expect(response.body).not.toContain("do not mention");
      expect(response.body).not.toContain("15:00");
    }
  });

  it("keeps in-house notes off the bill — a performer row is refused", async () => {
    const { event, performerParticipant } = await seedInHouseEvent("ih-bill");

    const refused = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${event.id}/crew/${performerParticipant.id}/in-house`,
      headers: auth("ih-bill-op"),
      payload: { privateNote: "note about the band" },
    });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error.message).toBe("In-house notes are kept on crew, not on the bill");
  });

  it("404s a participant who is not on this event, and one already removed", async () => {
    const { event, crewParticipant } = await seedInHouseEvent("ih-gone");
    const other = await seedInHouseEvent("ih-other");

    const stranger = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${event.id}/crew/${other.crewParticipant.id}/in-house`,
      headers: auth("ih-gone-op"),
      payload: { callTime: "17:00" },
    });
    expect(stranger.statusCode).toBe(404);

    await harness.db
      .update(schema.eventParticipants)
      .set({ status: "removed" })
      .where(eq(schema.eventParticipants.id, crewParticipant.id));
    const removed = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${event.id}/crew/${crewParticipant.id}/in-house`,
      headers: auth("ih-gone-op"),
      payload: { callTime: "17:00" },
    });
    expect(removed.statusCode).toBe(404);
  });

  it("refuses a call time that is not a wall-clock HH:MM", async () => {
    const { event, crewParticipant } = await seedInHouseEvent("ih-time");

    const bad = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${event.id}/crew/${crewParticipant.id}/in-house`,
      headers: auth("ih-time-op"),
      payload: { callTime: "2026-07-15T17:00" },
    });
    expect(bad.statusCode).toBe(400);

    // The positive control the checklist asks for: the same route, the same body
    // shape, a valid time — so the 400 above is the regex and not the request.
    const good = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${event.id}/crew/${crewParticipant.id}/in-house`,
      headers: auth("ih-time-op"),
      payload: { callTime: "17:00" },
    });
    expect(good.statusCode).toBe(200);
  });
});
