import { PRESET_PERMISSION_SETS } from "@showme/auth";
import { schema } from "@showme/db";
import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TokenVerifier } from "./auth/token-verifier";
import { inboundRoutes } from "./routes/inbound";
import { buildTestApp } from "./testing";

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
  app = buildTestApp({ database: harness.db, tokenVerifier: fakeVerifier }, [inboundRoutes]);
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await harness?.stop();
});

const auth = (uid: string) => ({ authorization: `Bearer ${uid}` });

/** A bare provisioned user (no memberships). */
async function seedUser(id: string, kind: "operator" | "performer") {
  await harness.db.insert(schema.users).values({ id, email: `${id}@example.com`, kind });
}

/** Seed an owner + their claimed profile + an operator_full permission set. */
async function seedOwnerWithProfile(id: string, kind: "operator" | "performer" = "operator") {
  const { db } = harness;
  await seedUser(id, kind);
  const [profile] = await db
    .insert(schema.profiles)
    .values({ kind, ownerUserId: id, name: id, slug: id, claimedAt: new Date() })
    .returning();
  if (!profile) throw new Error("profile seed failed");
  await db
    .insert(schema.profileMembers)
    .values({ profileId: profile.id, userId: id, role: "owner", status: "active" });
  const preset =
    kind === "operator" ? PRESET_PERMISSION_SETS.operator_full : PRESET_PERMISSION_SETS.performer;
  const [set] = await db
    .insert(schema.permissionSets)
    .values({ profileId: profile.id, name: "set", capabilities: [...preset] })
    .returning();
  if (!set) throw new Error("permission set seed failed");
  return { profileId: profile.id, permissionSetId: set.id };
}

/** Seed an event hosted by `profileId`, with that profile as its host participant. */
async function seedEvent(hostProfileId: string, permissionSetId: string, createdBy: string) {
  const { db } = harness;
  const [event] = await db
    .insert(schema.events)
    .values({ hostProfileId, title: "Handoff Night", baseCurrency: "SEK", createdBy })
    .returning();
  if (!event) throw new Error("event seed failed");
  await db.insert(schema.eventParticipants).values({
    eventId: event.id,
    profileId: hostProfileId,
    role: "host",
    permissionSetId,
  });
  return event;
}

describe("inbound — public booking request + listing", () => {
  it("accepts an anonymous public-form request; the target's owner lists it", async () => {
    const owner = await seedOwnerWithProfile("inb-owner");

    // PUBLIC — no Authorization header at all.
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/booking-requests",
      payload: {
        source: "public_form",
        targetProfileId: owner.profileId,
        contactName: "Ada Booker",
        email: "ada@example.com",
        artistName: "The Adas",
        wantedDate: "2026-09-01",
        pitch: "We would love to play",
        offerFeeMin: "50000",
        offerFeeMax: "120000",
      },
    });
    expect(created.statusCode).toBe(201);
    const createdId = created.json().id;
    expect(typeof createdId).toBe("string");

    const listed = await app.inject({
      method: "GET",
      url: "/api/v1/booking-requests",
      headers: auth("inb-owner"),
    });
    expect(listed.statusCode).toBe(200);
    const rows = listed.json().items;
    const match = rows.find((row: { id: string }) => row.id === createdId);
    expect(match).toBeDefined();
    expect(match.source).toBe("public_form");
    expect(match.status).toBe("pending");
    expect(match.offerFeeMin).toBe("50000"); // bigint → string on the wire
    expect(match.offerFeeMax).toBe("120000");
  });

  it("lets the owner PATCH status but 404s a non-owner", async () => {
    const owner = await seedOwnerWithProfile("inb-po");
    await seedOwnerWithProfile("inb-stranger");

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/booking-requests",
      payload: {
        source: "public_form",
        targetProfileId: owner.profileId,
        contactName: "Ben",
        email: "ben@example.com",
      },
    });
    const id = created.json().id;

    const strangerPatch = await app.inject({
      method: "PATCH",
      url: `/api/v1/booking-requests/${id}`,
      headers: auth("inb-stranger"),
      payload: { status: "accepted" },
    });
    expect([403, 404]).toContain(strangerPatch.statusCode);

    const ownerPatch = await app.inject({
      method: "PATCH",
      url: `/api/v1/booking-requests/${id}`,
      headers: auth("inb-po"),
      payload: { status: "accepted" },
    });
    expect(ownerPatch.statusCode).toBe(200);
    expect(ownerPatch.json().status).toBe("accepted");

    const audit = await harness.db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, id));
    expect(audit.some((row) => row.action === "booking_request.update")).toBe(true);
  });
});

describe("inbound — performer offers", () => {
  it("creates an offer and 409s a duplicate pending offer for the same target+date", async () => {
    const target = await seedOwnerWithProfile("inb-tgt");
    const performer = await seedOwnerWithProfile("inb-perf", "performer");
    const headers = { ...auth("inb-perf"), "x-profile-id": performer.profileId };

    const first = await app.inject({
      method: "POST",
      url: "/api/v1/offers",
      headers,
      payload: {
        targetProfileId: target.profileId,
        wantedDate: "2026-10-10",
        offerFeeMin: "80000",
        offerFeeMax: "150000",
      },
    });
    expect(first.statusCode).toBe(201);
    expect(first.json().source).toBe("performer_offer");

    const duplicate = await app.inject({
      method: "POST",
      url: "/api/v1/offers",
      headers,
      payload: { targetProfileId: target.profileId, wantedDate: "2026-10-10" },
    });
    expect(duplicate.statusCode).toBe(409);
  });
});

describe("inbound — spam flag", () => {
  it("409s a second flag with the same kind from the same reporter", async () => {
    const target = await seedOwnerWithProfile("inb-spam-tgt");
    const reporter = await seedOwnerWithProfile("inb-spam-rep", "performer");

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/booking-requests",
      payload: {
        source: "public_form",
        targetProfileId: target.profileId,
        contactName: "Spammer",
        email: "spam@example.com",
      },
    });
    const id = created.json().id;
    const headers = { ...auth("inb-spam-rep"), "x-profile-id": reporter.profileId };

    const first = await app.inject({
      method: "POST",
      url: `/api/v1/booking-requests/${id}/flag-spam`,
      headers,
      payload: { kind: "unsolicited" },
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: "POST",
      url: `/api/v1/booking-requests/${id}/flag-spam`,
      headers,
      payload: { kind: "unsolicited" },
    });
    expect(second.statusCode).toBe(409);
  });
});

describe("inbound — venue handoff", () => {
  it("creates an unclaimed stub profile and a venue_handoff invitation", async () => {
    const owner = await seedOwnerWithProfile("inb-ho");
    const event = await seedEvent(owner.profileId, owner.permissionSetId, "inb-ho");

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/handoff`,
      headers: { ...auth("inb-ho"), "x-profile-id": owner.profileId },
      payload: { name: "New Venue" },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(typeof body.profileId).toBe("string");
    expect(typeof body.invitationId).toBe("string");

    const [stub] = await harness.db
      .select()
      .from(schema.profiles)
      .where(eq(schema.profiles.id, body.profileId));
    expect(stub).toBeDefined();
    expect(stub?.kind).toBe("operator");
    expect(stub?.claimedAt).toBeNull(); // unclaimed stub

    const [invitation] = await harness.db
      .select()
      .from(schema.invitations)
      .where(
        and(
          eq(schema.invitations.targetEventId, event.id),
          eq(schema.invitations.targetProfileId, body.profileId),
        ),
      );
    expect(invitation).toBeDefined();
    expect(invitation?.source).toBe("venue_handoff");
    expect(invitation?.type).toBe("event_participant");
  });
});

describe("inbound — send_offer entitlement gate (decisions #4/§C)", () => {
  /** Fill an artist's month with existing offers to sit at the free-tier cap (50). */
  async function fillOffers(senderUserId: string, targetProfileId: string, count: number) {
    const day = (i: number) =>
      `2027-${String(1 + Math.floor(i / 28)).padStart(2, "0")}-${String(1 + (i % 28)).padStart(2, "0")}`;
    await harness.db.insert(schema.bookingRequests).values(
      Array.from({ length: count }, (_, i) => ({
        source: "performer_offer" as const,
        status: "pending" as const,
        targetProfileId,
        senderUserId,
        wantedDate: day(i),
      })),
    );
  }

  it("blocks a free artist who has hit the monthly offer cap", async () => {
    const target = await seedOwnerWithProfile("off-tgt");
    const performer = await seedOwnerWithProfile("off-perf", "performer"); // no plan → free_artist
    await fillOffers("off-perf", target.profileId, 50);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/offers",
      headers: { ...auth("off-perf"), "x-profile-id": performer.profileId },
      payload: { targetProfileId: target.profileId, wantedDate: "2027-09-09" },
    });
    expect(response.statusCode).toBe(403);
  });

  it("lets a paid (artist_pro) artist send past the free cap", async () => {
    const target = await seedOwnerWithProfile("offp-tgt");
    const performer = await seedOwnerWithProfile("offp-perf", "performer");
    await harness.db
      .insert(schema.plans)
      .values({ profileId: performer.profileId, tier: "artist_pro" });
    await fillOffers("offp-perf", target.profileId, 50);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/offers",
      headers: { ...auth("offp-perf"), "x-profile-id": performer.profileId },
      payload: { targetProfileId: target.profileId, wantedDate: "2027-09-09" },
    });
    expect(response.statusCode).toBe(201);
  });
});
