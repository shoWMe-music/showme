import { schema } from "@showme/db";
import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TokenVerifier } from "./auth/token-verifier";
import { publicRoutes } from "./routes/public";
import { buildTestApp } from "./testing";

/** Fake verifier — public routes never call it, but buildTestApp needs one. */
const fakeVerifier: TokenVerifier = {
  async verify(token: string) {
    return { uid: token, email: `${token}@example.com`, name: token };
  },
};

let harness: TestDatabase;
let app: FastifyInstance;

beforeAll(async () => {
  harness = await startTestDatabase();
  app = buildTestApp({ database: harness.db, tokenVerifier: fakeVerifier }, [publicRoutes]);
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await harness?.stop();
});

/** Seed an owner user + a profile with the given publicity/slug. */
async function seedProfile(
  ownerId: string,
  slug: string,
  isPublic: boolean,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const { db } = harness;
  await db
    .insert(schema.users)
    .values({ id: ownerId, email: `${ownerId}@example.com`, kind: "performer" });
  const [profile] = await db
    .insert(schema.profiles)
    .values({ kind: "performer", ownerUserId: ownerId, name: slug, slug, isPublic, ...extra })
    .returning();
  if (!profile) throw new Error("profile seed failed");
  return profile.id;
}

/** Seed an operator + host profile + an event with the given publish flag. */
async function seedEvent(
  ownerId: string,
  published: boolean,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const { db } = harness;
  await db
    .insert(schema.users)
    .values({ id: ownerId, email: `${ownerId}@example.com`, kind: "operator" });
  const [profile] = await db
    .insert(schema.profiles)
    .values({ kind: "operator", ownerUserId: ownerId, name: ownerId, slug: `${ownerId}-p` })
    .returning();
  if (!profile) throw new Error("host profile seed failed");
  const [event] = await db
    .insert(schema.events)
    .values({
      hostProfileId: profile.id,
      title: "Public Show",
      baseCurrency: "SEK",
      published,
      createdBy: ownerId,
      ...extra,
    })
    .returning();
  if (!event) throw new Error("event seed failed");
  return event.id;
}

describe("public profiles", () => {
  it("serves a public profile by slug, whitelisted fields only", async () => {
    await seedProfile("pub-owner", "cool-band", true, {
      type: "band",
      bio: "We play",
      avatarUrl: "https://cdn/a.png",
      bannerUrl: "https://cdn/b.png",
      billing: { vatId: "SECRET" },
      details: { private: true },
    });

    const response = await app.inject({ method: "GET", url: "/api/v1/public/profiles/cool-band" });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toEqual({
      id: expect.any(String),
      name: "cool-band",
      type: "band",
      kind: "performer",
      bio: "We play",
      avatarUrl: "https://cdn/a.png",
      bannerUrl: "https://cdn/b.png",
    });
    // No owner/billing/details/members leak.
    expect(body.ownerUserId).toBeUndefined();
    expect(body.billing).toBeUndefined();
    expect(body.details).toBeUndefined();
  });

  it("404s a non-public profile", async () => {
    await seedProfile("priv-owner", "hidden-band", false);
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/public/profiles/hidden-band",
    });
    expect(response.statusCode).toBe(404);
  });

  it("exposes a public profile's unavailability for the availability calendar", async () => {
    const profileId = await seedProfile("avail-owner", "busy-band", true);
    await harness.db.insert(schema.profileUnavailability).values({
      profileId,
      startDate: "2026-08-01",
      endDate: "2026-08-05",
      reason: "on tour",
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/public/profiles/busy-band/availability",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().unavailability).toEqual([
      { startDate: "2026-08-01", endDate: "2026-08-05" },
    ]);
  });
});

describe("public events", () => {
  it("serves a published event without budget/notes leaking", async () => {
    const eventId = await seedEvent("ev-owner", true, {
      venueName: "The Hall",
      doorTime: "19:00:00",
      startTime: "20:00:00",
      eventDate: "2026-09-01",
      notes: "internal note",
      holdRank: 3,
    });

    const response = await app.inject({ method: "GET", url: `/api/v1/public/events/${eventId}` });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toEqual({
      id: eventId,
      title: "Public Show",
      eventDate: "2026-09-01",
      venueName: "The Hall",
      doorTime: "19:00:00",
      startTime: "20:00:00",
    });
    expect(body.notes).toBeUndefined();
    expect(body.holdRank).toBeUndefined();
    expect(body.baseCurrency).toBeUndefined();
    expect(body.hostProfileId).toBeUndefined();
  });

  it("404s an unpublished event", async () => {
    const eventId = await seedEvent("draft-owner", false);
    const response = await app.inject({ method: "GET", url: `/api/v1/public/events/${eventId}` });
    expect(response.statusCode).toBe(404);
  });
});

describe("public RSVP", () => {
  it("inserts an RSVP, then 409s a duplicate (event,email)", async () => {
    const eventId = await seedEvent("rsvp-owner", true);

    const first = await app.inject({
      method: "POST",
      url: `/api/v1/public/events/${eventId}/rsvp`,
      payload: { name: "Ada", email: "ada@example.com", city: "Stockholm" },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ ok: true });

    const rows = await harness.db
      .select()
      .from(schema.audienceRsvps)
      .where(eq(schema.audienceRsvps.eventId, eventId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.email).toBe("ada@example.com");

    const duplicate = await app.inject({
      method: "POST",
      url: `/api/v1/public/events/${eventId}/rsvp`,
      payload: { email: "ada@example.com" },
    });
    expect(duplicate.statusCode).toBe(409);
  });
});
