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

/** Propose (by agent) + performer-accept → an active representation over `region`. */
async function activateRepresentation(prefix: string, region: string[]) {
  const agent = await createProfile(`${prefix}-agent`, "agent");
  const performer = await createProfile(`${prefix}-performer`, "performer");
  const proposed = await app.inject({
    method: "POST",
    url: "/api/v1/representations",
    headers: auth(`${prefix}-agent`),
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
    headers: auth(`${prefix}-performer`),
    payload: { action: "accept" },
  });
  return { agent, performer, repId };
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
    expect(await agentParticipant(event.id, agent.id)).toBeUndefined(); // agent removed

    // The performer's full floor is restored (confirm capability back).
    const caps = await capsFor("term-performer", event.id);
    expect(caps.has("settlement.confirm")).toBe(true);
  });
});
