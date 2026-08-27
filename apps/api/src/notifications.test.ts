import { schema } from "@showme/db";
import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import { and, eq, isNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TokenVerifier } from "./auth/token-verifier";
import type { EmailMessage } from "./lib/email";
import { notifyUsers } from "./lib/notify";
import { notificationRoutes } from "./routes/notifications";
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
    .values({ id, email: `${id}@example.showme.test`, kind: "operator" });
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

describe("notification preferences", () => {
  it("serves the whole catalog with its defaults for a user who has set nothing", async () => {
    await seedUser("prefs-fresh");

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/notifications/preferences",
      headers: auth("prefs-fresh"),
    });
    expect(response.statusCode).toBe(200);

    const { preferences } = response.json();
    expect(preferences.map((preference: { category: string }) => preference.category)).toEqual([
      "bookings",
      "holds",
      "deals",
      "settlements",
      "events",
    ]);
    // In-app is on everywhere; email is on for the four that cost money or a date
    // and off for `events`, which is situational awareness (`NOTIFICATION_CATEGORIES`).
    for (const preference of preferences) {
      expect(preference.inApp).toBe(true);
      expect(preference.isDefault).toBe(true);
    }
    const emailOn = preferences
      .filter((preference: { email: boolean }) => preference.email)
      .map((preference: { category: string }) => preference.category);
    expect(emailOn).toEqual(["bookings", "holds", "deals", "settlements"]);
  });

  it("stores an answer, returns the merged catalog, and leaves untouched categories default", async () => {
    await seedUser("prefs-writer");

    const saved = await app.inject({
      method: "PUT",
      url: "/api/v1/notifications/preferences",
      headers: auth("prefs-writer"),
      payload: { preferences: [{ category: "deals", inApp: false, email: false }] },
    });
    expect(saved.statusCode).toBe(200);

    const byCategory = new Map(
      saved
        .json()
        .preferences.map((preference: { category: string }) => [preference.category, preference]),
    );
    expect(byCategory.get("deals")).toMatchObject({ inApp: false, email: false, isDefault: false });
    // The four the body never mentioned are untouched — a client that knows about
    // one category cannot blank the rest by omitting them.
    expect(byCategory.get("settlements")).toMatchObject({ inApp: true, isDefault: true });

    // …and a second write to the same category updates rather than duplicating.
    const flipped = await app.inject({
      method: "PUT",
      url: "/api/v1/notifications/preferences",
      headers: auth("prefs-writer"),
      payload: { preferences: [{ category: "deals", inApp: true, email: false }] },
    });
    expect(flipped.statusCode).toBe(200);
    const stored = await harness.db
      .select()
      .from(schema.notificationPreferences)
      .where(eq(schema.notificationPreferences.userId, "prefs-writer"));
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ category: "deals", inApp: true, email: false });
  });

  it("refuses a body naming the same category twice", async () => {
    await seedUser("prefs-dupe");
    const response = await app.inject({
      method: "PUT",
      url: "/api/v1/notifications/preferences",
      headers: auth("prefs-dupe"),
      payload: {
        preferences: [
          { category: "holds", inApp: true, email: true },
          { category: "holds", inApp: false, email: false },
        ],
      },
    });
    expect(response.statusCode).toBe(400);
  });

  it("cannot read or write another user's preferences", async () => {
    await seedUser("prefs-owner");
    await seedUser("prefs-other");
    await app.inject({
      method: "PUT",
      url: "/api/v1/notifications/preferences",
      headers: auth("prefs-owner"),
      payload: { preferences: [{ category: "holds", inApp: false, email: false }] },
    });

    // The other user's read is their OWN catalog — defaults, not the owner's answer.
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/notifications/preferences",
      headers: auth("prefs-other"),
    });
    const holds = response
      .json()
      .preferences.find((preference: { category: string }) => preference.category === "holds");
    expect(holds).toMatchObject({ inApp: true, isDefault: true });

    const rows = await harness.db
      .select()
      .from(schema.notificationPreferences)
      .where(eq(schema.notificationPreferences.userId, "prefs-other"));
    expect(rows).toHaveLength(0);
  });
});

/** A sink that records instead of sending, so a delivery is assertable. */
function recordingEmailSink() {
  const sent: EmailMessage[] = [];
  return {
    sent,
    sink: {
      async sendEmail(message: EmailMessage) {
        sent.push(message);
      },
    },
  };
}

async function notificationsOf(userId: string) {
  return harness.db
    .select()
    .from(schema.notifications)
    .where(eq(schema.notifications.userId, userId));
}

describe("notifyUsers honours the preference", () => {
  it("writes no row at all when the category's in-app channel is off", async () => {
    await seedUser("gate-off");
    await harness.db
      .insert(schema.notificationPreferences)
      .values({ userId: "gate-off", category: "deals", inApp: false, email: false });

    await notifyUsers(harness.db, ["gate-off"], null, {
      type: "deal.confirmed",
      title: "should not arrive",
    });
    expect(await notificationsOf("gate-off")).toHaveLength(0);

    // A category the user has NOT switched off still arrives — the gate is per
    // category, not a mute button.
    await notifyUsers(harness.db, ["gate-off"], null, {
      type: "settlement.finalized",
      title: "should arrive",
    });
    expect(await notificationsOf("gate-off")).toHaveLength(1);
  });

  it("delivers to a user who has set nothing, and to one who switched it back on", async () => {
    await seedUser("gate-default");
    await notifyUsers(harness.db, ["gate-default"], null, {
      type: "deal.confirmed",
      title: "default is on",
    });
    expect(await notificationsOf("gate-default")).toHaveLength(1);

    await seedUser("gate-back-on");
    await harness.db
      .insert(schema.notificationPreferences)
      .values({ userId: "gate-back-on", category: "deals", inApp: true, email: true });
    await notifyUsers(harness.db, ["gate-back-on"], null, {
      type: "deal.reopened",
      title: "explicitly on",
    });
    expect(await notificationsOf("gate-back-on")).toHaveLength(1);
  });

  it("filters recipient by recipient, never all-or-nothing", async () => {
    await seedUser("gate-mixed-yes");
    await seedUser("gate-mixed-no");
    await harness.db
      .insert(schema.notificationPreferences)
      .values({ userId: "gate-mixed-no", category: "holds", inApp: false, email: false });

    await notifyUsers(harness.db, ["gate-mixed-yes", "gate-mixed-no"], null, {
      type: "hold.lost",
      title: "one of two",
    });
    expect(await notificationsOf("gate-mixed-yes")).toHaveLength(1);
    expect(await notificationsOf("gate-mixed-no")).toHaveLength(0);
  });

  it("delivers an UNCATEGORISED type regardless — the safe direction", async () => {
    await seedUser("gate-unknown");
    // Every category switched off, and a type no category claims.
    await harness.db.insert(schema.notificationPreferences).values(
      ["bookings", "holds", "deals", "settlements", "events"].map((category) => ({
        userId: "gate-unknown",
        category,
        inApp: false,
        email: false,
      })),
    );

    await notifyUsers(harness.db, ["gate-unknown"], null, {
      type: "task.reminder",
      title: "nobody has classified this yet",
    });
    expect(await notificationsOf("gate-unknown")).toHaveLength(1);
  });

  it("gates the two channels independently", async () => {
    await seedUser("gate-bell-only");
    await harness.db
      .insert(schema.notificationPreferences)
      .values({ userId: "gate-bell-only", category: "settlements", inApp: true, email: false });
    const bellOnly = recordingEmailSink();

    await notifyUsers(
      harness.db,
      ["gate-bell-only"],
      null,
      { type: "settlement.commented", title: "bell yes, mail no" },
      { sink: bellOnly.sink, message: { subject: "s", html: "<p>h</p>", text: "t" } },
    );
    expect(await notificationsOf("gate-bell-only")).toHaveLength(1);
    expect(bellOnly.sent).toHaveLength(0);

    await seedUser("gate-mail-only");
    await harness.db
      .insert(schema.notificationPreferences)
      .values({ userId: "gate-mail-only", category: "settlements", inApp: false, email: true });
    const mailOnly = recordingEmailSink();

    await notifyUsers(
      harness.db,
      ["gate-mail-only"],
      null,
      { type: "settlement.commented", title: "mail yes, bell no" },
      { sink: mailOnly.sink, message: { subject: "s", html: "<p>h</p>", text: "t" } },
    );
    expect(await notificationsOf("gate-mail-only")).toHaveLength(0);
    expect(mailOnly.sent).toHaveLength(1);
    expect(mailOnly.sent[0]?.to).toBe("gate-mail-only@example.showme.test");
  });

  it("keeps its best-effort contract when the sink throws", async () => {
    await seedUser("gate-bad-sink");
    const throwingSink = {
      async sendEmail() {
        throw new Error("Brevo is down");
      },
    };

    await expect(
      notifyUsers(
        harness.db,
        ["gate-bad-sink"],
        null,
        { type: "deal.sent", title: "the row still lands" },
        { sink: throwingSink, message: { subject: "s", html: "<p>h</p>", text: "t" } },
      ),
    ).resolves.toBeUndefined();
    expect(await notificationsOf("gate-bad-sink")).toHaveLength(1);
  });
});
