import { PRESET_PERMISSION_SETS } from "@showme/auth";
import { schema } from "@showme/db";
import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TokenVerifier } from "./auth/token-verifier";
import { performingRightsRoutes } from "./routes/performing-rights";
import { buildTestApp } from "./testing";

/** Fake verifier: the bearer token IS the uid (mirrors app.test.ts). */
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
    performingRightsRoutes,
  ]);
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await harness?.stop();
});

const auth = (uid: string) => ({ authorization: `Bearer ${uid}` });

let seq = 0;

/** Seed a user + profile + active membership + a permission set. */
async function seedMemberWithSet(
  id: string,
  kind: "operator" | "performer",
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
    .values({
      profileId: profile.id,
      name: capabilities.join("+"),
      capabilities: [...capabilities],
    })
    .returning();
  if (!set) throw new Error("permission set seed failed");
  return { profileId: profile.id, permissionSetId: set.id };
}

/**
 * An operator-hosted event. `venueCountry` is the country recorded on the VENUE
 * profile's primary location — the only signal the resolver reads.
 */
async function seedEvent(options: { venueCountry?: string | null; venueProfile?: boolean } = {}) {
  const { db } = harness;
  const prefix = `pro-rate-${seq++}`;
  const operator = await seedMemberWithSet(
    `${prefix}-op`,
    "operator",
    PRESET_PERMISSION_SETS.operator_full,
  );
  const performer = await seedMemberWithSet(
    `${prefix}-perf`,
    "performer",
    PRESET_PERMISSION_SETS.performer,
  );

  if (options.venueCountry !== undefined && options.venueCountry !== null) {
    await db.insert(schema.profileLocations).values({
      profileId: operator.profileId,
      city: "Somewhere",
      country: options.venueCountry,
      isPrimary: true,
    });
  }

  const [event] = await db
    .insert(schema.events)
    .values({
      hostProfileId: operator.profileId,
      venueProfileId: options.venueProfile === false ? null : operator.profileId,
      title: `${prefix} event`,
      baseCurrency: "SEK",
      createdBy: `${prefix}-op`,
    })
    .returning();
  if (!event) throw new Error("event seed failed");

  await db.insert(schema.eventParticipants).values([
    {
      eventId: event.id,
      profileId: operator.profileId,
      role: "host",
      permissionSetId: operator.permissionSetId,
      status: "confirmed",
    },
    {
      eventId: event.id,
      profileId: performer.profileId,
      role: "performer",
      permissionSetId: performer.permissionSetId,
      status: "confirmed",
    },
  ]);

  return {
    eventId: event.id,
    operatorUid: `${prefix}-op`,
    operatorProfileId: operator.profileId,
    performerUid: `${prefix}-perf`,
  };
}

/** Configure a territory's rate directly, as an admin would through `/admin`. */
async function setRate(country: string, rateBasisPoints: number, proName = "STIM") {
  await harness.db
    .insert(schema.performingRightsRates)
    .values({ country, proCode: "stim", proName, rateBasisPoints })
    .onConflictDoUpdate({
      target: schema.performingRightsRates.country,
      set: { rateBasisPoints, proName },
    });
}

describe("GET /events/:id/performing-rights-rate", () => {
  it("resolves the venue's country and returns the tariff configured for it", async () => {
    const event = await seedEvent({ venueCountry: "SE" });
    await setRate("SE", 750);

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/events/${event.eventId}/performing-rights-rate`,
      headers: auth(event.operatorUid),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      country: "SE",
      rate: { proCode: "stim", proName: "STIM", rateBasisPoints: 750 },
    });
  });

  /**
   * The honesty branch, and the one that must never quietly become a rate. A
   * country we can place with nothing configured for it returns the country and a
   * NULL rate — which is what makes the planner keep its "estimate only" card.
   */
  it("returns the country with a null rate when that territory is unconfigured", async () => {
    const event = await seedEvent({ venueCountry: "FR" });

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/events/${event.eventId}/performing-rights-rate`,
      headers: auth(event.operatorUid),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ country: "FR", rate: null });
  });

  it("returns a null country when the event has no venue profile", async () => {
    const event = await seedEvent({ venueProfile: false });

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/events/${event.eventId}/performing-rights-rate`,
      headers: auth(event.operatorUid),
    });

    expect(response.json()).toEqual({ country: null, rate: null });
  });

  it("returns a null country when the venue has recorded no location", async () => {
    const event = await seedEvent({ venueCountry: null });

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/events/${event.eventId}/performing-rights-rate`,
      headers: auth(event.operatorUid),
    });

    expect(response.json()).toEqual({ country: null, rate: null });
  });

  /**
   * A rate stored lowercase still governs the territory. The admin route
   * normalizes on the way in, so this can only happen to a row written by hand —
   * but a tariff that silently governs nothing is the worst failure this feature
   * has, so the read side normalizes too.
   */
  it("matches a rate whatever case the venue's country was recorded in", async () => {
    const event = await seedEvent({ venueCountry: "de" });
    await setRate("DE", 800, "GEMA");

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/events/${event.eventId}/performing-rights-rate`,
      headers: auth(event.operatorUid),
    });

    expect(response.json()).toMatchObject({ country: "DE", rate: { rateBasisPoints: 800 } });
  });

  /**
   * Gated with the planner it feeds: `budget.view` is operator-only, so a
   * performer on the bill gets the same 403 here as on the budget itself. The
   * assertion is on the REASON, not the bare status (verify-e2e: "right status,
   * wrong reason" is a false pass).
   */
  it("refuses a performer on the bill for the missing budget capability", async () => {
    const event = await seedEvent({ venueCountry: "SE" });

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/events/${event.eventId}/performing-rights-rate`,
      headers: auth(event.performerUid),
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.message).toContain("budget.view");
  });

  /** No standing at all reads as "no such event" — the engine never confirms it exists. */
  it("is 404 for someone with no standing on the event at all", async () => {
    const event = await seedEvent({ venueCountry: "SE" });
    const outsiderUid = `pro-rate-outsider-${seq++}`;
    await seedMemberWithSet(outsiderUid, "operator", PRESET_PERMISSION_SETS.operator_full);

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/events/${event.eventId}/performing-rights-rate`,
      headers: auth(outsiderUid),
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.message).toContain("Event not found");
  });
});
