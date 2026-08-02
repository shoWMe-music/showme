import { schema } from "@showme/db";
import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TokenVerifier } from "./auth/token-verifier";
import { calendarRoutes } from "./routes/calendar";
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
  app = buildTestApp({ database: harness.db, tokenVerifier: fakeVerifier }, [calendarRoutes]);
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

describe("calendar — owner-scoped CRUD", () => {
  it("creates a personal item and lists it, filtered by date range", async () => {
    await seedUserWithProfile("c-personal");

    const june = await app.inject({
      method: "POST",
      url: "/api/v1/calendar",
      headers: auth("c-personal"),
      payload: { type: "appointment", title: "Soundcheck", date: "2026-06-15", startTime: "17:00" },
    });
    expect(june.statusCode).toBe(201);
    expect(june.json().ownerUserId).toBe("c-personal");
    expect(june.json().type).toBe("appointment");

    const august = await app.inject({
      method: "POST",
      url: "/api/v1/calendar",
      headers: auth("c-personal"),
      payload: { type: "note", title: "Tour prep", date: "2026-08-20" },
    });
    expect(august.statusCode).toBe(201);

    // Full list has both.
    const all = await app.inject({
      method: "GET",
      url: "/api/v1/calendar",
      headers: auth("c-personal"),
    });
    expect(all.statusCode).toBe(200);
    expect(all.json()).toHaveLength(2);

    // Range excludes the August item.
    const ranged = await app.inject({
      method: "GET",
      url: "/api/v1/calendar?from=2026-06-01&to=2026-06-30",
      headers: auth("c-personal"),
    });
    expect(ranged.statusCode).toBe(200);
    expect(ranged.json()).toHaveLength(1);
    expect(ranged.json()[0].title).toBe("Soundcheck");
  });

  it("creates a profile-scoped item but not for a foreign profile", async () => {
    const profileId = await seedUserWithProfile("c-owner");
    const foreignProfileId = await seedUserWithProfile("c-foreign");

    const ok = await app.inject({
      method: "POST",
      url: "/api/v1/calendar",
      headers: auth("c-owner"),
      payload: {
        type: "task",
        title: "Profile cal",
        date: "2026-09-01",
        ownerProfileId: profileId,
      },
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().ownerProfileId).toBe(profileId);
    expect(ok.json().ownerUserId).toBeNull();

    const denied = await app.inject({
      method: "POST",
      url: "/api/v1/calendar",
      headers: auth("c-owner"),
      payload: {
        type: "task",
        title: "Nope",
        date: "2026-09-01",
        ownerProfileId: foreignProfileId,
      },
    });
    expect([403, 404]).toContain(denied.statusCode);
  });

  it("updates and deletes within scope, auditing each mutation", async () => {
    await seedUserWithProfile("c-edit");
    await seedUserWithProfile("c-stranger");

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/calendar",
      headers: auth("c-edit"),
      payload: { type: "appointment", title: "Meet promoter", date: "2026-10-05" },
    });
    const itemId = created.json().id;

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/v1/calendar/${itemId}`,
      headers: auth("c-edit"),
      payload: { title: "Meet promoter (rescheduled)", date: "2026-10-06" },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().title).toBe("Meet promoter (rescheduled)");
    expect(patched.json().date).toBe("2026-10-06");

    // A stranger cannot reach it.
    const foreignPatch = await app.inject({
      method: "PATCH",
      url: `/api/v1/calendar/${itemId}`,
      headers: auth("c-stranger"),
      payload: { title: "Hijack" },
    });
    expect(foreignPatch.statusCode).toBe(404);

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/v1/calendar/${itemId}`,
      headers: auth("c-edit"),
    });
    expect(deleted.statusCode).toBe(200);

    const auditRows = await harness.db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, itemId));
    const actions = auditRows.map((row) => row.action);
    expect(actions).toContain("calendar.create");
    expect(actions).toContain("calendar.update");
    expect(actions).toContain("calendar.delete");
  });
});
