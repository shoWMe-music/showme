import { randomBytes } from "node:crypto";
import { schema } from "@showme/db";
import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { TokenVerifier } from "./auth/token-verifier";
import { readProfileBusyTime } from "./lib/availability";
import { createCalendarIntegration } from "./lib/calendar-integration";
import type { GoogleCalendarEvent } from "./lib/google-calendar";
import { signOAuthState } from "./lib/oauth-state";
import { calendarRoutes } from "./routes/calendar";
import { integrationRoutes } from "./routes/integrations";
import { buildTestApp } from "./testing";

/**
 * The integrations routes, driven against a Postgres container and a stand-in for
 * Google. The stand-in answers exactly what the real API answers — verified
 * against the live `daniel@showme.music` calendar first — so the cases here are
 * the ones a network cannot be asked to reproduce on demand: a revoked grant, an
 * expired sync cursor, a state minted for somebody else.
 */

const fakeVerifier: TokenVerifier = {
  async verify(token: string) {
    return { uid: token, email: `${token}@example.com`, name: token };
  },
};

const ENCRYPTION_KEY = randomBytes(32).toString("base64");
const REDIRECT_URI = "https://showme-app.web.app/oauth/google/callback";
const REFRESH_TOKEN = "1//0-a-refresh-token";

/** What the stand-in Google is currently holding, and what it has been asked. */
interface FakeGoogle {
  events: GoogleCalendarEvent[];
  /** Changes since the last sync token, returned only on the incremental path. */
  incremental: GoogleCalendarEvent[];
  revokedTokens: Set<string>;
  /** Force the next refresh to answer `invalid_grant`, as a revoked grant does. */
  grantRevoked: boolean;
  /** Force the next incremental listing to answer 410 GONE. */
  syncTokenExpired: boolean;
  calls: { url: string; body?: string }[];
  timeZone: string;
  summary: string;
}

function createFakeGoogle(): FakeGoogle {
  return {
    events: [],
    incremental: [],
    revokedTokens: new Set(),
    grantRevoked: false,
    syncTokenExpired: false,
    calls: [],
    timeZone: "Europe/Stockholm",
    summary: "daniel@showme.music",
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A `fetch` that speaks Google's three endpoints and records every call. */
function fakeGoogleFetch(google: FakeGoogle): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const body = typeof init?.body === "string" ? init.body : undefined;
    google.calls.push({ url, body });
    const form = new URLSearchParams(body ?? "");

    if (url.startsWith("https://oauth2.googleapis.com/token")) {
      if (form.get("grant_type") === "authorization_code") {
        if (form.get("code") !== "a-valid-code") {
          return jsonResponse({ error: "invalid_grant", error_description: "bad code" }, 400);
        }
        return jsonResponse({
          access_token: "an-access-token",
          refresh_token: REFRESH_TOKEN,
          scope: "https://www.googleapis.com/auth/calendar.events",
          expires_in: 3599,
        });
      }
      const presented = form.get("refresh_token") ?? "";
      if (google.grantRevoked || google.revokedTokens.has(presented)) {
        return jsonResponse(
          { error: "invalid_grant", error_description: "Token has been expired or revoked." },
          400,
        );
      }
      return jsonResponse({
        access_token: "an-access-token",
        scope: "https://www.googleapis.com/auth/calendar.events",
        expires_in: 3599,
      });
    }

    if (url.startsWith("https://oauth2.googleapis.com/revoke")) {
      const token = form.get("token") ?? "";
      if (google.revokedTokens.has(token)) return new Response("", { status: 400 });
      google.revokedTokens.add(token);
      return new Response("", { status: 200 });
    }

    if (url.includes("/calendar/v3/calendars/")) {
      const parsed = new URL(url);
      if (parsed.searchParams.get("syncToken")) {
        if (google.syncTokenExpired) return new Response("gone", { status: 410 });
        return jsonResponse({
          summary: google.summary,
          timeZone: google.timeZone,
          items: google.incremental,
          nextSyncToken: "sync-token-2",
        });
      }
      // The one-day identity probe: envelope only, and no cursor.
      if (parsed.searchParams.get("maxResults") === "1") {
        return jsonResponse({ summary: google.summary, timeZone: google.timeZone, items: [] });
      }
      return jsonResponse({
        summary: google.summary,
        timeZone: google.timeZone,
        items: google.events,
        nextSyncToken: "sync-token-1",
      });
    }

    throw new Error(`unexpected fetch to ${url}`);
  }) as typeof fetch;
}

let harness: TestDatabase;
let app: FastifyInstance;
let google: FakeGoogle;
let operatorProfileId: string;

const auth = (uid: string) => ({ authorization: `Bearer ${uid}` });

/** A user who owns an operator profile — the shape a connection attaches to. */
async function seedOperator(id: string): Promise<string> {
  const { db } = harness;
  await db.insert(schema.users).values({ id, email: `${id}@example.com`, kind: "operator" });
  const [profile] = await db
    .insert(schema.profiles)
    .values({ kind: "operator", ownerUserId: id, name: id, slug: `${id}-slug`, isPublic: true })
    .returning();
  if (!profile) throw new Error("profile seed failed");
  await db
    .insert(schema.profileMembers)
    .values({ profileId: profile.id, userId: id, role: "owner", status: "active" });
  return profile.id;
}

/** Add somebody else to the profile at the given role. */
async function addMember(profileId: string, id: string, role: "admin" | "editor"): Promise<void> {
  const { db } = harness;
  await db.insert(schema.users).values({ id, email: `${id}@example.com`, kind: "operator" });
  await db.insert(schema.profileMembers).values({ profileId, userId: id, role, status: "active" });
}

/** The three real entries, in the shape the live API returns them. */
function realWorldEvents(): GoogleCalendarEvent[] {
  return [
    {
      id: "founder-lunch-2026-09-11",
      status: "confirmed",
      summary: "🧑‍🍳 Founder Lunch",
      start: { dateTime: "2026-09-11T12:00:00+02:00", timeZone: "Europe/Stockholm" },
      end: { dateTime: "2026-09-11T13:00:00+02:00", timeZone: "Europe/Stockholm" },
    },
    {
      id: "morning-coffee-2026-11-04",
      status: "confirmed",
      summary: "☕️ Morning Coffee",
      // November: the offset has moved to +01:00 and the wall clock has not.
      start: { dateTime: "2026-11-04T09:00:00+01:00", timeZone: "Europe/Stockholm" },
      end: { dateTime: "2026-11-04T09:30:00+01:00", timeZone: "Europe/Stockholm" },
    },
    {
      id: "kullaberg-2026-08-28",
      status: "confirmed",
      summary: "⛰️ Fall Kickoff at Kullaberg",
      location: "Kullaberg, 263 77 Mölle, Sverige",
      start: { dateTime: "2026-08-28T09:00:00+02:00", timeZone: "Europe/Stockholm" },
      end: { dateTime: "2026-08-28T13:00:00+02:00", timeZone: "Europe/Stockholm" },
    },
  ];
}

beforeAll(async () => {
  harness = await startTestDatabase();
  google = createFakeGoogle();
  const integration = createCalendarIntegration({
    googleOAuthClientId: "a-client-id",
    googleOAuthClientSecret: "a-client-secret",
    calendarTokenEncryptionKey: ENCRYPTION_KEY,
    // Every Google call in this suite goes through here — nothing leaves the box.
    fetchImplementation: fakeGoogleFetch(google),
  });
  app = buildTestApp(
    { database: harness.db, tokenVerifier: fakeVerifier, calendarIntegration: integration },
    [integrationRoutes, calendarRoutes],
  );
  await app.ready();
  operatorProfileId = await seedOperator("connector");
  await addMember(operatorProfileId, "co-admin", "admin");
  await addMember(operatorProfileId, "an-editor", "editor");
  await seedOperator("stranger");
});

afterAll(async () => {
  await app?.close();
  await harness?.stop();
});

beforeEach(async () => {
  await harness.db.delete(schema.calendarConnections);
  await harness.db.delete(schema.calendarItems);
  Object.assign(google, {
    ...createFakeGoogle(),
    calls: [],
  });
});

/** Start a flow the way the app does, and return the signed state. */
async function authorizationUrl(uid: string, profileId = operatorProfileId) {
  return app.inject({
    method: "POST",
    url: "/api/v1/integrations/calendar/google/authorization-url",
    headers: auth(uid),
    payload: { profileId, redirectUri: REDIRECT_URI },
  });
}

/** Complete a flow: mint a state for `uid`, then post the code as `callerUid`. */
async function connect(uid: string, callerUid = uid, code = "a-valid-code") {
  const started = await authorizationUrl(uid);
  const { state } = started.json();
  return app.inject({
    method: "POST",
    url: "/api/v1/integrations/calendar/google/connect",
    headers: auth(callerUid),
    payload: { code, state },
  });
}

describe("starting the flow", () => {
  it("hands back a consent URL carrying the client id, the scope and a state", async () => {
    const response = await authorizationUrl("connector");
    expect(response.statusCode).toBe(200);
    const url = new URL(response.json().authorizationUrl);
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe("a-client-id");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("state")).toBe(response.json().state);
    // THE INVARIANT: no secret ever leaves for the browser.
    expect(response.body).not.toContain("a-client-secret");
  });

  it("refuses a redirect address that is not registered", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/integrations/calendar/google/authorization-url",
      headers: auth("connector"),
      payload: { profileId: operatorProfileId, redirectUri: "https://evil.example.com/callback" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toMatch(/not registered/);
  });

  it("refuses a profile the caller does not manage", async () => {
    const other = await seedOperator("someone-else");
    const response = await authorizationUrl("connector", other);
    expect(response.statusCode).toBe(403);
    expect(response.json().error.message).toMatch(/not a member/);
  });

  it("refuses an editor — connecting takes nights off the profile's availability", async () => {
    const response = await authorizationUrl("an-editor");
    expect(response.statusCode).toBe(403);
    expect(response.json().error.message).toMatch(/owner or admin/);
  });
});

describe("the state check", () => {
  it("accepts a state the caller minted for themselves", async () => {
    google.events = realWorldEvents();
    const response = await connect("connector");
    expect(response.statusCode).toBe(201);
  });

  /**
   * THE ATTACK. An attacker runs the consent screen, keeps their code, and gets a
   * signed-in victim to post it. Without the state→caller comparison the victim's
   * account ends up driven by the attacker's calendar.
   */
  it("REFUSES a code presented with somebody else's state", async () => {
    const attackerFlow = await authorizationUrl("connector");
    const attackerState = attackerFlow.json().state;

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/integrations/calendar/google/connect",
      headers: auth("co-admin"), // the victim, signed in, same profile
      payload: { code: "a-valid-code", state: attackerState },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toMatch(/different account/);
    // And the state check happened BEFORE the exchange — no code was spent.
    expect(google.calls.some((call) => call.body?.includes("authorization_code"))).toBe(false);
    expect(await harness.db.select().from(schema.calendarConnections)).toHaveLength(0);
  });

  it("refuses a forged state", async () => {
    const forged = signOAuthState(randomBytes(32).toString("base64"), {
      userId: "connector",
      profileId: operatorProfileId,
      redirectUri: REDIRECT_URI,
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/integrations/calendar/google/connect",
      headers: auth("connector"),
      payload: { code: "a-valid-code", state: forged },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toMatch(/does not verify/);
  });

  it("refuses an expired state", async () => {
    const stale = signOAuthState(
      ENCRYPTION_KEY,
      { userId: "connector", profileId: operatorProfileId, redirectUri: REDIRECT_URI },
      new Date(Date.now() - 60 * 60 * 1000),
    );
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/integrations/calendar/google/connect",
      headers: auth("connector"),
      payload: { code: "a-valid-code", state: stale },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toMatch(/expired/);
  });
});

describe("connecting and the first sync", () => {
  it("imports the calendar as external entries, owned by both the user and the profile", async () => {
    google.events = realWorldEvents();
    const response = await connect("connector");
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ full: true, imported: 3, deleted: 0 });

    const items = await harness.db
      .select()
      .from(schema.calendarItems)
      .where(eq(schema.calendarItems.externalSource, "google"));
    expect(items).toHaveLength(3);
    for (const item of items) {
      expect(item.type).toBe("external");
      expect(item.ownerUserId).toBe("connector");
      expect(item.ownerProfileId).toBe(operatorProfileId);
      expect(item.blocksAvailability).toBe(true);
    }

    const lunch = items.find((item) => item.externalId === "founder-lunch-2026-09-11");
    expect(lunch).toMatchObject({
      title: "🧑‍🍳 Founder Lunch",
      date: "2026-09-11",
      startTime: "12:00:00",
      endTime: "13:00:00",
    });

    // The winter instance keeps its 09:00 wall clock across the DST boundary.
    const coffee = items.find((item) => item.externalId === "morning-coffee-2026-11-04");
    expect(coffee).toMatchObject({ date: "2026-11-04", startTime: "09:00:00" });

    // The provider's location lands on `entity`, which the serializer withholds
    // from non-owners on the same rule as the title.
    const kickoff = items.find((item) => item.externalId === "kullaberg-2026-08-28");
    expect(kickoff?.entity).toBe("Kullaberg, 263 77 Mölle, Sverige");
  });

  it("stores the refresh token sealed, and the sync cursor beside it", async () => {
    google.events = realWorldEvents();
    await connect("connector");

    const [connection] = await harness.db.select().from(schema.calendarConnections);
    expect(connection).toBeTruthy();
    if (!connection) throw new Error("no connection");

    // The credential is NOT in the row as issued, in any column.
    const asText = JSON.stringify(connection);
    expect(asText).not.toContain(REFRESH_TOKEN);
    expect(connection.refreshTokenCiphertext).not.toBe(REFRESH_TOKEN);
    expect(connection.refreshTokenIv).toBeTruthy();
    expect(connection.refreshTokenAuthTag).toBeTruthy();
    // The cursor IS there, so the second sync can be incremental.
    expect(connection.syncToken).toBe("sync-token-1");
    expect(connection.providerAccountId).toBe("daniel@showme.music");
    expect(connection.calendarTimeZone).toBe("Europe/Stockholm");
  });

  it("never serializes the credential or the cursor to a client", async () => {
    google.events = realWorldEvents();
    await connect("connector");
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/integrations/calendar",
      headers: auth("connector"),
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain(REFRESH_TOKEN);
    expect(response.body).not.toContain("sync-token-1");
    expect(response.json()[0]).toMatchObject({
      providerAccountId: "daniel@showme.music",
      accountWithheld: false,
      manageable: true,
      incrementalSyncReady: true,
    });
  });

  it("withholds the Google address from a co-member, who still sees it is connected", async () => {
    google.events = realWorldEvents();
    await connect("connector");
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/integrations/calendar",
      headers: auth("co-admin"),
    });
    expect(response.json()[0]).toMatchObject({
      providerAccountId: null,
      accountWithheld: true,
      manageable: false,
    });
    expect(response.body).not.toContain("daniel@showme.music");
  });

  it("takes the imported hours off the profile's availability", async () => {
    google.events = realWorldEvents();
    await connect("connector");
    const busy = await readProfileBusyTime(harness.db, operatorProfileId);
    expect(busy.timeWindows).toContainEqual({
      date: "2026-09-11",
      startTime: "12:00:00",
      endTime: "13:00:00",
    });
    expect(busy.timeWindows).toContainEqual({
      date: "2026-11-04",
      startTime: "09:00:00",
      endTime: "09:30:00",
    });
  });

  it("reconnecting updates the row instead of leaving a second live token behind", async () => {
    google.events = realWorldEvents();
    await connect("connector");
    const second = await connect("connector");
    expect(second.statusCode).toBe(201);
    expect(await harness.db.select().from(schema.calendarConnections)).toHaveLength(1);
  });
});

describe("the second sync", () => {
  it("goes incremental and applies a cancellation as a deletion", async () => {
    google.events = realWorldEvents();
    await connect("connector");
    const [connection] = await harness.db.select().from(schema.calendarConnections);
    if (!connection) throw new Error("no connection");

    // The user deletes the lunch and moves the kickoff an hour later.
    google.incremental = [
      { id: "founder-lunch-2026-09-11", status: "cancelled" },
      {
        id: "kullaberg-2026-08-28",
        status: "confirmed",
        summary: "⛰️ Fall Kickoff at Kullaberg",
        start: { dateTime: "2026-08-28T10:00:00+02:00", timeZone: "Europe/Stockholm" },
        end: { dateTime: "2026-08-28T13:00:00+02:00", timeZone: "Europe/Stockholm" },
      },
    ];

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/integrations/calendar/${connection.id}/sync`,
      headers: auth("connector"),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ full: false, imported: 1, deleted: 1 });

    // Google was asked with the cursor and NOT with a time window — it rejects
    // the two together.
    const listing = google.calls.map((call) => call.url).filter((url) => url.includes("/events"));
    const incremental = listing[listing.length - 1] ?? "";
    expect(incremental).toContain("syncToken=sync-token-1");
    expect(incremental).not.toContain("timeMin");

    const items = await harness.db
      .select()
      .from(schema.calendarItems)
      .where(eq(schema.calendarItems.externalSource, "google"));
    expect(items.map((item) => item.externalId).sort()).toEqual([
      "kullaberg-2026-08-28",
      "morning-coffee-2026-11-04",
    ]);
    expect(items.find((item) => item.externalId === "kullaberg-2026-08-28")?.startTime).toBe(
      "10:00:00",
    );

    const [after] = await harness.db.select().from(schema.calendarConnections);
    expect(after?.syncToken).toBe("sync-token-2");
  });

  it("keeps the user's 'available anyway' override across a re-sync", async () => {
    google.events = realWorldEvents();
    await connect("connector");
    const [item] = await harness.db
      .select()
      .from(schema.calendarItems)
      .where(eq(schema.calendarItems.externalId, "founder-lunch-2026-09-11"));
    if (!item) throw new Error("no item");

    const overridden = await app.inject({
      method: "PATCH",
      url: `/api/v1/calendar/${item.id}/availability`,
      headers: auth("connector"),
      payload: { blocksAvailability: false },
    });
    expect(overridden.statusCode).toBe(200);

    const [connection] = await harness.db.select().from(schema.calendarConnections);
    if (!connection) throw new Error("no connection");
    google.incremental = realWorldEvents().slice(0, 1);
    await app.inject({
      method: "POST",
      url: `/api/v1/integrations/calendar/${connection.id}/sync`,
      headers: auth("connector"),
    });

    const [after] = await harness.db
      .select()
      .from(schema.calendarItems)
      .where(eq(schema.calendarItems.id, item.id));
    expect(after?.blocksAvailability).toBe(false);
  });

  it("falls back to a full re-listing when the cursor has aged out", async () => {
    google.events = realWorldEvents();
    await connect("connector");
    const [connection] = await harness.db.select().from(schema.calendarConnections);
    if (!connection) throw new Error("no connection");

    google.syncTokenExpired = true;
    google.events = realWorldEvents().slice(0, 1);

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/integrations/calendar/${connection.id}/sync`,
      headers: auth("connector"),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().full).toBe(true);
    // The full path reconciles by difference: the two entries the listing no
    // longer mentions are gone, which a listing alone could never have said.
    expect(response.json().deleted).toBe(2);
  });

  it("only the person whose account it is may sync it", async () => {
    google.events = realWorldEvents();
    await connect("connector");
    const [connection] = await harness.db.select().from(schema.calendarConnections);
    if (!connection) throw new Error("no connection");
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/integrations/calendar/${connection.id}/sync`,
      headers: auth("co-admin"),
    });
    expect(response.statusCode).toBe(404);
  });
});

describe("a revoked grant", () => {
  it("is recorded as state and reported as a conflict, not a 500", async () => {
    google.events = realWorldEvents();
    await connect("connector");
    const [connection] = await harness.db.select().from(schema.calendarConnections);
    if (!connection) throw new Error("no connection");

    // The user pressed "Remove access" on their Google account page.
    google.grantRevoked = true;

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/integrations/calendar/${connection.id}/sync`,
      headers: auth("connector"),
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.message).toMatch(/reconnect/i);

    const [after] = await harness.db.select().from(schema.calendarConnections);
    expect(after?.reauthorizationRequiredAt).toBeInstanceOf(Date);
    expect(after?.lastError).toMatch(/revoked/i);

    // And the screen is told, on an ordinary read, without another sync.
    const listed = await app.inject({
      method: "GET",
      url: "/api/v1/integrations/calendar",
      headers: auth("connector"),
    });
    expect(listed.json()[0].reauthorizationRequiredAt).not.toBeNull();
  });

  it("clears the reconnect flag once a sync succeeds again", async () => {
    google.events = realWorldEvents();
    await connect("connector");
    const [connection] = await harness.db.select().from(schema.calendarConnections);
    if (!connection) throw new Error("no connection");

    google.grantRevoked = true;
    await app.inject({
      method: "POST",
      url: `/api/v1/integrations/calendar/${connection.id}/sync`,
      headers: auth("connector"),
    });
    google.grantRevoked = false;
    google.incremental = [];
    await app.inject({
      method: "POST",
      url: `/api/v1/integrations/calendar/${connection.id}/sync`,
      headers: auth("connector"),
    });

    const [after] = await harness.db.select().from(schema.calendarConnections);
    expect(after?.reauthorizationRequiredAt).toBeNull();
    expect(after?.lastError).toBeNull();
  });
});

describe("disconnecting", () => {
  it("revokes at Google, removes the imported entries, and deletes the row", async () => {
    google.events = realWorldEvents();
    await connect("connector");
    const [connection] = await harness.db.select().from(schema.calendarConnections);
    if (!connection) throw new Error("no connection");

    const response = await app.inject({
      method: "DELETE",
      url: `/api/v1/integrations/calendar/${connection.id}`,
      headers: auth("connector"),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      disconnected: true,
      revokedAtProvider: true,
      entriesRemoved: 3,
    });

    // The revoke was addressed to the REAL refresh token, not to a placeholder —
    // a disconnect that revokes the wrong string leaves a live key upstream.
    const revoke = google.calls.find((call) => call.url.includes("/revoke"));
    expect(new URLSearchParams(revoke?.body ?? "").get("token")).toBe(REFRESH_TOKEN);
    expect(google.revokedTokens.has(REFRESH_TOKEN)).toBe(true);

    expect(await harness.db.select().from(schema.calendarConnections)).toHaveLength(0);
    const items = await harness.db
      .select()
      .from(schema.calendarItems)
      .where(eq(schema.calendarItems.externalSource, "google"));
    expect(items).toHaveLength(0);
  });

  it("keeps an entry that became a show, and stops it blocking", async () => {
    google.events = realWorldEvents();
    await connect("connector");
    const [item] = await harness.db
      .select()
      .from(schema.calendarItems)
      .where(eq(schema.calendarItems.externalId, "kullaberg-2026-08-28"));
    if (!item) throw new Error("no item");

    const [event] = await harness.db
      .insert(schema.events)
      .values({
        hostProfileId: operatorProfileId,
        title: "Kullaberg",
        baseCurrency: "SEK",
        eventDate: "2026-08-28",
        createdBy: "connector",
      })
      .returning();
    await harness.db
      .update(schema.calendarItems)
      .set({ promotedEventId: event?.id })
      .where(eq(schema.calendarItems.id, item.id));

    const [connection] = await harness.db.select().from(schema.calendarConnections);
    if (!connection) throw new Error("no connection");
    const response = await app.inject({
      method: "DELETE",
      url: `/api/v1/integrations/calendar/${connection.id}`,
      headers: auth("connector"),
    });
    expect(response.json()).toMatchObject({ entriesRemoved: 2, entriesKeptBecausePromoted: 1 });

    const [kept] = await harness.db
      .select()
      .from(schema.calendarItems)
      .where(eq(schema.calendarItems.id, item.id));
    expect(kept?.blocksAvailability).toBe(false);
  });

  it("still disconnects when the grant was already dead at Google", async () => {
    google.events = realWorldEvents();
    await connect("connector");
    google.revokedTokens.add(REFRESH_TOKEN);
    const [connection] = await harness.db.select().from(schema.calendarConnections);
    if (!connection) throw new Error("no connection");

    const response = await app.inject({
      method: "DELETE",
      url: `/api/v1/integrations/calendar/${connection.id}`,
      headers: auth("connector"),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().revokedAtProvider).toBe(false);
    expect(await harness.db.select().from(schema.calendarConnections)).toHaveLength(0);
  });

  it("only the person whose account it is may disconnect it", async () => {
    google.events = realWorldEvents();
    await connect("connector");
    const [connection] = await harness.db.select().from(schema.calendarConnections);
    if (!connection) throw new Error("no connection");
    const response = await app.inject({
      method: "DELETE",
      url: `/api/v1/integrations/calendar/${connection.id}`,
      headers: auth("stranger"),
    });
    expect(response.statusCode).toBe(404);
    expect(await harness.db.select().from(schema.calendarConnections)).toHaveLength(1);
  });

  it("writes both ends of the story to the audit log, without the token", async () => {
    google.events = realWorldEvents();
    await connect("connector");
    const [connection] = await harness.db.select().from(schema.calendarConnections);
    if (!connection) throw new Error("no connection");
    await app.inject({
      method: "DELETE",
      url: `/api/v1/integrations/calendar/${connection.id}`,
      headers: auth("connector"),
    });

    const entries = await harness.db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, connection.id));
    expect(entries.map((entry) => entry.action).sort()).toEqual([
      "integration.calendar.connect",
      "integration.calendar.disconnect",
    ]);
    expect(JSON.stringify(entries)).not.toContain(REFRESH_TOKEN);
  });
});

describe("when the deployment has no Google credentials", () => {
  it("answers 503 with a sentence saying so, and leaves every other route alone", async () => {
    const bare = buildTestApp({ database: harness.db, tokenVerifier: fakeVerifier }, [
      integrationRoutes,
      calendarRoutes,
    ]);
    await bare.ready();
    try {
      const response = await bare.inject({
        method: "POST",
        url: "/api/v1/integrations/calendar/google/authorization-url",
        headers: auth("connector"),
        payload: { profileId: operatorProfileId, redirectUri: REDIRECT_URI },
      });
      expect(response.statusCode).toBe(503);
      expect(response.json().error.code).toBe("service_unavailable");

      // Listing still works — it reads rows, not credentials.
      const listed = await bare.inject({
        method: "GET",
        url: "/api/v1/integrations/calendar",
        headers: auth("connector"),
      });
      expect(listed.statusCode).toBe(200);

      // And the calendar routes are entirely unaffected.
      const calendar = await bare.inject({
        method: "GET",
        url: "/api/v1/calendar",
        headers: auth("connector"),
      });
      expect(calendar.statusCode).toBe(200);
    } finally {
      await bare.close();
    }
  });
});

describe("the sealed token is bound to its row", () => {
  it("a credential copied onto another connection cannot be opened", async () => {
    google.events = realWorldEvents();
    await connect("connector");
    const [connection] = await harness.db.select().from(schema.calendarConnections);
    if (!connection) throw new Error("no connection");

    // An attacker with write access to Postgres moves the sealed token to their
    // own connection row. The associated-data binding makes it inert.
    const strangerProfile = (
      await harness.db
        .select()
        .from(schema.profiles)
        .where(eq(schema.profiles.ownerUserId, "stranger"))
    )[0];
    if (!strangerProfile) throw new Error("no stranger profile");

    const [stolen] = await harness.db
      .insert(schema.calendarConnections)
      .values({
        userId: "stranger",
        profileId: strangerProfile.id,
        provider: "google",
        providerAccountId: "daniel@showme.music",
        refreshTokenCiphertext: connection.refreshTokenCiphertext,
        refreshTokenIv: connection.refreshTokenIv,
        refreshTokenAuthTag: connection.refreshTokenAuthTag,
        scope: connection.scope,
      })
      .returning();
    if (!stolen) throw new Error("insert failed");

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/integrations/calendar/${stolen.id}/sync`,
      headers: auth("stranger"),
    });
    expect(response.statusCode).toBe(500);
    // Nothing of the victim's calendar reached the attacker's profile.
    const leaked = await harness.db
      .select()
      .from(schema.calendarItems)
      .where(
        and(
          eq(schema.calendarItems.ownerProfileId, strangerProfile.id),
          eq(schema.calendarItems.externalSource, "google"),
        ),
      );
    expect(leaked).toHaveLength(0);
  });
});
