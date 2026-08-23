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

type AccountKind = "operator" | "performer" | "agent";

/** The full name a seeded person carries — what an offer should fall back to. */
const personName = (id: string) => `${id} Person`;
/** The display name a seeded profile carries — what an act should fall back to. */
const profileName = (id: string) => `${id} Profile`;

/** A bare provisioned user (no memberships). */
async function seedUser(id: string, kind: AccountKind) {
  await harness.db
    .insert(schema.users)
    .values({ id, email: `${id}@example.com`, name: personName(id), kind });
}

/** Seed an owner + their claimed profile + a permission set matching the kind. */
async function seedOwnerWithProfile(id: string, kind: AccountKind = "operator") {
  const { db } = harness;
  await seedUser(id, kind);
  const [profile] = await db
    .insert(schema.profiles)
    .values({ kind, ownerUserId: id, name: profileName(id), slug: id, claimedAt: new Date() })
    .returning();
  if (!profile) throw new Error("profile seed failed");
  await db
    .insert(schema.profileMembers)
    .values({ profileId: profile.id, userId: id, role: "owner", status: "active" });
  const preset =
    kind === "operator"
      ? PRESET_PERMISSION_SETS.operator_full
      : kind === "agent"
        ? PRESET_PERMISSION_SETS.agent
        : PRESET_PERMISSION_SETS.performer;
  const [set] = await db
    .insert(schema.permissionSets)
    .values({ profileId: profile.id, name: "set", capabilities: [...preset] })
    .returning();
  if (!set) throw new Error("permission set seed failed");
  return { profileId: profile.id, permissionSetId: set.id };
}

/** A representation row linking an agent to a performer, in whatever state. */
async function seedRepresentation(
  agentProfileId: string,
  performerProfileId: string,
  status: "proposed" | "active" | "terminated",
  terminatedEffectiveAt: Date | null = null,
) {
  await harness.db.insert(schema.representations).values({
    agentProfileId,
    performerProfileId,
    region: ["SE"],
    commissionRate: 1000,
    proposedBy: "agent",
    status,
    confirmedByAgent: true,
    confirmedByPerformer: status === "active",
    terminatedEffectiveAt,
  });
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

describe("inbound — an offer names its sender (audit A-24)", () => {
  it("carries the sender's identity and pitch end-to-end, defaulting what was omitted", async () => {
    const target = await seedOwnerWithProfile("id-tgt");
    const performer = await seedOwnerWithProfile("id-perf", "performer");
    const headers = { ...auth("id-perf"), "x-profile-id": performer.profileId };

    // Deliberately omits contactName / email / artistName — they must be DERIVED,
    // never left null, or the venue's inbox shows an anonymous row.
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/offers",
      headers,
      payload: {
        targetProfileId: target.profileId,
        wantedDate: "2026-10-11",
        offerFeeMin: "80000",
        pitch: "  Four-piece indie rock, touring in October.  ",
        note: "Self-booked.",
        musicUrl: "https://open.spotify.example/id-perf",
      },
    });
    expect(created.statusCode).toBe(201);
    const offer = created.json();
    expect(offer.senderProfileId).toBe(performer.profileId);
    expect(offer.senderType).toBe("performer");
    expect(offer.contactName).toBe(personName("id-perf"));
    expect(offer.email).toBe("id-perf@example.com");
    expect(offer.artistName).toBe(profileName("id-perf"));
    // Sanitized: control characters stripped, whitespace collapsed and trimmed.
    expect(offer.pitch).toBe("Four-piece indie rock, touring in October.");
    expect(offer.note).toBe("Self-booked.");
    expect(offer.musicUrl).toBe("https://open.spotify.example/id-perf");
    expect(offer.onBehalfOfProfileId).toBeNull();

    // The row itself, not just the response — the write path is what A-24 broke.
    const [row] = await harness.db
      .select()
      .from(schema.bookingRequests)
      .where(eq(schema.bookingRequests.id, offer.id));
    expect(row?.contactName).toBe(personName("id-perf"));
    expect(row?.email).toBe("id-perf@example.com");
    expect(row?.artistName).toBe(profileName("id-perf"));
    expect(row?.pitch).toBe("Four-piece indie rock, touring in October.");

    // …and the venue's INCOMING inbox shows who is offering.
    const inbox = await app.inject({
      method: "GET",
      url: "/api/v1/booking-requests?direction=incoming",
      headers: auth("id-tgt"),
    });
    expect(inbox.statusCode).toBe(200);
    const listed = inbox.json().items.find((item: { id: string }) => item.id === offer.id);
    expect(listed).toBeDefined();
    expect(listed.senderProfileId).toBe(performer.profileId);
    expect(listed.contactName).toBe(personName("id-perf"));
    expect(listed.artistName).toBe(profileName("id-perf"));
    expect(listed.pitch).toBe("Four-piece indie rock, touring in October.");
  });

  it("prefers an explicitly stated identity over the derived default", async () => {
    const target = await seedOwnerWithProfile("id-tgt2");
    const performer = await seedOwnerWithProfile("id-perf2", "performer");

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/offers",
      headers: { ...auth("id-perf2"), "x-profile-id": performer.profileId },
      payload: {
        targetProfileId: target.profileId,
        wantedDate: "2026-10-12",
        contactName: "Ada Booker",
        email: "Ada@Example.COM",
        artistName: "The Adas",
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().contactName).toBe("Ada Booker");
    expect(created.json().email).toBe("ada@example.com"); // normalized
    expect(created.json().artistName).toBe("The Adas");
  });

  it("rejects a malformed email rather than storing it", async () => {
    const target = await seedOwnerWithProfile("id-tgt3");
    const performer = await seedOwnerWithProfile("id-perf3", "performer");

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/offers",
      headers: { ...auth("id-perf3"), "x-profile-id": performer.profileId },
      payload: {
        targetProfileId: target.profileId,
        wantedDate: "2026-10-13",
        email: "not-an-email",
      },
    });
    expect(created.statusCode).toBe(400);
  });
});

describe("inbound — an agent offers on behalf of the act it represents (decisions #14)", () => {
  it("names the ACT, not the agency, when an active representation covers the pair", async () => {
    const target = await seedOwnerWithProfile("ob-tgt");
    const performer = await seedOwnerWithProfile("ob-perf", "performer");
    const agent = await seedOwnerWithProfile("ob-agent", "agent");
    await seedRepresentation(agent.profileId, performer.profileId, "active");

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/offers",
      headers: { ...auth("ob-agent"), "x-profile-id": agent.profileId },
      payload: {
        targetProfileId: target.profileId,
        wantedDate: "2026-11-07",
        offerFeeMin: "2500000",
        offerFeeMax: "3200000",
        onBehalfOfProfileId: performer.profileId,
        pitch: "Headline slot, routing through Stockholm in November.",
      },
    });
    expect(created.statusCode).toBe(201);
    const offer = created.json();
    expect(offer.onBehalfOfProfileId).toBe(performer.profileId);
    expect(offer.onBehalfOfName).toBe(profileName("ob-perf"));
    expect(offer.artistName).toBe(profileName("ob-perf")); // the ACT, not the agency
    expect(offer.contactName).toBe(personName("ob-agent")); // the agency is still visible
    expect(offer.senderProfileId).toBe(agent.profileId);
    expect(offer.senderType).toBe("agency");

    const inbox = await app.inject({
      method: "GET",
      url: "/api/v1/booking-requests?direction=incoming",
      headers: auth("ob-tgt"),
    });
    const listed = inbox.json().items.find((item: { id: string }) => item.id === offer.id);
    expect(listed.artistName).toBe(profileName("ob-perf"));
    expect(listed.onBehalfOfName).toBe(profileName("ob-perf"));
    expect(listed.onBehalfOfProfileId).toBe(performer.profileId);

    // The agent's OWN outgoing view carries the same identity.
    const outgoing = await app.inject({
      method: "GET",
      url: "/api/v1/booking-requests?direction=outgoing",
      headers: { ...auth("ob-agent"), "x-profile-id": agent.profileId },
    });
    const sent = outgoing.json().items.find((item: { id: string }) => item.id === offer.id);
    expect(sent.onBehalfOfName).toBe(profileName("ob-perf"));
  });

  it("400s an on-behalf-of offer with no ACTIVE representation — never a silent drop", async () => {
    const target = await seedOwnerWithProfile("ob2-tgt");
    const performer = await seedOwnerWithProfile("ob2-perf", "performer");
    const agent = await seedOwnerWithProfile("ob2-agent", "agent");
    // Proposed, not yet confirmed by both sides — not an authority to offer.
    await seedRepresentation(agent.profileId, performer.profileId, "proposed");

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/offers",
      headers: { ...auth("ob2-agent"), "x-profile-id": agent.profileId },
      payload: {
        targetProfileId: target.profileId,
        wantedDate: "2026-11-08",
        onBehalfOfProfileId: performer.profileId,
      },
    });
    expect(created.statusCode).toBe(400);

    // Nothing was written — not even under the agency's own name.
    const rows = await harness.db
      .select()
      .from(schema.bookingRequests)
      .where(eq(schema.bookingRequests.senderProfileId, agent.profileId));
    expect(rows).toHaveLength(0);
  });

  it("400s when there is no representation row at all", async () => {
    const target = await seedOwnerWithProfile("ob3-tgt");
    const performer = await seedOwnerWithProfile("ob3-perf", "performer");
    const agent = await seedOwnerWithProfile("ob3-agent", "agent");

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/offers",
      headers: { ...auth("ob3-agent"), "x-profile-id": agent.profileId },
      payload: {
        targetProfileId: target.profileId,
        wantedDate: "2026-11-09",
        onBehalfOfProfileId: performer.profileId,
      },
    });
    expect(created.statusCode).toBe(400);
  });

  // Liveness is `isRepresentationActiveAt`, not `status = 'active'` — the two
  // disagree exactly around an effective-dated termination (decisions.md #14).
  it("still accepts an offer inside an agreed notice period, and refuses one after it", async () => {
    const target = await seedOwnerWithProfile("ob5-tgt");
    const noticePerformer = await seedOwnerWithProfile("ob5-perf", "performer");
    const lapsedPerformer = await seedOwnerWithProfile("ob5-perf-lapsed", "performer");
    const agent = await seedOwnerWithProfile("ob5-agent", "agent");
    const oneDay = 24 * 60 * 60 * 1000;
    await seedRepresentation(
      agent.profileId,
      noticePerformer.profileId,
      "active",
      new Date(Date.now() + 30 * oneDay), // notice served, not yet bitten
    );
    await seedRepresentation(
      agent.profileId,
      lapsedPerformer.profileId,
      "active",
      new Date(Date.now() - oneDay), // moment passed; the sweep has not run yet
    );

    const duringNotice = await app.inject({
      method: "POST",
      url: "/api/v1/offers",
      headers: { ...auth("ob5-agent"), "x-profile-id": agent.profileId },
      payload: {
        targetProfileId: target.profileId,
        wantedDate: "2026-11-11",
        onBehalfOfProfileId: noticePerformer.profileId,
      },
    });
    expect(duringNotice.statusCode).toBe(201);
    expect(duringNotice.json().artistName).toBe(profileName("ob5-perf"));

    const afterLapse = await app.inject({
      method: "POST",
      url: "/api/v1/offers",
      headers: { ...auth("ob5-agent"), "x-profile-id": agent.profileId },
      payload: {
        targetProfileId: target.profileId,
        wantedDate: "2026-11-12",
        onBehalfOfProfileId: lapsedPerformer.profileId,
      },
    });
    expect(afterLapse.statusCode).toBe(400);
  });

  it("400s a non-agent profile trying to offer on someone else's behalf", async () => {
    const target = await seedOwnerWithProfile("ob4-tgt");
    const other = await seedOwnerWithProfile("ob4-other", "performer");
    const performer = await seedOwnerWithProfile("ob4-perf", "performer");

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/offers",
      headers: { ...auth("ob4-perf"), "x-profile-id": performer.profileId },
      payload: {
        targetProfileId: target.profileId,
        wantedDate: "2026-11-10",
        onBehalfOfProfileId: other.profileId,
      },
    });
    expect(created.statusCode).toBe(400);
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
