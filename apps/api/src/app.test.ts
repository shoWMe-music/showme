import { PRESET_PERMISSION_SETS } from "@showme/auth";
import { schema } from "@showme/db";
import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app";
import type { TokenVerifier } from "./auth/token-verifier";

/** Fake verifier: the bearer token IS the uid, so tests just send `Bearer <uid>`. */
const fakeVerifier: TokenVerifier = {
  async verify(token: string) {
    return { uid: token, email: `${token}@example.showme.test`, name: token };
  },
};

let harness: TestDatabase;
let app: FastifyInstance;

beforeAll(async () => {
  harness = await startTestDatabase();
  app = buildApp({ database: harness.db, tokenVerifier: fakeVerifier });
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await harness?.stop();
});

/** Seed a provisioned user (bare — no memberships). */
async function seedUser(id: string, kind: "operator" | "performer") {
  await harness.db.insert(schema.users).values({ id, email: `${id}@example.showme.test`, kind });
}

/** Seed a user + profile + active membership + a permission set, return the ids. */
async function seedMemberWithSet(
  id: string,
  kind: "operator" | "performer",
  capabilities: readonly string[],
) {
  const { db } = harness;
  await seedUser(id, kind);
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

const auth = (uid: string) => ({ authorization: `Bearer ${uid}` });

describe("pipeline plumbing", () => {
  it("serves the public health route without auth", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });

  it("rejects an authed route with no token", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/me" });
    expect(response.statusCode).toBe(401);
  });

  it("JIT-provisions a user on first session, then reflects it at /me", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/auth/session",
      headers: auth("newbie"),
      payload: { kind: "operator", name: "Newbie" },
    });
    expect(created.statusCode).toBe(200);
    expect(created.json()).toMatchObject({ userId: "newbie", kind: "operator", memberships: [] });

    const me = await app.inject({ method: "GET", url: "/api/v1/me", headers: auth("newbie") });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ userId: "newbie", isAdmin: false });
  });

  it("refuses to provision a new user without a kind", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/session",
      headers: auth("kindless"),
      payload: {},
    });
    expect(response.statusCode).toBe(400);
  });
});

describe("events — authorize + serialize + audit", () => {
  it("serializes the hold rank for operators but redacts it for performers", async () => {
    const { db } = harness;
    const operator = await seedMemberWithSet(
      "ev-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const performer = await seedMemberWithSet(
      "ev-perf",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );

    const [event] = await db
      .insert(schema.events)
      .values({
        hostProfileId: operator.profileId,
        title: "Hold Night",
        baseCurrency: "SEK",
        status: "on_hold",
        holdRank: 2,
        createdBy: "ev-op",
      })
      .returning();
    if (!event) throw new Error("event seed failed");
    await db.insert(schema.eventParticipants).values([
      {
        eventId: event.id,
        profileId: operator.profileId,
        role: "host",
        permissionSetId: operator.permissionSetId,
      },
      {
        eventId: event.id,
        profileId: performer.profileId,
        role: "performer",
        permissionSetId: performer.permissionSetId,
      },
    ]);

    const asOperator = await app.inject({
      method: "GET",
      url: `/api/v1/events/${event.id}`,
      headers: auth("ev-op"),
    });
    expect(asOperator.statusCode).toBe(200);
    expect(asOperator.json().holdRank).toBe(2); // operator sees the rank

    const asPerformer = await app.inject({
      method: "GET",
      url: `/api/v1/events/${event.id}`,
      headers: auth("ev-perf"),
    });
    expect(asPerformer.statusCode).toBe(200);
    expect(asPerformer.json().title).toBe("Hold Night"); // authorized to view
    expect(asPerformer.json().holdRank).toBeUndefined(); // but never the rank
  });

  it("404s an event the caller cannot reach (no existence leak)", async () => {
    const { db } = harness;
    const operator = await seedMemberWithSet(
      "ev-owner",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    await seedUser("ev-stranger", "operator");
    const [event] = await db
      .insert(schema.events)
      .values({
        hostProfileId: operator.profileId,
        title: "Private",
        baseCurrency: "EUR",
        createdBy: "ev-owner",
      })
      .returning();
    if (!event) throw new Error("event seed failed");
    await db.insert(schema.eventParticipants).values({
      eventId: event.id,
      profileId: operator.profileId,
      role: "host",
      permissionSetId: operator.permissionSetId,
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/events/${event.id}`,
      headers: auth("ev-stranger"),
    });
    expect(response.statusCode).toBe(404);
  });

  it("edits an event and writes an audit row; forbids a performer", async () => {
    const { db } = harness;
    const operator = await seedMemberWithSet(
      "ed-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const performer = await seedMemberWithSet(
      "ed-perf",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );
    const [event] = await db
      .insert(schema.events)
      .values({
        hostProfileId: operator.profileId,
        title: "Before",
        baseCurrency: "EUR",
        createdBy: "ed-op",
      })
      .returning();
    if (!event) throw new Error("event seed failed");
    await db.insert(schema.eventParticipants).values([
      {
        eventId: event.id,
        profileId: operator.profileId,
        role: "host",
        permissionSetId: operator.permissionSetId,
      },
      {
        eventId: event.id,
        profileId: performer.profileId,
        role: "performer",
        permissionSetId: performer.permissionSetId,
      },
    ]);

    const edit = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${event.id}`,
      headers: auth("ed-op"),
      payload: { title: "After" },
    });
    expect(edit.statusCode).toBe(200);
    expect(edit.json().title).toBe("After");

    const auditRows = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, event.id));
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.action).toBe("event.update");
    expect(auditRows[0]?.actorUserId).toBe("ed-op");

    const forbidden = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${event.id}`,
      headers: auth("ed-perf"),
      payload: { title: "Nope" },
    });
    expect(forbidden.statusCode).toBe(403);
  });
});

describe("the deal the create wizard states (ClickUp 86cbaxu52)", () => {
  /**
   * The wizard's second step used to post its terms as `extras.dealDraft`, which
   * nothing read: the operator typed a guarantee and a split, the screen said the
   * settlement was being set up, and `select count(*) from deals` answered 0.
   * These pin the two halves that fix it — the deal is really written, and a deal
   * the engine could not reconcile is refused rather than written as nothing.
   */
  it("writes the stated deal as real deals + deal_parties rows, with the party joined to the event", async () => {
    const { db } = harness;
    const operator = await seedMemberWithSet(
      "deal-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const performer = await seedMemberWithSet(
      "deal-perf",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers: { ...auth("deal-op"), "x-profile-id": operator.profileId },
      payload: {
        title: "Nils Frahm",
        baseCurrency: "SEK",
        participants: [{ profileId: performer.profileId, role: "performer" }],
        deal: {
          type: "performance",
          structure: "guarantee_vs_door",
          name: "deal-perf",
          // Minor units as a string (money.md) — 5 000.00 SEK.
          guaranteeAmount: "500000",
          splitBasisPoints: 7000,
          paymentTiming: "at_settlement",
          parties: [
            { profileId: operator.profileId, roleInDeal: "payer" },
            { profileId: performer.profileId, roleInDeal: "payee" },
          ],
        },
      },
    });
    expect(created.statusCode).toBe(201);
    const eventId = created.json().id;

    const deals = await db.select().from(schema.deals).where(eq(schema.deals.eventId, eventId));
    expect(deals).toHaveLength(1);
    const deal = deals[0];
    if (!deal) throw new Error("deal missing");
    expect(deal).toMatchObject({
      type: "performance",
      structure: "guarantee_vs_door",
      currency: "SEK",
      guaranteeAmount: 500000n,
      splitBasisPoints: 7000,
      // Terms one side typed are a proposal until the parties confirm them.
      status: "draft",
    });

    const participants = await db
      .select()
      .from(schema.eventParticipants)
      .where(eq(schema.eventParticipants.eventId, eventId));
    expect(participants).toHaveLength(2);
    const performerParticipant = participants.find((row) => row.profileId === performer.profileId);
    expect(performerParticipant).toMatchObject({ role: "performer", status: "invited" });

    const parties = await db
      .select()
      .from(schema.dealParties)
      .where(eq(schema.dealParties.dealId, deal.id));
    expect(parties).toHaveLength(2);
    // Named by PROFILE on the wire, resolved to the participant rows this same
    // request created — that resolution is the whole point of the new fields.
    const payee = parties.find((party) => party.roleInDeal === "payee");
    expect(payee?.participantId).toBe(performerParticipant?.id);
    const payer = parties.find((party) => party.roleInDeal === "payer");
    expect(payer?.participantId).toBe(
      participants.find((row) => row.profileId === operator.profileId)?.id,
    );
  });

  it("refuses a structure with no figure for the engine to settle, and creates nothing", async () => {
    const { db } = harness;
    const operator = await seedMemberWithSet(
      "deal-op-bad",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const performer = await seedMemberWithSet(
      "deal-perf-bad",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );

    const refused = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers: { ...auth("deal-op-bad"), "x-profile-id": operator.profileId },
      payload: {
        title: "No figure",
        baseCurrency: "SEK",
        participants: [{ profileId: performer.profileId, role: "performer" }],
        deal: {
          type: "performance",
          // A guarantee that states no guarantee settles as nothing.
          structure: "guarantee",
          name: "deal-perf-bad",
          parties: [
            { profileId: operator.profileId, roleInDeal: "payer" },
            { profileId: performer.profileId, roleInDeal: "payee" },
          ],
        },
      },
    });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error.message).toMatch(/fixed amount/i);

    // Refused BEFORE the transaction — no half-made event left behind.
    const events = await db
      .select()
      .from(schema.events)
      .where(eq(schema.events.hostProfileId, operator.profileId));
    expect(events).toHaveLength(0);
  });

  it("refuses a deal party that is not on the event", async () => {
    const operator = await seedMemberWithSet(
      "deal-op-stranger",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const stranger = await seedMemberWithSet(
      "deal-stranger",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );

    const refused = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers: { ...auth("deal-op-stranger"), "x-profile-id": operator.profileId },
      payload: {
        title: "Reaching for a stranger",
        baseCurrency: "SEK",
        deal: {
          type: "performance",
          structure: "guarantee",
          name: "stranger",
          guaranteeAmount: "100000",
          parties: [
            { profileId: operator.profileId, roleInDeal: "payer" },
            { profileId: stranger.profileId, roleInDeal: "payee" },
          ],
        },
      },
    });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error.message).toMatch(/participant on this event/i);
  });

  it("refuses a nobody-is-paid agreement", async () => {
    const operator = await seedMemberWithSet(
      "deal-op-unpaid",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const performer = await seedMemberWithSet(
      "deal-perf-unpaid",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );

    const refused = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers: { ...auth("deal-op-unpaid"), "x-profile-id": operator.profileId },
      payload: {
        title: "Nobody is paid",
        baseCurrency: "SEK",
        participants: [{ profileId: performer.profileId, role: "performer" }],
        deal: {
          type: "performance",
          structure: "guarantee",
          name: "unpaid",
          guaranteeAmount: "100000",
          parties: [
            { profileId: operator.profileId, roleInDeal: "payer" },
            { profileId: performer.profileId, roleInDeal: "observer" },
          ],
        },
      },
    });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error.message).toMatch(/Nobody on this agreement is paid/i);
  });
});

describe("decisions #8 — concurrency & idempotency", () => {
  it("replays an idempotent create instead of making a second event", async () => {
    const { db } = harness;
    const operator = await seedMemberWithSet(
      "idem-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const headers = {
      ...auth("idem-op"),
      "x-profile-id": operator.profileId,
      "idempotency-key": "create-key-1",
    };

    const first = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers,
      payload: { title: "Fest", baseCurrency: "EUR" },
    });
    expect(first.statusCode).toBe(201);
    const firstId = first.json().id;

    const replay = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers,
      payload: { title: "Fest", baseCurrency: "EUR" },
    });
    expect(replay.statusCode).toBe(201);
    expect(replay.json().id).toBe(firstId); // same stored result

    const events = await db
      .select()
      .from(schema.events)
      .where(eq(schema.events.hostProfileId, operator.profileId));
    expect(events).toHaveLength(1); // not two
  });

  it("rejects a stale write with 409 (optimistic lock)", async () => {
    const operator = await seedMemberWithSet(
      "lock-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers: { ...auth("lock-op"), "x-profile-id": operator.profileId },
      payload: { title: "v1", baseCurrency: "EUR" },
    });
    const eventId = created.json().id;
    expect(created.json().version).toBe(1);

    const ok = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${eventId}`,
      headers: auth("lock-op"),
      payload: { title: "v2", expectedVersion: 1 },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().version).toBe(2);

    // Retry with the now-stale version → conflict.
    const stale = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${eventId}`,
      headers: auth("lock-op"),
      payload: { title: "v3", expectedVersion: 1 },
    });
    expect(stale.statusCode).toBe(409);
  });
});

describe("what a venue lends the show it hosts (ClickUp 86cbaxvku)", () => {
  /**
   * A venue writes its amenities, its PA, its catering, its rooms and its
   * load-in down ONCE, on its profile. Placing an event there copies them onto
   * the event — and it is a copy: an agreement freezes at confirmation, so a
   * venue that sells its PA in March must not rewrite what it promised in
   * January. These pin the copy, the receipt that explains it, and the fact that
   * the profile can never reach back into a show it already lent to.
   */
  async function seedVenue(id: string) {
    const venue = await seedMemberWithSet(id, "operator", PRESET_PERMISSION_SETS.operator_full);
    await harness.db.insert(schema.venueDetails).values({
      profileId: venue.profileId,
      capacity: 400,
      soundSystem: "d&b audiotechnik V-Series",
      curfew: "02:00",
      amenities: ["pa_system", "backline"],
      dealTypes: ["door_split", "rental"],
      cateringNotes: "Hot meal for up to six.",
      accommodationNotes: "Two twin rooms across the square.",
      artistLogisticsNotes: "Load-in through the courtyard gate.",
    });
    return venue;
  }

  it("copies the venue's own record onto the event, with a receipt naming what came from where", async () => {
    const venue = await seedVenue("carry-op");

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers: { ...auth("carry-op"), "x-profile-id": venue.profileId },
      payload: { title: "Copied", baseCurrency: "SEK", venueProfileId: venue.profileId },
    });
    expect(created.statusCode).toBe(201);
    const event = created.json();
    expect(event.capacity).toBe(400);
    expect(event.curfew).toBe("02:00:00");
    expect(event.extras.amenities).toEqual(["pa_system", "backline"]);
    expect(event.extras.soundSystem).toBe("d&b audiotechnik V-Series");
    expect(event.extras.cateringNotes).toBe("Hot meal for up to six.");
    expect(event.extras.accommodationNotes).toBe("Two twin rooms across the square.");
    expect(event.extras.artistLogisticsNotes).toBe("Load-in through the courtyard gate.");
    // The receipt is what lets the screen say where these came from — and offer
    // to take them off again.
    expect(event.extras.venueCarryOver.profileId).toBe(venue.profileId);
    expect(event.extras.venueCarryOver.fields).toContain("cateringNotes");

    // `deal_types` is an advertised PREFERENCE, not terms, and nothing on the
    // event settles from it — so it must not ride along as if it did.
    expect(event.extras.dealTypes).toBeUndefined();
  });

  it("never overwrites what the operator stated, and never re-syncs after a profile edit", async () => {
    const venue = await seedVenue("resync-op");

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers: { ...auth("resync-op"), "x-profile-id": venue.profileId },
      payload: {
        title: "Seated layout",
        baseCurrency: "SEK",
        venueProfileId: venue.profileId,
        capacity: 220,
        extras: { cateringNotes: "Vegan only, agreed with the promoter." },
      },
    });
    expect(created.statusCode).toBe(201);
    const eventId = created.json().id;
    expect(created.json().capacity).toBe(220);
    expect(created.json().extras.cateringNotes).toBe("Vegan only, agreed with the promoter.");

    // The venue sells its PA and rewrites its catering, AFTER the booking.
    await harness.db
      .update(schema.venueDetails)
      .set({ amenities: [], soundSystem: null, cateringNotes: "Sandwiches." })
      .where(eq(schema.venueDetails.profileId, venue.profileId));

    const read = await app.inject({
      method: "GET",
      url: `/api/v1/events/${eventId}`,
      headers: { ...auth("resync-op"), "x-profile-id": venue.profileId },
    });
    expect(read.json().extras.amenities).toEqual(["pa_system", "backline"]);
    expect(read.json().extras.soundSystem).toBe("d&b audiotechnik V-Series");
    expect(read.json().extras.cateringNotes).toBe("Vegan only, agreed with the promoter.");
  });

  it("puts a show in a room of the venue it is at, and refuses any other room", async () => {
    const venue = await seedVenue("room-op");
    const other = await seedVenue("room-other-op");
    const [backRoom] = await harness.db
      .insert(schema.stages)
      .values({ venueProfileId: venue.profileId, name: "Back Room", capacity: 80 })
      .returning();
    if (!backRoom) throw new Error("stage seed failed");

    const wrongVenue = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers: { ...auth("room-other-op"), "x-profile-id": other.profileId },
      payload: {
        title: "Wrong building",
        baseCurrency: "SEK",
        venueProfileId: other.profileId,
        stageId: backRoom.id,
      },
    });
    expect(wrongVenue.statusCode).toBe(400);
    expect(wrongVenue.json().error.message).toMatch(/does not belong to this venue/i);

    // The room's own capacity is the specific one, and it wins: 400 is the
    // building, and it caps ticket inventory for a room that holds 80.
    const inTheRoom = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers: { ...auth("room-op"), "x-profile-id": venue.profileId },
      payload: {
        title: "Back Room show",
        baseCurrency: "SEK",
        venueProfileId: venue.profileId,
        stageId: backRoom.id,
      },
    });
    expect(inTheRoom.statusCode).toBe(201);
    expect(inTheRoom.json().capacity).toBe(80);
  });
});
