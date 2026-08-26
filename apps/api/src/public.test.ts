import { schema } from "@showme/db";
import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TokenVerifier } from "./auth/token-verifier";
import type { Lead, LeadSink } from "./lib/clickup";
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
    // The WHOLE body, asserted exactly. This is the projection's contract: a
    // field added to `profiles` that quietly reached the open internet would
    // break this line, which is the point of writing it as an equality rather
    // than a handful of `toHaveProperty`s.
    expect(body).toEqual({
      id: expect.any(String),
      slug: "cool-band",
      name: "cool-band",
      type: "band",
      kind: "performer",
      bio: "We play",
      avatarUrl: "https://cdn/a.png",
      bannerUrl: "https://cdn/b.png",
      // `details` held `{ private: true }`; only the two leaves the projection
      // names by hand come out, and neither was set.
      genres: [],
      setups: [],
      socialLinks: [],
      photos: [],
      videos: [],
      location: null,
      venueDetails: null,
      // The bill. Empty because this profile is on nothing — and present, because
      // the page is built around it and an absent field would read as "no shows"
      // for a reason the page could not distinguish from a broken projection.
      upcomingShows: [],
    });
    // No owner/billing/details/members leak.
    expect(body.ownerUserId).toBeUndefined();
    expect(body.billing).toBeUndefined();
    expect(body.details).toBeUndefined();
    expect(body.isPublic).toBeUndefined();
  });

  /**
   * WHO IS ON THE BILL, and who merely worked the night.
   *
   * The first version of `loadPublicShows` asked for every CONFIRMED participant
   * and leaked twice: a sound engineer's public page advertised the gig as though
   * it were their tour, and — the one that matters — a booking agency's page
   * announced to the open web that it represents this performer on this date.
   * Representation is private between agent and performer (`docs/decisions.md`
   * #14) and the agent is arm's-length (`docs/story.md`), so a stranger must not
   * learn the relationship exists at all.
   */
  it("bills performers and the room, never the crew or the agent", async () => {
    const { db } = harness;
    const eventId = await seedEvent("bill-op", true, {
      status: "confirmed",
      eventDate: "2099-09-12",
      title: "Album Release",
      venueName: "The Lantern Hall",
    });
    for (const [slug, role] of [
      ["bill-headliner", "performer"],
      ["bill-support", "support"],
      ["bill-crew", "crew"],
      ["bill-agent", "agent"],
    ] as const) {
      const profileId = await seedProfile(`${slug}-owner`, slug, true);
      await db
        .insert(schema.eventParticipants)
        .values({ eventId, profileId, role, status: "confirmed" });
    }
    const showsFor = async (slug: string) => {
      const response = await app.inject({ method: "GET", url: `/api/v1/public/profiles/${slug}` });
      expect(response.statusCode).toBe(200);
      return response.json().upcomingShows as { title: string }[];
    };

    // ON the bill.
    expect(await showsFor("bill-headliner")).toHaveLength(1);
    expect((await showsFor("bill-headliner"))[0]?.title).toBe("Album Release");
    expect(await showsFor("bill-support")).toHaveLength(1);

    // NOT on the bill — and these are the assertions that would have caught it.
    expect(await showsFor("bill-crew")).toEqual([]);
    expect(await showsFor("bill-agent")).toEqual([]);
  });

  it("keeps an unpublished or unconfirmed show off the bill", async () => {
    const { db } = harness;
    const performerId = await seedProfile("quiet-owner", "quiet-band", true);

    const unpublished = await seedEvent("quiet-op-a", false, {
      status: "confirmed",
      eventDate: "2099-10-01",
      title: "Not Published",
    });
    const draft = await seedEvent("quiet-op-b", true, {
      status: "draft",
      eventDate: "2099-10-02",
      title: "Still A Draft",
    });
    const past = await seedEvent("quiet-op-c", true, {
      status: "confirmed",
      eventDate: "2000-01-01",
      title: "Long Gone",
    });
    for (const eventId of [unpublished, draft, past]) {
      await db
        .insert(schema.eventParticipants)
        .values({ eventId, profileId: performerId, role: "performer", status: "confirmed" });
    }
    // Confirmed on a publishable show, but the PERFORMER has not accepted.
    const invitedOnly = await seedEvent("quiet-op-d", true, {
      status: "confirmed",
      eventDate: "2099-10-03",
      title: "Only Invited",
    });
    await db.insert(schema.eventParticipants).values({
      eventId: invitedOnly,
      profileId: performerId,
      role: "performer",
      status: "invited",
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/public/profiles/quiet-band",
    });
    expect(response.statusCode).toBe(200);
    // An unpublished event, a draft, a past date and an unaccepted invitation are
    // four different reasons to say nothing, and the page says nothing for all four.
    expect(response.json().upcomingShows).toEqual([]);
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
      status: "confirmed",
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

  it("still serves a published concluded event — the link is out in the world", async () => {
    const eventId = await seedEvent("done-owner", true, {
      status: "concluded",
      eventDate: "2026-04-18",
    });
    const response = await app.inject({ method: "GET", url: `/api/v1/public/events/${eventId}` });
    expect(response.statusCode).toBe(200);
    expect(response.json().eventDate).toBe("2026-04-18");
  });

  it.each(["draft", "suggested", "pending", "on_hold", "cancelled"] as const)(
    "404s a published %s event — status is consulted, not just the flag",
    async (status) => {
      const eventId = await seedEvent(`status-${status}-owner`, true, {
        status,
        eventDate: "2026-09-01",
      });
      const response = await app.inject({ method: "GET", url: `/api/v1/public/events/${eventId}` });
      expect(response.statusCode).toBe(404);
    },
  );
});

describe("public RSVP", () => {
  it("inserts an RSVP, then 409s a duplicate (event,email)", async () => {
    const eventId = await seedEvent("rsvp-owner", true, {
      status: "confirmed",
      eventDate: "2026-09-01",
    });

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

  it("refuses an RSVP to a published event that was cancelled, and stores nothing", async () => {
    const eventId = await seedEvent("cancelled-rsvp-owner", true, {
      status: "cancelled",
      eventDate: "2026-12-05",
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/public/events/${eventId}/rsvp`,
      payload: { email: "ada@example.com" },
    });
    // The page WAS public, so the honest answer names the reason (409) rather
    // than pretending the event never existed.
    expect(response.statusCode).toBe(409);
    expect(response.json().error.message).toMatch(/cancelled/i);

    const rows = await harness.db
      .select()
      .from(schema.audienceRsvps)
      .where(eq(schema.audienceRsvps.eventId, eventId));
    expect(rows).toHaveLength(0);
  });

  it("takes no new RSVP for a concluded event, even though its page still renders", async () => {
    const eventId = await seedEvent("concluded-rsvp-owner", true, {
      status: "concluded",
      eventDate: "2026-04-18",
    });

    const page = await app.inject({ method: "GET", url: `/api/v1/public/events/${eventId}` });
    expect(page.statusCode).toBe(200);

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/public/events/${eventId}/rsvp`,
      payload: { email: "ada@example.com" },
    });
    expect(response.statusCode).toBe(409);

    const rows = await harness.db
      .select()
      .from(schema.audienceRsvps)
      .where(eq(schema.audienceRsvps.eventId, eventId));
    expect(rows).toHaveLength(0);
  });

  it("404s an RSVP to a published draft — a status that was never public", async () => {
    const eventId = await seedEvent("draft-rsvp-owner", true, {
      status: "draft",
      eventDate: "2026-09-01",
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/public/events/${eventId}/rsvp`,
      payload: { email: "ada@example.com" },
    });
    expect(response.statusCode).toBe(404);

    const rows = await harness.db
      .select()
      .from(schema.audienceRsvps)
      .where(eq(schema.audienceRsvps.eventId, eventId));
    expect(rows).toHaveLength(0);
  });
});

describe("public leads", () => {
  // In DEFAULT_LEADS_ALLOWED_ORIGINS, so buildTestApp's default allows it.
  const ORIGIN = "http://localhost:5173";

  /** A fresh app (fresh rate limiter) with a spy sink recording into `captured`. */
  function buildLeadApp(captured: Lead[]): FastifyInstance {
    const sink: LeadSink = {
      async captureLead(lead) {
        captured.push(lead);
      },
    };
    return buildTestApp({ database: harness.db, tokenVerifier: fakeVerifier, leadSink: sink }, [
      publicRoutes,
    ]);
  }

  it("forwards a sanitized lead from an allowed origin, reflecting that origin", async () => {
    const captured: Lead[] = [];
    const leadApp = buildLeadApp(captured);
    await leadApp.ready();

    const response = await leadApp.inject({
      method: "POST",
      url: "/api/v1/public/leads",
      headers: { origin: ORIGIN },
      payload: {
        name: "Ada\u0000\u0009 Lovelace ", // null + tab collapse to one space; ends trimmed
        email: " ADA@Example.com ",
        message: "Line 1\r\nLine 2\u0000!", // CRLF normalized; embedded null stripped; newline kept
        role: "Venue",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(response.headers["access-control-allow-origin"]).toBe(ORIGIN);
    // Sanitized: collapsed whitespace, lowercased/trimmed email, CRLF → LF.
    expect(captured).toEqual([
      { name: "Ada Lovelace", email: "ada@example.com", message: "Line 1\nLine 2!", role: "Venue" },
    ]);

    await leadApp.close();
  });

  it("403s a POST from a disallowed or missing origin, forwarding nothing", async () => {
    const captured: Lead[] = [];
    const leadApp = buildLeadApp(captured);
    await leadApp.ready();
    const payload = { name: "Ada", email: "ada@example.com", message: "hi there" };

    const evil = await leadApp.inject({
      method: "POST",
      url: "/api/v1/public/leads",
      headers: { origin: "https://evil.example" },
      payload,
    });
    expect(evil.statusCode).toBe(403);

    const noOrigin = await leadApp.inject({
      method: "POST",
      url: "/api/v1/public/leads",
      payload,
    });
    expect(noOrigin.statusCode).toBe(403);

    expect(captured).toEqual([]);
    await leadApp.close();
  });

  it("silently drops a honeypot submission without forwarding", async () => {
    const captured: Lead[] = [];
    const leadApp = buildLeadApp(captured);
    await leadApp.ready();

    const response = await leadApp.inject({
      method: "POST",
      url: "/api/v1/public/leads",
      headers: { origin: ORIGIN },
      payload: { name: "Bot", email: "bot@spam.com", message: "buy now", website: "http://spam" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(captured).toEqual([]);
    await leadApp.close();
  });

  it("400s an invalid email", async () => {
    const leadApp = buildLeadApp([]);
    await leadApp.ready();
    const response = await leadApp.inject({
      method: "POST",
      url: "/api/v1/public/leads",
      headers: { origin: ORIGIN },
      payload: { name: "Ada", email: "not-an-email", message: "hi" },
    });
    expect(response.statusCode).toBe(400);
    await leadApp.close();
  });

  it("rate-limits after 5 submissions from the same IP", async () => {
    const captured: Lead[] = [];
    const leadApp = buildLeadApp(captured);
    await leadApp.ready();
    const send = () =>
      leadApp.inject({
        method: "POST",
        url: "/api/v1/public/leads",
        headers: { origin: ORIGIN, "x-forwarded-for": "203.0.113.7" },
        payload: { name: "Ada", email: "ada@example.com", message: "hello there" },
      });

    for (let attempt = 0; attempt < 5; attempt++) {
      expect((await send()).statusCode).toBe(200);
    }
    const sixth = await send();
    expect(sixth.statusCode).toBe(429);
    expect(sixth.headers["retry-after"]).toBe("60");
    expect(captured).toHaveLength(5);
    await leadApp.close();
  });

  it("handles CORS preflight (global @fastify/cors): reflects allowed origin, omits otherwise", async () => {
    const leadApp = buildLeadApp([]);
    await leadApp.ready();

    const allowed = await leadApp.inject({
      method: "OPTIONS",
      url: "/api/v1/public/leads",
      headers: { origin: ORIGIN, "access-control-request-method": "POST" },
    });
    expect(allowed.statusCode).toBe(204);
    expect(allowed.headers["access-control-allow-origin"]).toBe(ORIGIN);

    const denied = await leadApp.inject({
      method: "OPTIONS",
      url: "/api/v1/public/leads",
      headers: { origin: "https://evil.example", "access-control-request-method": "POST" },
    });
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();

    await leadApp.close();
  });
});
