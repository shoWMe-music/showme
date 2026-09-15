import { randomUUID } from "node:crypto";
import { schema } from "@showme/db";
import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { concludeFinishedShowDays, ringStartedShowDays } from "./show-days";

let harness: TestDatabase;

beforeAll(async () => {
  harness = await startTestDatabase();
});

afterAll(async () => {
  await harness?.stop();
});

/** A user, the profile they own, and the active membership joining the two. */
async function seedProfile(slug: string): Promise<{ userId: string; profileId: string }> {
  const userId = `user-${randomUUID()}`;
  await harness.db
    .insert(schema.users)
    .values({ id: userId, email: `${slug}@example.com`, kind: "operator" });
  const [profile] = await harness.db
    .insert(schema.profiles)
    .values({ kind: "operator", ownerUserId: userId, name: slug, slug })
    .returning({ id: schema.profiles.id });
  if (!profile) throw new Error("failed to seed profile");
  await harness.db
    .insert(schema.profileMembers)
    .values({ profileId: profile.id, userId, role: "owner", status: "active" });
  return { userId, profileId: profile.id };
}

/** A show with a date, a zone and one performer on the bill besides the host. */
async function seedShow(options: {
  eventDate: string | null;
  timezone: string | null;
  status?: "confirmed" | "cancelled" | "pending" | "on_hold" | "draft";
  venueName?: string | null;
}): Promise<{ eventId: string; hostUserId: string; performerUserId: string }> {
  const slug = `show-${randomUUID()}`;
  const host = await seedProfile(`host-${slug}`);
  const performer = await seedProfile(`act-${slug}`);
  const [event] = await harness.db
    .insert(schema.events)
    .values({
      hostProfileId: host.profileId,
      title: `${slug} show`,
      baseCurrency: "SEK",
      status: options.status ?? "confirmed",
      eventDate: options.eventDate,
      timezone: options.timezone,
      venueName: options.venueName ?? null,
      createdBy: host.userId,
    })
    .returning({ id: schema.events.id });
  if (!event) throw new Error("failed to seed event");
  for (const profileId of [host.profileId, performer.profileId]) {
    await harness.db.insert(schema.eventParticipants).values({
      eventId: event.id,
      profileId,
      role: profileId === host.profileId ? "host" : "performer",
      status: "confirmed",
    });
  }
  return { eventId: event.id, hostUserId: host.userId, performerUserId: performer.userId };
}

/** The `event.showday` rows one user has been sent. */
async function bellsFor(userId: string) {
  return harness.db
    .select({ title: schema.notifications.title, body: schema.notifications.body })
    .from(schema.notifications)
    .where(
      and(eq(schema.notifications.userId, userId), eq(schema.notifications.type, "event.showday")),
    );
}

async function statusOf(eventId: string): Promise<string> {
  const [row] = await harness.db
    .select({ status: schema.events.status })
    .from(schema.events)
    .where(eq(schema.events.id, eventId));
  if (!row) throw new Error("event vanished");
  return row.status;
}

/**
 * SHOW DAYS (ClickUp `123qy9rng4z`).
 *
 * These are the first sweeps in this app whose boundary is a LOCAL midnight
 * rather than a fixed interval from a UTC stamp, so most of what is asserted here
 * is the zone arithmetic. None of it fails loudly when it is wrong: a bell rings
 * on the wrong morning, or a show concludes while the doors are still open, and
 * both read as the feature working.
 */
describe("ringStartedShowDays", () => {
  it("rings ONCE, however many times it is swept", async () => {
    // 2026-07-01 09:00 in Stockholm — the show day has begun, not ended.
    const now = new Date("2026-07-01T07:00:00.000Z");
    const show = await seedShow({ eventDate: "2026-07-01", timezone: "Europe/Stockholm" });

    expect(await ringStartedShowDays(harness.db, now)).toBe(1);
    expect(await ringStartedShowDays(harness.db, now)).toBe(0);

    expect(await bellsFor(show.performerUserId)).toHaveLength(1);
  });

  /**
   * The bell is for the BILL, not the office. This is the one kind of event news
   * where the performer is the primary audience — it is their night — so an
   * `operatorsOnly` rule here would be the bug, not the safe default.
   */
  it("reaches the performer as well as the host", async () => {
    const now = new Date("2026-07-02T07:00:00.000Z");
    const show = await seedShow({ eventDate: "2026-07-02", timezone: "Europe/Stockholm" });
    await ringStartedShowDays(harness.db, now);

    expect(await bellsFor(show.hostUserId)).toHaveLength(1);
    expect(await bellsFor(show.performerUserId)).toHaveLength(1);
  });

  it("names the room, because the title is usually the act's own name", async () => {
    const now = new Date("2026-07-03T07:00:00.000Z");
    const show = await seedShow({
      eventDate: "2026-07-03",
      timezone: "Europe/Stockholm",
      venueName: "The Lantern Hall",
    });
    await ringStartedShowDays(harness.db, now);

    const [bell] = await bellsFor(show.performerUserId);
    expect(bell?.body).toContain("The Lantern Hall");
  });

  /**
   * THE ZONE, written as a pair because one assertion cannot express it: the
   * server sits in ONE zone, so it cannot give two same-dated shows different
   * answers. At this instant Sydney is ten hours into the 20th while Honolulu is
   * still on the 19th.
   */
  it("opens at local midnight where the show is, not where the server is", async () => {
    const sameInstant = new Date("2026-07-03T23:00:00.000Z");
    const sydney = await seedShow({ eventDate: "2026-07-04", timezone: "Australia/Sydney" });
    const honolulu = await seedShow({ eventDate: "2026-07-04", timezone: "Pacific/Honolulu" });

    await ringStartedShowDays(harness.db, sameInstant);

    expect(await bellsFor(sydney.performerUserId)).toHaveLength(1);
    expect(await bellsFor(honolulu.performerUserId)).toHaveLength(0);
  });

  /**
   * The bound that stops the column's first ever sweep ringing for a decade of
   * history. A morning that is already over is not news.
   */
  it("stays silent about a show day that is already over", async () => {
    const show = await seedShow({ eventDate: "2026-07-05", timezone: "Europe/Stockholm" });
    // Three days later. Asserted on THIS show rather than on the sweep's count,
    // which counts every other test's leftovers in the shared database too.
    await ringStartedShowDays(harness.db, new Date("2026-07-08T07:00:00.000Z"));
    expect(await bellsFor(show.performerUserId)).toHaveLength(0);
  });

  it("stays silent about a show day that has not started", async () => {
    const show = await seedShow({ eventDate: "2026-07-09", timezone: "Europe/Stockholm" });
    // 2026-07-08 23:00 Stockholm — one hour short of the show day.
    await ringStartedShowDays(harness.db, new Date("2026-07-08T21:00:00.000Z"));
    expect(await bellsFor(show.performerUserId)).toHaveLength(0);
  });

  it("says nothing about a show that was called off", async () => {
    const now = new Date("2026-07-10T07:00:00.000Z");
    const show = await seedShow({
      eventDate: "2026-07-10",
      timezone: "Europe/Stockholm",
      status: "cancelled",
    });
    await ringStartedShowDays(harness.db, now);
    expect(await bellsFor(show.performerUserId)).toHaveLength(0);
  });

  it("ignores an event with no date at all", async () => {
    const show = await seedShow({ eventDate: null, timezone: "Europe/Stockholm" });
    await ringStartedShowDays(harness.db, new Date("2026-07-11T07:00:00.000Z"));
    expect(await bellsFor(show.performerUserId)).toHaveLength(0);
  });

  /** A zone is nullable on `events`; falling back to UTC beats never ringing. */
  it("falls back to UTC when no zone was stamped", async () => {
    const show = await seedShow({ eventDate: "2026-07-12", timezone: null });
    await ringStartedShowDays(harness.db, new Date("2026-07-12T12:00:00.000Z"));
    expect(await bellsFor(show.performerUserId)).toHaveLength(1);
  });
});

describe("concludeFinishedShowDays", () => {
  it("concludes a confirmed show once its local day is over", async () => {
    const show = await seedShow({ eventDate: "2026-08-01", timezone: "Europe/Stockholm" });
    // 2026-08-02 02:00 Stockholm — past the closing midnight.
    await concludeFinishedShowDays(harness.db, new Date("2026-08-02T00:00:00.000Z"));
    expect(await statusOf(show.eventId)).toBe("concluded");
  });

  /**
   * The failure this exists to prevent: concluding a show while the doors are
   * still open. 23:00 local on the night itself is mid-gig.
   */
  it("leaves the show alone during its own night", async () => {
    const show = await seedShow({ eventDate: "2026-08-03", timezone: "Europe/Stockholm" });
    // 2026-08-03 23:00 Stockholm.
    await concludeFinishedShowDays(harness.db, new Date("2026-08-03T21:00:00.000Z"));
    expect(await statusOf(show.eventId)).toBe("confirmed");
  });

  /** Same pair as the bell, for the same reason: one server zone, two answers. */
  it("closes at local midnight where the show is", async () => {
    const sameInstant = new Date("2026-08-05T00:00:00.000Z");
    const stockholm = await seedShow({ eventDate: "2026-08-04", timezone: "Europe/Stockholm" });
    const honolulu = await seedShow({ eventDate: "2026-08-04", timezone: "Pacific/Honolulu" });

    await concludeFinishedShowDays(harness.db, sameInstant);

    // 02:00 on the 5th in Stockholm — over.
    expect(await statusOf(stockholm.eventId)).toBe("concluded");
    // 14:00 on the 4th in Honolulu — the show has not happened yet.
    expect(await statusOf(honolulu.eventId)).toBe("confirmed");
  });

  /**
   * A show that was called off does not become a show that happened because its
   * date went by, and a date nobody ever confirmed must not conclude itself into
   * asserting a booking that never existed.
   */
  it("promotes confirmed and nothing else", async () => {
    const past = new Date("2026-08-10T00:00:00.000Z");
    for (const status of ["cancelled", "pending", "on_hold", "draft"] as const) {
      const show = await seedShow({
        eventDate: "2026-08-06",
        timezone: "Europe/Stockholm",
        status,
      });
      await concludeFinishedShowDays(harness.db, past);
      expect(await statusOf(show.eventId)).toBe(status);
    }
  });

  it("is idempotent — the second sweep finds nothing", async () => {
    await seedShow({ eventDate: "2026-08-11", timezone: "Europe/Stockholm" });
    const past = new Date("2026-08-12T00:00:00.000Z");
    expect(await concludeFinishedShowDays(harness.db, past)).toBeGreaterThanOrEqual(1);
    expect(await concludeFinishedShowDays(harness.db, past)).toBe(0);
  });
});
