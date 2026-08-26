import { schema } from "@showme/db";
import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TokenVerifier } from "./auth/token-verifier";
import { profileRoutes } from "./routes/profiles";
import { buildTestApp } from "./testing";

/**
 * A VENUE'S ROOMS — `GET/POST/PATCH/DELETE /profiles/:id/stages`.
 *
 * The rules worth pinning down are the ones a room list gets wrong quietly: who
 * may enumerate a venue's internal geography, whether two rooms may share a name,
 * and what becomes of the shows in a room somebody deletes.
 */

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
  app = buildTestApp({ database: harness.db, tokenVerifier: fakeVerifier }, [profileRoutes]);
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await harness?.stop();
});

const auth = (uid: string) => ({ authorization: `Bearer ${uid}` });

type Kind = "operator" | "performer" | "team_and_crew" | "agent";

async function seedUser(id: string, kind: Kind) {
  await harness.db.insert(schema.users).values({ id, email: `${id}@example.com`, kind });
}

/** A profile of `kind`/`type` plus its owner and their active `owner` membership. */
async function seedProfile(prefix: string, kind: Kind, type: string | null) {
  const { db } = harness;
  const ownerId = `${prefix}-owner`;
  await seedUser(ownerId, kind);
  const [profile] = await db
    .insert(schema.profiles)
    .values({ kind, type, ownerUserId: ownerId, name: prefix, slug: prefix })
    .returning();
  if (!profile) throw new Error("profile seed failed");
  await db
    .insert(schema.profileMembers)
    .values({ profileId: profile.id, userId: ownerId, role: "owner", status: "active" });
  return { profileId: profile.id, ownerId };
}

async function seedMember(profileId: string, userId: string, kind: Kind, role: string) {
  await seedUser(userId, kind);
  await harness.db
    .insert(schema.profileMembers)
    .values({ profileId, userId, role: role as "viewer", status: "active" });
}

/** Create a room through the route, returning its id. */
async function createRoom(profileId: string, actor: string, name: string, capacity?: number) {
  const response = await app.inject({
    method: "POST",
    url: `/api/v1/profiles/${profileId}/stages`,
    headers: auth(actor),
    payload: capacity === undefined ? { name } : { name, capacity },
  });
  expect(response.statusCode).toBe(201);
  return response.json().id as string;
}

describe("rooms (stages) — the venue's own list", () => {
  it("creates, lists and renames a room", async () => {
    const venue = await seedProfile("rooms-basic", "operator", "venue");

    const created = await app.inject({
      method: "POST",
      url: `/api/v1/profiles/${venue.profileId}/stages`,
      headers: auth(venue.ownerId),
      payload: { name: "Main Room", capacity: 400 },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      name: "Main Room",
      capacity: 400,
      venueProfileId: venue.profileId,
      eventCount: 0,
    });

    await createRoom(venue.profileId, venue.ownerId, "Basement", 90);

    const listed = await app.inject({
      method: "GET",
      url: `/api/v1/profiles/${venue.profileId}/stages`,
      headers: auth(venue.ownerId),
    });
    expect(listed.statusCode).toBe(200);
    // Ordered by name, so the picker that reads this list is stable.
    expect(listed.json().map((room: { name: string }) => room.name)).toEqual([
      "Basement",
      "Main Room",
    ]);

    const roomId = created.json().id;
    const renamed = await app.inject({
      method: "PATCH",
      url: `/api/v1/profiles/${venue.profileId}/stages/${roomId}`,
      headers: auth(venue.ownerId),
      payload: { name: "Main Hall" },
    });
    expect(renamed.statusCode).toBe(200);
    // Capacity was not restated and must not be lost.
    expect(renamed.json()).toMatchObject({ name: "Main Hall", capacity: 400 });

    const audits = await harness.db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, roomId));
    expect(audits.map((row) => row.action).sort()).toEqual(["stage.create", "stage.update"]);
  });

  it("refuses a second room with the same name in the same venue", async () => {
    const venue = await seedProfile("rooms-dupe", "operator", "venue");
    await createRoom(venue.profileId, venue.ownerId, "Hall A");

    const duplicate = await app.inject({
      method: "POST",
      url: `/api/v1/profiles/${venue.profileId}/stages`,
      headers: auth(venue.ownerId),
      payload: { name: "Hall A" },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.message).toMatch(/already has a room by that name/i);

    // Scoped to the venue: the same name in another building is fine.
    const otherVenue = await seedProfile("rooms-dupe-other", "operator", "venue");
    await createRoom(otherVenue.profileId, otherVenue.ownerId, "Hall A");
  });

  it("refuses rooms on a profile that is not a place", async () => {
    const band = await seedProfile("rooms-band", "performer", "band");

    const refused = await app.inject({
      method: "POST",
      url: `/api/v1/profiles/${band.profileId}/stages`,
      headers: auth(band.ownerId),
      payload: { name: "Rehearsal Space" },
    });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error.message).toMatch(/venue or festival/i);
  });

  it("lets any member read the rooms but only owner/admin/editor write them", async () => {
    const venue = await seedProfile("rooms-roles", "operator", "venue");
    const roomId = await createRoom(venue.profileId, venue.ownerId, "Main Room");
    await seedMember(venue.profileId, "rooms-roles-crew", "team_and_crew", "crew");

    // Crew work the building: they read the room list (it draws every picker).
    const read = await app.inject({
      method: "GET",
      url: `/api/v1/profiles/${venue.profileId}/stages`,
      headers: auth("rooms-roles-crew"),
    });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toHaveLength(1);

    for (const attempt of [
      { method: "POST" as const, url: `/api/v1/profiles/${venue.profileId}/stages` },
      { method: "PATCH" as const, url: `/api/v1/profiles/${venue.profileId}/stages/${roomId}` },
    ]) {
      const refused = await app.inject({
        ...attempt,
        headers: auth("rooms-roles-crew"),
        payload: { name: "Crew Room" },
      });
      expect(refused.statusCode).toBe(403);
    }

    const refusedDelete = await app.inject({
      method: "DELETE",
      url: `/api/v1/profiles/${venue.profileId}/stages/${roomId}`,
      headers: auth("rooms-roles-crew"),
    });
    expect(refusedDelete.statusCode).toBe(403);
  });

  it("hides a venue's rooms from someone with no membership at all", async () => {
    const venue = await seedProfile("rooms-private", "operator", "venue");
    await createRoom(venue.profileId, venue.ownerId, "Main Room");
    await seedUser("rooms-private-stranger", "performer");

    // A 404, not a 403 and not an empty list: a venue's internal geography is not
    // something an arm's-length party gets to enumerate, or even confirm exists.
    const refused = await app.inject({
      method: "GET",
      url: `/api/v1/profiles/${venue.profileId}/stages`,
      headers: auth("rooms-private-stranger"),
    });
    expect(refused.statusCode).toBe(404);
  });

  it("will not edit a room through a profile that does not own it", async () => {
    const venue = await seedProfile("rooms-cross", "operator", "venue");
    const otherVenue = await seedProfile("rooms-cross-other", "operator", "venue");
    const roomId = await createRoom(venue.profileId, venue.ownerId, "Main Room");

    // The caller owns `otherVenue` and names a room id belonging to `venue`.
    const refused = await app.inject({
      method: "PATCH",
      url: `/api/v1/profiles/${otherVenue.profileId}/stages/${roomId}`,
      headers: auth(otherVenue.ownerId),
      payload: { name: "Stolen Room" },
    });
    expect(refused.statusCode).toBe(404);

    const untouched = await harness.db
      .select()
      .from(schema.stages)
      .where(eq(schema.stages.id, roomId));
    expect(untouched[0]?.name).toBe("Main Room");
  });

  it("counts the events in a room, and unassigns rather than deletes them", async () => {
    const { db } = harness;
    const venue = await seedProfile("rooms-delete", "operator", "venue");
    const roomId = await createRoom(venue.profileId, venue.ownerId, "Main Room");

    const [event] = await db
      .insert(schema.events)
      .values({
        hostProfileId: venue.profileId,
        title: "A show in the main room",
        eventDate: "2026-09-11",
        venueProfileId: venue.profileId,
        stageId: roomId,
        baseCurrency: "EUR",
        createdBy: venue.ownerId,
      })
      .returning();
    if (!event) throw new Error("event seed failed");

    const listed = await app.inject({
      method: "GET",
      url: `/api/v1/profiles/${venue.profileId}/stages`,
      headers: auth(venue.ownerId),
    });
    expect(listed.json()[0]).toMatchObject({ name: "Main Room", eventCount: 1 });

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/v1/profiles/${venue.profileId}/stages/${roomId}`,
      headers: auth(venue.ownerId),
    });
    expect(deleted.statusCode).toBe(200);
    // The count is REPORTED, not swallowed: the screen has to be able to say what
    // just happened to those shows.
    expect(deleted.json()).toEqual({ deleted: true, unassignedEvents: 1 });

    // `events.stage_id` is ON DELETE SET NULL — the show survives, room-less.
    const [survivor] = await db.select().from(schema.events).where(eq(schema.events.id, event.id));
    expect(survivor?.stageId).toBeNull();
    expect(survivor?.eventDate).toBe("2026-09-11");
  });
});
