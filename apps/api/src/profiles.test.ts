import { schema } from "@showme/db";
import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TokenVerifier } from "./auth/token-verifier";
import { profileRoutes } from "./routes/profiles";
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
  app = buildTestApp({ database: harness.db, tokenVerifier: fakeVerifier }, [profileRoutes]);
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await harness?.stop();
});

const auth = (uid: string) => ({ authorization: `Bearer ${uid}` });

type Kind = "operator" | "performer" | "professional" | "agent";

/** Seed a bare provisioned user (no memberships). */
async function seedUser(id: string, kind: Kind) {
  await harness.db.insert(schema.users).values({ id, email: `${id}@example.com`, kind });
}

/**
 * Seed a user + a profile they own + their active `owner` membership. Returns the
 * ids the tests reach for (profile, owner user, owner membership row).
 */
async function seedProfileOwner(prefix: string, kind: Kind) {
  const { db } = harness;
  const ownerId = `${prefix}-owner`;
  await seedUser(ownerId, kind);
  const [profile] = await db
    .insert(schema.profiles)
    .values({ kind, ownerUserId: ownerId, name: prefix, slug: prefix })
    .returning();
  if (!profile) throw new Error("profile seed failed");
  const [member] = await db
    .insert(schema.profileMembers)
    .values({ profileId: profile.id, userId: ownerId, role: "owner", status: "active" })
    .returning();
  if (!member) throw new Error("owner member seed failed");
  return { profileId: profile.id, ownerId, ownerMemberId: member.id };
}

/** Add an active member of a given role to a profile, seeding the user first. */
async function seedMember(profileId: string, userId: string, kind: Kind, role: string) {
  await seedUser(userId, kind);
  await harness.db
    .insert(schema.profileMembers)
    .values({ profileId, userId, role: role as "viewer", status: "active" });
}

describe("profiles — authorize + serialize + audit", () => {
  it("creates a profile with an owner membership and an audit row", async () => {
    const { db } = harness;
    await seedUser("create-op", "operator");

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/profiles",
      headers: auth("create-op"),
      payload: { kind: "operator", name: "Venue One", slug: "create-op-venue" },
    });
    expect(created.statusCode).toBe(201);
    const profileId = created.json().id;
    expect(created.json().name).toBe("Venue One");

    const members = await db
      .select()
      .from(schema.profileMembers)
      .where(eq(schema.profileMembers.profileId, profileId));
    expect(members).toHaveLength(1);
    expect(members[0]?.role).toBe("owner");
    expect(members[0]?.userId).toBe("create-op");

    const audit = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, profileId));
    expect(audit).toHaveLength(1);
    expect(audit[0]?.action).toBe("profile.create");
    expect(audit[0]?.actorUserId).toBe("create-op");
  });

  it("rejects a profile whose kind differs from the user's kind", async () => {
    await seedUser("mismatch-perf", "performer");
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/profiles",
      headers: auth("mismatch-perf"),
      payload: { kind: "operator", name: "Wrong Kind", slug: "mismatch-wrong" },
    });
    expect(response.statusCode).toBe(400);
  });

  it("404s a GET from a non-member (no existence leak)", async () => {
    const { profileId } = await seedProfileOwner("leak", "operator");
    await seedUser("leak-stranger", "operator");

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/profiles/${profileId}`,
      headers: auth("leak-stranger"),
    });
    expect(response.statusCode).toBe(404);
  });

  it("403s a PATCH from a viewer member", async () => {
    const { profileId } = await seedProfileOwner("view", "operator");
    await seedMember(profileId, "view-viewer", "operator", "viewer");

    const response = await app.inject({
      method: "PATCH",
      url: `/api/v1/profiles/${profileId}`,
      headers: auth("view-viewer"),
      payload: { name: "Renamed" },
    });
    expect(response.statusCode).toBe(403);
  });

  it("lets an owner add a member and 409s a duplicate", async () => {
    const { profileId, ownerId } = await seedProfileOwner("add", "operator");
    await seedUser("add-newmember", "operator");
    const payload = { userId: "add-newmember", role: "editor" as const };

    const first = await app.inject({
      method: "POST",
      url: `/api/v1/profiles/${profileId}/members`,
      headers: auth(ownerId),
      payload,
    });
    expect(first.statusCode).toBe(201);
    expect(first.json().role).toBe("editor");

    const second = await app.inject({
      method: "POST",
      url: `/api/v1/profiles/${profileId}/members`,
      headers: auth(ownerId),
      payload,
    });
    expect(second.statusCode).toBe(409);
  });

  it("refuses to demote the owner membership (403)", async () => {
    const { profileId, ownerId, ownerMemberId } = await seedProfileOwner("protect", "operator");

    const response = await app.inject({
      method: "PATCH",
      url: `/api/v1/profiles/${profileId}/members/${ownerMemberId}`,
      headers: auth(ownerId),
      payload: { role: "editor" },
    });
    expect(response.statusCode).toBe(403);
  });

  it("round-trips a full unavailability replace (PUT then GET)", async () => {
    const { profileId, ownerId } = await seedProfileOwner("avail", "performer");

    const put = await app.inject({
      method: "PUT",
      url: `/api/v1/profiles/${profileId}/unavailability`,
      headers: auth(ownerId),
      payload: {
        entries: [
          { startDate: "2026-08-01", endDate: "2026-08-05", reason: "tour" },
          { startDate: "2026-09-10", endDate: "2026-09-10" },
        ],
      },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toHaveLength(2);

    const list = await app.inject({
      method: "GET",
      url: `/api/v1/profiles/${profileId}/unavailability`,
      headers: auth(ownerId),
    });
    expect(list.statusCode).toBe(200);
    const dates = list
      .json()
      .map((row: { startDate: string }) => row.startDate)
      .sort();
    expect(dates).toEqual(["2026-08-01", "2026-09-10"]);
  });

  it("creates a template and reads it back", async () => {
    const { profileId, ownerId } = await seedProfileOwner("tmpl", "operator");

    const created = await app.inject({
      method: "POST",
      url: `/api/v1/profiles/${profileId}/templates`,
      headers: auth(ownerId),
      payload: { category: "rider", name: "Standard Rider", payload: { power: "3-phase" } },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().name).toBe("Standard Rider");

    const list = await app.inject({
      method: "GET",
      url: `/api/v1/profiles/${profileId}/templates`,
      headers: auth(ownerId),
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toHaveLength(1);
    expect(list.json()[0]?.category).toBe("rider");
    expect(list.json()[0]?.payload).toEqual({ power: "3-phase" });
  });
});

describe("profiles — grant_admin entitlement gate (decisions #12)", () => {
  it("blocks granting admin on a free plan, allows it on a paid plan", async () => {
    const { db } = harness;
    // Free operator (no plans row → free_operator).
    const free = await seedProfileOwner("ga-free", "operator");
    await seedUser("ga-free-m", "operator");
    const blocked = await app.inject({
      method: "POST",
      url: `/api/v1/profiles/${free.profileId}/members`,
      headers: auth(free.ownerId),
      payload: { userId: "ga-free-m", role: "admin" },
    });
    expect(blocked.statusCode).toBe(403);

    // Paid operator (operator_pro) → admin allowed, seat consumed.
    const paid = await seedProfileOwner("ga-paid", "operator");
    await db.insert(schema.plans).values({ profileId: paid.profileId, tier: "operator_pro" });
    await seedUser("ga-paid-m", "operator");
    const allowed = await app.inject({
      method: "POST",
      url: `/api/v1/profiles/${paid.profileId}/members`,
      headers: auth(paid.ownerId),
      payload: { userId: "ga-paid-m", role: "admin" },
    });
    expect(allowed.statusCode).toBe(201);
    expect(allowed.json().role).toBe("admin");
    const [row] = await db
      .select()
      .from(schema.profileMembers)
      .where(eq(schema.profileMembers.userId, "ga-paid-m"));
    expect(row?.seatConsumed).toBe(true);
  });

  it("does not gate adding a non-admin member on a free plan", async () => {
    const free = await seedProfileOwner("ga-editor", "operator");
    await seedUser("ga-editor-m", "operator");
    const editor = await app.inject({
      method: "POST",
      url: `/api/v1/profiles/${free.profileId}/members`,
      headers: auth(free.ownerId),
      payload: { userId: "ga-editor-m", role: "editor" },
    });
    expect(editor.statusCode).toBe(201);
  });

  it("gates PATCH promotion to admin by plan", async () => {
    const { db } = harness;
    const free = await seedProfileOwner("ga-promote", "operator");
    await seedMember(free.profileId, "ga-promote-m", "operator", "viewer");
    const [member] = await db
      .select()
      .from(schema.profileMembers)
      .where(eq(schema.profileMembers.userId, "ga-promote-m"));

    const blocked = await app.inject({
      method: "PATCH",
      url: `/api/v1/profiles/${free.profileId}/members/${member?.id}`,
      headers: auth(free.ownerId),
      payload: { role: "admin" },
    });
    expect(blocked.statusCode).toBe(403);

    await db.insert(schema.plans).values({ profileId: free.profileId, tier: "operator_pro" });
    const allowed = await app.inject({
      method: "PATCH",
      url: `/api/v1/profiles/${free.profileId}/members/${member?.id}`,
      headers: auth(free.ownerId),
      payload: { role: "admin" },
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json().role).toBe("admin");
  });
});
