import { PRESET_PERMISSION_SETS } from "@showme/auth";
import { schema } from "@showme/db";
import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TokenVerifier } from "./auth/token-verifier";
import { groupRoutes } from "./routes/groups";
import { buildTestApp } from "./testing";

const fakeVerifier: TokenVerifier = {
  async verify(token: string) {
    return { uid: token, email: `${token}@example.com`, name: token };
  },
};

let harness: TestDatabase;
let app: FastifyInstance;

beforeAll(async () => {
  harness = await startTestDatabase();
  app = buildTestApp({ database: harness.db, tokenVerifier: fakeVerifier }, [groupRoutes]);
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
  await db.insert(schema.users).values({ id, email: `${id}@example.com`, kind });
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
      payload: { email: "sound@example.com", roleLabel: "Sound engineer" },
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
      { groupId: group.id, email: "bar@example.com", roleLabel: "Bartender" }, // off-platform
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
