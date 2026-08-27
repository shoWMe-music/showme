import { schema } from "@showme/db";
import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TokenVerifier } from "./auth/token-verifier";
import { eventRoutes } from "./routes/events";
import { scheduleRoutes } from "./routes/schedule";
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
    eventRoutes,
    scheduleRoutes,
  ]);
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await harness?.stop();
});

/** Seed an operator user + profile + owner membership. */
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
  return { userId: id, profileId: profile.id };
}

/** Seed a venue profile with a primary location in `country`. */
async function seedVenue(id: string, country: string) {
  const { db } = harness;
  await db
    .insert(schema.users)
    .values({ id, email: `${id}@example.showme.test`, kind: "operator" });
  const [profile] = await db
    .insert(schema.profiles)
    .values({ kind: "operator", ownerUserId: id, name: id, slug: id })
    .returning();
  if (!profile) throw new Error("venue seed failed");
  await db
    .insert(schema.profileLocations)
    .values({ profileId: profile.id, country, isPrimary: true });
  return profile.id;
}

const opHeaders = (uid: string, profileId: string) => ({
  authorization: `Bearer ${uid}`,
  "x-profile-id": profileId,
});

describe("events — timezone snapshot (decisions #10)", () => {
  it("snapshots the venue's location country → IANA zone on create", async () => {
    const op = await seedOperator("tz-op");
    const venueId = await seedVenue("tz-venue", "SE");

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers: opHeaders("tz-op", op.profileId),
      payload: { title: "Sthlm Night", baseCurrency: "SEK", venueProfileId: venueId },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().timezone).toBe("Europe/Stockholm");
    expect(created.json().venueProfileId).toBe(venueId);
  });

  it("an explicit timezone overrides the venue lookup", async () => {
    const op = await seedOperator("tz-op2");
    const venueId = await seedVenue("tz-venue2", "SE");
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers: opHeaders("tz-op2", op.profileId),
      payload: {
        title: "Override",
        baseCurrency: "SEK",
        venueProfileId: venueId,
        timezone: "America/New_York",
      },
    });
    expect(created.json().timezone).toBe("America/New_York");
  });

  it("no venue → no timezone anchor", async () => {
    const op = await seedOperator("tz-op3");
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers: opHeaders("tz-op3", op.profileId),
      payload: { title: "Venueless", baseCurrency: "SEK" },
    });
    expect(created.json().timezone).toBeNull();
  });

  it("re-snapshots when the venue changes on update", async () => {
    const op = await seedOperator("tz-op4");
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers: opHeaders("tz-op4", op.profileId),
      payload: { title: "Movable", baseCurrency: "SEK" },
    });
    const eventId = created.json().id;
    const norwayVenue = await seedVenue("tz-venue4", "NO");

    const updated = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${eventId}`,
      headers: opHeaders("tz-op4", op.profileId),
      payload: { venueProfileId: norwayVenue },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().timezone).toBe("Europe/Oslo");
  });

  it("serializes schedule items as { localDateTime, timezone } anchored by the event", async () => {
    const op = await seedOperator("tz-op5");
    const venueId = await seedVenue("tz-venue5", "SE");
    const event = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers: opHeaders("tz-op5", op.profileId),
      payload: { title: "Show", baseCurrency: "SEK", venueProfileId: venueId },
    });
    const eventId = event.json().id;

    await app.inject({
      method: "POST",
      url: `/api/v1/events/${eventId}/schedule`,
      headers: { authorization: "Bearer tz-op5" },
      payload: { localDateTime: "2026-08-01T20:00", label: "Doors" },
    });

    const list = await app.inject({
      method: "GET",
      url: `/api/v1/events/${eventId}/schedule`,
      headers: { authorization: "Bearer tz-op5" },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()[0]).toMatchObject({
      localDateTime: "2026-08-01T20:00",
      timezone: "Europe/Stockholm",
      label: "Doors",
    });
  });
});
