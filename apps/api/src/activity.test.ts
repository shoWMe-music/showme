import { PRESET_PERMISSION_SETS } from "@showme/auth";
import { schema } from "@showme/db";
import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TokenVerifier } from "./auth/token-verifier";
import { activityRoutes } from "./routes/activity";
import { dealRoutes } from "./routes/deals";
import { participantRoutes } from "./routes/participants";
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
    dealRoutes,
    participantRoutes,
    activityRoutes,
  ]);
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await harness?.stop();
});

async function createProfile(id: string, kind: "operator" | "performer") {
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

async function addParticipant(
  eventId: string,
  profileId: string,
  role: "host" | "performer",
  capabilities: readonly string[],
) {
  const { db } = harness;
  const [set] = await db
    .insert(schema.permissionSets)
    .values({ profileId, name: role, capabilities: [...capabilities] })
    .returning();
  const [participant] = await db
    .insert(schema.eventParticipants)
    .values({ eventId, profileId, role, permissionSetId: set?.id, status: "confirmed" })
    .returning();
  if (!participant) throw new Error("participant seed failed");
  return participant.id;
}

const auth = (uid: string) => ({ authorization: `Bearer ${uid}` });

function feedFor(uid: string) {
  return app.inject({ method: "GET", url: "/api/v1/activity", headers: auth(uid) });
}

describe("activity feed — target-scoped visibility", () => {
  it("shows event-level activity to all, deal activity only to the party, everything to the operator", async () => {
    const { db } = harness;
    const operator = await createProfile("act-op", "operator");
    const performerA = await createProfile("act-a", "performer");
    const performerB = await createProfile("act-b", "performer");

    const [event] = await db
      .insert(schema.events)
      .values({
        hostProfileId: operator.id,
        title: "Feed Night",
        baseCurrency: "SEK",
        createdBy: "act-op",
      })
      .returning();
    if (!event) throw new Error("event seed failed");

    await addParticipant(event.id, operator.id, "host", PRESET_PERMISSION_SETS.operator_full);
    const aParticipantId = await addParticipant(
      event.id,
      performerA.id,
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );

    // Event-level activity: add performer B via the route.
    const added = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/participants`,
      headers: auth("act-op"),
      payload: { profileId: performerB.id, role: "performer" },
    });
    expect(added.statusCode).toBe(201);

    // Party-scoped activity: a deal with performer A as a party.
    const deal = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/deals`,
      headers: auth("act-op"),
      payload: {
        type: "performance",
        name: "A's guarantee",
        parties: [{ participantId: aParticipantId, roleInDeal: "payee" }],
      },
    });
    expect(deal.statusCode).toBe(201);

    const types = async (uid: string) => {
      const response = await feedFor(uid);
      expect(response.statusCode).toBe(200);
      return (response.json().items as Array<{ type: string }>).map((item) => item.type).sort();
    };

    // Operator sees everything on their event.
    expect(await types("act-op")).toEqual(["deal.created", "participant.added"]);

    // Performer A is a party on the deal → sees both.
    expect(await types("act-a")).toEqual(["deal.created", "participant.added"]);

    // Performer B is NOT a party → sees the event-level item, not the deal.
    expect(await types("act-b")).toEqual(["participant.added"]);
  });

  it("returns an empty feed for a user with no reachable events", async () => {
    await createProfile("act-lonely", "operator");
    const response = await feedFor("act-lonely");
    expect(response.statusCode).toBe(200);
    expect(response.json().items).toEqual([]);
  });
});
