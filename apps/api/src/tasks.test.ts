import { PRESET_PERMISSION_SETS } from "@showme/auth";
import { schema } from "@showme/db";
import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TokenVerifier } from "./auth/token-verifier";
import { taskRoutes } from "./routes/tasks";
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
  app = buildTestApp({ database: harness.db, tokenVerifier: fakeVerifier }, [taskRoutes]);
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await harness?.stop();
});

const auth = (uid: string) => ({ authorization: `Bearer ${uid}` });

/** Seed a user + a profile they own (owner membership), return the profile id. */
async function seedUserWithProfile(id: string): Promise<string> {
  const { db } = harness;
  await db
    .insert(schema.users)
    .values({ id, email: `${id}@example.showme.test`, kind: "operator" });
  const [profile] = await db
    .insert(schema.profiles)
    .values({ kind: "operator", ownerUserId: id, name: id, slug: id })
    .returning();
  if (!profile) throw new Error("profile seed failed");
  await db
    .insert(schema.profileMembers)
    .values({ profileId: profile.id, userId: id, role: "owner", status: "active" });
  return profile.id;
}

describe("tasks — owner-scoped CRUD", () => {
  it("creates a personal task with a reminder and lists it", async () => {
    await seedUserWithProfile("t-personal");

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/tasks",
      headers: auth("t-personal"),
      payload: {
        title: "Call the venue",
        dueDate: "2026-08-01",
        reminders: [{ date: "2026-07-30", time: "09:00", label: "Ping" }],
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().ownerUserId).toBe("t-personal");
    expect(created.json().ownerProfileId).toBeNull();
    const taskId = created.json().id;

    // The reminder row was persisted alongside the task.
    const reminders = await harness.db
      .select()
      .from(schema.taskReminders)
      .where(eq(schema.taskReminders.taskId, taskId));
    expect(reminders).toHaveLength(1);
    expect(reminders[0]?.label).toBe("Ping");

    const list = await app.inject({
      method: "GET",
      url: "/api/v1/tasks",
      headers: auth("t-personal"),
    });
    expect(list.statusCode).toBe(200);
    const ids = list.json().items.map((task: { id: string }) => task.id);
    expect(ids).toContain(taskId);
  });

  it("creates a profile-scoped task for an owned profile but not a foreign one", async () => {
    const profileId = await seedUserWithProfile("t-owner");
    const foreignProfileId = await seedUserWithProfile("t-foreign");

    const ownScoped = await app.inject({
      method: "POST",
      url: "/api/v1/tasks",
      headers: auth("t-owner"),
      payload: { title: "Profile todo", ownerProfileId: profileId },
    });
    expect(ownScoped.statusCode).toBe(201);
    expect(ownScoped.json().ownerProfileId).toBe(profileId);
    expect(ownScoped.json().ownerUserId).toBeNull();

    const foreignScoped = await app.inject({
      method: "POST",
      url: "/api/v1/tasks",
      headers: auth("t-owner"),
      payload: { title: "Not allowed", ownerProfileId: foreignProfileId },
    });
    expect([403, 404]).toContain(foreignScoped.statusCode);
  });

  it("round-trips budgetAmount as a STRING (minor units)", async () => {
    await seedUserWithProfile("t-money");

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/tasks",
      headers: auth("t-money"),
      payload: { title: "Book flights", budgetType: "cost", budgetAmount: "150000" },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().budgetAmount).toBe("150000");
    expect(typeof created.json().budgetAmount).toBe("string");

    const list = await app.inject({
      method: "GET",
      url: "/api/v1/tasks",
      headers: auth("t-money"),
    });
    const found = list.json().items.find((task: { id: string }) => task.id === created.json().id);
    expect(found.budgetAmount).toBe("150000");
  });

  it("stamps completedAt when a task is completed and writes an audit row", async () => {
    await seedUserWithProfile("t-complete");

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/tasks",
      headers: auth("t-complete"),
      payload: { title: "Finish rider" },
    });
    const taskId = created.json().id;
    expect(created.json().completedAt).toBeNull();

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/v1/tasks/${taskId}`,
      headers: auth("t-complete"),
      payload: { completed: true },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().completed).toBe(true);
    expect(patched.json().completedAt).not.toBeNull();

    const auditRows = await harness.db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, taskId));
    const actions = auditRows.map((row) => row.action);
    expect(actions).toContain("task.create");
    expect(actions).toContain("task.update");
  });

  it("deletes a task and 404s a foreign one", async () => {
    await seedUserWithProfile("t-del");
    await seedUserWithProfile("t-other");

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/tasks",
      headers: auth("t-del"),
      payload: { title: "Temp" },
    });
    const taskId = created.json().id;

    // A stranger cannot see it → 404 (no existence leak).
    const foreignDelete = await app.inject({
      method: "DELETE",
      url: `/api/v1/tasks/${taskId}`,
      headers: auth("t-other"),
    });
    expect(foreignDelete.statusCode).toBe(404);

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/v1/tasks/${taskId}`,
      headers: auth("t-del"),
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json().deleted).toBe(true);
  });
});

describe("tasks — the event's shared to-do list", () => {
  /** An operator standing on their own event, the way the event workspace opens. */
  async function seedHostOnEvent(prefix: string) {
    const { db } = harness;
    const profileId = await seedUserWithProfile(`${prefix}-host`);
    const [permissionSet] = await db
      .insert(schema.permissionSets)
      .values({
        profileId,
        name: "operator_full",
        capabilities: [...PRESET_PERMISSION_SETS.operator_full],
      })
      .returning();
    const [event] = await db
      .insert(schema.events)
      .values({
        hostProfileId: profileId,
        title: "Open Mic Wednesdays",
        baseCurrency: "SEK",
        createdBy: `${prefix}-host`,
      })
      .returning();
    if (!event) throw new Error("event seed failed");
    await db.insert(schema.eventParticipants).values({
      eventId: event.id,
      profileId,
      role: "host",
      permissionSetId: permissionSet?.id,
      status: "confirmed",
    });
    return { profileId, event };
  }

  it("creates a task from inside an event and lists it under that event", async () => {
    const { profileId, event } = await seedHostOnEvent("todo-tab");

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/tasks",
      headers: { ...auth("todo-tab-host"), "x-profile-id": profileId },
      payload: { title: "Hire the PA", eventId: event.id },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().eventId).toBe(event.id);

    const list = await app.inject({
      method: "GET",
      url: `/api/v1/tasks?eventId=${event.id}`,
      headers: { ...auth("todo-tab-host"), "x-profile-id": profileId },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().items.map((task: { title: string }) => task.title)).toEqual(["Hire the PA"]);
  });

  it("refuses a task on an event the caller cannot see", async () => {
    const { event } = await seedHostOnEvent("todo-outsider");
    const outsiderProfileId = await seedUserWithProfile("todo-outsider-stranger");

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/tasks",
      headers: { ...auth("todo-outsider-stranger"), "x-profile-id": outsiderProfileId },
      payload: { title: "Not mine", eventId: event.id },
    });
    expect(created.statusCode).toBe(404);
  });
});

describe("tasks — the assignee", () => {
  /**
   * A host on their own event, plus a second profile really on the bill: the
   * shape every assignment test needs, because the rule under test is exactly
   * "is this person a participant on THIS event".
   */
  async function seedEventWithPerformer(prefix: string) {
    const { db } = harness;
    const hostProfileId = await seedUserWithProfile(`${prefix}-host`);
    const performerProfileId = await seedUserWithProfile(`${prefix}-performer`);
    const [permissionSet] = await db
      .insert(schema.permissionSets)
      .values({
        profileId: hostProfileId,
        name: "operator_full",
        capabilities: [...PRESET_PERMISSION_SETS.operator_full],
      })
      .returning();
    const [event] = await db
      .insert(schema.events)
      .values({
        hostProfileId,
        title: "Assignment Night",
        baseCurrency: "SEK",
        createdBy: `${prefix}-host`,
      })
      .returning();
    if (!event) throw new Error("event seed failed");
    const [hostParticipant] = await db
      .insert(schema.eventParticipants)
      .values({
        eventId: event.id,
        profileId: hostProfileId,
        role: "host",
        permissionSetId: permissionSet?.id,
        status: "confirmed",
      })
      .returning();
    const [performerParticipant] = await db
      .insert(schema.eventParticipants)
      .values({
        eventId: event.id,
        profileId: performerProfileId,
        role: "performer",
        status: "confirmed",
      })
      .returning();
    if (!hostParticipant || !performerParticipant) throw new Error("participant seed failed");
    return {
      hostProfileId,
      performerProfileId,
      event,
      hostParticipant,
      performerParticipant,
      headers: { ...auth(`${prefix}-host`), "x-profile-id": hostProfileId },
    };
  }

  it("assigns an event task to somebody on that event, names them, and persists the id", async () => {
    const seeded = await seedEventWithPerformer("assign-ok");

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/tasks",
      headers: seeded.headers,
      payload: {
        title: "Load in the backline",
        eventId: seeded.event.id,
        assigneeParticipantId: seeded.performerParticipant.id,
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().assigneeParticipantId).toBe(seeded.performerParticipant.id);
    expect(created.json().assigneeName).toBe("assign-ok-performer");

    // The state, not just the response.
    const [row] = await harness.db
      .select({ assigneeParticipantId: schema.tasks.assigneeParticipantId })
      .from(schema.tasks)
      .where(eq(schema.tasks.id, created.json().id));
    expect(row?.assigneeParticipantId).toBe(seeded.performerParticipant.id);

    // And the list carries the name too — one join, not a lookup per row.
    const list = await app.inject({
      method: "GET",
      url: `/api/v1/tasks?eventId=${seeded.event.id}`,
      headers: seeded.headers,
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().items[0].assigneeName).toBe("assign-ok-performer");
  });

  it("assigns and unassigns over PATCH", async () => {
    const seeded = await seedEventWithPerformer("assign-patch");

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/tasks",
      headers: seeded.headers,
      payload: { title: "Chase the rider", eventId: seeded.event.id },
    });
    const taskId = created.json().id;
    expect(created.json().assigneeParticipantId).toBeNull();

    const assigned = await app.inject({
      method: "PATCH",
      url: `/api/v1/tasks/${taskId}`,
      headers: seeded.headers,
      payload: { assigneeParticipantId: seeded.performerParticipant.id },
    });
    expect(assigned.statusCode).toBe(200);
    expect(assigned.json().assigneeName).toBe("assign-patch-performer");

    const cleared = await app.inject({
      method: "PATCH",
      url: `/api/v1/tasks/${taskId}`,
      headers: seeded.headers,
      payload: { assigneeParticipantId: null },
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().assigneeParticipantId).toBeNull();
    expect(cleared.json().assigneeName).toBeNull();

    const [row] = await harness.db
      .select({ assigneeParticipantId: schema.tasks.assigneeParticipantId })
      .from(schema.tasks)
      .where(eq(schema.tasks.id, taskId));
    expect(row?.assigneeParticipantId).toBeNull();
  });

  it("refuses a participant of ANOTHER event, and writes nothing", async () => {
    const here = await seedEventWithPerformer("assign-elsewhere-here");
    const elsewhere = await seedEventWithPerformer("assign-elsewhere-there");

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/tasks",
      headers: here.headers,
      payload: {
        title: "Not theirs to do",
        eventId: here.event.id,
        assigneeParticipantId: elsewhere.performerParticipant.id,
      },
    });
    expect(created.statusCode).toBe(404);
    expect(created.json().error.message).toContain("not on this event");

    // The refusal is a refusal: no task row was written on the way to it.
    const rows = await harness.db
      .select({ id: schema.tasks.id })
      .from(schema.tasks)
      .where(eq(schema.tasks.eventId, here.event.id));
    expect(rows).toHaveLength(0);

    // Same rule on the way in through PATCH, on a task that already exists.
    const own = await app.inject({
      method: "POST",
      url: "/api/v1/tasks",
      headers: here.headers,
      payload: { title: "Mine", eventId: here.event.id },
    });
    const patched = await app.inject({
      method: "PATCH",
      url: `/api/v1/tasks/${own.json().id}`,
      headers: here.headers,
      payload: { assigneeParticipantId: elsewhere.performerParticipant.id },
    });
    expect(patched.statusCode).toBe(404);
    const [after] = await harness.db
      .select({ assigneeParticipantId: schema.tasks.assigneeParticipantId })
      .from(schema.tasks)
      .where(eq(schema.tasks.id, own.json().id));
    expect(after?.assigneeParticipantId).toBeNull();
  });

  it("refuses a participant who has been removed from the event", async () => {
    const seeded = await seedEventWithPerformer("assign-removed");
    await harness.db
      .update(schema.eventParticipants)
      .set({ status: "removed" })
      .where(eq(schema.eventParticipants.id, seeded.performerParticipant.id));

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/tasks",
      headers: seeded.headers,
      payload: {
        title: "Off the show",
        eventId: seeded.event.id,
        assigneeParticipantId: seeded.performerParticipant.id,
      },
    });
    expect(created.statusCode).toBe(404);
  });

  it("refuses an assignee on a task with no event — a personal list has no participants", async () => {
    const seeded = await seedEventWithPerformer("assign-personal");

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/tasks",
      headers: seeded.headers,
      payload: { title: "Buy strings", assigneeParticipantId: seeded.performerParticipant.id },
    });
    expect(created.statusCode).toBe(400);
    expect(created.json().error.message).toContain("Only a task on an event");
  });
});
