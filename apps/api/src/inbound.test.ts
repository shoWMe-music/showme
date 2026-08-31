import { PRESET_PERMISSION_SETS } from "@showme/auth";
import { schema } from "@showme/db";
import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import type { EmailMessage } from "@showme/shared";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TokenVerifier } from "./auth/token-verifier";
import { inboundRoutes } from "./routes/inbound";
import { buildTestApp } from "./testing";

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
  app = buildTestApp({ database: harness.db, tokenVerifier: fakeVerifier }, [inboundRoutes]);
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await harness?.stop();
});

const auth = (uid: string) => ({ authorization: `Bearer ${uid}` });

/** In DEFAULT_LEADS_ALLOWED_ORIGINS, so buildTestApp's default allows it. */
const PUBLIC_ORIGIN = "http://localhost:5173";

let clientIpCounter = 0;

/**
 * Headers for an anonymous public-form POST: the allowed Origin the server-side
 * guard demands, plus a FRESH client IP per call. The IP has to vary because the
 * route's rate limiter lives on the plugin registration — every test in this file
 * shares one window, so a fixed IP would make the sixth public request in the
 * whole suite fail for a reason no test was written to check.
 */
function publicFormHeaders() {
  clientIpCounter += 1;
  return { origin: PUBLIC_ORIGIN, "x-forwarded-for": `198.51.100.${clientIpCounter}` };
}

type AccountKind = "operator" | "performer" | "agent";

/** The full name a seeded person carries — what an offer should fall back to. */
const personName = (id: string) => `${id} Person`;
/** The display name a seeded profile carries — what an act should fall back to. */
const profileName = (id: string) => `${id} Profile`;

/** A bare provisioned user (no memberships). */
async function seedUser(id: string, kind: AccountKind) {
  await harness.db
    .insert(schema.users)
    .values({ id, email: `${id}@example.showme.test`, name: personName(id), kind });
}

/** Seed an owner + their claimed profile + a permission set matching the kind. */
async function seedOwnerWithProfile(id: string, kind: AccountKind = "operator") {
  const { db } = harness;
  await seedUser(id, kind);
  const [profile] = await db
    .insert(schema.profiles)
    .values({
      kind,
      ownerUserId: id,
      name: profileName(id),
      slug: id,
      claimedAt: new Date(),
      // Public by default in these fixtures: `POST /booking-requests` only
      // addresses a PUBLIC profile, so a private one would 404 every public case.
      // The one test that needs a private target flips it back.
      isPublic: true,
    })
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
      headers: publicFormHeaders(),
      payload: {
        source: "public_form",
        targetProfileId: owner.profileId,
        contactName: "Ada Booker",
        email: "ada@example.showme.test",
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
      headers: publicFormHeaders(),
      payload: {
        source: "public_form",
        targetProfileId: owner.profileId,
        contactName: "Ben",
        email: "ben@example.showme.test",
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
    expect(offer.email).toBe("id-perf@example.showme.test");
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
    expect(row?.email).toBe("id-perf@example.showme.test");
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
        email: "Ada@Example.ShowMe.Test",
        artistName: "The Adas",
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().contactName).toBe("Ada Booker");
    expect(created.json().email).toBe("ada@example.showme.test"); // normalized
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

describe("inbound — Block reports the SENDER and clears the request", () => {
  /** Every spam flag standing against a profile — who has been ACCUSED. */
  async function flagsAgainst(profileId: string) {
    return harness.db
      .select()
      .from(schema.spamFlags)
      .where(eq(schema.spamFlags.targetProfileId, profileId));
  }

  it("files the report against the sender's profile, never the recipient's, and flags the request", async () => {
    const venue = await seedOwnerWithProfile("blk-venue");
    const performer = await seedOwnerWithProfile("blk-perf", "performer");

    const offer = await app.inject({
      method: "POST",
      url: "/api/v1/offers",
      headers: { ...auth("blk-perf"), "x-profile-id": performer.profileId },
      payload: { targetProfileId: venue.profileId, wantedDate: "2027-05-05" },
    });
    expect(offer.statusCode).toBe(201);
    const offerId = offer.json().id;

    const blocked = await app.inject({
      method: "POST",
      url: `/api/v1/booking-requests/${offerId}/flag-spam`,
      headers: { ...auth("blk-venue"), "x-profile-id": venue.profileId },
      payload: { kind: "spam" },
    });
    expect(blocked.statusCode).toBe(201);
    expect(blocked.json().reportedProfileId).toBe(performer.profileId);
    expect(blocked.json().status).toBe("flagged");

    // The ACCUSED is the sender. `spam_flags.target_profile_id` is the column
    // `canUseFeature("not_spam_suspended")` counts against, so filing it under the
    // recipient (as this route used to) suspended the victim, not the spammer.
    const againstSender = await flagsAgainst(performer.profileId);
    expect(againstSender).toHaveLength(1);
    expect(againstSender[0]?.reporterProfileId).toBe(venue.profileId);
    expect(againstSender[0]?.contextId).toBe(offerId);
    expect(await flagsAgainst(venue.profileId)).toHaveLength(0);

    // …and the request leaves the inbox instead of sitting there pending.
    const [row] = await harness.db
      .select()
      .from(schema.bookingRequests)
      .where(eq(schema.bookingRequests.id, offerId));
    expect(row?.status).toBe("flagged");
  });

  it("is idempotent: blocking a second request from the same sender adds no second row", async () => {
    const venue = await seedOwnerWithProfile("blk2-venue");
    const performer = await seedOwnerWithProfile("blk2-perf", "performer");
    const headers = { ...auth("blk2-perf"), "x-profile-id": performer.profileId };

    const send = (wantedDate: string) =>
      app.inject({
        method: "POST",
        url: "/api/v1/offers",
        headers,
        payload: { targetProfileId: venue.profileId, wantedDate },
      });
    const block = (id: string) =>
      app.inject({
        method: "POST",
        url: `/api/v1/booking-requests/${id}/flag-spam`,
        headers: { ...auth("blk2-venue"), "x-profile-id": venue.profileId },
        payload: { kind: "spam" },
      });

    const first = await send("2027-06-01");
    const second = await send("2027-06-02");
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);

    expect((await block(first.json().id)).statusCode).toBe(201);
    // The second block is the same reporter naming the same profile — nothing new
    // for a DISTINCT-reporter count, so it must not 409 and leave the operator
    // staring at a request they just told us to remove.
    expect((await block(second.json().id)).statusCode).toBe(201);

    expect(await flagsAgainst(performer.profileId)).toHaveLength(1);
    const rows = await harness.db
      .select()
      .from(schema.bookingRequests)
      .where(eq(schema.bookingRequests.senderProfileId, performer.profileId));
    expect(rows.every((row) => row.status === "flagged")).toBe(true);
  });

  it("flags a public-form request even though there is no profile to accuse", async () => {
    const venue = await seedOwnerWithProfile("blk3-venue");
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/booking-requests",
      headers: publicFormHeaders(),
      payload: {
        source: "public_form",
        targetProfileId: venue.profileId,
        contactName: "Spammer",
        email: "spam@example.showme.test",
      },
    });
    const id = created.json().id;

    const blocked = await app.inject({
      method: "POST",
      url: `/api/v1/booking-requests/${id}/flag-spam`,
      headers: { ...auth("blk3-venue"), "x-profile-id": venue.profileId },
      payload: { kind: "spam" },
    });
    expect(blocked.statusCode).toBe(201);
    // Nobody is accused: an anonymous sender has no profile, and inventing one
    // (or accusing the venue) is worse than recording only the audit entry.
    expect(blocked.json().reportedProfileId).toBeNull();
    expect(await flagsAgainst(venue.profileId)).toHaveLength(0);

    const [row] = await harness.db
      .select()
      .from(schema.bookingRequests)
      .where(eq(schema.bookingRequests.id, id));
    expect(row?.status).toBe("flagged");
  });

  it("404s a caller who is not on the target profile, writing nothing", async () => {
    const venue = await seedOwnerWithProfile("blk4-venue");
    const stranger = await seedOwnerWithProfile("blk4-stranger", "performer");
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/booking-requests",
      headers: publicFormHeaders(),
      payload: {
        source: "public_form",
        targetProfileId: venue.profileId,
        contactName: "Ada",
        email: "ada@example.showme.test",
      },
    });
    const id = created.json().id;

    // Before the fix this endpoint had NO authorization: any signed-in user who
    // knew a request id could file a report against someone else's profile.
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/booking-requests/${id}/flag-spam`,
      headers: { ...auth("blk4-stranger"), "x-profile-id": stranger.profileId },
      payload: { kind: "spam" },
    });
    expect(response.statusCode).toBe(404);
    expect(await flagsAgainst(venue.profileId)).toHaveLength(0);

    const [row] = await harness.db
      .select()
      .from(schema.bookingRequests)
      .where(eq(schema.bookingRequests.id, id));
    expect(row?.status).toBe("pending");
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

    // 90 days, stamped at create. The reaper that converges the status reads the
    // same constant (`@showme/shared`), so the column and the sweep agree.
    const days = Math.round(
      ((invitation?.expiresAt?.getTime() ?? 0) - Date.now()) / (24 * 60 * 60 * 1000),
    );
    expect(days).toBe(90);

    // The token comes BACK. Without it the handoff minted a perfect invitation
    // that no human could reach — the route worked and the flow did not.
    expect(body.token).toBe(invitation?.token);
    expect(body.emailed).toBe(false); // no address was given, so nothing was sent
  });

  it("mails the venue their link when an address is given, and says that it did", async () => {
    const sent: EmailMessage[] = [];
    const emailApp = buildTestApp(
      {
        database: harness.db,
        tokenVerifier: fakeVerifier,
        emailSink: {
          async sendEmail(message) {
            sent.push(message);
          },
        },
      },
      [inboundRoutes],
    );
    await emailApp.ready();

    const owner = await seedOwnerWithProfile("inb-ho-mail");
    const event = await seedEvent(owner.profileId, owner.permissionSetId, "inb-ho-mail");

    const response = await emailApp.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/handoff`,
      headers: { ...auth("inb-ho-mail"), "x-profile-id": owner.profileId },
      payload: { name: "The New Venue", recipientEmail: "venue@example.showme.test" },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().emailed).toBe(true);

    const message = sent.find((entry) => entry.to === "venue@example.showme.test");
    expect(message).toBeDefined();
    // The link is the payload: it must carry this handoff's own token, which is
    // what the redemption page then resolves.
    expect(message?.text).toContain(`/invitations/${response.json().token}`);

    await emailApp.close();
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

describe("inbound — the public form is an anonymous, hardened endpoint", () => {
  /**
   * A fresh app is a fresh rate-limit window (the limiter is scoped to the plugin
   * registration), so a test that deliberately exhausts the budget cannot spend
   * the shared app's budget for every test after it.
   */
  function buildPublicApp(): FastifyInstance {
    return buildTestApp({ database: harness.db, tokenVerifier: fakeVerifier }, [inboundRoutes]);
  }

  /** How many requests exist for a target — the "nothing was written" assertion. */
  async function countRequestsFor(profileId: string): Promise<number> {
    const rows = await harness.db
      .select()
      .from(schema.bookingRequests)
      .where(eq(schema.bookingRequests.targetProfileId, profileId));
    return rows.length;
  }

  const body = (targetProfileId: string, overrides: Record<string, unknown> = {}) => ({
    source: "public_form",
    targetProfileId,
    contactName: "Ada Booker",
    email: "ada@example.showme.test",
    pitch: "We would love to play.",
    ...overrides,
  });

  it("403s a POST with a disallowed or missing Origin, writing nothing", async () => {
    const owner = await seedOwnerWithProfile("pub-origin");

    const forged = await app.inject({
      method: "POST",
      url: "/api/v1/booking-requests",
      headers: { origin: "https://evil.example", "x-forwarded-for": "198.51.100.200" },
      payload: body(owner.profileId),
    });
    expect(forged.statusCode).toBe(403);

    // A non-browser client sends no Origin at all — refused for the same reason.
    const anonymous = await app.inject({
      method: "POST",
      url: "/api/v1/booking-requests",
      payload: body(owner.profileId),
    });
    expect(anonymous.statusCode).toBe(403);

    expect(await countRequestsFor(owner.profileId)).toBe(0);
  });

  it("rate-limits after 5 submissions from one IP, while another IP still gets through", async () => {
    const owner = await seedOwnerWithProfile("pub-rate");
    const publicApp = buildPublicApp();
    await publicApp.ready();

    // Distinct dates so the per-email dedup never fires — the limiter is what is
    // under test, and a 409 would look like a pass for the wrong reason.
    const send = (ip: string, day: number) =>
      publicApp.inject({
        method: "POST",
        url: "/api/v1/booking-requests",
        headers: { origin: PUBLIC_ORIGIN, "x-forwarded-for": ip },
        payload: body(owner.profileId, { wantedDate: `2027-03-${String(day).padStart(2, "0")}` }),
      });

    for (let attempt = 1; attempt <= 5; attempt++) {
      expect((await send("203.0.113.9", attempt)).statusCode).toBe(201);
    }
    const sixth = await send("203.0.113.9", 6);
    expect(sixth.statusCode).toBe(429);
    expect(sixth.headers["retry-after"]).toBe("60");

    // Per-IP, not global: a different visitor is unaffected.
    expect((await send("203.0.113.10", 7)).statusCode).toBe(201);
    expect(await countRequestsFor(owner.profileId)).toBe(6);
    await publicApp.close();
  });

  it("bounds and sanitizes the free text an anonymous sender can store", async () => {
    const owner = await seedOwnerWithProfile("pub-text");

    const tooLongPitch = await app.inject({
      method: "POST",
      url: "/api/v1/booking-requests",
      headers: publicFormHeaders(),
      payload: body(owner.profileId, { pitch: "x".repeat(5001) }),
    });
    expect(tooLongPitch.statusCode).toBe(400);

    const tooLongName = await app.inject({
      method: "POST",
      url: "/api/v1/booking-requests",
      headers: publicFormHeaders(),
      payload: body(owner.profileId, { contactName: "x".repeat(201) }),
    });
    expect(tooLongName.statusCode).toBe(400);

    const accepted = await app.inject({
      method: "POST",
      url: "/api/v1/booking-requests",
      headers: publicFormHeaders(),
      payload: body(owner.profileId, {
        contactName: "  Ada \u0000\u0009 Booker  ",
        email: "Ada@Example.ShowMe.Test",
        pitch: "Line one  \r\nLine two  ",
      }),
    });
    expect(accepted.statusCode).toBe(201);

    const [row] = await harness.db
      .select()
      .from(schema.bookingRequests)
      .where(eq(schema.bookingRequests.id, accepted.json().id));
    // Control characters gone, whitespace collapsed, email normalized — the same
    // treatment the authenticated offer body has always given its input.
    expect(row?.contactName).toBe("Ada Booker");
    expect(row?.email).toBe("ada@example.showme.test");
    expect(row?.pitch).toBe("Line one  \nLine two");
    expect(await countRequestsFor(owner.profileId)).toBe(1);
  });

  it("400s a wantedDate that is not a real calendar date, rather than 500ing on the date column", async () => {
    const owner = await seedOwnerWithProfile("pub-date");

    for (const wantedDate of ["banana", "2026-13-01", "2026-02-30", "01/09/2026"]) {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/booking-requests",
        headers: publicFormHeaders(),
        payload: body(owner.profileId, { wantedDate }),
      });
      expect(response.statusCode).toBe(400);
    }

    // The positive control: the same body with a real date is accepted, so the
    // 400s above are the date rule and not the shape of the payload.
    const good = await app.inject({
      method: "POST",
      url: "/api/v1/booking-requests",
      headers: publicFormHeaders(),
      payload: body(owner.profileId, { wantedDate: "2026-02-28" }),
    });
    expect(good.statusCode).toBe(201);
    expect(await countRequestsFor(owner.profileId)).toBe(1);
  });

  it("404s an unknown target instead of surfacing a foreign-key 500", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/booking-requests",
      headers: publicFormHeaders(),
      payload: body("00000000-0000-4000-8000-000000000000"),
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.message).toBe("Profile not found");
  });

  it("404s a profile that is not public — a private inbox is not addressable from the open web", async () => {
    const owner = await seedOwnerWithProfile("pub-private");
    await harness.db
      .update(schema.profiles)
      .set({ isPublic: false })
      .where(eq(schema.profiles.id, owner.profileId));

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/booking-requests",
      headers: publicFormHeaders(),
      payload: body(owner.profileId),
    });
    // Same non-answer as an unknown id, so neither can be probed for the other.
    expect(response.statusCode).toBe(404);
    expect(await countRequestsFor(owner.profileId)).toBe(0);
  });

  it("409s a repeat of a PENDING request, and takes it again once it is declined", async () => {
    const owner = await seedOwnerWithProfile("pub-dedup");
    const send = () =>
      app.inject({
        method: "POST",
        url: "/api/v1/booking-requests",
        headers: publicFormHeaders(),
        payload: body(owner.profileId, { wantedDate: "2027-04-04" }),
      });

    const first = await send();
    expect(first.statusCode).toBe(201);
    expect((await send()).statusCode).toBe(409);
    expect(await countRequestsFor(owner.profileId)).toBe(1);

    // Dedup covers PENDING only — a declined request can be re-sent, exactly the
    // rule the `booking_requests_pending_dedup` index states for on-platform senders.
    const declined = await app.inject({
      method: "PATCH",
      url: `/api/v1/booking-requests/${first.json().id}`,
      headers: auth("pub-dedup"),
      payload: { status: "declined" },
    });
    expect(declined.statusCode).toBe(200);
    expect((await send()).statusCode).toBe(201);
    expect(await countRequestsFor(owner.profileId)).toBe(2);
  });
});

describe("inbound — triage moves a request through its statuses", () => {
  it("declines, archives, and restores a request to pending", async () => {
    const owner = await seedOwnerWithProfile("tri-owner");
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/booking-requests",
      headers: publicFormHeaders(),
      payload: {
        source: "public_form",
        targetProfileId: owner.profileId,
        contactName: "Ada",
        email: "ada@example.showme.test",
        wantedDate: "2027-07-07",
      },
    });
    const id = created.json().id;
    const patch = (status: string) =>
      app.inject({
        method: "PATCH",
        url: `/api/v1/booking-requests/${id}`,
        headers: auth("tri-owner"),
        payload: { status },
      });

    expect((await patch("declined")).json().status).toBe("declined");
    expect((await patch("archived")).json().status).toBe("archived");
    // Restore: without `pending` in the accepted set, archiving is a one-way door
    // and the screen's Restore button would have nothing to call.
    expect((await patch("pending")).json().status).toBe("pending");

    const [row] = await harness.db
      .select()
      .from(schema.bookingRequests)
      .where(eq(schema.bookingRequests.id, id));
    expect(row?.status).toBe("pending");

    // `expired` is the reaper's word, not a human's — the API does not take it.
    expect((await patch("expired")).statusCode).toBe(400);
  });
});

describe("inbound — Create Draft turns a request into a draft event", () => {
  /**
   * A primary location with a country — which is where an event's currency comes
   * from (currency is a per-country fact, decisions.md #17). Without one there is
   * nothing to denominate the budget in, and the route says so rather than
   * guessing; the last test in this block drives that refusal.
   */
  async function seedPrimaryLocation(profileId: string, country: string) {
    await harness.db
      .insert(schema.profileLocations)
      .values({ profileId, country, city: "Stockholm", isPrimary: true });
  }

  /** A public-form request aimed at `profileId`, with a date and a fee asked. */
  async function seedPublicRequest(profileId: string, wantedDate = "2027-08-08") {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/booking-requests",
      headers: publicFormHeaders(),
      payload: {
        source: "public_form",
        targetProfileId: profileId,
        contactName: "Ada Booker",
        email: "ada@example.showme.test",
        artistName: "The Adas",
        wantedDate,
        pitch: "Touring in August.",
        offerFeeMin: "65000",
      },
    });
    expect(created.statusCode).toBe(201);
    return created.json().id as string;
  }

  it("creates a draft event linked to the request, hosted by the recipient", async () => {
    const owner = await seedOwnerWithProfile("draft-owner");
    await seedPrimaryLocation(owner.profileId, "SE");
    const requestId = await seedPublicRequest(owner.profileId);

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/booking-requests/${requestId}/draft-event`,
      headers: { ...auth("draft-owner"), "x-profile-id": owner.profileId },
      payload: {},
    });
    expect(response.statusCode).toBe(201);
    const created = response.json();
    expect(created.status).toBe("draft");
    expect(created.title).toBe("The Adas"); // named after the ACT
    expect(created.eventDate).toBe("2027-08-08"); // the date they asked for
    // Denomination is derived, never guessed: SEK from the venue's own country.
    expect(created.baseCurrency).toBe("SEK");

    const [event] = await harness.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, created.eventId));
    expect(event?.hostProfileId).toBe(owner.profileId);
    expect(event?.status).toBe("draft");
    expect(event?.eventDate).toBe("2027-08-08");
    // The contact, the fee and the pitch survive into the event the operator opens.
    expect(event?.notes).toContain("ada@example.showme.test");
    expect(event?.notes).toContain("Touring in August.");
    expect(event?.notes).toContain("650");

    // The host stands on their own event, or they cannot open it.
    const participants = await harness.db
      .select()
      .from(schema.eventParticipants)
      .where(eq(schema.eventParticipants.eventId, created.eventId));
    expect(participants).toHaveLength(1);
    expect(participants[0]?.role).toBe("host");

    // The request now points at the draft — and is STILL pending, because
    // starting work is not answering the sender.
    const [row] = await harness.db
      .select()
      .from(schema.bookingRequests)
      .where(eq(schema.bookingRequests.id, requestId));
    expect(row?.eventId).toBe(created.eventId);
    expect(row?.status).toBe("pending");

    const audit = await harness.db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, created.eventId));
    expect(audit.some((entry) => entry.action === "booking_request.draft_event")).toBe(true);
  });

  it("spends no event-cap slot, and reports the counter that confirming WILL spend", async () => {
    const owner = await seedOwnerWithProfile("draft-cap");
    await seedPrimaryLocation(owner.profileId, "SE");
    const requestId = await seedPublicRequest(owner.profileId, "2027-08-09");

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/booking-requests/${requestId}/draft-event`,
      headers: { ...auth("draft-cap"), "x-profile-id": owner.profileId },
      payload: {},
    });
    expect(response.statusCode).toBe(201);
    const cap = response.json().eventCap;
    // A draft is outside CAP_COUNTING_EVENT_STATUSES, so the used counter has not
    // moved — the cost lands at `confirmed`, which is what `chargedAtConfirm` says.
    expect(cap.used).toBe(0);
    expect(cap.limit).toBeGreaterThan(0);
    expect(cap.allowed).toBe(true);
    expect(cap.chargedAtConfirm).toBe(true);
  });

  it("409s a second draft for the same request", async () => {
    const owner = await seedOwnerWithProfile("draft-twice");
    await seedPrimaryLocation(owner.profileId, "SE");
    const requestId = await seedPublicRequest(owner.profileId, "2027-08-10");
    const draft = () =>
      app.inject({
        method: "POST",
        url: `/api/v1/booking-requests/${requestId}/draft-event`,
        headers: { ...auth("draft-twice"), "x-profile-id": owner.profileId },
        payload: {},
      });

    expect((await draft()).statusCode).toBe(201);
    expect((await draft()).statusCode).toBe(409);

    const events = await harness.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.hostProfileId, owner.profileId));
    expect(events).toHaveLength(1);
  });

  it("refuses to guess a currency when the venue has no country, and takes an explicit one", async () => {
    const owner = await seedOwnerWithProfile("draft-nocurrency");
    const requestId = await seedPublicRequest(owner.profileId, "2027-08-12");
    const draft = (payload: Record<string, unknown>) =>
      app.inject({
        method: "POST",
        url: `/api/v1/booking-requests/${requestId}/draft-event`,
        headers: { ...auth("draft-nocurrency"), "x-profile-id": owner.profileId },
        payload,
      });

    // `base_currency` denominates the whole budget and settlement, so a default
    // would be a wrong number rather than a missing one.
    const refused = await draft({});
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error.message).toContain("currency");

    const accepted = await draft({ baseCurrency: "eur" });
    expect(accepted.statusCode).toBe(201);
    expect(accepted.json().baseCurrency).toBe("EUR"); // normalized
  });

  it("refuses a non-operator recipient and a stranger", async () => {
    const performer = await seedOwnerWithProfile("draft-perf", "performer");
    const stranger = await seedOwnerWithProfile("draft-stranger");
    const requestId = await seedPublicRequest(performer.profileId, "2027-08-11");

    // Only operators host events (story.md: the operator runs the show).
    const asPerformer = await app.inject({
      method: "POST",
      url: `/api/v1/booking-requests/${requestId}/draft-event`,
      headers: { ...auth("draft-perf"), "x-profile-id": performer.profileId },
      payload: {},
    });
    expect(asPerformer.statusCode).toBe(403);
    expect(asPerformer.json().error.message).toContain("operator");

    const asStranger = await app.inject({
      method: "POST",
      url: `/api/v1/booking-requests/${requestId}/draft-event`,
      headers: { ...auth("draft-stranger"), "x-profile-id": stranger.profileId },
      payload: {},
    });
    expect(asStranger.statusCode).toBe(404);

    const events = await harness.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.hostProfileId, performer.profileId));
    expect(events).toHaveLength(0);
  });
});

describe("inbound — Make Offer counters back to whoever asked", () => {
  it("notifies an on-platform sender and records the terms in the audit trail", async () => {
    const venue = await seedOwnerWithProfile("co-venue");
    const performer = await seedOwnerWithProfile("co-perf", "performer");

    const offer = await app.inject({
      method: "POST",
      url: "/api/v1/offers",
      headers: { ...auth("co-perf"), "x-profile-id": performer.profileId },
      payload: { targetProfileId: venue.profileId, wantedDate: "2027-09-09" },
    });
    const requestId = offer.json().id;

    const countered = await app.inject({
      method: "POST",
      url: `/api/v1/booking-requests/${requestId}/counter-offer`,
      headers: { ...auth("co-venue"), "x-profile-id": venue.profileId },
      payload: {
        message: "We can do the 9th, but the fee is lower.",
        offerFeeMin: "45000",
        offerFeeMax: "55000",
      },
    });
    expect(countered.statusCode).toBe(201);
    expect(countered.json()).toMatchObject({ channel: "notification", delivered: true });

    // The requester HEARS it — the whole point of the button.
    const notifications = await harness.db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, "co-perf"));
    const counter = notifications.find((row) => row.type === "booking_request.counter_offer");
    expect(counter).toBeDefined();
    expect(counter?.body).toContain("We can do the 9th");
    expect((counter?.metadata as { offerFeeMin?: string })?.offerFeeMin).toBe("45000");

    // …and the terms are in the forensic record, not only in a feed row.
    const audit = await harness.db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, requestId));
    const entry = audit.find((row) => row.action === "booking_request.counter_offer");
    expect(entry).toBeDefined();

    // A counter is not an answer: the request stays pending until they reply.
    const [row] = await harness.db
      .select()
      .from(schema.bookingRequests)
      .where(eq(schema.bookingRequests.id, requestId));
    expect(row?.status).toBe("pending");
  });

  it("emails a public-form sender, since their address is the only way back to them", async () => {
    const sent: EmailMessage[] = [];
    const emailApp = buildTestApp(
      {
        database: harness.db,
        tokenVerifier: fakeVerifier,
        emailSink: {
          async sendEmail(message) {
            sent.push(message);
          },
        },
      },
      [inboundRoutes],
    );
    await emailApp.ready();

    const venue = await seedOwnerWithProfile("co-pub-venue");
    const created = await emailApp.inject({
      method: "POST",
      url: "/api/v1/booking-requests",
      headers: { origin: PUBLIC_ORIGIN, "x-forwarded-for": "203.0.113.55" },
      payload: {
        source: "public_form",
        targetProfileId: venue.profileId,
        contactName: "Ada Booker",
        email: "ada@example.showme.test",
        wantedDate: "2027-10-10",
      },
    });
    const requestId = created.json().id;

    const countered = await emailApp.inject({
      method: "POST",
      url: `/api/v1/booking-requests/${requestId}/counter-offer`,
      headers: { ...auth("co-pub-venue"), "x-profile-id": venue.profileId },
      payload: { message: "Yes — 10 Oct works.", offerFeeMin: "50000" },
    });
    expect(countered.statusCode).toBe(201);
    expect(countered.json()).toMatchObject({
      channel: "email",
      deliveredTo: "ada@example.showme.test",
      delivered: true,
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("ada@example.showme.test");
    expect(sent[0]?.text).toContain("Yes — 10 Oct works.");
    // Reply-to is the operator's own address: an anonymous sender has no account
    // to answer in, so the reply has to land in a real mailbox.
    expect(sent[0]?.replyTo).toBe("co-pub-venue@example.showme.test");
    await emailApp.close();
  });

  it("404s a caller who is not on the target profile", async () => {
    const venue = await seedOwnerWithProfile("co-guard-venue");
    const stranger = await seedOwnerWithProfile("co-guard-stranger");
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/booking-requests",
      headers: publicFormHeaders(),
      payload: {
        source: "public_form",
        targetProfileId: venue.profileId,
        contactName: "Ada",
        email: "ada@example.showme.test",
      },
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/booking-requests/${created.json().id}/counter-offer`,
      headers: { ...auth("co-guard-stranger"), "x-profile-id": stranger.profileId },
      payload: { message: "Let me answer someone else's inbox." },
    });
    expect(response.statusCode).toBe(404);
  });
});
