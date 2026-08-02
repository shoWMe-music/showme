import { PRESET_PERMISSION_SETS } from "@showme/auth";
import { schema } from "@showme/db";
import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TokenVerifier } from "./auth/token-verifier";
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
  app = buildTestApp({ database: harness.db, tokenVerifier: fakeVerifier }, [eventListRoutes]);
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
) {
  const { db } = harness;
  const [event] = await db
    .insert(schema.events)
    .values({ hostProfileId: host.profileId, title, baseCurrency: "SEK", createdBy })
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
    const event = await seedHostedEvent("Draft Night", caller, "pub-op");
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
