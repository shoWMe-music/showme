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
    return { uid: token, email: `${token}@example.com`, name: token };
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
  await db.insert(schema.users).values({ id, email: `${id}@example.com`, kind: "operator" });
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
