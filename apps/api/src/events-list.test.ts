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
    return { uid: token, email: `${token}@example.com`, name: token };
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
      email: "api-del-op@example.com",
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
