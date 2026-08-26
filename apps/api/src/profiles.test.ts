import { schema } from "@showme/db";
import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TokenVerifier } from "./auth/token-verifier";
import { profileRoutes } from "./routes/profiles";
import { publicRoutes } from "./routes/public";
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
  // `publicRoutes` rides along so the preview tests can assert that the owner's
  // Preview and the anonymous page return the SAME body — the one thing a second
  // copy of the projection would break.
  app = buildTestApp({ database: harness.db, tokenVerifier: fakeVerifier }, [
    profileRoutes,
    publicRoutes,
  ]);
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await harness?.stop();
});

const auth = (uid: string) => ({ authorization: `Bearer ${uid}` });

type Kind = "operator" | "performer" | "team_and_crew" | "agent";

/** Seed a bare provisioned user (no memberships). */
async function seedUser(id: string, kind: Kind) {
  await harness.db.insert(schema.users).values({ id, email: `${id}@example.com`, kind });
}

/**
 * Seed a user + a profile they own + their active `owner` membership. Returns the
 * ids the tests reach for (profile, owner user, owner membership row).
 */
async function seedProfileOwner(prefix: string, kind: Kind) {
  const { db } = harness;
  const ownerId = `${prefix}-owner`;
  await seedUser(ownerId, kind);
  const [profile] = await db
    .insert(schema.profiles)
    .values({ kind, ownerUserId: ownerId, name: prefix, slug: prefix })
    .returning();
  if (!profile) throw new Error("profile seed failed");
  const [member] = await db
    .insert(schema.profileMembers)
    .values({ profileId: profile.id, userId: ownerId, role: "owner", status: "active" })
    .returning();
  if (!member) throw new Error("owner member seed failed");
  return { profileId: profile.id, ownerId, ownerMemberId: member.id };
}

/** Add an active member of a given role to a profile, seeding the user first. */
async function seedMember(profileId: string, userId: string, kind: Kind, role: string) {
  await seedUser(userId, kind);
  await harness.db
    .insert(schema.profileMembers)
    .values({ profileId, userId, role: role as "viewer", status: "active" });
}

describe("profiles — authorize + serialize + audit", () => {
  it("creates a profile with an owner membership and an audit row", async () => {
    const { db } = harness;
    await seedUser("create-op", "operator");

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/profiles",
      headers: auth("create-op"),
      payload: { kind: "operator", name: "Venue One", slug: "create-op-venue" },
    });
    expect(created.statusCode).toBe(201);
    const profileId = created.json().id;
    expect(created.json().name).toBe("Venue One");

    const members = await db
      .select()
      .from(schema.profileMembers)
      .where(eq(schema.profileMembers.profileId, profileId));
    expect(members).toHaveLength(1);
    expect(members[0]?.role).toBe("owner");
    expect(members[0]?.userId).toBe("create-op");

    const audit = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, profileId));
    expect(audit).toHaveLength(1);
    expect(audit[0]?.action).toBe("profile.create");
    expect(audit[0]?.actorUserId).toBe("create-op");
  });

  it("inherits the account's kind and ignores any kind in the body", async () => {
    // The kind is fixed per account (CLAUDE.md, story.md), so it is not a field
    // on this form. A performer who submits `kind: operator` — by an old client
    // or by hand — does not get a 400 and does NOT get an operator profile; the
    // value is not read at all and the account's own kind is used.
    await seedUser("infer-perf", "performer");
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/profiles",
      headers: auth("infer-perf"),
      payload: { kind: "operator", name: "Inferred Kind", slug: "infer-perf-profile" },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().kind).toBe("performer");

    const [stored] = await harness.db
      .select()
      .from(schema.profiles)
      .where(eq(schema.profiles.id, response.json().id));
    expect(stored?.kind).toBe("performer");
  });

  it("refuses a profile type the account kind cannot create", async () => {
    await seedUser("type-op", "operator");
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/profiles",
      headers: auth("type-op"),
      payload: { type: "band", name: "Not A Band", slug: "type-op-band" },
    });
    expect(response.statusCode).toBe(400);
    // Assert the REASON, not the bare status — a 400 here could just as easily be
    // a body-shape complaint, which would prove nothing about the rule.
    expect(response.json().error.message).toContain("cannot be of type");

    const accepted = await app.inject({
      method: "POST",
      url: "/api/v1/profiles",
      headers: auth("type-op"),
      payload: { type: "venue", name: "A Venue", slug: "type-op-venue" },
    });
    expect(accepted.statusCode).toBe(201);
    expect(accepted.json().type).toBe("venue");
  });

  it("stores venue details and the location where every other query reads them", async () => {
    const { profileId } = await seedProfileOwner("venue-details", "operator");

    // Nothing recorded yet — and the route says so with an explicit null rather
    // than an absent key, so the screen can tell "empty" from "not loaded".
    const before = await app.inject({
      method: "GET",
      url: `/api/v1/profiles/${profileId}`,
      headers: auth("venue-details-owner"),
    });
    expect(before.statusCode).toBe(200);
    expect(before.json().venueDetails).toBeNull();
    expect(before.json().location).toBeNull();

    const saved = await app.inject({
      method: "PATCH",
      url: `/api/v1/profiles/${profileId}`,
      headers: auth("venue-details-owner"),
      payload: {
        location: { city: "Stockholm", country: "se" },
        venueDetails: {
          capacity: 400,
          soundSystem: "Funktion-One",
          curfew: "02:00",
          // Blank and duplicate entries are dropped, and a venue's own wording
          // survives beside the standard keys.
          amenities: ["pa_system", "pa_system", "  ", "Green Room"],
          dealTypes: ["door_split"],
          contactEmail: "book@lantern.example",
        },
      },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().venueDetails.amenities).toEqual(["pa_system", "Green Room"]);
    expect(saved.json().venueDetails.capacity).toBe(400);
    expect(saved.json().location).toEqual({
      street: null,
      postcode: null,
      city: "Stockholm",
      country: "SE",
      lat: null,
      lng: null,
    });

    // The state, not just the response: the location must land in
    // `profile_locations` (what timezone/territory/search join), not in a jsonb
    // blob only the profile screen can see.
    const [locationRow] = await harness.db
      .select()
      .from(schema.profileLocations)
      .where(eq(schema.profileLocations.profileId, profileId));
    expect(locationRow?.city).toBe("Stockholm");
    expect(locationRow?.country).toBe("SE");
    expect(locationRow?.isPrimary).toBe(true);

    const [venueRow] = await harness.db
      .select()
      .from(schema.venueDetails)
      .where(eq(schema.venueDetails.profileId, profileId));
    expect(venueRow?.capacity).toBe(400);
    expect(venueRow?.soundSystem).toBe("Funktion-One");
    expect(venueRow?.contactEmail).toBe("book@lantern.example");

    // A second save must UPDATE the same rows, not stack up duplicates — the
    // location row is upserted by profile, the venue row by primary key.
    const again = await app.inject({
      method: "PATCH",
      url: `/api/v1/profiles/${profileId}`,
      headers: auth("venue-details-owner"),
      payload: {
        location: { city: "Göteborg", country: "SE" },
        venueDetails: { capacity: 250 },
      },
    });
    expect(again.statusCode).toBe(200);
    expect(again.json().location).toEqual({
      street: null,
      postcode: null,
      city: "Göteborg",
      country: "SE",
      lat: null,
      lng: null,
    });
    // An unmentioned field is left alone, not blanked.
    expect(again.json().venueDetails.soundSystem).toBe("Funktion-One");

    const locationRows = await harness.db
      .select()
      .from(schema.profileLocations)
      .where(eq(schema.profileLocations.profileId, profileId));
    expect(locationRows).toHaveLength(1);
  });

  it("refuses venue details from a member who may not manage the profile", async () => {
    const { profileId } = await seedProfileOwner("venue-viewer", "operator");
    await seedMember(profileId, "venue-viewer-watcher", "operator", "viewer");

    const response = await app.inject({
      method: "PATCH",
      url: `/api/v1/profiles/${profileId}`,
      headers: auth("venue-viewer-watcher"),
      payload: { venueDetails: { capacity: 999 } },
    });
    expect(response.statusCode).toBe(403);

    // And nothing was written — a refusal that still wrote would be worse than
    // no refusal at all.
    const rows = await harness.db
      .select()
      .from(schema.venueDetails)
      .where(eq(schema.venueDetails.profileId, profileId));
    expect(rows).toHaveLength(0);
  });

  it("404s a GET from a non-member (no existence leak)", async () => {
    const { profileId } = await seedProfileOwner("leak", "operator");
    await seedUser("leak-stranger", "operator");

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/profiles/${profileId}`,
      headers: auth("leak-stranger"),
    });
    expect(response.statusCode).toBe(404);
  });

  it("403s a PATCH from a viewer member", async () => {
    const { profileId } = await seedProfileOwner("view", "operator");
    await seedMember(profileId, "view-viewer", "operator", "viewer");

    const response = await app.inject({
      method: "PATCH",
      url: `/api/v1/profiles/${profileId}`,
      headers: auth("view-viewer"),
      payload: { name: "Renamed" },
    });
    expect(response.statusCode).toBe(403);
  });

  it("lets an owner add a member and 409s a duplicate", async () => {
    const { profileId, ownerId } = await seedProfileOwner("add", "operator");
    await seedUser("add-newmember", "operator");
    const payload = { userId: "add-newmember", role: "editor" as const };

    const first = await app.inject({
      method: "POST",
      url: `/api/v1/profiles/${profileId}/members`,
      headers: auth(ownerId),
      payload,
    });
    expect(first.statusCode).toBe(201);
    expect(first.json().role).toBe("editor");

    const second = await app.inject({
      method: "POST",
      url: `/api/v1/profiles/${profileId}/members`,
      headers: auth(ownerId),
      payload,
    });
    expect(second.statusCode).toBe(409);
  });

  it("refuses to demote the owner membership (403)", async () => {
    const { profileId, ownerId, ownerMemberId } = await seedProfileOwner("protect", "operator");

    const response = await app.inject({
      method: "PATCH",
      url: `/api/v1/profiles/${profileId}/members/${ownerMemberId}`,
      headers: auth(ownerId),
      payload: { role: "editor" },
    });
    expect(response.statusCode).toBe(403);
  });

  it("round-trips a full unavailability replace (PUT then GET)", async () => {
    const { profileId, ownerId } = await seedProfileOwner("avail", "performer");

    const put = await app.inject({
      method: "PUT",
      url: `/api/v1/profiles/${profileId}/unavailability`,
      headers: auth(ownerId),
      payload: {
        entries: [
          { startDate: "2026-08-01", endDate: "2026-08-05", reason: "tour" },
          { startDate: "2026-09-10", endDate: "2026-09-10" },
        ],
      },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toHaveLength(2);

    const list = await app.inject({
      method: "GET",
      url: `/api/v1/profiles/${profileId}/unavailability`,
      headers: auth(ownerId),
    });
    expect(list.statusCode).toBe(200);
    const dates = list
      .json()
      .map((row: { startDate: string }) => row.startDate)
      .sort();
    expect(dates).toEqual(["2026-08-01", "2026-09-10"]);
  });

  it("creates a template and reads it back", async () => {
    const { profileId, ownerId } = await seedProfileOwner("tmpl", "operator");

    const created = await app.inject({
      method: "POST",
      url: `/api/v1/profiles/${profileId}/templates`,
      headers: auth(ownerId),
      payload: { category: "rider", name: "Standard Rider", payload: { power: "3-phase" } },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().name).toBe("Standard Rider");

    const list = await app.inject({
      method: "GET",
      url: `/api/v1/profiles/${profileId}/templates`,
      headers: auth(ownerId),
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toHaveLength(1);
    expect(list.json()[0]?.category).toBe("rider");
    expect(list.json()[0]?.payload).toEqual({ power: "3-phase" });
  });

  // PLAN.md §K promises the payload is validated per-category. `budget` is the
  // first category with a reader that does arithmetic on what it loads, so it is
  // the first one whose payload is actually checked.
  it("stores a budget template and reads its payload back unchanged", async () => {
    const { profileId, ownerId } = await seedProfileOwner("tmpl-budget", "operator");
    const payload = {
      ticketTiers: [{ name: "General Admission", unitAmount: "6000", quantity: 1280 }],
      averageBarSpend: "500",
      capacity: 1600,
      otherRevenue: "100000",
      customRevenue: [{ label: "Sponsorship", amount: "500000" }],
      costs: [{ label: "Performer fee", amount: "5000000" }],
      paymentProcessing: { percentBasisPoints: 150, flatPerTicket: "50" },
    };

    const created = await app.inject({
      method: "POST",
      url: `/api/v1/profiles/${profileId}/templates`,
      headers: auth(ownerId),
      payload: { category: "budget", name: "Club night — 1600 cap", payload },
    });

    expect(created.statusCode).toBe(201);
    expect(created.json().payload).toEqual(payload);
  });

  it("rejects a budget template whose money is not minor units", async () => {
    const { profileId, ownerId } = await seedProfileOwner("tmpl-bad", "operator");

    // "40.00" reaches `BigInt()` in the planner and throws, so it never gets
    // stored — the screen that loads a template must always be able to open it.
    const rejected = await app.inject({
      method: "POST",
      url: `/api/v1/profiles/${profileId}/templates`,
      headers: auth(ownerId),
      payload: {
        category: "budget",
        name: "Broken",
        payload: {
          ticketTiers: [],
          averageBarSpend: "0",
          capacity: 100,
          otherRevenue: "0",
          customRevenue: [],
          costs: [{ label: "Venue cost", amount: "40.00" }],
        },
      },
    });

    expect(rejected.statusCode).toBe(400);
    expect(rejected.json().error.message).toContain("costs.0.amount");
  });

  /**
   * The old app had a hard rule that performers get NO templates
   * (`firestore.rules:551-556`), and `docs/old-app-analysis-data-model.md` (question
   * 5) could not tell whether the rebuild dropped it on purpose. The owner settled
   * it on 2026-08-26: *"performers should have templates."*
   *
   * Nothing had to change — `/profiles/:id/templates` is gated on PROFILE ROLE
   * (`requireProfileRole(... WRITE_ROLES)`) and never once looks at `profiles.kind`,
   * so the old rule was not carried across. These tests are the proof, and the guard
   * that stops it being reintroduced as a "missing" check.
   */
  it("gives a PERFORMER the full template lifecycle — the old app's ban is gone", async () => {
    const { profileId, ownerId } = await seedProfileOwner("tmpl-performer", "performer");

    const created = await app.inject({
      method: "POST",
      url: `/api/v1/profiles/${profileId}/templates`,
      headers: auth(ownerId),
      payload: { category: "rider", name: "Tech rider — trio", payload: { channels: 12 } },
    });
    expect(created.statusCode).toBe(201);
    const templateId = created.json().id as string;

    const listed = await app.inject({
      method: "GET",
      url: `/api/v1/profiles/${profileId}/templates`,
      headers: auth(ownerId),
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toHaveLength(1);

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/v1/profiles/${profileId}/templates/${templateId}`,
      headers: auth(ownerId),
      payload: { name: "Tech rider — quartet" },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().name).toBe("Tech rider — quartet");

    const removed = await app.inject({
      method: "DELETE",
      url: `/api/v1/profiles/${profileId}/templates/${templateId}`,
      headers: auth(ownerId),
    });
    expect(removed.statusCode).toBe(200);
    expect(removed.json()).toEqual({ deleted: true });
  });

  it("lets a performer save a BUDGET template too — the category is not kind-gated", async () => {
    // The category with a real reader (the planner), and therefore the one where a
    // kind check would most plausibly have been hiding. A performer promoting their
    // own show wears an OPERATOR role for that event (story.md) and plans a budget
    // like anybody else; the template library is profile-level and follows them.
    const { profileId, ownerId } = await seedProfileOwner("tmpl-perf-budget", "performer");
    const payload = {
      ticketTiers: [{ name: "Advance", unitAmount: "25000", quantity: 200 }],
      averageBarSpend: "0",
      capacity: 250,
      otherRevenue: "0",
      customRevenue: [],
      costs: [{ label: "Backline hire", amount: "300000" }],
    };

    const created = await app.inject({
      method: "POST",
      url: `/api/v1/profiles/${profileId}/templates`,
      headers: auth(ownerId),
      payload: { category: "budget", name: "Own release show", payload },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().payload).toEqual(payload);

    // …and the SAME payload validation applies to them as to an operator: the rule
    // that is enforced is the shape, never the account kind.
    const rejected = await app.inject({
      method: "POST",
      url: `/api/v1/profiles/${profileId}/templates`,
      headers: auth(ownerId),
      payload: {
        category: "budget",
        name: "Broken",
        payload: { ...payload, costs: [{ label: "Backline hire", amount: "3000.00" }] },
      },
    });
    expect(rejected.statusCode).toBe(400);
  });

  it("gives a team-and-crew and an agent profile templates as well", async () => {
    for (const [prefix, kind] of [
      ["tmpl-crew", "team_and_crew"],
      ["tmpl-agent", "agent"],
    ] as const) {
      const { profileId, ownerId } = await seedProfileOwner(prefix, kind);
      const created = await app.inject({
        method: "POST",
        url: `/api/v1/profiles/${profileId}/templates`,
        headers: auth(ownerId),
        payload: { category: "terms", name: "Standard terms", payload: { notice: "14 days" } },
      });
      expect(created.statusCode).toBe(201);
    }
  });

  it("still refuses a template to a member who is not the profile's, whatever the kind", async () => {
    // Kind is not the gate; MEMBERSHIP is. A stranger gets 404 (no existence leak)
    // and a `viewer` member gets 403 — the same two answers as every other
    // profile-scoped write.
    const { profileId } = await seedProfileOwner("tmpl-guard", "performer");
    await seedUser("tmpl-guard-stranger", "performer");
    await seedMember(profileId, "tmpl-guard-viewer", "performer", "viewer");

    const stranger = await app.inject({
      method: "POST",
      url: `/api/v1/profiles/${profileId}/templates`,
      headers: auth("tmpl-guard-stranger"),
      payload: { category: "rider", name: "Nope", payload: {} },
    });
    expect(stranger.statusCode).toBe(404);

    const viewer = await app.inject({
      method: "POST",
      url: `/api/v1/profiles/${profileId}/templates`,
      headers: auth("tmpl-guard-viewer"),
      payload: { category: "rider", name: "Nope", payload: {} },
    });
    expect(viewer.statusCode).toBe(403);
  });

  it("leaves the other categories unvalidated — they have no reader to protect", async () => {
    const { profileId, ownerId } = await seedProfileOwner("tmpl-free", "operator");

    const created = await app.inject({
      method: "POST",
      url: `/api/v1/profiles/${profileId}/templates`,
      headers: auth(ownerId),
      payload: { category: "rider", name: "Anything", payload: { whatever: [1, 2, 3] } },
    });

    expect(created.statusCode).toBe(201);
  });
});

describe("profiles — grant_admin entitlement gate (decisions #12)", () => {
  it("blocks granting admin on a free plan, allows it on a paid plan", async () => {
    const { db } = harness;
    // Free operator (no plans row → free_operator).
    const free = await seedProfileOwner("ga-free", "operator");
    await seedUser("ga-free-m", "operator");
    const blocked = await app.inject({
      method: "POST",
      url: `/api/v1/profiles/${free.profileId}/members`,
      headers: auth(free.ownerId),
      payload: { userId: "ga-free-m", role: "admin" },
    });
    expect(blocked.statusCode).toBe(403);

    // Paid operator (operator_pro) → admin allowed, seat consumed.
    const paid = await seedProfileOwner("ga-paid", "operator");
    await db.insert(schema.plans).values({ profileId: paid.profileId, tier: "operator_pro" });
    await seedUser("ga-paid-m", "operator");
    const allowed = await app.inject({
      method: "POST",
      url: `/api/v1/profiles/${paid.profileId}/members`,
      headers: auth(paid.ownerId),
      payload: { userId: "ga-paid-m", role: "admin" },
    });
    expect(allowed.statusCode).toBe(201);
    expect(allowed.json().role).toBe("admin");
    const [row] = await db
      .select()
      .from(schema.profileMembers)
      .where(eq(schema.profileMembers.userId, "ga-paid-m"));
    expect(row?.seatConsumed).toBe(true);
  });

  it("does not gate adding a non-admin member on a free plan", async () => {
    const free = await seedProfileOwner("ga-editor", "operator");
    await seedUser("ga-editor-m", "operator");
    const editor = await app.inject({
      method: "POST",
      url: `/api/v1/profiles/${free.profileId}/members`,
      headers: auth(free.ownerId),
      payload: { userId: "ga-editor-m", role: "editor" },
    });
    expect(editor.statusCode).toBe(201);
  });

  it("gates PATCH promotion to admin by plan", async () => {
    const { db } = harness;
    const free = await seedProfileOwner("ga-promote", "operator");
    await seedMember(free.profileId, "ga-promote-m", "operator", "viewer");
    const [member] = await db
      .select()
      .from(schema.profileMembers)
      .where(eq(schema.profileMembers.userId, "ga-promote-m"));

    const blocked = await app.inject({
      method: "PATCH",
      url: `/api/v1/profiles/${free.profileId}/members/${member?.id}`,
      headers: auth(free.ownerId),
      payload: { role: "admin" },
    });
    expect(blocked.statusCode).toBe(403);

    await db.insert(schema.plans).values({ profileId: free.profileId, tier: "operator_pro" });
    const allowed = await app.inject({
      method: "PATCH",
      url: `/api/v1/profiles/${free.profileId}/members/${member?.id}`,
      headers: auth(free.ownerId),
      payload: { role: "admin" },
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json().role).toBe("admin");
  });
});

/**
 * THE FIELDS THE PREVIOUS APP CAPTURED AND THIS ONE HAD LOST.
 *
 * The user's report was "Profile is missing a lot of inputs from the old
 * version". These are the ones with somewhere to be stored — links, photos,
 * videos, performer setups, venue capacity setups, and the street half of an
 * address — asserted as a round trip, because "the API accepts it" and "the row
 * holds it" have been two different things in this codebase before.
 */
describe("profiles — the field inventory ported from the previous app", () => {
  it("round-trips links, photos, videos and setups, and stores each in its own table", async () => {
    const { profileId, ownerId } = await seedProfileOwner("inventory", "performer");

    const saved = await app.inject({
      method: "PATCH",
      url: `/api/v1/profiles/${profileId}`,
      headers: auth(ownerId),
      payload: {
        avatarUrl: "https://cdn.example/avatar.png",
        bannerUrl: "https://cdn.example/banner.png",
        location: { street: "Bandvägen 7", postcode: "113 30", city: "Stockholm", country: "se" },
        socialLinks: [
          { platform: "Spotify", url: "https://open.spotify.com/artist/x" },
          { platform: "Instagram", url: "https://instagram.com/x" },
        ],
        photos: ["https://cdn.example/1.jpg", "https://cdn.example/2.jpg"],
        videos: ["https://youtube.com/watch?v=abc"],
        setups: [
          { name: "Solo", headcount: 1 },
          { name: "Full Band", headcount: 5 },
        ],
      },
    });
    expect(saved.statusCode).toBe(200);

    const read = await app.inject({
      method: "GET",
      url: `/api/v1/profiles/${profileId}`,
      headers: auth(ownerId),
    });
    const body = read.json();
    expect(body.socialLinks).toEqual([
      { platform: "Spotify", url: "https://open.spotify.com/artist/x" },
      { platform: "Instagram", url: "https://instagram.com/x" },
    ]);
    expect(body.photos).toEqual(["https://cdn.example/1.jpg", "https://cdn.example/2.jpg"]);
    expect(body.videos).toEqual(["https://youtube.com/watch?v=abc"]);
    expect(body.location.street).toBe("Bandvägen 7");
    expect(body.location.postcode).toBe("113 30");

    // The STATE, per table — `profile_social_links` and `profile_media` had
    // existed since 0000 with nothing ever writing to them.
    const links = await harness.db
      .select()
      .from(schema.profileSocialLinks)
      .where(eq(schema.profileSocialLinks.profileId, profileId));
    expect(links).toHaveLength(2);
    // Order is the owner's editorial choice, so it is stored, not incidental.
    expect(links.map((link) => link.position).sort()).toEqual([0, 1]);

    const media = await harness.db
      .select()
      .from(schema.profileMedia)
      .where(eq(schema.profileMedia.profileId, profileId));
    expect(media.filter((item) => item.kind === "photo")).toHaveLength(2);
    expect(media.filter((item) => item.kind === "video")).toHaveLength(1);

    // Setups are merged into the `details` jsonb by the ROUTE, so a client never
    // has to hand-spread the blob (and so can never drop a sibling key).
    const [row] = await harness.db
      .select()
      .from(schema.profiles)
      .where(eq(schema.profiles.id, profileId));
    expect((row?.details as { setups: unknown[] }).setups).toEqual([
      { name: "Solo", headcount: 1 },
      { name: "Full Band", headcount: 5 },
    ]);
  });

  it("replaces photos without touching videos, and merges setups without dropping other details keys", async () => {
    const { profileId, ownerId } = await seedProfileOwner("inventory-partial", "performer");

    await app.inject({
      method: "PATCH",
      url: `/api/v1/profiles/${profileId}`,
      headers: auth(ownerId),
      payload: {
        details: { genres: ["Indie"] },
        photos: ["https://cdn.example/old.jpg"],
        videos: ["https://vimeo.com/1"],
      },
    });

    // Photos alone. The videos are a separate card in the editor, so a save that
    // only touched photos must not blank them.
    const partial = await app.inject({
      method: "PATCH",
      url: `/api/v1/profiles/${profileId}`,
      headers: auth(ownerId),
      payload: { photos: ["https://cdn.example/new.jpg"], setups: [{ name: "Duo", headcount: 2 }] },
    });
    expect(partial.statusCode).toBe(200);
    expect(partial.json().photos).toEqual(["https://cdn.example/new.jpg"]);
    expect(partial.json().videos).toEqual(["https://vimeo.com/1"]);

    const [row] = await harness.db
      .select()
      .from(schema.profiles)
      .where(eq(schema.profiles.id, profileId));
    const details = row?.details as { genres: string[]; setups: unknown[] };
    // `setups` arrived on its own; `genres` was written by an earlier save and is
    // still there.
    expect(details.genres).toEqual(["Indie"]);
    expect(details.setups).toEqual([{ name: "Duo", headcount: 2 }]);

    // An explicit empty array is "I removed them all", not "leave them alone".
    const cleared = await app.inject({
      method: "PATCH",
      url: `/api/v1/profiles/${profileId}`,
      headers: auth(ownerId),
      payload: { photos: [] },
    });
    expect(cleared.json().photos).toEqual([]);
    expect(cleared.json().videos).toEqual(["https://vimeo.com/1"]);
  });

  it("gives capacity setups stable ids and exactly one headline", async () => {
    const { profileId, ownerId } = await seedProfileOwner("capacity-setups", "operator");

    // Nobody flagged a main — the first setup becomes it, because a non-empty
    // list must have an answer to "what is this room's headline capacity".
    const none = await app.inject({
      method: "PATCH",
      url: `/api/v1/profiles/${profileId}`,
      headers: auth(ownerId),
      payload: {
        venueDetails: {
          capacitySetups: [
            { name: "Standing only", capacityStanding: 400 },
            { name: "Theater seating", capacitySitting: 220 },
            // A row the owner added and never named is dropped, not rejected.
            { name: "   " },
          ],
        },
      },
    });
    expect(none.statusCode).toBe(200);
    const setups = none.json().venueDetails.capacitySetups;
    expect(setups).toHaveLength(2);
    expect(setups.map((setup: { isMain: boolean }) => setup.isMain)).toEqual([true, false]);
    expect(setups[0].id).toBeTruthy();

    // Two mains is a state the previous app's UI could produce. Only the first
    // survives, so "the headline capacity" always has one answer.
    const both = await app.inject({
      method: "PATCH",
      url: `/api/v1/profiles/${profileId}`,
      headers: auth(ownerId),
      payload: {
        venueDetails: {
          capacitySetups: [
            { id: "a", name: "Standing only", capacityStanding: 400, isMain: true },
            { id: "b", name: "Theater seating", capacitySitting: 220, isMain: true },
          ],
        },
      },
    });
    expect(
      both.json().venueDetails.capacitySetups.map((s: { isMain: boolean }) => s.isMain),
    ).toEqual([true, false]);
  });
});

/**
 * THE PREVIEW, and the rule it exists to make honest.
 *
 * The screen used to compute "Public view" in the browser from the member
 * payload, so it showed draft events under a heading that said PUBLIC. The
 * preview is now a server projection — the SAME `serializePublicProfile` the
 * anonymous route runs — and these tests pin the two things that matters:
 * what it withholds, and that it agrees with the anonymous route field for field.
 */
describe("profiles — public preview", () => {
  it("withholds artist logistics and the booking contact, and keeps the audience half", async () => {
    const { profileId, ownerId } = await seedProfileOwner("preview-venue", "operator");
    await app.inject({
      method: "PATCH",
      url: `/api/v1/profiles/${profileId}`,
      headers: auth(ownerId),
      payload: {
        type: "venue",
        isPublic: true,
        location: { street: "Hornsgatan 12", postcode: "118 20", city: "Stockholm", country: "SE" },
        venueDetails: {
          capacity: 400,
          artistLogisticsNotes: "Back door on Bellmansgatan, code 4471",
          audienceLogisticsNotes: "Entrance on Hornsgatan, step-free at the side",
          contactEmail: "book@lantern.example",
          contactPhone: "+46 70 000 00 00",
        },
      },
    });

    const preview = await app.inject({
      method: "GET",
      url: `/api/v1/profiles/${profileId}/public-preview`,
      headers: auth(ownerId),
    });
    expect(preview.statusCode).toBe(200);
    const { profile } = preview.json();

    // The audience half is published; the artist half and the contact are not
    // merely blank — they have no key at all (decisions.md #16.7).
    expect(profile.venueDetails.audienceLogisticsNotes).toBe(
      "Entrance on Hornsgatan, step-free at the side",
    );
    expect(profile.venueDetails.artistLogisticsNotes).toBeUndefined();
    expect(profile.venueDetails.contactEmail).toBeUndefined();
    expect(profile.venueDetails.contactPhone).toBeUndefined();
    expect(profile.billing).toBeUndefined();
    expect(profile.details).toBeUndefined();
    expect(profile.ownerUserId).toBeUndefined();

    // A place publishes its street address — a venue nobody can find is a venue
    // nobody attends.
    expect(profile.location.street).toBe("Hornsgatan 12");

    // And it agrees with the anonymous route, field for field. Two projections
    // would drift; there is one, and this is the proof.
    const anonymous = await app.inject({
      method: "GET",
      url: `/api/v1/public/profiles/${anonymousSlug(preview.json().profile.slug)}`,
    });
    expect(anonymous.statusCode).toBe(200);
    expect(anonymous.json()).toEqual(profile);
  });

  it("withholds a performer's street address while publishing their city", async () => {
    const { profileId, ownerId } = await seedProfileOwner("preview-band", "performer");
    await app.inject({
      method: "PATCH",
      url: `/api/v1/profiles/${profileId}`,
      headers: auth(ownerId),
      payload: {
        type: "band",
        isPublic: true,
        location: { street: "Bandvägen 7", postcode: "113 30", city: "Stockholm", country: "SE" },
      },
    });

    // The band's own team still sees the whole address on the member read — it
    // is their address.
    const member = await app.inject({
      method: "GET",
      url: `/api/v1/profiles/${profileId}`,
      headers: auth(ownerId),
    });
    expect(member.json().location.street).toBe("Bandvägen 7");

    // A stranger gets the city and nothing finer. Ported from the previous app,
    // which printed a venue's full address and a performer's city only
    // (`PublicProfilePage.tsx` — `formatLocation` vs `formatPerformerLocation`).
    const preview = await app.inject({
      method: "GET",
      url: `/api/v1/profiles/${profileId}/public-preview`,
      headers: auth(ownerId),
    });
    expect(preview.json().profile.location).toEqual({
      street: null,
      postcode: null,
      city: "Stockholm",
      country: "SE",
      lat: null,
      lng: null,
    });
  });

  it("lists only published, world-facing events — never a draft", async () => {
    const { profileId, ownerId } = await seedProfileOwner("preview-events", "operator");
    const future = "2099-06-01";
    const past = "2000-06-01";
    await harness.db.insert(schema.events).values([
      // The one a stranger would find.
      {
        hostProfileId: profileId,
        venueProfileId: profileId,
        title: "Announced Show",
        baseCurrency: "SEK",
        eventDate: future,
        status: "confirmed",
        published: true,
        createdBy: ownerId,
      },
      // Never announced. The old screen listed exactly this under "PUBLIC".
      {
        hostProfileId: profileId,
        venueProfileId: profileId,
        title: "Draft Idea",
        baseCurrency: "SEK",
        eventDate: future,
        status: "draft",
        published: false,
        createdBy: ownerId,
      },
      // Published once, then called off — no longer a show.
      {
        hostProfileId: profileId,
        venueProfileId: profileId,
        title: "Called Off",
        baseCurrency: "SEK",
        eventDate: future,
        status: "cancelled",
        published: true,
        createdBy: ownerId,
      },
      // Real, announced, and over. "Coming Events" is a claim about the future.
      {
        hostProfileId: profileId,
        venueProfileId: profileId,
        title: "Last Year",
        baseCurrency: "SEK",
        eventDate: past,
        status: "concluded",
        published: true,
        createdBy: ownerId,
      },
    ]);

    const preview = await app.inject({
      method: "GET",
      url: `/api/v1/profiles/${profileId}/public-preview`,
      headers: auth(ownerId),
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().comingEvents.map((event: { title: string }) => event.title)).toEqual([
      "Announced Show",
    ]);
  });

  it("previews an UNPUBLISHED profile that the anonymous route 404s", async () => {
    const { profileId, ownerId } = await seedProfileOwner("preview-unpublished", "operator");
    const detail = await app.inject({
      method: "GET",
      url: `/api/v1/profiles/${profileId}`,
      headers: auth(ownerId),
    });
    const { slug } = detail.json();

    // Previewing before publishing is the whole point of a preview…
    const preview = await app.inject({
      method: "GET",
      url: `/api/v1/profiles/${profileId}/public-preview`,
      headers: auth(ownerId),
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().isPublic).toBe(false);
    expect(preview.json().profile.name).toBe("preview-unpublished");

    // …and the screen says so because the API told it, not because it guessed.
    const anonymous = await app.inject({
      method: "GET",
      url: `/api/v1/public/profiles/${slug}`,
    });
    expect(anonymous.statusCode).toBe(404);
  });

  it("404s a preview for a non-member (no existence leak)", async () => {
    const { profileId } = await seedProfileOwner("preview-private", "operator");
    await seedUser("preview-stranger", "operator");

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/profiles/${profileId}/public-preview`,
      headers: auth("preview-stranger"),
    });
    expect(response.statusCode).toBe(404);
  });
});

/** The slug is already URL-safe (created from a slug field); this just documents that. */
function anonymousSlug(slug: string): string {
  return encodeURIComponent(slug);
}
