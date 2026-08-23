import { PRESET_PERMISSION_SETS, effectiveEventCapabilities, resolvePrincipal } from "@showme/auth";
import { schema } from "@showme/db";
import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TokenVerifier } from "./auth/token-verifier";
import { participantRoutes } from "./routes/participants";
import { representationRoutes } from "./routes/representations";
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
  app = buildTestApp({ database: harness.db, tokenVerifier: fakeVerifier }, [
    representationRoutes,
    participantRoutes,
  ]);
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await harness?.stop();
});

async function createProfile(id: string, kind: "operator" | "performer" | "agent") {
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
  return profile;
}

async function createVenue(id: string, country: string) {
  const profile = await createProfile(id, "operator");
  await harness.db
    .insert(schema.profileLocations)
    .values({ profileId: profile.id, country, isPrimary: true });
  return profile;
}

async function createEvent(venueId: string, createdBy: string, status = "on_hold") {
  const [event] = await harness.db
    .insert(schema.events)
    .values({
      hostProfileId: venueId,
      venueProfileId: venueId,
      title: `Show-${status}`,
      baseCurrency: "SEK",
      status: status as "on_hold",
      createdBy,
    })
    .returning();
  if (!event) throw new Error("event seed failed");
  return event;
}

async function addPerformer(eventId: string, profileId: string) {
  const { db } = harness;
  const [set] = await db
    .insert(schema.permissionSets)
    .values({ profileId, name: "performer", capabilities: [...PRESET_PERMISSION_SETS.performer] })
    .returning();
  await db.insert(schema.eventParticipants).values({
    eventId,
    profileId,
    role: "performer",
    permissionSetId: set?.id,
    status: "confirmed",
  });
}

async function agentParticipant(eventId: string, agentProfileId: string) {
  const [row] = await harness.db
    .select()
    .from(schema.eventParticipants)
    .where(
      and(
        eq(schema.eventParticipants.eventId, eventId),
        eq(schema.eventParticipants.profileId, agentProfileId),
      ),
    );
  return row;
}

const auth = (uid: string) => ({ authorization: `Bearer ${uid}` });

/** The caller's effective capabilities on an event, via the real auth engine. */
async function capsFor(uid: string, eventId: string) {
  const principal = await resolvePrincipal(harness.db, uid);
  if (!principal) throw new Error(`no principal for ${uid}`);
  return effectiveEventCapabilities(harness.db, principal, eventId);
}

/** Fresh agent + performer profiles with an active representation over `region`. */
async function activateRepresentation(prefix: string, region: string[]) {
  const agent = await createProfile(`${prefix}-agent`, "agent");
  const performer = await createProfile(`${prefix}-performer`, "performer");
  const repId = await activateRepresentationBetween(
    agent,
    performer,
    `${prefix}-agent`,
    `${prefix}-performer`,
    region,
  );
  return { agent, performer, repId };
}

/** Propose (by agent) + performer-accept between two profiles that already exist. */
async function activateRepresentationBetween(
  agent: { id: string },
  performer: { id: string },
  agentUid: string,
  performerUid: string,
  region: string[],
) {
  const proposed = await app.inject({
    method: "POST",
    url: "/api/v1/representations",
    headers: auth(agentUid),
    payload: {
      agentProfileId: agent.id,
      performerProfileId: performer.id,
      region,
      commissionRate: 1500,
      proposedBy: "agent",
    },
  });
  const repId = proposed.json().id;
  await app.inject({
    method: "PATCH",
    url: `/api/v1/representations/${repId}`,
    headers: auth(performerUid),
    payload: { action: "accept" },
  });
  return repId;
}

describe("agent assignment", () => {
  it("assigns chosen current events and delegates the performer to view-only", async () => {
    const { agent, performer, repId } = await activateRepresentation("aa", ["SE"]);
    const venue = await createVenue("aa-venue", "SE");
    const event = await createEvent(venue.id, "aa-venue");
    await addPerformer(event.id, performer.id);

    const assigned = await app.inject({
      method: "POST",
      url: `/api/v1/representations/${repId}/events`,
      headers: auth("aa-performer"),
      payload: { eventIds: [event.id] },
    });
    expect(assigned.statusCode).toBe(200);
    expect(assigned.json().assigned).toBe(1);
    expect((await agentParticipant(event.id, agent.id))?.role).toBe("agent");

    const agentCaps = await capsFor("aa-agent", event.id);
    expect(agentCaps.has("deal.edit")).toBe(true);
    expect(agentCaps.has("budget.view")).toBe(false);

    const performerCaps = await capsFor("aa-performer", event.id);
    expect(performerCaps.has("deal.view.own")).toBe(true);
    expect(performerCaps.has("settlement.confirm")).toBe(false); // moved to the agent
  });

  it("lists delegatable current in-region events for the picker, and 'all' assigns them", async () => {
    const { agent, performer, repId } = await activateRepresentation("pick", ["SE"]);
    const seVenue = await createVenue("pick-se", "SE");
    const usVenue = await createVenue("pick-us", "US");
    const a = await createEvent(seVenue.id, "pick-se");
    const b = await createEvent(seVenue.id, "pick-se");
    const foreign = await createEvent(usVenue.id, "pick-us");
    const concluded = await createEvent(seVenue.id, "pick-se", "concluded");
    for (const e of [a, b, foreign, concluded]) await addPerformer(e.id, performer.id);

    // Picker: only the two current SE events, none assigned yet.
    const picker = await app.inject({
      method: "GET",
      url: `/api/v1/representations/${repId}/delegatable-events`,
      headers: auth("pick-performer"),
    });
    expect(picker.statusCode).toBe(200);
    const ids = picker
      .json()
      .events.map((e: { eventId: string }) => e.eventId)
      .sort();
    expect(ids).toEqual([a.id, b.id].sort());
    expect(
      picker.json().events.every((e: { alreadyAssigned: boolean }) => !e.alreadyAssigned),
    ).toBe(true);

    // "all" assigns both SE events (not the US or concluded one).
    const all = await app.inject({
      method: "POST",
      url: `/api/v1/representations/${repId}/events`,
      headers: auth("pick-performer"),
      payload: { all: true },
    });
    expect(all.json().assigned).toBe(2);
    expect(await agentParticipant(a.id, agent.id)).toBeDefined();
    expect(await agentParticipant(foreign.id, agent.id)).toBeUndefined();
  });

  it("auto-assigns FUTURE in-region events when the performer joins them", async () => {
    const { agent, performer } = await activateRepresentation("fut", ["SE"]);
    const venue = await createVenue("fut-venue", "SE");
    const event = await createEvent(venue.id, "fut-venue");
    const [set] = await harness.db
      .insert(schema.permissionSets)
      .values({
        profileId: venue.id,
        name: "op",
        capabilities: [...PRESET_PERMISSION_SETS.operator_full],
      })
      .returning();
    await harness.db.insert(schema.eventParticipants).values({
      eventId: event.id,
      profileId: venue.id,
      role: "host",
      permissionSetId: set?.id,
      status: "confirmed",
    });

    const added = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/participants`,
      headers: auth("fut-venue"),
      payload: { profileId: performer.id, role: "performer" },
    });
    expect(added.statusCode).toBe(201);
    expect((await agentParticipant(event.id, agent.id))?.role).toBe("agent");
  });

  it("returns control to the performer on termination (open events revert)", async () => {
    const { agent, performer, repId } = await activateRepresentation("term", ["SE"]);
    const venue = await createVenue("term-venue", "SE");
    const event = await createEvent(venue.id, "term-venue");
    await addPerformer(event.id, performer.id);
    await app.inject({
      method: "POST",
      url: `/api/v1/representations/${repId}/events`,
      headers: auth("term-performer"),
      payload: { eventIds: [event.id] },
    });
    expect(await agentParticipant(event.id, agent.id)).toBeDefined();

    // Terminate → the open event reverts.
    const terminated = await app.inject({
      method: "PATCH",
      url: `/api/v1/representations/${repId}`,
      headers: auth("term-performer"),
      payload: { action: "terminate" },
    });
    expect(terminated.statusCode).toBe(200);
    // Soft-removed, not deleted — the row stays, the access goes.
    expect((await agentParticipant(event.id, agent.id))?.status).toBe("removed");

    // The performer's full floor is restored (confirm capability back).
    const caps = await capsFor("term-performer", event.id);
    expect(caps.has("settlement.confirm")).toBe(true);

    // And the agent's access is gone the moment the row is marked removed.
    const agentCaps = await capsFor("term-agent", event.id);
    expect(agentCaps.size).toBe(0);
  });

  // A-12: unassignment used to hard-DELETE the agent participant, and
  // `settlements.participant_id` references it with no `ON DELETE` — so the
  // moment a settlement had been computed for that event, termination 500'd and
  // the representation was permanent. Either party can terminate unilaterally
  // (decisions #14), settled money or not.
  it("terminates after a settlement has been computed, leaving the settled row intact", async () => {
    const { agent, performer, repId } = await activateRepresentation("settled", ["SE"]);
    const venue = await createVenue("settled-venue", "SE");
    const event = await createEvent(venue.id, "settled-venue");
    await addPerformer(event.id, performer.id);
    await app.inject({
      method: "POST",
      url: `/api/v1/representations/${repId}/events`,
      headers: auth("settled-performer"),
      payload: { eventIds: [event.id] },
    });
    const assigned = await agentParticipant(event.id, agent.id);
    expect(assigned).toBeDefined();
    if (!assigned) throw new Error("agent participant missing");

    // What a settlement compute leaves behind: a settlement row pointing at the
    // agent's participation.
    const [settlement] = await harness.db
      .insert(schema.settlements)
      .values({
        eventId: event.id,
        participantId: assigned.id,
        computed: { entitlement: "0", collected: "0", paid: "0", net: "0" },
      })
      .returning();
    expect(settlement).toBeDefined();

    const terminated = await app.inject({
      method: "PATCH",
      url: `/api/v1/representations/${repId}`,
      headers: auth("settled-performer"),
      payload: { action: "terminate" },
    });
    expect(terminated.statusCode).toBe(200);

    // The participation survives as `removed`, so the money history still resolves.
    expect((await agentParticipant(event.id, agent.id))?.status).toBe("removed");
    const settlementsAfter = await harness.db
      .select()
      .from(schema.settlements)
      .where(eq(schema.settlements.eventId, event.id));
    expect(settlementsAfter).toHaveLength(1);
    expect(settlementsAfter[0]?.participantId).toBe(assigned.id);

    // The agent is out: no capabilities left on the event.
    expect((await capsFor("settled-agent", event.id)).size).toBe(0);
  });

  // Re-signing the same agent must bring the soft-removed row back to life,
  // rather than skipping it and leaving an agent participant with no access.
  it("reinstates a soft-removed agent participant when the agent is re-signed", async () => {
    const { agent, performer, repId } = await activateRepresentation("again", ["SE"]);
    const venue = await createVenue("again-venue", "SE");
    const event = await createEvent(venue.id, "again-venue");
    await addPerformer(event.id, performer.id);
    const assign = () =>
      app.inject({
        method: "POST",
        url: `/api/v1/representations/${repId}/events`,
        headers: auth("again-performer"),
        payload: { eventIds: [event.id] },
      });

    await assign();
    await app.inject({
      method: "PATCH",
      url: `/api/v1/representations/${repId}`,
      headers: auth("again-performer"),
      payload: { action: "terminate" },
    });
    expect((await agentParticipant(event.id, agent.id))?.status).toBe("removed");

    // A fresh representation with the same two parties, re-assigned to the event.
    const second = await activateRepresentationBetween(
      agent,
      performer,
      "again-agent",
      "again-performer",
      ["SE"],
    );
    const reassigned = await app.inject({
      method: "POST",
      url: `/api/v1/representations/${second}/events`,
      headers: auth("again-performer"),
      payload: { eventIds: [event.id] },
    });
    expect(reassigned.statusCode).toBe(200);
    expect(reassigned.json().assigned).toBe(1);

    const back = await agentParticipant(event.id, agent.id);
    expect(back?.status).toBe("accepted");
    expect(back?.role).toBe("agent");
    expect((await capsFor("again-agent", event.id)).has("deal.edit")).toBe(true);
  });
});
