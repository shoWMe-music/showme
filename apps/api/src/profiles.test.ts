import { schema } from "@showme/db";
import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TokenVerifier } from "./auth/token-verifier";
import type { StorageSigner } from "./lib/storage";
import { createFileRoutes } from "./routes/files";
import { profileRoutes } from "./routes/profiles";
import { publicRoutes } from "./routes/public";
import { buildTestApp } from "./testing";

/** Fake verifier: the bearer token IS the uid, so tests just send `Bearer <uid>`. */
const fakeVerifier: TokenVerifier = {
  async verify(token: string) {
    return { uid: token, email: `${token}@example.showme.test`, name: token };
  },
};

/**
 * Deterministic fake signer, so a picture's URL can be asserted exactly. The
 * SAME instance is decorated onto the app and given to `createFileRoutes`,
 * because that is the production wiring: one signer, or an upload issued through
 * one and read back through another.
 */
const fakeSigner: StorageSigner = {
  async signUpload(path, contentType, maxBytes) {
    return {
      url: `signed-upload::${path}`,
      headers: { "content-type": contentType, "x-goog-content-length-range": `0,${maxBytes}` },
    };
  },
  async signDownload(path) {
    return `signed-download::${path}`;
  },
};

let harness: TestDatabase;
let app: FastifyInstance;

beforeAll(async () => {
  harness = await startTestDatabase();
  // `publicRoutes` rides along so the preview tests can assert that the owner's
  // Preview and the anonymous page return the SAME body — the one thing a second
  // copy of the projection would break. `createFileRoutes` rides along so the
  // picture tests can walk the REAL upload path (issue a URL, then attach the
  // file to the profile) rather than hand-inserting a `files` row the API never
  // agreed to.
  app = buildTestApp(
    { database: harness.db, tokenVerifier: fakeVerifier, storageSigner: fakeSigner },
    [profileRoutes, publicRoutes, createFileRoutes(fakeSigner)],
  );
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
  await harness.db.insert(schema.users).values({ id, email: `${id}@example.showme.test`, kind });
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
          // No `capacity` — it belongs to a room now, and this route no longer
          // accepts one. See "a capacity is a room's" below.
          soundSystem: "Funktion-One",
          curfew: "02:00",
          // Blank and duplicate entries are dropped, and a venue's own wording
          // survives beside the standard keys.
          amenities: ["pa_system", "pa_system", "  ", "Green Room"],
          dealTypes: ["door_split"],
          contactEmail: "book@lantern.showme.test",
        },
      },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().venueDetails.amenities).toEqual(["pa_system", "Green Room"]);
    expect(saved.json().venueDetails.curfew).toBe("02:00");
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
    expect(venueRow?.soundSystem).toBe("Funktion-One");
    expect(venueRow?.contactEmail).toBe("book@lantern.showme.test");

    // A second save must UPDATE the same rows, not stack up duplicates — the
    // location row is upserted by profile, the venue row by primary key.
    const again = await app.inject({
      method: "PATCH",
      url: `/api/v1/profiles/${profileId}`,
      headers: auth("venue-details-owner"),
      payload: {
        location: { city: "Göteborg", country: "SE" },
        venueDetails: { curfew: "01:00" },
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
      payload: { venueDetails: { curfew: "03:00" } },
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

  it("keeps venue details on a place profile and refuses them everywhere else", async () => {
    // POSITIVE — an operator's venue. `seedProfileOwner` leaves `type` null and
    // an untyped operator already counts as a place (locking out someone mid-
    // setup is worse than offering the form to a promoter who ignores it), so
    // the type is stated here rather than implied: this is the venue case.
    const venue = await seedProfileOwner("room-venue", "operator");
    const saved = await app.inject({
      method: "PATCH",
      url: `/api/v1/profiles/${venue.profileId}`,
      headers: auth("room-venue-owner"),
      payload: { type: "venue", venueDetails: { curfew: "02:00" } },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().venueDetails.curfew).toBe("02:00");

    // NEGATIVE — a performer, the OWNER of their own profile, so nothing about
    // authority is being tested here. The room is simply not theirs to describe:
    // venue/production setup is operator-only (PLAN.md:350) and a performer sees
    // their own slice, never the venue's asset inventory (story.md).
    const performer = await seedProfileOwner("room-performer", "performer");
    const refused = await app.inject({
      method: "PATCH",
      url: `/api/v1/profiles/${performer.profileId}`,
      headers: auth("room-performer-owner"),
      payload: { name: "Renamed By The Same Request", venueDetails: { curfew: "02:00" } },
    });
    expect(refused.statusCode).toBe(403);
    // The REASON, not the bare status — a 403 on this route is also what a
    // viewer member gets, which would prove nothing about this rule.
    expect(refused.json().error.message).toContain("venue or festival");

    const performerRooms = await harness.db
      .select()
      .from(schema.venueDetails)
      .where(eq(schema.venueDetails.profileId, performer.profileId));
    expect(performerRooms).toHaveLength(0);

    // The rest of the PATCH went down with it. A partial save that wrote the
    // name and quietly dropped the venue half would be the same bug, quieter.
    const [storedPerformer] = await harness.db
      .select()
      .from(schema.profiles)
      .where(eq(schema.profiles.id, performer.profileId));
    expect(storedPerformer?.name).toBe("room-performer");

    // An operator who is a PROMOTER is refused too — the question is "is this a
    // place", not "is this an operator". A promoter is an organisation, not a
    // room, and it has no curfew to publish.
    const promoter = await seedProfileOwner("room-promoter", "operator");
    const promoterRefused = await app.inject({
      method: "PATCH",
      url: `/api/v1/profiles/${promoter.profileId}`,
      headers: auth("room-promoter-owner"),
      payload: { type: "promoter", venueDetails: { curfew: "02:00" } },
    });
    expect(promoterRefused.statusCode).toBe(403);
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
        photos: [{ url: "https://cdn.example/1.jpg" }, { url: "https://cdn.example/2.jpg" }],
        videos: ["https://youtube.com/watch?v=dQw4w9WgXcQ"],
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
    expect(body.photos).toEqual([
      { fileId: null, url: "https://cdn.example/1.jpg" },
      { fileId: null, url: "https://cdn.example/2.jpg" },
    ]);
    // Stored canonical, so the value in the row is one a player can be pointed at.
    expect(body.videos).toEqual(["https://www.youtube.com/watch?v=dQw4w9WgXcQ"]);
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
        photos: [{ url: "https://cdn.example/old.jpg" }],
        videos: ["https://vimeo.com/347119375"],
      },
    });

    // Photos alone. The videos are a separate card in the editor, so a save that
    // only touched photos must not blank them.
    const partial = await app.inject({
      method: "PATCH",
      url: `/api/v1/profiles/${profileId}`,
      headers: auth(ownerId),
      payload: {
        photos: [{ url: "https://cdn.example/new.jpg" }],
        setups: [{ name: "Duo", headcount: 2 }],
      },
    });
    expect(partial.statusCode).toBe(200);
    expect(partial.json().photos).toEqual([{ fileId: null, url: "https://cdn.example/new.jpg" }]);
    expect(partial.json().videos).toEqual(["https://vimeo.com/347119375"]);

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
    expect(cleared.json().videos).toEqual(["https://vimeo.com/347119375"]);
  });

  /**
   * The tagline is a first-class body field over a `details` LEAF, like `setups`.
   * Three things have to hold at once, and each of them has been got wrong by a
   * client hand-merging a jsonb blob before: the leaf saves, the neighbours it
   * shares the blob with survive, and clearing it REMOVES the key rather than
   * storing "".
   */
  it("saves a tagline beside the other details leaves, and clears it to nothing", async () => {
    const { profileId, ownerId } = await seedProfileOwner("tagline-leaf", "performer");

    await app.inject({
      method: "PATCH",
      url: `/api/v1/profiles/${profileId}`,
      headers: auth(ownerId),
      payload: { details: { genres: ["Indie folk"] } },
    });

    // A tagline and setups in ONE request. Two independent merge blocks would
    // keep whichever ran last and silently drop the other.
    const saved = await app.inject({
      method: "PATCH",
      url: `/api/v1/profiles/${profileId}`,
      headers: auth(ownerId),
      payload: {
        tagline: "  Songs built for rooms that listen.  ",
        setups: [{ name: "Solo", headcount: 1 }],
      },
    });
    expect(saved.statusCode).toBe(200);

    const detailsNow = async () => {
      const [row] = await harness.db
        .select()
        .from(schema.profiles)
        .where(eq(schema.profiles.id, profileId));
      return row?.details as Record<string, unknown>;
    };
    expect(await detailsNow()).toEqual({
      genres: ["Indie folk"],
      setups: [{ name: "Solo", headcount: 1 }],
      tagline: "Songs built for rooms that listen.",
    });

    // It is published — the whole reason the field exists.
    const published = await app.inject({
      method: "GET",
      url: `/api/v1/profiles/${profileId}/public-preview`,
      headers: auth(ownerId),
    });
    expect(published.json().profile.tagline).toBe("Songs built for rooms that listen.");

    // Cleared: the KEY is gone, and nothing else in the blob moved.
    const cleared = await app.inject({
      method: "PATCH",
      url: `/api/v1/profiles/${profileId}`,
      headers: auth(ownerId),
      payload: { tagline: null },
    });
    expect(cleared.statusCode).toBe(200);
    const after = await detailsNow();
    expect("tagline" in after).toBe(false);
    expect(after.genres).toEqual(["Indie folk"]);
    expect(after.setups).toEqual([{ name: "Solo", headcount: 1 }]);

    // Longer than a tagline is refused, not truncated.
    const tooLong = await app.inject({
      method: "PATCH",
      url: `/api/v1/profiles/${profileId}`,
      headers: auth(ownerId),
      payload: { tagline: "x".repeat(141) },
    });
    expect(tooLong.statusCode).toBe(400);
  });

  /**
   * A CAPACITY IS A ROOM'S — the one model that replaced three.
   *
   * A venue used to be asked for its capacity three times on one profile screen:
   * a flat `venue_details.capacity`, a "capacity setups" list beside it, and a
   * capacity on every room. This pins what is left: the room owns the number and
   * its alternate arrangements, the profile route refuses to take one, and
   * `venue_details.capacity` follows the largest room so the venue search, the
   * public chip and `events.capacity` keep reading one figure.
   */
  it("takes a capacity only on a room, and derives the venue's from the largest", async () => {
    const { profileId, ownerId } = await seedProfileOwner("room-capacity", "operator");
    await app.inject({
      method: "PATCH",
      url: `/api/v1/profiles/${profileId}`,
      headers: auth(ownerId),
      payload: { type: "venue" },
    });

    // The profile form cannot set a capacity any more. Not a 400 — the field is
    // simply not in the schema, so it is stripped — but nothing must be written:
    // a silently-accepted capacity would be overwritten by the next room edit.
    const rejected = await app.inject({
      method: "PATCH",
      url: `/api/v1/profiles/${profileId}`,
      headers: auth(ownerId),
      payload: { venueDetails: { capacity: 999, curfew: "02:00" } },
    });
    expect(rejected.statusCode).toBe(200);
    expect(rejected.json().venueDetails.capacity).toBeNull();

    const main = await app.inject({
      method: "POST",
      url: `/api/v1/profiles/${profileId}/stages`,
      headers: auth(ownerId),
      payload: {
        name: "Main Room",
        capacity: 400,
        capacitySetups: [
          { name: "Standing only", capacity: 400 },
          { name: "Theater seating", capacity: 220 },
          // A row the owner added and never named is dropped, not rejected.
          { name: "   ", capacity: 10 },
        ],
      },
    });
    expect(main.statusCode).toBe(201);
    const mainSetups = main.json().capacitySetups;
    expect(mainSetups.map((setup: { name: string }) => setup.name)).toEqual([
      "Standing only",
      "Theater seating",
    ]);
    // Ids are minted so the editor can key a row it is mid-edit on.
    expect(mainSetups[0].id).toBeTruthy();

    // The state, not just the response: the venue's headline capacity followed.
    const [afterMain] = await harness.db
      .select()
      .from(schema.venueDetails)
      .where(eq(schema.venueDetails.profileId, profileId));
    expect(afterMain?.capacity).toBe(400);

    // A smaller second room does not become the venue's number.
    const back = await app.inject({
      method: "POST",
      url: `/api/v1/profiles/${profileId}/stages`,
      headers: auth(ownerId),
      payload: { name: "Back Room", capacity: 80 },
    });
    expect(back.statusCode).toBe(201);
    expect(back.json().capacitySetups).toEqual([]);
    const [afterBack] = await harness.db
      .select()
      .from(schema.venueDetails)
      .where(eq(schema.venueDetails.profileId, profileId));
    expect(afterBack?.capacity).toBe(400);

    // Growing the small room past the big one moves the venue's figure with it.
    const grown = await app.inject({
      method: "PATCH",
      url: `/api/v1/profiles/${profileId}/stages/${back.json().id}`,
      headers: auth(ownerId),
      payload: { capacity: 900 },
    });
    expect(grown.statusCode).toBe(200);
    const [afterGrown] = await harness.db
      .select()
      .from(schema.venueDetails)
      .where(eq(schema.venueDetails.profileId, profileId));
    expect(afterGrown?.capacity).toBe(900);

    // And deleting it puts the venue back on the main hall — the derived number
    // is recomputed on every room write, never left behind by one.
    const removed = await app.inject({
      method: "DELETE",
      url: `/api/v1/profiles/${profileId}/stages/${back.json().id}`,
      headers: auth(ownerId),
    });
    expect(removed.statusCode).toBe(200);
    const [afterRemoved] = await harness.db
      .select()
      .from(schema.venueDetails)
      .where(eq(schema.venueDetails.profileId, profileId));
    expect(afterRemoved?.capacity).toBe(400);

    // Setups are the room's, and are read back with it.
    const listed = await app.inject({
      method: "GET",
      url: `/api/v1/profiles/${profileId}/stages`,
      headers: auth(ownerId),
    });
    expect(listed.statusCode).toBe(200);
    const rooms = listed.json();
    expect(rooms).toHaveLength(1);
    expect(rooms[0].name).toBe("Main Room");
    expect(rooms[0].capacitySetups).toHaveLength(2);
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
          contactEmail: "book@lantern.showme.test",
          contactPhone: "+46 70 000 00 00",
          amenities: ["pa_system", "backline"],
          dealTypes: ["door_split", "guarantee"],
          cateringNotes: "Hot meal for up to six.",
          accommodationNotes: "Two twin rooms across the square.",
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

    // The trade half is not in the projection either (decisions.md #19) — but it
    // is not lost: it rides beside it, so Preview can show the owner what it
    // entered while saying it is being held back.
    expect(preview.json().withheldDetails).toEqual({
      setups: [],
      venue: {
        amenities: ["pa_system", "backline"],
        dealTypes: ["door_split", "guarantee"],
        cateringNotes: "Hot meal for up to six.",
        accommodationNotes: "Two twin rooms across the square.",
      },
    });

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

  /**
   * THE REGRESSION THAT MATTERS.
   *
   * `amenities`, `dealTypes`, `cateringNotes` and `accommodationNotes` were
   * published to anyone who opened the page until 2026-08-31 (`docs/decisions.md`
   * #18). Two of them — the catering and accommodation notes — were on the wire
   * and rendered by nothing, which is the shape of disclosure nobody notices: no
   * screen changes when it leaks, so no screen changes when it comes back.
   *
   * This test walks the ANONYMOUS route, unauthenticated, against a venue that
   * has filled in all four, and asserts the keys are absent rather than blank.
   * `toBeUndefined` and not `toBeNull` on purpose: a null would mean the field is
   * published and empty, and the next person to touch the serializer would fill
   * it in.
   */
  it("never publishes the venue trade details to an anonymous visitor", async () => {
    const { profileId, ownerId } = await seedProfileOwner("preview-trade", "operator");
    const patched = await app.inject({
      method: "PATCH",
      url: `/api/v1/profiles/${profileId}`,
      headers: auth(ownerId),
      payload: {
        type: "venue",
        isPublic: true,
        venueDetails: {
          // No `capacity` — since migration 0029 it is only ever entered against
          // a room, and `venue_details.capacity` is a derived mirror. This venue
          // has no rooms, so it stays null, which is beside the point here.
          soundSystem: "Funktion-One",
          curfew: "02:00",
          audienceLogisticsNotes: "Tram 7 to Nybroplan.",
          amenities: ["pa_system", "backline", "catering"],
          dealTypes: ["door_split", "guarantee_plus_door_split", "rental", "guarantee"],
          cateringNotes: "Hot meal for up to six, vegan by default.",
          accommodationNotes: "Two twin rooms across the square.",
        },
      },
    });
    expect(patched.statusCode).toBe(200);

    // The venue's own team still has all four — the fields are withheld from
    // strangers, not deleted.
    expect(patched.json().venueDetails.amenities).toEqual(["pa_system", "backline", "catering"]);
    expect(patched.json().venueDetails.cateringNotes).toBe(
      "Hot meal for up to six, vegan by default.",
    );

    const anonymous = await app.inject({
      method: "GET",
      url: `/api/v1/public/profiles/${anonymousSlug(patched.json().slug)}`,
    });
    expect(anonymous.statusCode).toBe(200);
    const body = anonymous.json();

    for (const field of ["amenities", "dealTypes", "cateringNotes", "accommodationNotes"]) {
      expect(body.venueDetails[field]).toBeUndefined();
    }
    // Not anywhere else in the body either — a future handler could hang them off
    // the root as easily as off `venueDetails`.
    expect(JSON.stringify(body)).not.toContain("Hot meal for up to six");
    expect(JSON.stringify(body)).not.toContain("Two twin rooms across the square");
    expect(JSON.stringify(body)).not.toContain("guarantee_plus_door_split");
    expect(JSON.stringify(body)).not.toContain("backline");

    // And the public half is untouched — this is a narrowing, not a blackout.
    expect(body.venueDetails).toEqual({
      capacity: null,
      soundSystem: "Funktion-One",
      curfew: "02:00",
      audienceLogisticsNotes: "Tram 7 to Nybroplan.",
    });

    // The withheld half never reaches the anonymous route even as a sibling: it
    // exists only on the member preview.
    expect(body.withheldDetails).toBeUndefined();
  });

  /**
   * THE SAME REGRESSION, THE PERFORMER'S HALF.
   *
   * `setups` is the line-up an operator sizes a booking with — "Full Band", 7
   * people — and it went on publishing to the open web through the first pass of
   * `docs/decisions.md` #19, which named the four venue fields and missed this
   * one. It is the same class of fact for the same reason: what it costs to bring
   * this act is a negotiating position, not audience copy.
   *
   * It asserts the same two things #19's venue test does, and the second is the
   * one that would have caught the miss: the key is absent from `profile`, AND
   * the VALUES appear nowhere in the serialized body. A field can leave the
   * projection and come back hung off the root, and only a search of the whole
   * payload sees that.
   */
  it("never publishes a performer's setups to an anonymous visitor", async () => {
    const { profileId, ownerId } = await seedProfileOwner("preview-setups", "performer");
    const patched = await app.inject({
      method: "PATCH",
      url: `/api/v1/profiles/${profileId}`,
      headers: auth(ownerId),
      payload: {
        isPublic: true,
        bio: "A quartet from Stockholm.",
        details: { genres: ["jazz", "soul", "afrobeat"] },
        setups: [
          { name: "Solo · piano only", headcount: 1 },
          { name: "Full Band", headcount: 7 },
        ],
      },
    });
    expect(patched.statusCode).toBe(200);

    const anonymous = await app.inject({
      method: "GET",
      url: `/api/v1/public/profiles/${anonymousSlug(patched.json().slug)}`,
    });
    expect(anonymous.statusCode).toBe(200);
    const body = anonymous.json();

    expect(body.setups).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("Full Band");
    expect(JSON.stringify(body)).not.toContain("Solo · piano only");
    // The headcount on its own, too — a future handler could publish the numbers
    // without the names and still have said how big the touring party is.
    expect(JSON.stringify(body)).not.toContain("headcount");

    // A narrowing, not a blackout: everything else a stranger came for is there,
    // and ALL of the genres are, which is what the public page draws instead.
    expect(body.genres).toEqual(["jazz", "soul", "afrobeat"]);
    expect(body.bio).toBe("A quartet from Stockholm.");

    // And the owner still has them, on the preview, as a sibling of `profile` —
    // never inside it, so the two bodies stay equal field for field.
    const preview = await app.inject({
      method: "GET",
      url: `/api/v1/profiles/${profileId}/public-preview`,
      headers: auth(ownerId),
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().withheldDetails).toEqual({
      setups: [
        { name: "Solo · piano only", headcount: 1 },
        { name: "Full Band", headcount: 7 },
      ],
      venue: null,
    });
    expect(preview.json().profile.setups).toBeUndefined();
    expect(preview.json().profile).toEqual(body);
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
    // The bill now lives ON the profile — the same field the anonymous page
    // serves, so a preview cannot show a different set of shows than the page it
    // is previewing.
    expect(
      preview.json().profile.upcomingShows.map((show: { title: string }) => show.title),
    ).toEqual(["Announced Show"]);
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

/**
 * PICTURES ARE FILES, AND VIDEOS ARE LINKS TO A PLAYER.
 *
 * What this replaced: every image on a profile was a `text` column holding an
 * address somebody typed ("Avatar image URL", placeholder `https://…`), so the
 * only way to give a venue a face was to already be hosting that face elsewhere.
 * The `files` + signed-URL subsystem was never wired to a profile at all.
 *
 * These tests walk the real path — issue an upload URL, then attach the file id
 * to the profile — because "the API accepts a fileId" and "the picture came out
 * of this profile's own storage folder" are two different claims.
 */
describe("profiles — uploaded pictures", () => {
  /** Issue an upload URL the way the browser does, and return the new file id. */
  async function uploadImage(
    profileId: string,
    ownerId: string,
    name: string,
  ): Promise<{ fileId: string; path: string }> {
    const path = `profiles/${profileId}/media/${name}`;
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/files/upload-url",
      headers: auth(ownerId),
      payload: {
        path,
        contentType: "image/jpeg",
        kind: "photo",
        sizeBytes: 12_345,
        ownerProfileId: profileId,
      },
    });
    expect(response.statusCode).toBe(201);
    return { fileId: response.json().fileId, path };
  }

  it("puts an uploaded photo in the gallery and serves it through a signed URL", async () => {
    const { profileId, ownerId } = await seedProfileOwner("picture-upload", "performer");
    const uploaded = await uploadImage(profileId, ownerId, "stage.jpg");

    const saved = await app.inject({
      method: "PATCH",
      url: `/api/v1/profiles/${profileId}`,
      headers: auth(ownerId),
      payload: { photos: [{ fileId: uploaded.fileId }], avatarFileId: uploaded.fileId },
    });
    expect(saved.statusCode).toBe(200);

    // The ROW stores the file, never a URL — a signed URL expires in fifteen
    // minutes, so a stored one would be a face that works until lunchtime.
    const [media] = await harness.db
      .select()
      .from(schema.profileMedia)
      .where(eq(schema.profileMedia.profileId, profileId));
    expect(media?.fileId).toBe(uploaded.fileId);
    expect(media?.url).toBeNull();

    // The WIRE carries a signed URL, minted per read, plus the id the editor
    // needs to save the list back.
    const read = await app.inject({
      method: "GET",
      url: `/api/v1/profiles/${profileId}`,
      headers: auth(ownerId),
    });
    expect(read.json().photos).toEqual([
      { fileId: uploaded.fileId, url: `signed-download::${uploaded.path}` },
    ]);
    expect(read.json().avatarUrl).toBe(`signed-download::${uploaded.path}`);
  });

  it("publishes an uploaded picture on the public page as a signed URL, never as a path", async () => {
    const slug = "picture-public";
    const { profileId, ownerId } = await seedProfileOwner(slug, "operator");
    const uploaded = await uploadImage(profileId, ownerId, "room.jpg");
    await app.inject({
      method: "PATCH",
      url: `/api/v1/profiles/${profileId}`,
      headers: auth(ownerId),
      payload: { isPublic: true, photos: [{ fileId: uploaded.fileId }] },
    });

    const anonymous = await app.inject({
      method: "GET",
      url: `/api/v1/public/profiles/${anonymousSlug(slug)}`,
    });
    expect(anonymous.statusCode).toBe(200);
    expect(anonymous.json().photos).toEqual([`signed-download::${uploaded.path}`]);
  });

  it("refuses a file that belongs to another profile", async () => {
    const mine = await seedProfileOwner("picture-mine", "performer");
    const theirs = await seedProfileOwner("picture-theirs", "performer");
    const stolen = await uploadImage(theirs.profileId, theirs.ownerId, "theirs.jpg");

    const response = await app.inject({
      method: "PATCH",
      url: `/api/v1/profiles/${mine.profileId}`,
      headers: auth(mine.ownerId),
      payload: { photos: [{ fileId: stolen.fileId }] },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain("not uploaded to this profile");
  });

  it("refuses a file whose object path is outside this profile's folder", async () => {
    const { profileId, ownerId } = await seedProfileOwner("picture-elsewhere", "performer");

    // THE ROW IS PLANTED DIRECTLY, and that is the point of this test now.
    //
    // `POST /files/upload-url` refuses this shape outright — a signed write URL
    // must target the caller's own folder — so the route can no longer produce a
    // row whose `owner_profile_id` and `path` disagree. This asserts the SECOND
    // door: even handed such a row (an older upload, a future writer, a direct
    // insert), attaching it as a picture is still refused, because `files.path`
    // is client-supplied and ownership and location are two separate claims.
    const [planted] = await harness.db
      .insert(schema.files)
      .values({
        path: "profiles/00000000-0000-0000-0000-000000000000/media/elsewhere.jpg",
        kind: "photo",
        contentType: "image/jpeg",
        sizeBytes: 100,
        ownerUserId: ownerId,
        ownerProfileId: profileId,
      })
      .returning();

    const response = await app.inject({
      method: "PATCH",
      url: `/api/v1/profiles/${profileId}`,
      headers: auth(ownerId),
      payload: { avatarFileId: planted?.id },
    });
    expect(response.statusCode).toBe(400);
  });

  it("refuses to ISSUE an upload URL outside the profile's folder in the first place", async () => {
    const { profileId, ownerId } = await seedProfileOwner("picture-prefix", "performer");
    const issued = await app.inject({
      method: "POST",
      url: "/api/v1/files/upload-url",
      headers: auth(ownerId),
      payload: {
        path: "profiles/00000000-0000-0000-0000-000000000000/media/elsewhere.jpg",
        contentType: "image/jpeg",
        kind: "photo",
        sizeBytes: 100,
        ownerProfileId: profileId,
      },
    });
    expect(issued.statusCode).toBe(400);
  });

  it("refuses a photo that is both a file and a URL, and one that is neither", async () => {
    const { profileId, ownerId } = await seedProfileOwner("picture-either", "performer");
    const uploaded = await uploadImage(profileId, ownerId, "either.jpg");

    const both = await app.inject({
      method: "PATCH",
      url: `/api/v1/profiles/${profileId}`,
      headers: auth(ownerId),
      payload: {
        photos: [{ fileId: uploaded.fileId, url: "https://cdn.example/also.jpg" }],
      },
    });
    expect(both.statusCode).toBe(400);

    const neither = await app.inject({
      method: "PATCH",
      url: `/api/v1/profiles/${profileId}`,
      headers: auth(ownerId),
      payload: { photos: [{}] },
    });
    expect(neither.statusCode).toBe(400);
  });

  it("takes the picture off when the owner clears both halves", async () => {
    const { profileId, ownerId } = await seedProfileOwner("picture-clear", "performer");
    const uploaded = await uploadImage(profileId, ownerId, "clear.jpg");
    await app.inject({
      method: "PATCH",
      url: `/api/v1/profiles/${profileId}`,
      headers: auth(ownerId),
      payload: { avatarFileId: uploaded.fileId },
    });

    const cleared = await app.inject({
      method: "PATCH",
      url: `/api/v1/profiles/${profileId}`,
      headers: auth(ownerId),
      payload: { avatarFileId: null, avatarUrl: null },
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().avatarUrl).toBeNull();
  });
});

/**
 * A video is a link to somebody else's player, which means it becomes an
 * `<iframe src>` on a page strangers read. The server decides which links may
 * become that, so what is stored is already safe to embed — a check that lives
 * only in the browser is a check the stored value never had to pass.
 */
describe("profiles — video links", () => {
  it("refuses a link that is not YouTube or Vimeo, and says what is accepted", async () => {
    const { profileId, ownerId } = await seedProfileOwner("video-refuse", "performer");

    const response = await app.inject({
      method: "PATCH",
      url: `/api/v1/profiles/${profileId}`,
      headers: auth(ownerId),
      payload: { videos: ["https://example.com/our-showreel.mp4"] },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain("YouTube and Vimeo");
  });

  it("refuses a hostile host that merely contains the provider's name", async () => {
    const { profileId, ownerId } = await seedProfileOwner("video-lookalike", "performer");

    const response = await app.inject({
      method: "PATCH",
      url: `/api/v1/profiles/${profileId}`,
      headers: auth(ownerId),
      payload: { videos: ["https://attacker.example/youtube.com/watch?v=dQw4w9WgXcQ"] },
    });
    expect(response.statusCode).toBe(400);
  });

  it("stores every accepted form canonically, so the player gets one shape", async () => {
    const { profileId, ownerId } = await seedProfileOwner("video-canonical", "performer");

    const saved = await app.inject({
      method: "PATCH",
      url: `/api/v1/profiles/${profileId}`,
      headers: auth(ownerId),
      payload: {
        videos: [
          "https://youtu.be/dQw4w9WgXcQ?si=share-sheet",
          "https://player.vimeo.com/video/347119375",
          "https://vimeo.com/347119375/a1b2c3d4e5",
        ],
      },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().videos).toEqual([
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://vimeo.com/347119375",
      "https://vimeo.com/347119375/a1b2c3d4e5",
    ]);
  });
});
