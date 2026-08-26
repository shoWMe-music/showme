import { schema } from "@showme/db";
import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TokenVerifier } from "./auth/token-verifier";
import { busyFromCalendarItem, readProfileBusyTime } from "./lib/availability";
import {
  applyExternalCalendarDeletions,
  mirrorIsStale,
  mirrorPayloadForEvent,
  recordMirrorPush,
  upsertExternalCalendarEvents,
} from "./lib/external-calendar";
import { calendarRoutes } from "./routes/calendar";
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
  app = buildTestApp({ database: harness.db, tokenVerifier: fakeVerifier }, [
    calendarRoutes,
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

interface SeededProfile {
  profileId: string;
  slug: string;
}

/**
 * A user who owns an operator profile with a Swedish primary location (so a
 * promoted event can derive a currency) and a public page (so the availability
 * page resolves).
 */
async function seedOperator(id: string, country = "SE"): Promise<SeededProfile> {
  const { db } = harness;
  const slug = `${id}-slug`;
  await db.insert(schema.users).values({ id, email: `${id}@example.com`, kind: "operator" });
  const [profile] = await db
    .insert(schema.profiles)
    .values({ kind: "operator", ownerUserId: id, name: id, slug, isPublic: true })
    .returning();
  if (!profile) throw new Error("profile seed failed");
  await db
    .insert(schema.profileMembers)
    .values({ profileId: profile.id, userId: id, role: "owner", status: "active" });
  await db
    .insert(schema.profileLocations)
    .values({ profileId: profile.id, country, city: "Stockholm", isPrimary: true });
  return { profileId: profile.id, slug };
}

/** Add a second person to an existing profile — the co-member the title rule is about. */
async function addMember(profileId: string, id: string, role = "admin"): Promise<void> {
  const { db } = harness;
  await db.insert(schema.users).values({ id, email: `${id}@example.com`, kind: "operator" });
  await db
    .insert(schema.profileMembers)
    .values({ profileId, userId: id, role: role as "admin", status: "active" });
}

/** Drive the inbound seam the way a provider adapter would. */
async function sync(
  owner: { profileId: string; userId: string },
  events: Parameters<typeof upsertExternalCalendarEvents>[1]["events"],
) {
  return upsertExternalCalendarEvents(harness.db, {
    provider: "google",
    ownerProfileId: owner.profileId,
    ownerUserId: owner.userId,
    events,
  });
}

describe("busyFromCalendarItem — the rule, as a pure function", () => {
  const base = { type: "external", date: "2026-09-10", endDate: null, blocksAvailability: true };

  it("takes only the hours a timed entry names", () => {
    expect(busyFromCalendarItem({ ...base, startTime: "09:00:00", endTime: "09:30:00" })).toEqual({
      kind: "window",
      window: { date: "2026-09-10", startTime: "09:00:00", endTime: "09:30:00" },
    });
  });

  it("takes the whole day when the entry names no hours", () => {
    expect(busyFromCalendarItem({ ...base, startTime: null, endTime: null })).toEqual({
      kind: "range",
      range: { startDate: "2026-09-10", endDate: "2026-09-10" },
    });
  });

  it("takes every day a multi-day entry spans, hours or not", () => {
    expect(
      busyFromCalendarItem({
        ...base,
        endDate: "2026-09-12",
        startTime: "09:00:00",
        endTime: "17:00:00",
      }),
    ).toEqual({
      kind: "range",
      range: { startDate: "2026-09-10", endDate: "2026-09-12" },
    });
  });

  it("treats a half-open entry as all-day — under-blocking books a double show", () => {
    expect(busyFromCalendarItem({ ...base, startTime: "09:00:00", endTime: null })).toEqual({
      kind: "range",
      range: { startDate: "2026-09-10", endDate: "2026-09-10" },
    });
  });

  it("ignores an entry marked available anyway", () => {
    expect(
      busyFromCalendarItem({
        ...base,
        blocksAvailability: false,
        startTime: "09:00:00",
        endTime: "09:30:00",
      }),
    ).toBeNull();
  });

  it("ignores shoWMe's own notes and tasks — a reminder is not an occupied window", () => {
    for (const type of ["task", "note", "appointment"]) {
      expect(
        busyFromCalendarItem({ ...base, type, startTime: "09:00:00", endTime: "09:30:00" }),
      ).toBeNull();
    }
  });
});

describe("the inbound seam", () => {
  it("upserts on (source, externalId) — a second sync updates, it does not duplicate", async () => {
    const owner = await seedOperator("ext-upsert");
    const scope = { profileId: owner.profileId, userId: "ext-upsert" };

    const first = await sync(scope, [
      {
        externalId: "g-1",
        title: "Founder Lunch",
        date: "2026-09-10",
        startTime: "09:00",
        endTime: "09:30",
      },
    ]);
    expect(first.upserted).toBe(1);

    const second = await sync(scope, [
      {
        externalId: "g-1",
        title: "Founder Lunch (moved)",
        date: "2026-09-10",
        startTime: "10:00",
        endTime: "10:45",
      },
    ]);
    expect(second.upserted).toBe(1);

    const rows = await harness.db
      .select()
      .from(schema.calendarItems)
      .where(eq(schema.calendarItems.ownerProfileId, owner.profileId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe("Founder Lunch (moved)");
    expect(rows[0]?.startTime).toBe("10:00:00");
    expect(rows[0]?.type).toBe("external");
  });

  it("never resets the user's 'available anyway' override on re-sync", async () => {
    const owner = await seedOperator("ext-override");
    const scope = { profileId: owner.profileId, userId: "ext-override" };
    const { itemIds } = await sync(scope, [
      {
        externalId: "g-2",
        title: "Dentist",
        date: "2026-09-11",
        startTime: "08:00",
        endTime: "09:00",
      },
    ]);
    const itemId = itemIds[0] as string;

    const lifted = await app.inject({
      method: "PATCH",
      url: `/api/v1/calendar/${itemId}/availability`,
      headers: auth("ext-override"),
      payload: { blocksAvailability: false },
    });
    expect(lifted.statusCode).toBe(200);
    expect(lifted.json().blocksAvailability).toBe(false);

    await sync(scope, [
      {
        externalId: "g-2",
        title: "Dentist",
        date: "2026-09-11",
        startTime: "08:00",
        endTime: "09:00",
      },
    ]);

    const [after] = await harness.db
      .select()
      .from(schema.calendarItems)
      .where(eq(schema.calendarItems.id, itemId));
    expect(after?.blocksAvailability).toBe(false);
  });

  it("skips the echo — a shoWMe event pushed out does not come back as an import", async () => {
    const owner = await seedOperator("ext-echo");
    const [event] = await harness.db
      .insert(schema.events)
      .values({
        hostProfileId: owner.profileId,
        title: "Our Own Show",
        baseCurrency: "SEK",
        eventDate: "2026-09-20",
        createdBy: "ext-echo",
      })
      .returning();
    if (!event) throw new Error("event seed failed");

    await recordMirrorPush(harness.db, {
      eventId: event.id,
      provider: "google",
      providerCalendarId: "daniel@showme.music",
      providerEventId: "g-echo",
    });

    const result = await sync({ profileId: owner.profileId, userId: "ext-echo" }, [
      { externalId: "g-echo", title: "Our Own Show", date: "2026-09-20" },
      { externalId: "g-real", title: "Somebody else's thing", date: "2026-09-21" },
    ]);

    expect(result.echoesSkipped).toBe(1);
    expect(result.upserted).toBe(1);

    const rows = await harness.db
      .select({ externalId: schema.calendarItems.externalId })
      .from(schema.calendarItems)
      .where(eq(schema.calendarItems.ownerProfileId, owner.profileId));
    expect(rows.map((row) => row.externalId)).toEqual(["g-real"]);
  });

  it("removes a cancelled entry, but keeps one that already became a show", async () => {
    const owner = await seedOperator("ext-delete");
    const scope = { profileId: owner.profileId, userId: "ext-delete" };
    await sync(scope, [
      { externalId: "g-gone", title: "Cancelled meeting", date: "2026-09-12" },
      { externalId: "g-promoted", title: "Club night", date: "2026-09-13" },
    ]);

    const [promotedItem] = await harness.db
      .select()
      .from(schema.calendarItems)
      .where(
        and(
          eq(schema.calendarItems.ownerProfileId, owner.profileId),
          eq(schema.calendarItems.externalId, "g-promoted"),
        ),
      );
    const promote = await app.inject({
      method: "POST",
      url: `/api/v1/calendar/${promotedItem?.id}/promote-event`,
      headers: auth("ext-delete"),
      payload: {},
    });
    expect(promote.statusCode).toBe(201);

    const result = await applyExternalCalendarDeletions(harness.db, {
      provider: "google",
      ownerProfileId: owner.profileId,
      ownerUserId: "ext-delete",
      externalIds: ["g-gone", "g-promoted"],
    });
    expect(result).toEqual({ deleted: 1, keptBecausePromoted: 1 });

    const survivors = await harness.db
      .select({
        externalId: schema.calendarItems.externalId,
        blocksAvailability: schema.calendarItems.blocksAvailability,
      })
      .from(schema.calendarItems)
      .where(eq(schema.calendarItems.ownerProfileId, owner.profileId));
    expect(survivors).toEqual([{ externalId: "g-promoted", blocksAvailability: false }]);
  });
});

describe("the availability union", () => {
  it("unions hand-made blocks with imported all-day entries, and keeps hours separate", async () => {
    const owner = await seedOperator("ext-union");
    await harness.db.insert(schema.profileUnavailability).values({
      profileId: owner.profileId,
      startDate: "2026-10-01",
      endDate: "2026-10-03",
      reason: "on tour",
    });
    await sync({ profileId: owner.profileId, userId: "ext-union" }, [
      { externalId: "u-allday", title: "Company offsite", date: "2026-10-08" },
      { externalId: "u-span", title: "Family holiday", date: "2026-10-12", endDate: "2026-10-14" },
      {
        externalId: "u-timed",
        title: "Founder Lunch",
        date: "2026-10-20",
        startTime: "09:00",
        endTime: "09:30",
      },
    ]);

    const busy = await readProfileBusyTime(harness.db, owner.profileId);
    expect(busy.dateRanges).toEqual([
      { startDate: "2026-10-01", endDate: "2026-10-03" },
      { startDate: "2026-10-08", endDate: "2026-10-08" },
      { startDate: "2026-10-12", endDate: "2026-10-14" },
    ]);
    expect(busy.timeWindows).toEqual([
      { date: "2026-10-20", startTime: "09:00:00", endTime: "09:30:00" },
    ]);
  });

  it("narrows to a window, and a multi-day entry still counts from its far end", async () => {
    const owner = await seedOperator("ext-window");
    await sync({ profileId: owner.profileId, userId: "ext-window" }, [
      { externalId: "w-span", title: "Festival", date: "2026-11-01", endDate: "2026-11-05" },
      { externalId: "w-far", title: "Later", date: "2026-12-01" },
    ]);

    // The window starts INSIDE the festival — a naive `date >= from` would miss it.
    const busy = await readProfileBusyTime(harness.db, owner.profileId, {
      from: "2026-11-03",
      to: "2026-11-30",
    });
    expect(busy.dateRanges).toEqual([{ startDate: "2026-11-01", endDate: "2026-11-05" }]);
  });

  it("a person's own calendar never leaks into a profile's availability", async () => {
    const owner = await seedOperator("ext-personal");
    // Owned by the USER, not the profile — a private lunch on a personal calendar.
    await harness.db.insert(schema.calendarItems).values({
      ownerUserId: "ext-personal",
      ownerProfileId: null,
      type: "external",
      title: "Private",
      date: "2026-10-05",
      externalSource: "google",
      externalId: "p-1",
    });

    const busy = await readProfileBusyTime(harness.db, owner.profileId);
    expect(busy).toEqual({ dateRanges: [], timeWindows: [] });
  });
});

describe("the public availability page", () => {
  it("reflects the block, in the right shape, and leaks no title", async () => {
    const owner = await seedOperator("ext-public");
    await sync({ profileId: owner.profileId, userId: "ext-public" }, [
      { externalId: "pub-allday", title: "Company offsite", date: "2026-10-08" },
      {
        externalId: "pub-timed",
        title: "Founder Lunch",
        date: "2026-10-20",
        startTime: "09:00",
        endTime: "09:30",
        location: "Nordic Oncology Centre",
      },
    ]);

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/public/profiles/${owner.slug}/availability`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      unavailability: [{ startDate: "2026-10-08", endDate: "2026-10-08" }],
      busyTimes: [{ date: "2026-10-20", startTime: "09:00:00", endTime: "09:30:00" }],
    });
    // Nothing about WHAT the commitment is may appear anywhere in the payload.
    expect(response.payload).not.toContain("Founder Lunch");
    expect(response.payload).not.toContain("Company offsite");
    expect(response.payload).not.toContain("Nordic Oncology");
    expect(response.payload).not.toContain("google");
  });

  it("lifts the block when the user marks it available anyway", async () => {
    const owner = await seedOperator("ext-public-lift");
    const { itemIds } = await sync({ profileId: owner.profileId, userId: "ext-public-lift" }, [
      { externalId: "lift-1", title: "Offsite", date: "2026-10-09" },
    ]);

    const before = await app.inject({
      method: "GET",
      url: `/api/v1/public/profiles/${owner.slug}/availability`,
    });
    expect(before.json().unavailability).toHaveLength(1);

    const lifted = await app.inject({
      method: "PATCH",
      url: `/api/v1/calendar/${itemIds[0]}/availability`,
      headers: auth("ext-public-lift"),
      payload: { blocksAvailability: false },
    });
    expect(lifted.statusCode).toBe(200);

    const after = await app.inject({
      method: "GET",
      url: `/api/v1/public/profiles/${owner.slug}/availability`,
    });
    expect(after.json()).toEqual({ unavailability: [], busyTimes: [] });
  });

  it("serves the same union to members through the in-app route", async () => {
    const owner = await seedOperator("ext-inapp");
    await sync({ profileId: owner.profileId, userId: "ext-inapp" }, [
      { externalId: "in-1", title: "Offsite", date: "2026-10-09" },
    ]);

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/profiles/${owner.profileId}/availability`,
      headers: auth("ext-inapp"),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      unavailability: [{ startDate: "2026-10-09", endDate: "2026-10-09" }],
      busyTimes: [],
    });
    expect(response.payload).not.toContain("Offsite");
  });
});

describe("titles are owner-only", () => {
  it("shows the real title to the importer and 'Busy' to a co-member", async () => {
    const owner = await seedOperator("ext-title");
    await addMember(owner.profileId, "ext-title-mate");
    await sync({ profileId: owner.profileId, userId: "ext-title" }, [
      {
        externalId: "t-1",
        title: "Founder Lunch",
        date: "2026-10-15",
        startTime: "09:00",
        endTime: "09:30",
        location: "Nordic Oncology Centre",
      },
    ]);

    const asOwner = await app.inject({
      method: "GET",
      url: "/api/v1/calendar?from=2026-10-01&to=2026-10-31",
      headers: auth("ext-title"),
    });
    expect(asOwner.json()[0]).toMatchObject({
      title: "Founder Lunch",
      titleWithheld: false,
      entity: "Nordic Oncology Centre",
    });

    const asColleague = await app.inject({
      method: "GET",
      url: "/api/v1/calendar?from=2026-10-01&to=2026-10-31",
      headers: auth("ext-title-mate"),
    });
    expect(asColleague.json()[0]).toMatchObject({
      title: "Busy",
      titleWithheld: true,
      entity: null,
      // The block itself is NOT withheld — that a night is taken is the point.
      date: "2026-10-15",
      startTime: "09:00:00",
      blocksAvailability: true,
    });
    expect(asColleague.payload).not.toContain("Founder Lunch");
    expect(asColleague.payload).not.toContain("Nordic Oncology");
  });

  it("leaves a shoWMe-authored entry alone — it was written for the profile on purpose", async () => {
    const owner = await seedOperator("ext-authored");
    await addMember(owner.profileId, "ext-authored-mate");
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/calendar",
      headers: auth("ext-authored"),
      payload: {
        type: "appointment",
        title: "Production meeting",
        date: "2026-10-16",
        ownerProfileId: owner.profileId,
      },
    });
    expect(created.statusCode).toBe(201);

    const asColleague = await app.inject({
      method: "GET",
      url: "/api/v1/calendar?from=2026-10-16&to=2026-10-16",
      headers: auth("ext-authored-mate"),
    });
    expect(asColleague.json()[0]).toMatchObject({
      title: "Production meeting",
      titleWithheld: false,
    });
  });

  it("refuses to hand-author an external entry, so kind and provenance cannot drift", async () => {
    await seedOperator("ext-forge");
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/calendar",
      headers: auth("ext-forge"),
      payload: { type: "external", title: "Forged", date: "2026-10-17" },
    });
    expect(response.statusCode).toBe(400);
  });
});

describe("promoting an imported entry into a show", () => {
  it("creates a linked draft event and reports the plan cap honestly", async () => {
    const owner = await seedOperator("ext-promote");
    const { itemIds } = await sync({ profileId: owner.profileId, userId: "ext-promote" }, [
      {
        externalId: "pr-1",
        title: "Club night",
        date: "2026-11-14",
        startTime: "20:00",
        endTime: "23:00",
        location: "Main Room",
      },
    ]);
    const itemId = itemIds[0] as string;

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/calendar/${itemId}/promote-event`,
      headers: auth("ext-promote"),
      payload: {},
    });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body).toMatchObject({
      calendarItemId: itemId,
      title: "Club night",
      eventDate: "2026-11-14",
      baseCurrency: "SEK",
      status: "draft",
      eventCap: { allowed: true, used: 0, limit: 3, chargedAtConfirm: true },
    });

    // The state, not just the response.
    const [event] = await harness.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, body.eventId));
    expect(event).toMatchObject({
      hostProfileId: owner.profileId,
      status: "draft",
      eventDate: "2026-11-14",
      startTime: "20:00:00",
      endTime: "23:00:00",
      // Door time is deliberately NOT invented from the calendar entry.
      doorTime: null,
    });

    const [item] = await harness.db
      .select()
      .from(schema.calendarItems)
      .where(eq(schema.calendarItems.id, itemId));
    expect(item?.promotedEventId).toBe(body.eventId);
    // Promoting does not free the night: the commitment is still on the real calendar.
    expect(item?.blocksAvailability).toBe(true);

    const [participant] = await harness.db
      .select()
      .from(schema.eventParticipants)
      .where(eq(schema.eventParticipants.eventId, body.eventId));
    expect(participant).toMatchObject({ role: "host", profileId: owner.profileId });

    const audit = await harness.db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, body.eventId));
    expect(audit.map((row) => row.action)).toContain("calendar.promote_event");
  });

  it("refuses a second promotion, refuses a non-external entry, and refuses a stranger", async () => {
    const owner = await seedOperator("ext-promote-guard");
    await seedOperator("ext-promote-stranger");
    const { itemIds } = await sync({ profileId: owner.profileId, userId: "ext-promote-guard" }, [
      { externalId: "pg-1", title: "Club night", date: "2026-11-15" },
    ]);
    const itemId = itemIds[0] as string;

    const stranger = await app.inject({
      method: "POST",
      url: `/api/v1/calendar/${itemId}/promote-event`,
      headers: auth("ext-promote-stranger"),
      payload: {},
    });
    expect(stranger.statusCode).toBe(404);

    const first = await app.inject({
      method: "POST",
      url: `/api/v1/calendar/${itemId}/promote-event`,
      headers: auth("ext-promote-guard"),
      payload: {},
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: "POST",
      url: `/api/v1/calendar/${itemId}/promote-event`,
      headers: auth("ext-promote-guard"),
      payload: {},
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error?.message ?? second.json().message).toMatch(/already a show/i);

    const note = await app.inject({
      method: "POST",
      url: "/api/v1/calendar",
      headers: auth("ext-promote-guard"),
      payload: {
        type: "note",
        title: "Not a show",
        date: "2026-11-16",
        ownerProfileId: owner.profileId,
      },
    });
    const noteId = note.json().id;
    const promotedNote = await app.inject({
      method: "POST",
      url: `/api/v1/calendar/${noteId}/promote-event`,
      headers: auth("ext-promote-guard"),
      payload: {},
    });
    expect(promotedNote.statusCode).toBe(400);
    expect(promotedNote.json().error?.message ?? promotedNote.json().message).toMatch(
      /imported calendar entry/i,
    );
  });

  it("refuses a performer profile — only an operator hosts a show", async () => {
    const { db } = harness;
    await db
      .insert(schema.users)
      .values({ id: "ext-performer", email: "ext-performer@example.com", kind: "performer" });
    const [profile] = await db
      .insert(schema.profiles)
      .values({
        kind: "performer",
        ownerUserId: "ext-performer",
        name: "ext-performer",
        slug: "ext-performer",
      })
      .returning();
    if (!profile) throw new Error("profile seed failed");
    await db
      .insert(schema.profileMembers)
      .values({ profileId: profile.id, userId: "ext-performer", role: "owner", status: "active" });

    const { itemIds } = await sync({ profileId: profile.id, userId: "ext-performer" }, [
      { externalId: "perf-1", title: "Gig", date: "2026-11-17" },
    ]);

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/calendar/${itemIds[0]}/promote-event`,
      headers: auth("ext-performer"),
      payload: {},
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error?.message ?? response.json().message).toMatch(
      /Only operator profiles/i,
    );
  });
});

describe("the outbound seam", () => {
  it("mirrors a dated event as a window, and an undated one not at all", () => {
    expect(
      mirrorPayloadForEvent({
        id: "e1",
        title: "Club night",
        eventDate: "2026-11-14",
        doorTime: "19:00:00",
        startTime: "20:00:00",
        endTime: "23:00:00",
        timezone: "Europe/Stockholm",
        venueName: "The Hall",
      }),
    ).toEqual({
      title: "Club night",
      date: "2026-11-14",
      startTime: "19:00:00",
      endTime: "23:00:00",
      timezone: "Europe/Stockholm",
      location: "The Hall",
      showmeEventId: "e1",
    });

    // A start with no end would mirror as a zero-length blip; all-day is the truth.
    expect(
      mirrorPayloadForEvent({
        id: "e2",
        title: "TBC",
        eventDate: "2026-11-14",
        doorTime: null,
        startTime: "20:00:00",
        endTime: null,
        timezone: null,
        venueName: null,
      }),
    ).toMatchObject({ startTime: null, endTime: null });

    expect(
      mirrorPayloadForEvent({
        id: "e3",
        title: "Undated",
        eventDate: null,
        doorTime: null,
        startTime: null,
        endTime: null,
        timezone: null,
        venueName: null,
      }),
    ).toBeNull();
  });

  it("knows when the far side moved after our push", () => {
    const pushedAt = new Date("2026-08-01T10:00:00Z");
    expect(mirrorIsStale({ pushedAt, remoteUpdatedAt: null })).toBe(false);
    expect(mirrorIsStale({ pushedAt, remoteUpdatedAt: new Date("2026-08-01T09:00:00Z") })).toBe(
      false,
    );
    expect(mirrorIsStale({ pushedAt, remoteUpdatedAt: new Date("2026-08-01T11:00:00Z") })).toBe(
      true,
    );
  });
});
