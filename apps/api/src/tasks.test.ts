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
  it("creates a personal task and lists it", async () => {
    await seedUserWithProfile("t-personal");

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/tasks",
      headers: auth("t-personal"),
      payload: { title: "Call the venue", dueDate: "2026-08-01" },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().ownerUserId).toBe("t-personal");
    expect(created.json().ownerProfileId).toBeNull();
    const taskId = created.json().id;

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

/**
 * THE TO-DO LIST IS SHARED; THE MONEY ON IT IS NOT (QA sweep run 3, 2026-09-26).
 *
 * `GET /tasks?eventId=…` answered crew, both performers and the agent with
 * `budgetAmount: "1200000"` — the operator's own planning figure. No screen renders
 * it, which is why three sweeps of the app missed it and only a look at the wire
 * found it. The same door was open from the write side: anybody who could reach the
 * task could change the figure too.
 */
describe("tasks — a task's budget is the operator's, not the event's", () => {
  async function seedEventWithPerformer(prefix: string) {
    const { db } = harness;
    const hostProfileId = await seedUserWithProfile(`${prefix}-host`);
    const performerProfileId = await seedUserWithProfile(`${prefix}-perf`);
    const [hostSet] = await db
      .insert(schema.permissionSets)
      .values({
        profileId: hostProfileId,
        name: "operator_full",
        capabilities: [...PRESET_PERMISSION_SETS.operator_full],
      })
      .returning();
    const [performerSet] = await db
      .insert(schema.permissionSets)
      .values({
        profileId: performerProfileId,
        name: "performer",
        capabilities: [...PRESET_PERMISSION_SETS.performer],
      })
      .returning();
    const [event] = await db
      .insert(schema.events)
      .values({
        hostProfileId,
        title: "Album Release",
        baseCurrency: "SEK",
        createdBy: `${prefix}-host`,
      })
      .returning();
    if (!event) throw new Error("event seed failed");
    await db.insert(schema.eventParticipants).values([
      {
        eventId: event.id,
        profileId: hostProfileId,
        role: "host",
        permissionSetId: hostSet?.id,
        status: "confirmed",
      },
      {
        eventId: event.id,
        profileId: performerProfileId,
        role: "performer",
        permissionSetId: performerSet?.id,
        status: "confirmed",
      },
    ]);

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/tasks",
      headers: { ...auth(`${prefix}-host`), "x-profile-id": hostProfileId },
      payload: {
        title: "Backline hire",
        eventId: event.id,
        budgetType: "cost",
        budgetAmount: "1200000",
      },
    });
    expect(created.statusCode).toBe(201);
    return { event, hostProfileId, performerProfileId, taskId: created.json().id as string };
  }

  const listAs = (eventId: string, uid: string, profileId: string) =>
    app.inject({
      method: "GET",
      url: `/api/v1/tasks?eventId=${eventId}`,
      headers: { ...auth(uid), "x-profile-id": profileId },
    });

  it("shows the task to a performer and withholds its figure", async () => {
    const seeded = await seedEventWithPerformer("taskmoney");

    const asPerformer = await listAs(seeded.event.id, "taskmoney-perf", seeded.performerProfileId);
    expect(asPerformer.statusCode).toBe(200);
    const [seen] = asPerformer.json().items;
    // The job itself is the point of a shared list.
    expect(seen.title).toBe("Backline hire");
    // Its money is not.
    expect(seen.budgetAmount).toBeNull();
    expect(seen.budgetType).toBeNull();

    // The operator reads their own figure, same route, same task.
    const asHost = await listAs(seeded.event.id, "taskmoney-host", seeded.hostProfileId);
    const [mine] = asHost.json().items;
    expect(mine.budgetAmount).toBe("1200000");
    expect(mine.budgetType).toBe("cost");
  });

  it("refuses a performer moving the figure, and still lets them tick the job off", async () => {
    const seeded = await seedEventWithPerformer("taskwrite");

    const moved = await app.inject({
      method: "PATCH",
      url: `/api/v1/tasks/${seeded.taskId}`,
      headers: { ...auth("taskwrite-perf"), "x-profile-id": seeded.performerProfileId },
      payload: { budgetAmount: "1" },
    });
    expect(moved.statusCode).toBe(403);

    // …and the shared list still works for them, which is the thing being protected.
    const ticked = await app.inject({
      method: "PATCH",
      url: `/api/v1/tasks/${seeded.taskId}`,
      headers: { ...auth("taskwrite-perf"), "x-profile-id": seeded.performerProfileId },
      payload: { completed: true },
    });
    expect(ticked.statusCode).toBe(200);
    expect(ticked.json().completed).toBe(true);
    // The echo from their own successful write withholds the figure too.
    expect(ticked.json().budgetAmount).toBeNull();
  });
});

describe("tasks — priority (ClickUp 123qy9rnk29)", () => {
  /**
   * Ran: *"Let's add priority tags to tasks: Urgent, High, Normal, Low."*
   *
   * The state worth pinning is the THIRD one he did not name: a task with no tag
   * at all. Every task written before this column existed is untagged, and most
   * will stay that way, so `null` has to be a first-class answer rather than a
   * gap that reads as `normal`.
   */
  it("creates a task with a priority, and without one", async () => {
    await seedUserWithProfile("t-prio");

    const tagged = await app.inject({
      method: "POST",
      url: "/api/v1/tasks",
      headers: auth("t-prio"),
      payload: { title: "Chase the rider", priority: "urgent" },
    });
    expect(tagged.statusCode).toBe(201);
    expect(tagged.json().priority).toBe("urgent");

    // No priority in the body is UNTAGGED, not "normal". Defaulting here would
    // claim somebody had judged this task ordinary.
    const untagged = await app.inject({
      method: "POST",
      url: "/api/v1/tasks",
      headers: auth("t-prio"),
      payload: { title: "Something nobody has triaged" },
    });
    expect(untagged.statusCode).toBe(201);
    expect(untagged.json().priority).toBeNull();
  });

  it("takes all four of Ran's words and refuses anything else", async () => {
    await seedUserWithProfile("t-prio-words");
    for (const priority of ["urgent", "high", "normal", "low"]) {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/tasks",
        headers: auth("t-prio-words"),
        payload: { title: `A ${priority} job`, priority },
      });
      expect(response.statusCode, priority).toBe(201);
      expect(response.json().priority).toBe(priority);
    }

    // An enum, not a free string — so "Urgent" and "urgent" cannot coexist and
    // sort apart.
    const rejected = await app.inject({
      method: "POST",
      url: "/api/v1/tasks",
      headers: auth("t-prio-words"),
      payload: { title: "Shouting", priority: "URGENT" },
    });
    expect(rejected.statusCode).toBe(400);
  });

  it("changes a tag, and takes one off with null — but leaves it alone when unmentioned", async () => {
    await seedUserWithProfile("t-prio-patch");
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/tasks",
      headers: auth("t-prio-patch"),
      payload: { title: "Book the van", priority: "low" },
    });
    const taskId = created.json().id;
    const patch = (payload: Record<string, unknown>) =>
      app.inject({
        method: "PATCH",
        url: `/api/v1/tasks/${taskId}`,
        headers: auth("t-prio-patch"),
        payload,
      });

    expect((await patch({ priority: "high" })).json().priority).toBe("high");

    // THE ONE THAT MATTERS: a PATCH about something else must not untag the task.
    // `undefined` leaves it alone, `null` removes it — the same three-state
    // convention `assigneeParticipantId` and `remindAt` already use here.
    expect((await patch({ title: "Book the van (9am)" })).json().priority).toBe("high");
    expect((await patch({ priority: null })).json().priority).toBeNull();
  });
});

describe("tasks — ranked by priority (ClickUp 123qy9rnk27)", () => {
  /**
   * The Dashboard asks for *"the top 5 tasks by priority and by time/date"*. That
   * has to be answered by the DATABASE: sorting in the browser would rank only
   * the page already loaded, so an urgent task at position 40 would never reach
   * the top five — which is the entire point of the card.
   */
  it("ranks urgent first, untagged last, and breaks ties on the due date", async () => {
    await seedUserWithProfile("t-rank");
    const add = (title: string, priority: string | null, dueDate?: string) =>
      app.inject({
        method: "POST",
        url: "/api/v1/tasks",
        headers: auth("t-rank"),
        payload: {
          title,
          ...(priority ? { priority } : {}),
          ...(dueDate ? { dueDate } : {}),
        },
      });

    // Inserted in a deliberately unhelpful order: creation order is the DEFAULT
    // ordering, so if the ranking silently failed the assertion below would read
    // back exactly this sequence.
    await add("untagged", null);
    await add("low", "low");
    await add("urgent later", "urgent", "2026-12-01");
    await add("normal", "normal");
    await add("urgent sooner", "urgent", "2026-06-01");
    await add("high", "high");

    const ranked = await app.inject({
      method: "GET",
      url: "/api/v1/tasks?order=priority&limit=10",
      headers: auth("t-rank"),
    });
    expect(ranked.statusCode).toBe(200);
    expect((ranked.json().items as { title: string }[]).map((task) => task.title)).toEqual([
      "urgent sooner",
      "urgent later",
      "high",
      "normal",
      "low",
      "untagged",
    ]);
  });

  it("still defaults to creation order, so paging is unchanged", async () => {
    await seedUserWithProfile("t-rank-default");
    await app.inject({
      method: "POST",
      url: "/api/v1/tasks",
      headers: auth("t-rank-default"),
      payload: { title: "first, untagged" },
    });
    await app.inject({
      method: "POST",
      url: "/api/v1/tasks",
      headers: auth("t-rank-default"),
      payload: { title: "second, urgent", priority: "urgent" },
    });

    const list = await app.inject({
      method: "GET",
      url: "/api/v1/tasks",
      headers: auth("t-rank-default"),
    });
    // The urgent one is SECOND here. Changing the default order would have
    // re-ordered every existing caller's list without asking.
    expect((list.json().items as { title: string }[]).map((task) => task.title)).toEqual([
      "first, untagged",
      "second, urgent",
    ]);
  });

  it("returns NO cursor when ranked, rather than one that would skip rows", async () => {
    await seedUserWithProfile("t-rank-cursor");
    for (const title of ["a", "b", "c"]) {
      await app.inject({
        method: "POST",
        url: "/api/v1/tasks",
        headers: auth("t-rank-cursor"),
        payload: { title },
      });
    }

    // Asked for fewer than exist: the default order hands back a cursor to walk,
    // the ranked order deliberately does not. A `created_at` cursor under a
    // priority ordering would page by one rule and filter by another — rows
    // missed, rows repeated, nothing to tell them apart.
    const paged = await app.inject({
      method: "GET",
      url: "/api/v1/tasks?limit=2",
      headers: auth("t-rank-cursor"),
    });
    expect(paged.json().nextCursor).not.toBeNull();

    const ranked = await app.inject({
      method: "GET",
      url: "/api/v1/tasks?order=priority&limit=2",
      headers: auth("t-rank-cursor"),
    });
    expect(ranked.json().items).toHaveLength(2);
    expect(ranked.json().nextCursor).toBeNull();
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

  /** The `task.assigned` rows one user has been sent. */
  async function assignmentBells(userId: string) {
    return harness.db
      .select({ body: schema.notifications.body, link: schema.notifications.link })
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, userId));
  }

  /**
   * BEING HANDED A JOB (ClickUp `123qy9rnk3k`).
   *
   * Ran asked for an email on task notifications; the finding was that there was
   * no task notification at all to add one to — `POST /tasks` wrote an audit row
   * and an event-history line and told the assignee nothing. Every assertion here
   * fails silently if it breaks: the task is still created, still assigned, still
   * correct, and the person who owes the work simply never hears.
   */
  it("tells the assignee they were handed the job", async () => {
    const seeded = await seedEventWithPerformer("assign-bell");

    await app.inject({
      method: "POST",
      url: "/api/v1/tasks",
      headers: seeded.headers,
      payload: {
        title: "Chase the backline",
        eventId: seeded.event.id,
        assigneeParticipantId: seeded.performerParticipant.id,
        dueDate: "2026-08-01",
      },
    });

    const bells = await assignmentBells("assign-bell-performer");
    expect(bells).toHaveLength(1);
    // The TITLE travels — a bell saying only "a task" costs a trip to find out
    // what — and so does the due date.
    expect(bells[0]?.body).toContain("Chase the backline");
    expect(bells[0]?.body).toContain("2026-08-01");
    expect(bells[0]?.link).toBe(`/events/${seeded.event.id}`);
  });

  /**
   * A to-do is one party's slice of the show. Telling the whole bill that the
   * promoter is behind on the rider is the line story.md draws, and the reminder
   * sweep's recipient rule draws it the same way.
   */
  it("tells NOBODY else on the bill", async () => {
    const seeded = await seedEventWithPerformer("assign-private");

    await app.inject({
      method: "POST",
      url: "/api/v1/tasks",
      headers: seeded.headers,
      payload: {
        title: "Chase the backline",
        eventId: seeded.event.id,
        assigneeParticipantId: seeded.performerParticipant.id,
      },
    });

    expect(await assignmentBells("assign-private-performer")).toHaveLength(1);
    // The host did the assigning; `notifyUsers` drops the actor.
    expect(await assignmentBells("assign-private-host")).toHaveLength(0);
  });

  it("rings when a task is handed over in a PATCH, not only at create", async () => {
    const seeded = await seedEventWithPerformer("assign-handover");
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/tasks",
      headers: seeded.headers,
      payload: { title: "Book the van", eventId: seeded.event.id },
    });
    expect(await assignmentBells("assign-handover-performer")).toHaveLength(0);

    await app.inject({
      method: "PATCH",
      url: `/api/v1/tasks/${created.json().id}`,
      headers: seeded.headers,
      payload: { assigneeParticipantId: seeded.performerParticipant.id },
    });

    expect(await assignmentBells("assign-handover-performer")).toHaveLength(1);
  });

  /**
   * The one that stops the feature becoming noise. Editing a task that is already
   * somebody's must not re-ring it, and a PATCH that re-states the same assignee
   * is the shape a form save takes.
   */
  it("does not ring again when the assignee has not changed", async () => {
    const seeded = await seedEventWithPerformer("assign-again");
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/tasks",
      headers: seeded.headers,
      payload: {
        title: "Book the van",
        eventId: seeded.event.id,
        assigneeParticipantId: seeded.performerParticipant.id,
      },
    });
    expect(await assignmentBells("assign-again-performer")).toHaveLength(1);

    await app.inject({
      method: "PATCH",
      url: `/api/v1/tasks/${created.json().id}`,
      headers: seeded.headers,
      payload: { title: "Book the van (9am)" },
    });
    await app.inject({
      method: "PATCH",
      url: `/api/v1/tasks/${created.json().id}`,
      headers: seeded.headers,
      payload: { assigneeParticipantId: seeded.performerParticipant.id },
    });

    expect(await assignmentBells("assign-again-performer")).toHaveLength(1);
  });

  /** "You no longer owe this" is not news somebody needs sent to them. */
  it("says nothing when a task is unassigned", async () => {
    const seeded = await seedEventWithPerformer("assign-off");
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/tasks",
      headers: seeded.headers,
      payload: {
        title: "Book the van",
        eventId: seeded.event.id,
        assigneeParticipantId: seeded.performerParticipant.id,
      },
    });

    await app.inject({
      method: "PATCH",
      url: `/api/v1/tasks/${created.json().id}`,
      headers: seeded.headers,
      payload: { assigneeParticipantId: null },
    });

    expect(await assignmentBells("assign-off-performer")).toHaveLength(1);
  });

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

describe("tasks — the reminder", () => {
  it("stores remind_at as the instant it was sent, and returns it unfired", async () => {
    await seedUserWithProfile("t-remind");

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/tasks",
      headers: auth("t-remind"),
      payload: { title: "Ring the promoter", remindAt: "2026-09-01T07:00:00.000Z" },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().remindAt).toBe("2026-09-01T07:00:00.000Z");
    // Nothing has fired it yet — that is the sweep's job, in `apps/jobs`.
    expect(created.json().remindedAt).toBeNull();

    // The state, not just the response: the column holds the same instant.
    const [row] = await harness.db
      .select({ remindAt: schema.tasks.remindAt, remindedAt: schema.tasks.remindedAt })
      .from(schema.tasks)
      .where(eq(schema.tasks.id, created.json().id));
    expect(row?.remindAt?.toISOString()).toBe("2026-09-01T07:00:00.000Z");
    expect(row?.remindedAt).toBeNull();
  });

  it("refuses a reminder that is not an instant", async () => {
    await seedUserWithProfile("t-remind-shape");

    // A bare calendar day is exactly the thing `remind_at` exists NOT to be: it
    // names no clock and no zone, so there is no moment to fire at.
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/tasks",
      headers: auth("t-remind-shape"),
      payload: { title: "Vague", remindAt: "2026-09-01" },
    });
    expect(created.statusCode).toBe(400);
  });

  it("RE-ARMS a fired reminder when a new instant is set, and disarms it on null", async () => {
    await seedUserWithProfile("t-remind-rearm");

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/tasks",
      headers: auth("t-remind-rearm"),
      payload: { title: "Snooze me", remindAt: "2026-09-01T07:00:00.000Z" },
    });
    const taskId = created.json().id;

    // Stand in for the sweep having already rung this one.
    await harness.db
      .update(schema.tasks)
      .set({ remindedAt: new Date("2026-09-01T07:00:30.000Z") })
      .where(eq(schema.tasks.id, taskId));

    const moved = await app.inject({
      method: "PATCH",
      url: `/api/v1/tasks/${taskId}`,
      headers: auth("t-remind-rearm"),
      payload: { remindAt: "2026-09-02T07:00:00.000Z" },
    });
    expect(moved.statusCode).toBe(200);
    expect(moved.json().remindAt).toBe("2026-09-02T07:00:00.000Z");
    // The whole point: the fire-once mark must not outlive the reminder it was
    // about, or "remind me again tomorrow" is stored and silently never rung.
    expect(moved.json().remindedAt).toBeNull();

    const cleared = await app.inject({
      method: "PATCH",
      url: `/api/v1/tasks/${taskId}`,
      headers: auth("t-remind-rearm"),
      payload: { remindAt: null },
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().remindAt).toBeNull();

    const [row] = await harness.db
      .select({ remindAt: schema.tasks.remindAt, remindedAt: schema.tasks.remindedAt })
      .from(schema.tasks)
      .where(eq(schema.tasks.id, taskId));
    expect(row?.remindAt).toBeNull();
    expect(row?.remindedAt).toBeNull();
  });

  it("leaves an untouched reminder alone when other fields are patched", async () => {
    await seedUserWithProfile("t-remind-untouched");

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/tasks",
      headers: auth("t-remind-untouched"),
      payload: { title: "Keep it", remindAt: "2026-09-01T07:00:00.000Z" },
    });
    const taskId = created.json().id;
    await harness.db
      .update(schema.tasks)
      .set({ remindedAt: new Date("2026-09-01T07:00:30.000Z") })
      .where(eq(schema.tasks.id, taskId));

    const renamed = await app.inject({
      method: "PATCH",
      url: `/api/v1/tasks/${taskId}`,
      headers: auth("t-remind-untouched"),
      payload: { title: "Keep it, renamed" },
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().remindAt).toBe("2026-09-01T07:00:00.000Z");
    // An omitted `remindAt` is not a re-arm — otherwise ticking a task's title
    // would make an already-rung bell ring again.
    expect(renamed.json().remindedAt).toBe("2026-09-01T07:00:30.000Z");
  });
});
