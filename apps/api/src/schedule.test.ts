import { PRESET_PERMISSION_SETS } from "@showme/auth";
import { schema } from "@showme/db";
import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TokenVerifier } from "./auth/token-verifier";
import { scheduleRoutes } from "./routes/schedule";
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
  app = buildTestApp({ database: harness.db, tokenVerifier: fakeVerifier }, [scheduleRoutes]);
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

/** An operator with an event + host participant, plus a performer participant. */
async function seedEventWithParticipants(prefix: string) {
  const { db } = harness;
  const operator = await seedMemberWithSet(
    `${prefix}-op`,
    "operator",
    PRESET_PERMISSION_SETS.operator_full,
  );
  const performer = await seedMemberWithSet(
    `${prefix}-perf`,
    "performer",
    PRESET_PERMISSION_SETS.performer,
  );

  const [event] = await db
    .insert(schema.events)
    .values({
      hostProfileId: operator.profileId,
      title: "Run of Show",
      baseCurrency: "SEK",
      createdBy: `${prefix}-op`,
    })
    .returning();
  if (!event) throw new Error("event seed failed");

  const [hostParticipant] = await db
    .insert(schema.eventParticipants)
    .values({
      eventId: event.id,
      profileId: operator.profileId,
      role: "host",
      permissionSetId: operator.permissionSetId,
      status: "confirmed",
    })
    .returning();
  if (!hostParticipant) throw new Error("host participant seed failed");

  const [performerParticipant] = await db
    .insert(schema.eventParticipants)
    .values({
      eventId: event.id,
      profileId: performer.profileId,
      role: "performer",
      permissionSetId: performer.permissionSetId,
      status: "confirmed",
    })
    .returning();
  if (!performerParticipant) throw new Error("performer participant seed failed");

  return { operator, performer, event, hostParticipant, performerParticipant };
}

describe("schedule — authorize + audit", () => {
  it("lets an operator create items and lists them ordered by start time", async () => {
    const { db } = harness;
    const { event } = await seedEventWithParticipants("sched-create");

    // Insert out of chronological order to prove the GET orders them.
    const later = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/schedule`,
      headers: auth("sched-create-op"),
      payload: {
        localDateTime: "2026-08-01T22:00",
        duration: 60,
        label: "Headliner",
        category: "production",
      },
    });
    expect(later.statusCode).toBe(201);
    expect(later.json().label).toBe("Headliner");

    const earlier = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/schedule`,
      headers: auth("sched-create-op"),
      payload: {
        localDateTime: "2026-08-01T18:00",
        label: "Doors",
        category: "crew",
      },
    });
    expect(earlier.statusCode).toBe(201);

    // The create is audited.
    const audit = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, later.json().id));
    expect(audit).toHaveLength(1);
    expect(audit[0]?.action).toBe("schedule.create");
    expect(audit[0]?.actorUserId).toBe("sched-create-op");

    const list = await app.inject({
      method: "GET",
      url: `/api/v1/events/${event.id}/schedule`,
      headers: auth("sched-create-op"),
    });
    expect(list.statusCode).toBe(200);
    const rows = list.json();
    expect(rows).toHaveLength(2);
    // Ordered by start_time ascending: Doors (18:00) before Headliner (22:00).
    expect(rows.map((row: { label: string }) => row.label)).toEqual(["Doors", "Headliner"]);
  });

  it("updates and deletes an item with audit", async () => {
    const { db } = harness;
    const { event } = await seedEventWithParticipants("sched-mutate");

    const created = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/schedule`,
      headers: auth("sched-mutate-op"),
      payload: { localDateTime: "2026-08-01T20:00", label: "Soundcheck", category: "crew" },
    });
    const scheduleItemId = created.json().id;

    const updated = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${event.id}/schedule/${scheduleItemId}`,
      headers: auth("sched-mutate-op"),
      payload: { label: "Line check", duration: 45 },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().label).toBe("Line check");
    expect(updated.json().duration).toBe(45);

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/v1/events/${event.id}/schedule/${scheduleItemId}`,
      headers: auth("sched-mutate-op"),
    });
    expect(deleted.statusCode).toBe(204);

    const actions = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, scheduleItemId));
    expect(actions.map((row) => row.action).sort()).toEqual([
      "schedule.create",
      "schedule.delete",
      "schedule.update",
    ]);
  });

  it("computes the UTC instant from the wall-clock local time in the event's zone", async () => {
    const { db } = harness;
    const { event } = await seedEventWithParticipants("sched-instant");

    // Anchor the event to Stockholm so summer wall-clock resolves at UTC+2 (CEST).
    await db
      .update(schema.events)
      .set({ timezone: "Europe/Stockholm" })
      .where(eq(schema.events.id, event.id));

    const created = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/schedule`,
      headers: auth("sched-instant-op"),
      payload: { localDateTime: "2026-08-01T20:00", label: "Headliner", category: "production" },
    });
    expect(created.statusCode).toBe(201);

    const list = await app.inject({
      method: "GET",
      url: `/api/v1/events/${event.id}/schedule`,
      headers: auth("sched-instant-op"),
    });
    expect(list.statusCode).toBe(200);
    const [row] = list.json();
    // 20:00 Stockholm summer time (CEST = UTC+2) → 18:00 UTC.
    expect(row.instant).toBe("2026-08-01T18:00:00.000Z");
    expect(row.localDateTime).toBe("2026-08-01T20:00");
    expect(row.timezone).toBe("Europe/Stockholm");
  });

  it("returns a null instant when the event has no timezone anchor", async () => {
    const { event } = await seedEventWithParticipants("sched-notz");

    const created = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/schedule`,
      headers: auth("sched-notz-op"),
      payload: { localDateTime: "2026-08-01T20:00", label: "Headliner", category: "production" },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().instant).toBeNull();
  });

  it("lets a performer view (floor) but forbids them from editing", async () => {
    const { event } = await seedEventWithParticipants("sched-perm");

    // schedule.view is in the performer floor → 200 on GET.
    const view = await app.inject({
      method: "GET",
      url: `/api/v1/events/${event.id}/schedule`,
      headers: auth("sched-perm-perf"),
    });
    expect(view.statusCode).toBe(200);

    // No schedule.edit → 403 on POST.
    const post = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/schedule`,
      headers: auth("sched-perm-perf"),
      payload: { localDateTime: "2026-08-01T20:00", label: "Nope", category: "production" },
    });
    expect(post.statusCode).toBe(403);
  });
});

/**
 * The add row in `EventScheduleCard` sends an explicit `null` when the time box
 * is left blank. `CreateScheduleBody.localDateTime` was `.optional()` but not
 * `.nullable()` — while the update body beside it had always accepted null — so
 * adding an item without a time failed with a 400 in production. An untimed
 * item is legitimate: you know the soundcheck is happening before you know when.
 */
describe("schedule — an item may be added before its time is known", () => {
  it("accepts the explicit null the add row sends for a blank time", async () => {
    const { event } = await seedEventWithParticipants("sched-null");

    const created = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/schedule`,
      headers: auth("sched-null-op"),
      payload: { localDateTime: null, label: "Doors", category: "production" },
    });

    expect(created.statusCode).toBe(201);
    expect(created.json().localDateTime).toBeNull();
    expect(created.json().label).toBe("Doors");
  });

  it("still accepts the key being omitted entirely", async () => {
    const { event } = await seedEventWithParticipants("sched-omitted");

    const created = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/schedule`,
      headers: auth("sched-omitted-op"),
      payload: { label: "Soundcheck", category: "crew" },
    });

    expect(created.statusCode).toBe(201);
    expect(created.json().localDateTime).toBeNull();
  });

  it("still rejects a time that is not a local date-time", async () => {
    const { event } = await seedEventWithParticipants("sched-garbage");

    const created = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/schedule`,
      headers: auth("sched-garbage-op"),
      payload: { localDateTime: "tomorrow-ish", label: "Doors", category: "production" },
    });

    expect(created.statusCode).toBe(400);
  });
});
