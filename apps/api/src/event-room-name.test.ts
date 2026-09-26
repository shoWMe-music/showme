import { PRESET_PERMISSION_SETS } from "@showme/auth";
import { schema } from "@showme/db";
import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TokenVerifier } from "./auth/token-verifier";
import { eventRoutes } from "./routes/events";
import { profileRoutes } from "./routes/profiles";
import { buildTestApp } from "./testing";

/**
 * "ROOM / STAGE: ASSIGNED" (QA sweep run 3, r3:165).
 *
 * The event page named the room by fetching the VENUE's whole room catalogue and
 * looking `events.stage_id` up in it. `GET /profiles/:id/stages` is a
 * venue-membership read and a 404 to everybody else by design — "a venue's internal
 * geography is not something a stranger enumerates" — so on one event, one field,
 * measured side by side: the host read `Main Room`, the co-promoter read `Assigned`,
 * and the client retried the 404 four times.
 *
 * Which room the show is in is a fact about the SHOW. The event now carries
 * `stageName`, and the catalogue is only asked for when there is a choice to offer.
 */
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
    eventRoutes,
    profileRoutes,
  ]);
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await harness?.stop();
});

async function seedOperator(id: string) {
  const { db } = harness;
  await db
    .insert(schema.users)
    .values({ id, email: `${id}@example.showme.test`, kind: "operator" });
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
      name: "operator",
      capabilities: [...PRESET_PERMISSION_SETS.operator_full],
    })
    .returning();
  return { userId: id, profileId: profile.id, permissionSetId: set?.id ?? null };
}

const headers = (uid: string, profileId: string) => ({
  authorization: `Bearer ${uid}`,
  "x-profile-id": profileId,
});

describe("an event names the room it stands in", () => {
  it("tells a reader who may not enumerate the venue's rooms which one it is", async () => {
    const { db } = harness;
    const venue = await seedOperator("room-venue");
    const coHost = await seedOperator("room-cohost");

    const [stage] = await db
      .insert(schema.stages)
      .values({ venueProfileId: venue.profileId, name: "Main Room", capacity: 400 })
      .returning();
    if (!stage) throw new Error("stage seed failed");

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers: headers(venue.userId, venue.profileId),
      payload: {
        title: "Room Night",
        baseCurrency: "SEK",
        venueProfileId: venue.profileId,
        stageId: stage.id,
      },
    });
    expect(created.statusCode).toBe(201);
    const eventId = created.json().id as string;
    // The create response names it too — picking a room is a write, and the field
    // it re-renders is the name.
    expect(created.json().stageName).toBe("Main Room");

    await db.insert(schema.eventParticipants).values({
      eventId,
      profileId: coHost.profileId,
      role: "co_host",
      permissionSetId: coHost.permissionSetId,
      status: "accepted",
    });

    // The catalogue is still the venue's own business...
    const catalogue = await app.inject({
      method: "GET",
      url: `/api/v1/profiles/${venue.profileId}/stages`,
      headers: headers(coHost.userId, coHost.profileId),
    });
    expect(catalogue.statusCode).toBe(404);

    // ...and the room this show is in is still readable by the show's co-promoter.
    const read = await app.inject({
      method: "GET",
      url: `/api/v1/events/${eventId}`,
      headers: headers(coHost.userId, coHost.profileId),
    });
    expect(read.statusCode).toBe(200);
    expect(read.json().stageId).toBe(stage.id);
    expect(read.json().stageName).toBe("Main Room");
  });

  it("is null when the show stands in no room", async () => {
    const venue = await seedOperator("room-none");
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers: headers(venue.userId, venue.profileId),
      payload: { title: "No Room", baseCurrency: "SEK", venueProfileId: venue.profileId },
    });
    expect(created.statusCode).toBe(201);
    const read = await app.inject({
      method: "GET",
      url: `/api/v1/events/${created.json().id}`,
      headers: headers(venue.userId, venue.profileId),
    });
    expect(read.json().stageName).toBeNull();
  });

  it("follows a PATCH that moves the show to another room", async () => {
    const { db } = harness;
    const venue = await seedOperator("room-move");
    const rooms = await db
      .insert(schema.stages)
      .values([
        { venueProfileId: venue.profileId, name: "Main Room", capacity: 400 },
        { venueProfileId: venue.profileId, name: "Back Room", capacity: 80 },
      ])
      .returning();
    const [main, back] = rooms;
    if (!main || !back) throw new Error("stage seed failed");

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers: headers(venue.userId, venue.profileId),
      payload: {
        title: "Moving Night",
        baseCurrency: "SEK",
        venueProfileId: venue.profileId,
        stageId: main.id,
      },
    });
    const patched = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${created.json().id}`,
      headers: headers(venue.userId, venue.profileId),
      payload: { stageId: back.id, expectedVersion: created.json().version },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().stageName).toBe("Back Room");
  });
});
