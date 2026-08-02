import { schema } from "@showme/db";
import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TokenVerifier } from "./auth/token-verifier";
import { adminRoutes } from "./routes/admin";
import { buildTestApp } from "./testing";

/** Fake verifier: the bearer token IS the uid (mirrors app.test.ts). */
const fakeVerifier: TokenVerifier = {
  async verify(token: string) {
    return { uid: token, email: `${token}@example.com`, name: token };
  },
};

let harness: TestDatabase;
let app: FastifyInstance;

beforeAll(async () => {
  harness = await startTestDatabase();
  app = buildTestApp({ database: harness.db, tokenVerifier: fakeVerifier }, [adminRoutes]);
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await harness?.stop();
});

const auth = (uid: string) => ({ authorization: `Bearer ${uid}` });

let seq = 0;

/** Seed a user, flagging platform-admin if asked. */
async function seedUser(kind: "operator" | "performer", isAdmin = false) {
  const id = `admin-${kind}-${isAdmin ? "root" : "user"}-${seq++}`;
  await harness.db.insert(schema.users).values({ id, email: `${id}@example.com`, kind, isAdmin });
  return id;
}

/** Seed a bare profile owned by `ownerUserId`. */
async function seedProfile(ownerUserId: string, kind: "operator" | "performer" = "operator") {
  const slug = `admin-profile-${seq++}`;
  const [profile] = await harness.db
    .insert(schema.profiles)
    .values({ kind, ownerUserId, name: slug, slug })
    .returning();
  if (!profile) throw new Error("profile seed failed");
  return profile.id;
}

describe("ADMIN routes — gated on principal.isAdmin", () => {
  it("lets an admin list all profiles, but forbids a normal user", async () => {
    const adminUser = await seedUser("operator", true);
    const normalUser = await seedUser("operator", false);
    await seedProfile(adminUser);
    await seedProfile(normalUser);

    const asAdmin = await app.inject({
      method: "GET",
      url: "/api/v1/admin/profiles",
      headers: auth(adminUser),
    });
    expect(asAdmin.statusCode).toBe(200);
    expect(asAdmin.json().items.length).toBeGreaterThanOrEqual(2);

    const asNormal = await app.inject({
      method: "GET",
      url: "/api/v1/admin/profiles",
      headers: auth(normalUser),
    });
    expect(asNormal.statusCode).toBe(403);
  });

  it("sets a profile's plan tier and writes an audit row", async () => {
    const adminUser = await seedUser("operator", true);
    const targetOwner = await seedUser("operator", false);
    const profileId = await seedProfile(targetOwner);

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/admin/plans/${profileId}`,
      headers: auth(adminUser),
      payload: { tier: "operator_pro" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      profileId,
      tier: "operator_pro",
      source: "manual",
      assignedBy: adminUser,
    });

    const [plan] = await harness.db
      .select()
      .from(schema.plans)
      .where(eq(schema.plans.profileId, profileId));
    expect(plan?.tier).toBe("operator_pro");
    expect(plan?.assignedBy).toBe(adminUser);

    const audit = await harness.db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, profileId));
    expect(audit.some((row) => row.action === "admin.plan.set")).toBe(true);
  });

  it("upserts the plan tier on a second set (no duplicate row)", async () => {
    const adminUser = await seedUser("operator", true);
    const targetOwner = await seedUser("operator", false);
    const profileId = await seedProfile(targetOwner);

    await app.inject({
      method: "POST",
      url: `/api/v1/admin/plans/${profileId}`,
      headers: auth(adminUser),
      payload: { tier: "free_operator" },
    });
    const second = await app.inject({
      method: "POST",
      url: `/api/v1/admin/plans/${profileId}`,
      headers: auth(adminUser),
      payload: { tier: "operator_pro" },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().tier).toBe("operator_pro");

    const plans = await harness.db
      .select()
      .from(schema.plans)
      .where(eq(schema.plans.profileId, profileId));
    expect(plans).toHaveLength(1);
  });

  it("forbids a normal user from setting a plan", async () => {
    const normalUser = await seedUser("operator", false);
    const targetOwner = await seedUser("operator", false);
    const profileId = await seedProfile(targetOwner);

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/admin/plans/${profileId}`,
      headers: auth(normalUser),
      payload: { tier: "operator_pro" },
    });
    expect(response.statusCode).toBe(403);
  });

  it("lists admin alerts unresolved-first for an admin; forbids a normal user", async () => {
    const adminUser = await seedUser("operator", true);
    const normalUser = await seedUser("operator", false);
    await harness.db.insert(schema.adminAlerts).values([
      { kind: "spam_threshold", subjectKey: "resolved-one", resolved: true },
      { kind: "expansion_threshold", subjectKey: "open-one", resolved: false },
    ]);

    const asAdmin = await app.inject({
      method: "GET",
      url: "/api/v1/admin/alerts",
      headers: auth(adminUser),
    });
    expect(asAdmin.statusCode).toBe(200);
    const alerts = asAdmin.json();
    expect(alerts.length).toBeGreaterThanOrEqual(2);
    // The first unresolved alert precedes the first resolved one.
    const firstUnresolved = alerts.findIndex((alert: { resolved: boolean }) => !alert.resolved);
    const firstResolved = alerts.findIndex((alert: { resolved: boolean }) => alert.resolved);
    expect(firstUnresolved).toBeLessThan(firstResolved);

    const asNormal = await app.inject({
      method: "GET",
      url: "/api/v1/admin/alerts",
      headers: auth(normalUser),
    });
    expect(asNormal.statusCode).toBe(403);
  });

  it("lists the audit log newest-first with an eventId filter; forbids a normal user", async () => {
    const adminUser = await seedUser("operator", true);
    const normalUser = await seedUser("operator", false);
    const owner = await seedUser("operator", false);
    const hostProfileId = await seedProfile(owner);
    const [event] = await harness.db
      .insert(schema.events)
      .values({
        hostProfileId,
        title: "Audit Night",
        baseCurrency: "SEK",
        createdBy: owner,
      })
      .returning();
    if (!event) throw new Error("event seed failed");

    await harness.db.insert(schema.auditLog).values([
      {
        action: "event.create",
        targetKind: "event",
        targetId: event.id,
        eventId: event.id,
        at: new Date("2026-01-01T10:00:00.000Z"),
      },
      {
        action: "event.update",
        targetKind: "event",
        targetId: event.id,
        eventId: event.id,
        at: new Date("2026-01-01T11:00:00.000Z"),
      },
    ]);

    const filtered = await app.inject({
      method: "GET",
      url: `/api/v1/admin/audit?eventId=${event.id}`,
      headers: auth(adminUser),
    });
    expect(filtered.statusCode).toBe(200);
    const rows = filtered.json().items;
    expect(rows.length).toBe(2);
    expect(rows.every((row: { eventId: string }) => row.eventId === event.id)).toBe(true);
    // Newest first: the second insert (event.update) leads.
    expect(rows[0].action).toBe("event.update");

    const unfiltered = await app.inject({
      method: "GET",
      url: "/api/v1/admin/audit",
      headers: auth(adminUser),
    });
    expect(unfiltered.statusCode).toBe(200);
    expect(unfiltered.json().items.length).toBeGreaterThanOrEqual(2);

    const asNormal = await app.inject({
      method: "GET",
      url: "/api/v1/admin/audit",
      headers: auth(normalUser),
    });
    expect(asNormal.statusCode).toBe(403);
  });
});
