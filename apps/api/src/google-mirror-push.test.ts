import { schema } from "@showme/db";
import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CalendarIntegration } from "./lib/calendar-integration";
import { GOOGLE_APP_CALENDAR_SCOPE, GOOGLE_CALENDAR_SCOPE } from "./lib/google-calendar";
import { pushMirroredEvents } from "./lib/google-mirror-push";

/**
 * The OUTBOUND direction — shoWMe's shows onto the user's own Google calendar.
 *
 * Daniel, 2026-09-01: "they should also be able to sync showme with their own
 * calendar." `lib/external-calendar.ts` specified this seam long ago and nothing
 * ever drove it; these prove the Google adapter now does, and that it obeys the
 * two rules that seam is emphatic about: never overwrite an edit made on the far
 * side, and never let a pushed copy come back as an import.
 */

let harness: TestDatabase;
const NOW = new Date("2027-01-15T12:00:00.000Z");

interface Captured {
  url: string;
  method: string;
  body: Record<string, unknown> | null;
}

/** A Google that records what it was asked and answers plausibly. */
function fakeGoogle() {
  const calls: Captured[] = [];
  let nextEventId = 1;
  const implementation = (async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({
      url: String(url),
      method,
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    if (String(url).includes("/users/me/calendarList")) {
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    }
    if (String(url).endsWith("/calendars") && method === "POST") {
      return new Response(JSON.stringify({ id: "showme-cal" }), { status: 200 });
    }
    if (method === "DELETE") return new Response(null, { status: 204 });
    return new Response(JSON.stringify({ id: `evt-${nextEventId++}` }), { status: 200 });
  }) as unknown as typeof fetch;
  return { calls, implementation };
}

function integrationWith(implementation: typeof fetch): CalendarIntegration {
  return {
    googleOAuthClient: {
      clientId: "client",
      clientSecret: "secret",
      fetchImplementation: implementation,
    },
  } as unknown as CalendarIntegration;
}

const BOTH_SCOPES = `${GOOGLE_CALENDAR_SCOPE} ${GOOGLE_APP_CALENDAR_SCOPE}`;

beforeAll(async () => {
  harness = await startTestDatabase();
});

afterAll(async () => {
  await harness?.stop();
});

/** An operator with a connection, and one show on the given date/status. */
async function seedConnectionWithEvent(
  slug: string,
  input: { status: string; eventDate: string | null; scope?: string },
) {
  const { db } = harness;
  const userId = `user-${slug}`;
  await db.insert(schema.users).values({ id: userId, email: `${slug}@t.test`, kind: "operator" });
  const [profile] = await db
    .insert(schema.profiles)
    .values({ kind: "operator", ownerUserId: userId, name: slug, slug })
    .returning({ id: schema.profiles.id });
  if (!profile) throw new Error("profile seed failed");
  const [connection] = await db
    .insert(schema.calendarConnections)
    .values({
      userId,
      profileId: profile.id,
      provider: "google",
      providerAccountId: `${slug}@gmail.test`,
      providerCalendarId: "primary",
      refreshTokenCiphertext: "x",
      refreshTokenIv: "y",
      refreshTokenAuthTag: "z",
      scope: input.scope ?? BOTH_SCOPES,
    })
    .returning();
  if (!connection) throw new Error("connection seed failed");
  const [event] = await db
    .insert(schema.events)
    .values({
      hostProfileId: profile.id,
      title: `${slug} show`,
      status: input.status as "confirmed",
      eventDate: input.eventDate,
      doorTime: "19:00",
      endTime: "23:00",
      timezone: "Europe/Stockholm",
      venueName: "The Lantern Hall",
      baseCurrency: "SEK",
      createdBy: userId,
    })
    .returning({ id: schema.events.id });
  if (!event) throw new Error("event seed failed");
  return { userId, profileId: profile.id, connection, eventId: event.id };
}

describe("pushMirroredEvents", () => {
  it("creates the shoWMe calendar once and mirrors a confirmed show onto it", async () => {
    const seeded = await seedConnectionWithEvent("mirror-basic", {
      status: "confirmed",
      eventDate: "2027-02-20",
    });
    const google = fakeGoogle();

    const result = await pushMirroredEvents(
      harness.db,
      integrationWith(google.implementation),
      seeded.connection,
      "token",
      NOW,
    );

    expect(result.created).toBe(1);

    // The calendar id is REMEMBERED, so the next sync does not re-list to find it.
    const [after] = await harness.db
      .select()
      .from(schema.calendarConnections)
      .where(eq(schema.calendarConnections.id, seeded.connection.id));
    expect(after?.appCalendarId).toBe("showme-cal");

    // It landed on OUR calendar, never the primary one.
    const write = google.calls.find((call) => call.url.includes("/events?"));
    expect(write?.url).toContain("/calendars/showme-cal/events");
    expect(write?.body?.summary).toBe("mirror-basic show");
    // Postgres hands back a `time` as `19:00:00`; that is valid RFC 3339 and is
    // what Google is sent, anchored by the event's own zone rather than the
    // server's — Cloud Run runs in UTC and a laptop does not.
    expect(write?.body?.start).toEqual({
      dateTime: "2027-02-20T19:00:00",
      timeZone: "Europe/Stockholm",
    });
    // Nobody is invited to a mirrored show — it is a copy for the owner.
    expect(write?.url).toContain("sendUpdates=none");

    // And the mirror row exists, which is what stops the inbound sync
    // re-importing this as an external entry blocking its own night.
    const mirrors = await harness.db
      .select()
      .from(schema.externalCalendarMirrors)
      .where(eq(schema.externalCalendarMirrors.eventId, seeded.eventId));
    expect(mirrors).toHaveLength(1);
    expect(mirrors[0]?.providerCalendarId).toBe("showme-cal");
  });

  it("does NOTHING without the app-calendar scope, however much else is granted", async () => {
    const seeded = await seedConnectionWithEvent("mirror-noscope", {
      status: "confirmed",
      eventDate: "2027-02-21",
      // Exactly what every connection made before this feature carries.
      scope: GOOGLE_CALENDAR_SCOPE,
    });
    const google = fakeGoogle();

    const result = await pushMirroredEvents(
      harness.db,
      integrationWith(google.implementation),
      seeded.connection,
      "token",
      NOW,
    );

    expect(result).toEqual({ created: 0, updated: 0, removed: 0, skippedStale: 0 });
    // Not even the calendar listing — that call is itself a 403 without the scope.
    expect(google.calls).toHaveLength(0);
  });

  it("does not put a HOLD on somebody's calendar", async () => {
    const seeded = await seedConnectionWithEvent("mirror-hold", {
      status: "on_hold",
      eventDate: "2027-02-22",
    });
    const google = fakeGoogle();

    const result = await pushMirroredEvents(
      harness.db,
      integrationWith(google.implementation),
      seeded.connection,
      "token",
      NOW,
    );

    // A hold is a date under consideration. Mirroring it announces a booking
    // nobody has agreed to, on a calendar a manager or partner may be reading.
    expect(result.created).toBe(0);
    expect(google.calls.some((call) => call.url.includes("/events?"))).toBe(false);
  });

  it("REFUSES to overwrite a copy the user edited on the far side", async () => {
    const seeded = await seedConnectionWithEvent("mirror-stale", {
      status: "confirmed",
      eventDate: "2027-02-23",
    });
    // Pushed an hour ago; they edited it since.
    await harness.db.insert(schema.externalCalendarMirrors).values({
      eventId: seeded.eventId,
      provider: "google",
      providerCalendarId: "showme-cal",
      providerEventId: "evt-existing",
      pushedAt: new Date(NOW.getTime() - 60 * 60 * 1000),
      remoteUpdatedAt: new Date(NOW.getTime() - 30 * 60 * 1000),
    });
    await harness.db
      .update(schema.calendarConnections)
      .set({ appCalendarId: "showme-cal" })
      .where(eq(schema.calendarConnections.id, seeded.connection.id));
    const google = fakeGoogle();

    const result = await pushMirroredEvents(
      harness.db,
      integrationWith(google.implementation),
      { ...seeded.connection, appCalendarId: "showme-cal" },
      "token",
      NOW,
    );

    // Skipped and COUNTED — never silently, and never overwritten. An integration
    // that quietly reverts somebody's edit teaches them not to trust it.
    expect(result.skippedStale).toBe(1);
    expect(result.updated).toBe(0);
    expect(google.calls.some((call) => call.method === "PATCH")).toBe(false);
  });

  it("takes the copy back off the calendar when the show is cancelled", async () => {
    const seeded = await seedConnectionWithEvent("mirror-cancel", {
      status: "cancelled",
      eventDate: "2027-02-24",
    });
    await harness.db.insert(schema.externalCalendarMirrors).values({
      eventId: seeded.eventId,
      provider: "google",
      providerCalendarId: "showme-cal",
      providerEventId: "evt-gone",
      pushedAt: new Date(NOW.getTime() - 60 * 60 * 1000),
    });
    const google = fakeGoogle();

    const result = await pushMirroredEvents(
      harness.db,
      integrationWith(google.implementation),
      { ...seeded.connection, appCalendarId: "showme-cal" },
      "token",
      NOW,
    );

    expect(result.removed).toBe(1);
    expect(google.calls.some((call) => call.method === "DELETE")).toBe(true);
    // The mirror goes with it, so a later sync does not try to address a copy
    // that is no longer there.
    const mirrors = await harness.db
      .select()
      .from(schema.externalCalendarMirrors)
      .where(eq(schema.externalCalendarMirrors.eventId, seeded.eventId));
    expect(mirrors).toHaveLength(0);
  });

  it("has nothing to mirror for an undated event", async () => {
    const seeded = await seedConnectionWithEvent("mirror-undated", {
      status: "confirmed",
      eventDate: null,
    });
    const google = fakeGoogle();

    const result = await pushMirroredEvents(
      harness.db,
      integrationWith(google.implementation),
      seeded.connection,
      "token",
      NOW,
    );

    expect(result.created).toBe(0);
  });
});
