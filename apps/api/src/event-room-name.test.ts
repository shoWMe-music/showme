import { PRESET_PERMISSION_SETS } from "@showme/auth";
import { schema } from "@showme/db";
import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import { eq } from "drizzle-orm";
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

/**
 * THE VENUE YOU TYPED THE NAME OF (QA sweep run 10, QA10-5).
 *
 * The Venue field is a picker; typing the exact name of your own room and moving on used to leave
 * `venue_profile_id` NULL, and every consequence of that is silent — `venueInRegion()` returns false
 * on a null venue, so a represented act's agent is never attached and never told (decisions #14),
 * there is no country stamp for the PRO rate or the currency (#17), and no double-booking check.
 *
 * These tests are the boundary of a deliberately narrow backstop: the caller's OWN operator profiles,
 * an exact name match, exactly one of them. Everything outside that stays NULL, which is the honest
 * answer — the server is doing what the operator plainly meant, not guessing which room they meant.
 */
describe("the venue an operator typed the exact name of (QA10-5)", () => {
  it("links the operator's own venue, and carries what that venue knows", async () => {
    const operator = await seedOperator("vn-own");
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers: headers(operator.userId, operator.profileId),
      // No `venueProfileId` — the shape the wizard sends when the suggestion was not clicked.
      payload: { baseCurrency: "SEK", title: "Typed Venue Night", venueName: "vn-own" },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().venueProfileId).toBe(operator.profileId);
  });

  it("is case- and space-insensitive, because a typed name is typed by a person", async () => {
    const operator = await seedOperator("vn-case");
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers: headers(operator.userId, operator.profileId),
      payload: { baseCurrency: "SEK", title: "Casing Night", venueName: "  VN-CASE " },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().venueProfileId).toBe(operator.profileId);
  });

  it("leaves a venue that is NOT the caller's own unlinked", async () => {
    /*
     * The important half. Matching on name alone across every profile would link a booking to a room
     * nobody chose, and would answer a question about which profiles exist to somebody who cannot
     * read them. A stranger's exact name stays free text, exactly as it did before.
     */
    const operator = await seedOperator("vn-me");
    const stranger = await seedOperator("vn-stranger");
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers: headers(operator.userId, operator.profileId),
      payload: { baseCurrency: "SEK", title: "Somebody Else's Room", venueName: "vn-stranger" },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().venueProfileId).toBeNull();
    expect(response.json().venueName).toBe("vn-stranger");
    expect(stranger.profileId).not.toBe(operator.profileId);
  });

  it("leaves a name that matches nothing alone — a room off the platform is still bookable", async () => {
    const operator = await seedOperator("vn-offplatform");
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers: headers(operator.userId, operator.profileId),
      payload: {
        baseCurrency: "SEK",
        title: "Off-platform Night",
        venueName: "A Room With No Account",
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().venueProfileId).toBeNull();
    expect(response.json().venueName).toBe("A Room With No Account");
  });

  it("declines to guess between two of the operator's own profiles with the same name", async () => {
    /*
     * The docstring claims this and a surviving mutation showed nothing proved it. Two rooms of your
     * own called the same thing is a real ambiguity, and picking the first row a query happens to
     * return would link a booking to whichever one the planner felt like.
     */
    const operator = await seedOperator("vn-dup-a");
    const twin = await seedOperator("vn-dup-b");
    await harness.db
      .insert(schema.profileMembers)
      .values({
        profileId: twin.profileId,
        userId: operator.userId,
        role: "admin",
        status: "active",
      });
    // Both of the caller's profiles now carry the same name.
    await harness.db
      .update(schema.profiles)
      .set({ name: "The Same Room" })
      .where(eq(schema.profiles.id, operator.profileId));
    await harness.db
      .update(schema.profiles)
      .set({ name: "The Same Room" })
      .where(eq(schema.profiles.id, twin.profileId));

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers: headers(operator.userId, operator.profileId),
      payload: { baseCurrency: "SEK", title: "Ambiguous Room", venueName: "The Same Room" },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().venueProfileId).toBeNull();
    expect(response.json().venueName).toBe("The Same Room");
  });

  it("never links a non-operator profile of the caller's as the venue", async () => {
    /*
     * The other surviving mutation. An operator who also performs owns a PERFORMER profile, and an
     * act's profile is not a room: linking it would put a venue's capacity, curfew and country
     * lookups against something that has none, and would stamp the event's territory from the wrong
     * place (#17).
     */
    const operator = await seedOperator("vn-kind-op");
    const alsoPerforms = await seedOperator("vn-kind-band");
    await harness.db.insert(schema.profileMembers).values({
      profileId: alsoPerforms.profileId,
      userId: operator.userId,
      role: "owner",
      status: "active",
    });
    await harness.db
      .update(schema.profiles)
      .set({ kind: "performer", name: "Both Hats" })
      .where(eq(schema.profiles.id, alsoPerforms.profileId));

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers: headers(operator.userId, operator.profileId),
      payload: { baseCurrency: "SEK", title: "Wrong Kind", venueName: "Both Hats" },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().venueProfileId).toBeNull();
  });

  it("never overrides a venue the operator actually picked", async () => {
    // A picked profile is a decision; the backstop only ever fills a blank.
    const operator = await seedOperator("vn-picked");
    const other = await seedOperator("vn-picked-other");
    await harness.db.insert(schema.profileMembers).values({
      profileId: other.profileId,
      userId: operator.userId,
      role: "admin",
      status: "active",
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers: headers(operator.userId, operator.profileId),
      // The name says one of their profiles; the id says the other. The id wins.
      payload: {
        baseCurrency: "SEK",
        title: "Picked Wins",
        venueName: "vn-picked",
        venueProfileId: other.profileId,
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().venueProfileId).toBe(other.profileId);
  });
});

/**
 * …AND WHAT LINKING IT BUYS: the agent hears about the booking (QA10-5, decisions #14).
 *
 * The end of the chain the sweep found broken, asserted rather than inferred.
 * `venueInRegion()` opens `if (!venueProfileId) return false`, so on the wizard's typed-name path no
 * representation could ever match: `autoAssignAgentOnPerformerJoin` returned an empty list — silently,
 * because an empty list is also the right answer for an unrepresented act — and the agency was never
 * attached and never told. One line of the same test proves the backstop and its consequence.
 */
describe("a typed venue still reaches the act's agent (QA10-5)", () => {
  it("attaches the agency and tells it, on an event whose venue was only typed", async () => {
    const { db } = harness;
    const operator = await seedOperator("vn-agent-op");
    // The venue's COUNTRY is what a representation's region is matched against (#17).
    await db
      .insert(schema.profileLocations)
      .values({ profileId: operator.profileId, country: "SE", city: "Stockholm", isPrimary: true });

    const act = await seedOperator("vn-agent-act");
    const agency = await seedOperator("vn-agent-agency");
    await db
      .update(schema.profiles)
      .set({ kind: "performer" })
      .where(eq(schema.profiles.id, act.profileId));
    await db
      .update(schema.profiles)
      .set({ kind: "agent" })
      .where(eq(schema.profiles.id, agency.profileId));
    // An ACTIVE, {SE}-region representation — the shape the seeded agency has.
    await db.insert(schema.representations).values({
      agentProfileId: agency.profileId,
      performerProfileId: act.profileId,
      region: ["SE"],
      commissionRate: 1500,
      proposedBy: "agent",
      status: "active",
      confirmedByAgent: true,
      confirmedByPerformer: true,
    });

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers: headers(operator.userId, operator.profileId),
      payload: {
        baseCurrency: "SEK",
        title: "Typed Venue, Represented Act",
        // TYPED, not picked — the whole point.
        venueName: "vn-agent-op",
        participants: [{ profileId: act.profileId, role: "performer" }],
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().venueProfileId).toBe(operator.profileId);
    const eventId = created.json().id as string;

    // The agency is ON the event…
    const participants = await db
      .select()
      .from(schema.eventParticipants)
      .where(eq(schema.eventParticipants.eventId, eventId));
    expect(
      participants.some((row) => row.profileId === agency.profileId && row.role === "agent"),
    ).toBe(true);

    // …and was TOLD, which is the half decisions #14 names explicitly.
    const bell = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, "vn-agent-agency"));
    expect(bell.length).toBeGreaterThan(0);
  });
});
