import { PRESET_PERMISSION_SETS } from "@showme/auth";
import { schema } from "@showme/db";
import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TokenVerifier } from "./auth/token-verifier";
import { eventRoutes } from "./routes/events";
import { eventListRoutes } from "./routes/events-list";
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
  app = buildTestApp({ database: harness.db, tokenVerifier: fakeVerifier }, [
    eventListRoutes,
    eventRoutes,
  ]);
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await harness?.stop();
});

const auth = (uid: string) => ({ authorization: `Bearer ${uid}` });

/** Seed a user + profile + active membership + a permission set, return the ids. */
async function seedMemberWithSet(
  id: string,
  kind: "operator" | "performer",
  capabilities: readonly string[],
) {
  const { db } = harness;
  await db.insert(schema.users).values({ id, email: `${id}@example.showme.test`, kind });
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

/** Insert an event hosted by `profileId`, with that profile as a host participant. */
async function seedHostedEvent(
  title: string,
  host: { profileId: string; permissionSetId: string },
  createdBy: string,
  extra: Record<string, unknown> = {},
) {
  const { db } = harness;
  const [event] = await db
    .insert(schema.events)
    .values({ hostProfileId: host.profileId, title, baseCurrency: "SEK", createdBy, ...extra })
    .returning();
  if (!event) throw new Error("event seed failed");
  await db.insert(schema.eventParticipants).values({
    eventId: event.id,
    profileId: host.profileId,
    role: "host",
    permissionSetId: host.permissionSetId,
    status: "confirmed",
  });
  return event;
}

describe("GET /events — access-scoped list", () => {
  it("returns only the caller's events, not one they are not on", async () => {
    const caller = await seedMemberWithSet(
      "ls-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const stranger = await seedMemberWithSet(
      "ls-other",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const mine1 = await seedHostedEvent("Mine A", caller, "ls-op");
    const mine2 = await seedHostedEvent("Mine B", caller, "ls-op");
    await seedHostedEvent("Not Mine", stranger, "ls-other");

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/events",
      headers: auth("ls-op"),
    });
    expect(response.statusCode).toBe(200);
    const ids = new Set(response.json().items.map((event: { id: string }) => event.id));
    expect(ids.has(mine1.id)).toBe(true);
    expect(ids.has(mine2.id)).toBe(true);
    expect(ids.size).toBe(2); // never the stranger's event
  });

  it("respects limit and returns a nextCursor when truncated", async () => {
    const caller = await seedMemberWithSet(
      "pg-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    await seedHostedEvent("Page 1", caller, "pg-op");
    await seedHostedEvent("Page 2", caller, "pg-op");

    const first = await app.inject({
      method: "GET",
      url: "/api/v1/events?limit=1",
      headers: auth("pg-op"),
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().items).toHaveLength(1);
    expect(first.json().nextCursor).toBeTypeOf("string");

    const second = await app.inject({
      method: "GET",
      url: `/api/v1/events?limit=1&cursor=${encodeURIComponent(first.json().nextCursor)}`,
      headers: auth("pg-op"),
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().items).toHaveLength(1);
    // Distinct pages.
    expect(second.json().items[0].id).not.toBe(first.json().items[0].id);
  });

  it("filters by a single status, server-side", async () => {
    const caller = await seedMemberWithSet(
      "st-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const draft = await seedHostedEvent("Shelved", caller, "st-op", { status: "draft" });
    await seedHostedEvent("Locked in", caller, "st-op", { status: "confirmed" });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/events?status=draft",
      headers: auth("st-op"),
    });
    expect(response.statusCode).toBe(200);
    const items = response.json().items as { id: string; status: string }[];
    expect(items.map((event) => event.id)).toEqual([draft.id]);
  });

  // The UI's "Pending" chip means pending OR suggested. Before the list-valued
  // `status` the only honest way to answer it was to filter in the browser —
  // over page one. `?status=pending,suggested` used to be a 400 (not in the enum).
  it("accepts a comma-separated status list, so one chip is one query", async () => {
    const caller = await seedMemberWithSet(
      "stl-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const pending = await seedHostedEvent("Awaiting reply", caller, "stl-op", {
      status: "pending",
    });
    const suggested = await seedHostedEvent("Offered", caller, "stl-op", { status: "suggested" });
    await seedHostedEvent("Locked in", caller, "stl-op", { status: "confirmed" });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/events?status=pending,suggested",
      headers: auth("stl-op"),
    });
    expect(response.statusCode).toBe(200);
    const ids = (response.json().items as { id: string }[]).map((event) => event.id);
    expect(new Set(ids)).toEqual(new Set([pending.id, suggested.id]));

    // The browser sends it percent-encoded (`URLSearchParams` escapes the comma),
    // so the same query has to survive that spelling too.
    const encoded = await app.inject({
      method: "GET",
      url: "/api/v1/events?status=pending%2Csuggested",
      headers: auth("stl-op"),
    });
    expect(encoded.statusCode).toBe(200);
    expect((encoded.json().items as { id: string }[]).map((event) => event.id).sort()).toEqual(
      ids.sort(),
    );
  });

  it("keeps the status filter across pages, so page two is still filtered", async () => {
    const caller = await seedMemberWithSet(
      "stp-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const first = await seedHostedEvent("Offer one", caller, "stp-op", { status: "suggested" });
    const second = await seedHostedEvent("Offer two", caller, "stp-op", { status: "pending" });
    await seedHostedEvent("Not in this filter", caller, "stp-op", { status: "confirmed" });

    const page1 = await app.inject({
      method: "GET",
      url: "/api/v1/events?status=pending,suggested&limit=1",
      headers: auth("stp-op"),
    });
    expect(page1.statusCode).toBe(200);
    expect(page1.json().items).toHaveLength(1);
    expect(page1.json().nextCursor).toBeTypeOf("string");

    const page2 = await app.inject({
      method: "GET",
      url: `/api/v1/events?status=pending,suggested&limit=1&cursor=${encodeURIComponent(page1.json().nextCursor)}`,
      headers: auth("stp-op"),
    });
    expect(page2.statusCode).toBe(200);
    const seen = [page1.json().items[0].id, page2.json().items[0].id];
    expect(new Set(seen)).toEqual(new Set([first.id, second.id]));
    // The confirmed event never appears, on either page.
    expect(page2.json().nextCursor).toBeNull();
  });

  it("rejects a status that is not an event status", async () => {
    await seedMemberWithSet("stx-op", "operator", PRESET_PERMISSION_SETS.operator_full);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/events?status=pending,not_a_status",
      headers: auth("stx-op"),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain("not_a_status");
  });

  it("serializes operator-only fields for the caller", async () => {
    const caller = await seedMemberWithSet(
      "sr-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    await seedHostedEvent("Rank Night", caller, "sr-op");
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/events",
      headers: auth("sr-op"),
    });
    expect(response.statusCode).toBe(200);
    // operator holds event.edit → hold fields present in the shape.
    expect(response.json().items[0]).toHaveProperty("holdAutoPromote");
  });
});

describe("DELETE /events/:id", () => {
  it("deletes an event and writes an audit row", async () => {
    const { db } = harness;
    const caller = await seedMemberWithSet(
      "del-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const event = await seedHostedEvent("Doomed", caller, "del-op");

    const response = await app.inject({
      method: "DELETE",
      url: `/api/v1/events/${event.id}`,
      headers: auth("del-op"),
      payload: { expectedVersion: 1 },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().deleted).toBe(true);

    const rows = await db.select().from(schema.events).where(eq(schema.events.id, event.id));
    expect(rows).toHaveLength(0);

    const audit = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, event.id));
    expect(audit).toHaveLength(1);
    expect(audit[0]?.action).toBe("event.delete");
  });

  // A-11: `POST /events` writes an audit row pinning the event it created, and
  // `audit_log.event_id` used to carry a foreign key — so every event created
  // through the API was undeletable (500) from the moment it existed. Seeding an
  // event straight into the table (as the test above does) never produced that
  // audit row, which is why nothing caught it.
  it("deletes an event created through the API, and the audit trail survives it", async () => {
    const { db } = harness;
    await db.insert(schema.users).values({
      id: "api-del-op",
      email: "api-del-op@example.showme.test",
      kind: "operator",
    });
    const [profile] = await db
      .insert(schema.profiles)
      .values({
        kind: "operator",
        ownerUserId: "api-del-op",
        name: "api-del-op",
        slug: "api-del-op",
      })
      .returning();
    if (!profile) throw new Error("profile seed failed");
    await db
      .insert(schema.profileMembers)
      .values({ profileId: profile.id, userId: "api-del-op", role: "owner", status: "active" });

    const headers = { authorization: "Bearer api-del-op", "x-profile-id": profile.id };
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers,
      payload: { title: "Created then deleted", baseCurrency: "SEK" },
    });
    expect(created.statusCode).toBe(201);
    const eventId = created.json().id;

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/v1/events/${eventId}`,
      headers,
      payload: { expectedVersion: 1 },
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json().deleted).toBe(true);
    expect(await db.select().from(schema.events).where(eq(schema.events.id, eventId))).toHaveLength(
      0,
    );

    // Both rows are still there, and both still name the event they describe.
    const trail = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.eventId, eventId));
    expect(trail.map((row) => row.action).sort()).toEqual(["event.create", "event.delete"]);
  });

  it("forbids a caller without event.delete (403)", async () => {
    const operator = await seedMemberWithSet(
      "fb-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const performer = await seedMemberWithSet(
      "fb-perf",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );
    const event = await seedHostedEvent("Guarded", operator, "fb-op");
    await harness.db.insert(schema.eventParticipants).values({
      eventId: event.id,
      profileId: performer.profileId,
      role: "performer",
      permissionSetId: performer.permissionSetId,
      status: "confirmed",
    });

    const response = await app.inject({
      method: "DELETE",
      url: `/api/v1/events/${event.id}`,
      headers: auth("fb-perf"),
    });
    expect(response.statusCode).toBe(403);
  });
});

describe("POST /events/:id/publish", () => {
  it("publishes the event and bumps the version to 2", async () => {
    const caller = await seedMemberWithSet(
      "pub-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const event = await seedHostedEvent("Confirmed Night", caller, "pub-op", {
      status: "confirmed",
      eventDate: "2026-09-12",
    });
    expect(event.published).toBe(false);

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/publish`,
      headers: auth("pub-op"),
      payload: { expectedVersion: 1 },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().published).toBe(true);
    expect(response.json().version).toBe(2);

    const audit = await harness.db
      .select()
      .from(schema.auditLog)
      .where(
        and(eq(schema.auditLog.targetId, event.id), eq(schema.auditLog.action, "event.publish")),
      );
    expect(audit).toHaveLength(1);
  });

  it("refuses to publish an unconfirmed event and leaves the flag down", async () => {
    const caller = await seedMemberWithSet(
      "pub-draft-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const event = await seedHostedEvent("Draft Night", caller, "pub-draft-op", {
      status: "draft",
      eventDate: "2026-09-12",
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/publish`,
      headers: auth("pub-draft-op"),
      payload: { expectedVersion: 1 },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toMatch(/confirmed/i);

    const [after] = await harness.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, event.id));
    expect(after?.published).toBe(false);
    expect(after?.version).toBe(1);
  });

  it("refuses to publish a dateless event — a poster with no date is not an announcement", async () => {
    const caller = await seedMemberWithSet(
      "pub-nodate-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const event = await seedHostedEvent("Someday Show", caller, "pub-nodate-op", {
      status: "confirmed",
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/publish`,
      headers: auth("pub-nodate-op"),
      payload: { expectedVersion: 1 },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toMatch(/date/i);

    const [after] = await harness.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, event.id));
    expect(after?.published).toBe(false);
  });
});

describe("POST /events/:id/notify", () => {
  it("queues (stub) and audits event.notify", async () => {
    const caller = await seedMemberWithSet(
      "not-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const event = await seedHostedEvent("Announce", caller, "not-op");

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/notify`,
      headers: auth("not-op"),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ queued: true });

    const audit = await harness.db
      .select()
      .from(schema.auditLog)
      .where(
        and(eq(schema.auditLog.targetId, event.id), eq(schema.auditLog.action, "event.notify")),
      );
    expect(audit).toHaveLength(1);
  });
});

describe("PATCH /events/:id — the poster (migration 0026)", () => {
  /**
   * A file row + the storage path the API insists on, exactly as
   * `POST /files/upload-url` would have written them. Inserted directly because
   * this suite does not mount the files routes — the rule under test is what the
   * EVENT does with a file id, not how the id was minted.
   */
  async function seedUploadedImage(profileId: string, ownerUserId: string, name: string) {
    const [file] = await harness.db
      .insert(schema.files)
      .values({
        ownerUserId,
        ownerProfileId: profileId,
        kind: "photo",
        path: `profiles/${profileId}/media/${name}`,
        contentType: "image/png",
        sizeBytes: 4096,
      })
      .returning();
    if (!file) throw new Error("file seed failed");
    return file;
  }

  it("attaches a poster the host uploaded, and serves it as a signed URL", async () => {
    const host = await seedMemberWithSet("poster-host", "operator", ["event.view", "event.edit"]);
    const event = await seedHostedEvent("Poster Show", host, "poster-host");
    const file = await seedUploadedImage(host.profileId, "poster-host", "poster.png");

    const saved = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${event.id}`,
      headers: auth("poster-host"),
      payload: { imageFileId: file.id },
    });
    expect(saved.statusCode).toBe(200);
    // The WIRE carries a URL minted per read FROM THE FILE'S PATH — this suite's
    // signer is the offline fake, so the assertion is on the shape rather than on
    // a real signature. What it proves is that the response went through the
    // signer at all, which is the half that used to be missing.
    expect(saved.json().imageUrl).toBe(
      `https://fake.storage.local/download/${encodeURIComponent(file.path)}`,
    );

    // The ROW stores the FILE. Storing the signed URL instead would give the show
    // a poster that works for fifteen minutes.
    const [row] = await harness.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, event.id));
    expect(row?.imageFileId).toBe(file.id);
    expect(row?.imageUrl).toBeNull();
  });

  it("refuses a poster uploaded to a different profile", async () => {
    const host = await seedMemberWithSet("poster-mine", "operator", ["event.view", "event.edit"]);
    const stranger = await seedMemberWithSet("poster-theirs", "operator", ["event.view"]);
    const event = await seedHostedEvent("Borrowed Poster", host, "poster-mine");
    const theirs = await seedUploadedImage(stranger.profileId, "poster-theirs", "theirs.png");

    const response = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${event.id}`,
      headers: auth("poster-mine"),
      payload: { imageFileId: theirs.id },
    });
    // 400, not 403: the caller may edit this event. The file is the problem, and
    // the message says which one.
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain("not uploaded to this profile");

    const [row] = await harness.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, event.id));
    expect(row?.imageFileId).toBeNull();
  });

  it("takes the poster off when both halves are cleared", async () => {
    const host = await seedMemberWithSet("poster-clear", "operator", ["event.view", "event.edit"]);
    const event = await seedHostedEvent("Cleared Poster", host, "poster-clear", {
      imageUrl: "https://cdn.example/old-poster.png",
    });

    const response = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${event.id}`,
      headers: auth("poster-clear"),
      payload: { imageFileId: null, imageUrl: null },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().imageUrl).toBeNull();
  });
});

describe("PATCH /events/:id — the free-tier event cap (entitlement layer)", () => {
  /** A free_operator host already sitting ON the cap: 3 counted events in the window. */
  async function seedHostAtCap(prefix: string) {
    const host = await seedMemberWithSet(
      `${prefix}-op`,
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    await seedHostedEvent("Counted A", host, `${prefix}-op`, { status: "confirmed" });
    await seedHostedEvent("Counted B", host, `${prefix}-op`, { status: "confirmed" });
    await seedHostedEvent("Counted C", host, `${prefix}-op`, { status: "concluded" });
    return host;
  }

  it("403s a fourth event going straight to `concluded`, not just to `confirmed`", async () => {
    const host = await seedHostAtCap("cap-conc");
    const fourth = await seedHostedEvent("Fourth", host, "cap-conc-op", { status: "draft" });

    const confirmed = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${fourth.id}`,
      headers: auth("cap-conc-op"),
      payload: { status: "confirmed" },
    });
    expect(confirmed.statusCode).toBe(403);

    // The A-20 hole: the SAME event walked into the counted set through `concluded`.
    const concluded = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${fourth.id}`,
      headers: auth("cap-conc-op"),
      payload: { status: "concluded" },
    });
    expect(concluded.statusCode).toBe(403);

    const [after] = await harness.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, fourth.id));
    expect(after?.status).toBe("draft");
  });

  it("still lets an event already inside the counted set conclude, and lets a cancel through", async () => {
    const host = await seedHostAtCap("cap-inside");
    const live = await seedHostedEvent("Live", host, "cap-inside-op", { status: "confirmed" });
    const draft = await seedHostedEvent("Shelved", host, "cap-inside-op", { status: "draft" });

    // confirmed → concluded consumes nothing new: never gated.
    const concluded = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${live.id}`,
      headers: auth("cap-inside-op"),
      payload: { status: "concluded" },
    });
    expect(concluded.statusCode).toBe(200);
    expect(concluded.json().status).toBe("concluded");

    // Leaving the set is never gated either.
    const cancelled = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${draft.id}`,
      headers: auth("cap-inside-op"),
      payload: { status: "cancelled" },
    });
    expect(cancelled.statusCode).toBe(200);
  });

  it("lets a host under the cap conclude a draft", async () => {
    const host = await seedMemberWithSet(
      "cap-under-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    await seedHostedEvent("Counted A", host, "cap-under-op", { status: "confirmed" });
    const draft = await seedHostedEvent("Next", host, "cap-under-op", { status: "draft" });

    const response = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${draft.id}`,
      headers: auth("cap-under-op"),
      payload: { status: "concluded" },
    });
    expect(response.statusCode).toBe(200);
  });
});

describe("venue-profile prefill — the venue's own facts fill the blanks", () => {
  /** A venue profile that has actually filled in its own record (migration 0010). */
  async function seedVenueProfile(id: string, name: string) {
    const { db } = harness;
    await db
      .insert(schema.users)
      .values({ id, email: `${id}@example.showme.test`, kind: "operator" });
    const [profile] = await db
      .insert(schema.profiles)
      .values({ kind: "operator", type: "venue", ownerUserId: id, name, slug: id })
      .returning();
    if (!profile) throw new Error("venue profile seed failed");
    await db.insert(schema.venueDetails).values({
      profileId: profile.id,
      capacity: 420,
      curfew: "02:00",
      amenities: ["green_room", "Loading Dock"],
    });
    await db
      .insert(schema.profileLocations)
      .values({ profileId: profile.id, city: "Stockholm", country: "SE", isPrimary: true });
    return profile.id;
  }

  it("fills name, capacity, curfew, amenities and city on create", async () => {
    const host = await seedMemberWithSet(
      "prefill-create-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const venueProfileId = await seedVenueProfile("prefill-create-venue", "The Lantern Hall");

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers: { ...auth("prefill-create-op"), "x-profile-id": host.profileId },
      payload: { title: "Prefilled", baseCurrency: "SEK", venueProfileId },
    });

    expect(response.statusCode).toBe(201);
    const event = response.json();
    expect(event.venueName).toBe("The Lantern Hall");
    expect(event.capacity).toBe(420);
    expect(event.curfew).toBe("02:00:00");
    expect(event.extras.amenities).toEqual(["green_room", "Loading Dock"]);
    expect(event.extras.city).toBe("Stockholm");
    expect(event.extras.country).toBe("SE");
  });

  it("never overwrites what the operator typed", async () => {
    const host = await seedMemberWithSet(
      "prefill-typed-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const venueProfileId = await seedVenueProfile("prefill-typed-venue", "The Lantern Hall");

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers: { ...auth("prefill-typed-op"), "x-profile-id": host.profileId },
      payload: {
        title: "Seated night",
        baseCurrency: "SEK",
        venueProfileId,
        venueName: "The Lantern Hall (Back Room)",
        capacity: 80,
        curfew: "23:00",
        extras: { amenities: ["Piano"], city: "Uppsala" },
      },
    });

    expect(response.statusCode).toBe(201);
    const event = response.json();
    expect(event.venueName).toBe("The Lantern Hall (Back Room)");
    expect(event.capacity).toBe(80);
    expect(event.curfew).toBe("23:00:00");
    expect(event.extras.amenities).toEqual(["Piano"]);
    expect(event.extras.city).toBe("Uppsala");
    // The country was blank in both, so the venue still gets to fill THAT one.
    expect(event.extras.country).toBe("SE");
  });

  it("fills the blanks when a venue is attached later, and leaves filled fields alone", async () => {
    const host = await seedMemberWithSet(
      "prefill-patch-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const venueProfileId = await seedVenueProfile("prefill-patch-venue", "The Lantern Hall");
    const event = await seedHostedEvent("Venue later", host, "prefill-patch-op", { capacity: 80 });

    const response = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${event.id}`,
      headers: auth("prefill-patch-op"),
      payload: { venueProfileId },
    });

    expect(response.statusCode).toBe(200);
    const updated = response.json();
    // Blank before → the venue's own answer.
    expect(updated.venueName).toBe("The Lantern Hall");
    expect(updated.curfew).toBe("02:00:00");
    expect(updated.extras.amenities).toEqual(["green_room", "Loading Dock"]);
    // Already set → untouched.
    expect(updated.capacity).toBe(80);
  });

  it("does not re-prefill on an unrelated edit once the operator has cleared a field", async () => {
    const host = await seedMemberWithSet(
      "prefill-cleared-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const venueProfileId = await seedVenueProfile("prefill-cleared-venue", "The Lantern Hall");
    const event = await seedHostedEvent("Cleared", host, "prefill-cleared-op", { venueProfileId });

    const cleared = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${event.id}`,
      headers: auth("prefill-cleared-op"),
      payload: { capacity: null, title: "Cleared capacity" },
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().capacity).toBeNull();

    // A later title edit does not touch the venue link, so nothing is re-read.
    const renamed = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${event.id}`,
      headers: auth("prefill-cleared-op"),
      payload: { title: "Still cleared" },
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().capacity).toBeNull();
  });

  it("survives a venue that has written nothing down", async () => {
    const host = await seedMemberWithSet(
      "prefill-bare-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const bare = await seedMemberWithSet(
      "prefill-bare-venue",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers: { ...auth("prefill-bare-op"), "x-profile-id": host.profileId },
      payload: { title: "Bare venue", baseCurrency: "SEK", venueProfileId: bare.profileId },
    });

    expect(response.statusCode).toBe(201);
    // The profile still has a NAME, which is the one fact every profile has.
    expect(response.json().venueName).toBe("prefill-bare-venue");
    expect(response.json().capacity).toBeNull();
  });
});

describe("PATCH /events/:id — a solo operator drives the status themselves", () => {
  // The counterparty-consent rules in this product live on the DEAL (each party
  // confirms its own `deal_parties` row) and on the INVITATION (nothing is
  // granted until the invitee accepts). The EVENT's status has never been a
  // handshake — it is the operator's own record of where the booking stands, and
  // an operator working alone must be able to say so. This locks that in, so a
  // future "tighten the transitions" change has to argue with a test.
  it("walks draft → suggested → pending → confirmed → concluded with no counterparty", async () => {
    const host = await seedMemberWithSet(
      "solo-status-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const event = await seedHostedEvent("Solo run", host, "solo-status-op", {
      eventDate: "2026-12-01",
    });

    for (const status of ["suggested", "pending", "confirmed", "concluded"]) {
      const response = await app.inject({
        method: "PATCH",
        url: `/api/v1/events/${event.id}`,
        headers: auth("solo-status-op"),
        payload: { status },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().status).toBe(status);
    }
  });

  it("lets the operator correct a status BACKWARDS (onboarding a past booking)", async () => {
    const host = await seedMemberWithSet(
      "solo-back-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const event = await seedHostedEvent("Mistyped", host, "solo-back-op", { status: "confirmed" });

    const response = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${event.id}`,
      headers: auth("solo-back-op"),
      payload: { status: "pending" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe("pending");
  });

  it("records the move as its own history line, not a generic update", async () => {
    const host = await seedMemberWithSet(
      "solo-history-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const event = await seedHostedEvent("Tracked", host, "solo-history-op", {});

    await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${event.id}`,
      headers: auth("solo-history-op"),
      payload: { status: "confirmed" },
    });

    const rows = await harness.db
      .select()
      .from(schema.activityLog)
      .where(eq(schema.activityLog.eventId, event.id));
    const statusLine = rows.find((row) => row.type === "event.status_changed");
    expect(statusLine).toBeDefined();
    expect(statusLine?.summary).toMatchObject({ from: "draft", to: "confirmed" });
  });
});

/**
 * The list row's own facts.
 *
 * Every one of these was an em-dash on `/events` while the same event's detail
 * page showed the value in full — three of them because the row had nothing to
 * draw, and `capacity` because `EventResponse` never declared a field
 * `serializeEvent` was already returning, so Fastify stripped it on the way out.
 * That is the same failure that hid `venueName`, which is why both are asserted
 * here: a schema that silently drops a field is invisible until someone reads the
 * screen.
 */
describe("GET /events — the facts a row draws", () => {
  it("carries the venue name and the capacity all the way through serialization", async () => {
    const caller = await seedMemberWithSet(
      "row-venue-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    await seedHostedEvent("Lantern Night", caller, "row-venue-op", {
      venueName: "The Lantern Hall",
      capacity: 400,
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/events",
      headers: auth("row-venue-op"),
    });
    expect(response.statusCode).toBe(200);
    const [row] = response.json().items as { venueName: string; capacity: number }[];
    expect(row?.venueName).toBe("The Lantern Hall");
    expect(row?.capacity).toBe(400);
  });

  it("names the top of the bill — the headliner, not whoever was added first", async () => {
    const caller = await seedMemberWithSet(
      "row-bill-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const opener = await seedMemberWithSet(
      "row-bill-opener",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );
    const headliner = await seedMemberWithSet(
      "row-bill-headliner",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );
    const event = await seedHostedEvent("Double Bill", caller, "row-bill-op");
    // Support goes on the bill FIRST, so ordering by insertion alone would name
    // the wrong act.
    await harness.db.insert(schema.eventParticipants).values({
      eventId: event.id,
      profileId: opener.profileId,
      role: "support",
      status: "confirmed",
    });
    await harness.db.insert(schema.eventParticipants).values({
      eventId: event.id,
      profileId: headliner.profileId,
      role: "performer",
      performerTag: "headliner",
      status: "confirmed",
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/events",
      headers: auth("row-bill-op"),
    });
    expect(response.statusCode).toBe(200);
    const row = (
      response.json().items as { id: string; headlinePerformerName: string | null }[]
    ).find((item) => item.id === event.id);
    expect(row?.headlinePerformerName).toBe("row-bill-headliner");
  });

  it("leaves the bill empty when nobody is on it yet", async () => {
    const caller = await seedMemberWithSet(
      "row-nobill-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    await seedHostedEvent("Nobody booked", caller, "row-nobill-op");

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/events",
      headers: auth("row-nobill-op"),
    });
    expect(response.statusCode).toBe(200);
    const [row] = response.json().items as { headlinePerformerName: string | null }[];
    expect(row?.headlinePerformerName).toBeNull();
  });

  it("reports the caller's settlement status, and null until someone runs one", async () => {
    const caller = await seedMemberWithSet(
      "row-settle-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const settled = await seedHostedEvent("Reconciled", caller, "row-settle-op");
    const untouched = await seedHostedEvent("Not reconciled", caller, "row-settle-op");

    const [hostParticipant] = await harness.db
      .select()
      .from(schema.eventParticipants)
      .where(eq(schema.eventParticipants.eventId, settled.id));
    if (!hostParticipant) throw new Error("host participant seed failed");
    await harness.db.insert(schema.settlements).values({
      eventId: settled.id,
      participantId: hostParticipant.id,
      status: "finalized",
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/events",
      headers: auth("row-settle-op"),
    });
    expect(response.statusCode).toBe(200);
    const rows = response.json().items as { id: string; settlementStatus: string | null }[];
    expect(rows.find((row) => row.id === settled.id)?.settlementStatus).toBe("finalized");
    // No settlement rows at all means nobody has run it — the absence IS the
    // answer, and the screen says "Not started" rather than inventing a stage.
    expect(rows.find((row) => row.id === untouched.id)?.settlementStatus).toBeNull();
  });

  it("never answers with a settlement the caller is not a party to", async () => {
    const caller = await seedMemberWithSet(
      "row-scope-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const performer = await seedMemberWithSet(
      "row-scope-performer",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );
    const event = await seedHostedEvent("Someone else's line", caller, "row-scope-op");
    const [performerParticipant] = await harness.db
      .insert(schema.eventParticipants)
      .values({
        eventId: event.id,
        profileId: performer.profileId,
        role: "performer",
        status: "confirmed",
      })
      .returning();
    if (!performerParticipant) throw new Error("performer participant seed failed");
    await harness.db.insert(schema.settlements).values({
      eventId: event.id,
      participantId: performerParticipant.id,
      status: "dispute",
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/events",
      headers: auth("row-scope-op"),
    });
    expect(response.statusCode).toBe(200);
    const row = (response.json().items as { id: string; settlementStatus: string | null }[]).find(
      (item) => item.id === event.id,
    );
    // The performer's line is theirs (decisions #4). The host holds no settlement
    // row here, so the honest answer is nothing — not the other party's status.
    expect(row?.settlementStatus).toBeNull();
  });
});
