import { schema } from "@showme/db";
import { NOTIFICATION_CATEGORY_KEYS, notifyUsers } from "@showme/db/notify";
import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import type { EmailMessage } from "@showme/shared";
import { and, eq, isNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TokenVerifier } from "./auth/token-verifier";
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

  it("puts a notification back to unread, and cannot un-read someone else's", async () => {
    await seedUser("notif-unread");
    await seedUser("notif-unread-other");
    const mine = await seedNotification("notif-unread", "put me back", false);
    const theirs = await seedNotification("notif-unread-other", "not yours", false);

    const read = (uid: string, ids: string[]) =>
      app.inject({
        method: "POST",
        url: "/api/v1/notifications/read",
        headers: auth(uid),
        payload: { ids },
      });
    const unread = (uid: string, ids: string[]) =>
      app.inject({
        method: "POST",
        url: "/api/v1/notifications/read",
        headers: auth(uid),
        payload: { ids, read: false },
      });

    expect((await read("notif-unread", [mine.id])).json().updated).toBe(1);
    expect((await read("notif-unread-other", [theirs.id])).json().updated).toBe(1);

    // The way back, which this route did not have until 2026-08-31: a bell you
    // can only ever silence is a place things go to be lost.
    const putBack = await unread("notif-unread", [mine.id]);
    expect(putBack.json().updated).toBe(1);

    const [after] = await harness.db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.id, mine.id));
    expect(after?.readAt).toBeNull();

    // Marking it unread AGAIN is a no-op, not a second update.
    expect((await unread("notif-unread", [mine.id])).json().updated).toBe(0);

    // The user predicate guards both directions.
    expect((await unread("notif-unread", [theirs.id])).json().updated).toBe(0);
    const [untouched] = await harness.db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.id, theirs.id));
    expect(untouched?.readAt).not.toBeNull();
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
      "tasks",
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

describe("the mail path cannot take the bell down with it", () => {
  it("still writes the in-app row when the EMAIL half's QUERY throws", async () => {
    await seedUser("mail-throws");
    // NOT a failing send — `deliverEmail` has always swallowed those per
    // recipient, so a throwing sink proves nothing and the first version of
    // this test was vacuous. The unguarded half was `deliverEmail`'s OWN
    // queries: its preference lookup and its address select. A throw there
    // aborted `notifyUsers` before a single row was inserted, so a wobble on
    // the mail path silently cost the user their bell.
    //
    // So: fail the FIRST select only. `deliverEmail` runs before the in-app
    // lookup, so call one belongs to the mail half and everything after it is
    // the durable half carrying on.
    let selectCalls = 0;
    const realDatabase = harness.db as unknown as Record<string, unknown>;
    const flaky = new Proxy(realDatabase, {
      get(target, property) {
        if (property === "select") {
          return (...args: unknown[]) => {
            selectCalls += 1;
            if (selectCalls === 1) throw new Error("connection reset mid-lookup");
            return (target.select as (...a: unknown[]) => unknown).apply(target, args);
          };
        }
        const value = Reflect.get(target, property);
        // Bound to the REAL database, not the proxy: drizzle's builders call
        // back into their own methods, and a `this` of the proxy re-enters this
        // trap and loses the internals they expect.
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as unknown as typeof harness.db;

    await notifyUsers(
      flaky,
      ["mail-throws"],
      null,
      { type: "deal.confirmed", title: "the bell must survive" },
      { sink: recordingEmailSink().sink, message: { subject: "s", html: "<p>h</p>", text: "t" } },
    );

    expect(selectCalls, "the mail half must have been reached and thrown").toBeGreaterThan(1);
    const rows = await notificationsOf("mail-throws");
    expect(rows, "the in-app feed is the durable half and must not depend on mail").toHaveLength(1);
    expect(rows[0]?.title).toBe("the bell must survive");
  });
});

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
    // Every category the catalog knows, switched off.
    await harness.db.insert(schema.notificationPreferences).values(
      NOTIFICATION_CATEGORY_KEYS.map((category) => ({
        userId: "gate-unknown",
        category,
        inApp: false,
        email: false,
      })),
    );

    // A prefix on purpose belonging to no category — this test USED to use
    // `task.reminder`, which stopped proving anything the moment the reminder
    // sweep brought a `tasks` category with it. Read from the catalog rather than
    // a hand-copied list, so the next category cannot make it vacuous again.
    await notifyUsers(harness.db, ["gate-unknown"], null, {
      type: "unclassified.thing",
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
