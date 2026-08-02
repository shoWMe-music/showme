import { schema } from "@showme/db";
import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import { and, eq, isNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TokenVerifier } from "./auth/token-verifier";
import { notificationRoutes } from "./routes/notifications";
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
  app = buildTestApp({ database: harness.db, tokenVerifier: fakeVerifier }, [notificationRoutes]);
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await harness?.stop();
});

const auth = (uid: string) => ({ authorization: `Bearer ${uid}` });

/** Provision a bare user (no memberships needed — notifications are user-scoped). */
async function seedUser(id: string) {
  await harness.db
    .insert(schema.users)
    .values({ id, email: `${id}@example.com`, kind: "operator" });
}

/** Seed one notification row for a user; `read` controls the read_at state. */
async function seedNotification(userId: string, title: string, read: boolean) {
  const [row] = await harness.db
    .insert(schema.notifications)
    .values({
      userId,
      type: "test",
      title,
      readAt: read ? new Date() : null,
    })
    .returning();
  if (!row) throw new Error("notification seed failed");
  return row;
}

describe("notifications — user-scoped feed", () => {
  it("lists the caller's notifications newest-first and filters unread", async () => {
    await seedUser("notif-a");
    await seedNotification("notif-a", "one", true);
    await seedNotification("notif-a", "two", false);
    await seedNotification("notif-a", "three", false);
    // Another user's notification must never appear in A's feed.
    await seedUser("notif-a-other");
    await seedNotification("notif-a-other", "not-mine", false);

    const all = await app.inject({
      method: "GET",
      url: "/api/v1/notifications",
      headers: auth("notif-a"),
    });
    expect(all.statusCode).toBe(200);
    expect(all.json().items).toHaveLength(3);
    for (const item of all.json().items) {
      expect(item.userId).toBe("notif-a");
    }

    const unread = await app.inject({
      method: "GET",
      url: "/api/v1/notifications?unread=true",
      headers: auth("notif-a"),
    });
    expect(unread.statusCode).toBe(200);
    expect(unread.json().items).toHaveLength(2);
    for (const item of unread.json().items) {
      expect(item.readAt).toBeNull();
    }
  });

  it("marks the caller's unread notifications read and returns the count", async () => {
    await seedUser("notif-b");
    await seedNotification("notif-b", "x", false);
    await seedNotification("notif-b", "y", false);

    const marked = await app.inject({
      method: "POST",
      url: "/api/v1/notifications/read",
      headers: auth("notif-b"),
      payload: {},
    });
    expect(marked.statusCode).toBe(200);
    expect(marked.json().updated).toBe(2);

    const stillUnread = await harness.db
      .select()
      .from(schema.notifications)
      .where(and(eq(schema.notifications.userId, "notif-b"), isNull(schema.notifications.readAt)));
    expect(stillUnread).toHaveLength(0);
  });

  it("marks only the given ids", async () => {
    await seedUser("notif-c");
    const first = await seedNotification("notif-c", "keep", false);
    const second = await seedNotification("notif-c", "read-me", false);

    const marked = await app.inject({
      method: "POST",
      url: "/api/v1/notifications/read",
      headers: auth("notif-c"),
      payload: { ids: [second.id] },
    });
    expect(marked.statusCode).toBe(200);
    expect(marked.json().updated).toBe(1);

    const remaining = await harness.db
      .select()
      .from(schema.notifications)
      .where(and(eq(schema.notifications.userId, "notif-c"), isNull(schema.notifications.readAt)));
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.id).toBe(first.id);
  });

  it("cannot mark another user's notifications", async () => {
    await seedUser("notif-owner");
    await seedUser("notif-attacker");
    const victim = await seedNotification("notif-owner", "private", false);

    const marked = await app.inject({
      method: "POST",
      url: "/api/v1/notifications/read",
      headers: auth("notif-attacker"),
      payload: { ids: [victim.id] },
    });
    expect(marked.statusCode).toBe(200);
    expect(marked.json().updated).toBe(0);

    const [after] = await harness.db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.id, victim.id));
    expect(after?.readAt).toBeNull(); // untouched
  });
});
