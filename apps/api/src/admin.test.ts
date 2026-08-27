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
    return { uid: token, email: `${token}@example.showme.test`, name: token };
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
  await harness.db
    .insert(schema.users)
    .values({ id, email: `${id}@example.showme.test`, kind, isAdmin });
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

/**
 * PRO rates per territory (migration 0018).
 *
 * The rule these cover is not "an admin can write a row" — it is that **nobody
 * else can**, and that an unconfigured territory keeps saying so. The Budget
 * Planner turns a configured row into a quoted rate on a card an operator commits
 * money against, so the write side is the only thing standing between a typo and
 * a number that looks like a tariff.
 */
describe("ADMIN routes — PRO rates per territory", () => {
  it("sets a territory's rate, reads it back, and writes an audit row", async () => {
    const adminUser = await seedUser("operator", true);

    const set = await app.inject({
      method: "PUT",
      url: "/api/v1/admin/performing-rights-rates/SE",
      headers: auth(adminUser),
      payload: {
        proCode: "stim",
        proName: "STIM",
        rateBasisPoints: 750,
        sourceUrl: "https://www.stim.se/en/tariffs",
        sourceNote: "Live concert tariff, 2026",
      },
    });
    expect(set.statusCode).toBe(200);
    expect(set.json()).toMatchObject({
      country: "SE",
      proCode: "stim",
      proName: "STIM",
      rateBasisPoints: 750,
      sourceNote: "Live concert tariff, 2026",
      updatedBy: adminUser,
    });

    const list = await app.inject({
      method: "GET",
      url: "/api/v1/admin/performing-rights-rates",
      headers: auth(adminUser),
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toEqual(
      expect.arrayContaining([expect.objectContaining({ country: "SE", rateBasisPoints: 750 })]),
    );

    const [audit] = await harness.db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "admin.performing_rights_rate.set"));
    expect(audit?.targetKind).toBe("performing_rights_rate");
    expect(audit?.actorUserId).toBe(adminUser);
    // Platform admin has no capability — recording one would log a check that was
    // never made (`lib/audit.ts`).
    expect(audit?.capability).toBeNull();
  });

  /** A re-set overwrites in place and the trail carries what the rate WAS. */
  it("replaces an existing rate and keeps the previous one in the audit trail", async () => {
    const adminUser = await seedUser("operator", true);
    const body = { proCode: "gema", proName: "GEMA", rateBasisPoints: 800 };

    await app.inject({
      method: "PUT",
      url: "/api/v1/admin/performing-rights-rates/DE",
      headers: auth(adminUser),
      payload: body,
    });
    const second = await app.inject({
      method: "PUT",
      url: "/api/v1/admin/performing-rights-rates/DE",
      headers: auth(adminUser),
      payload: { ...body, rateBasisPoints: 900 },
    });
    expect(second.json().rateBasisPoints).toBe(900);

    const rows = await harness.db
      .select()
      .from(schema.performingRightsRates)
      .where(eq(schema.performingRightsRates.country, "DE"));
    expect(rows.length).toBe(1);

    const trail = await harness.db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "admin.performing_rights_rate.set"));
    const german = trail.filter(
      (row) => (row.changes as { after?: { country?: string } })?.after?.country === "DE",
    );
    const replacement = german.find(
      (row) =>
        (row.changes as { after?: { rateBasisPoints?: number } })?.after?.rateBasisPoints === 900,
    );
    expect(
      (replacement?.changes as { before?: { rateBasisPoints?: number } })?.before?.rateBasisPoints,
    ).toBe(800);
  });

  /**
   * `se` and `SE` are one territory. The resolver matches on the normalized form,
   * so a row stored any other way would sit in the admin list looking configured
   * while governing no event at all — the quietest failure this feature has.
   */
  it("normalizes the country code on the way in", async () => {
    const adminUser = await seedUser("operator", true);

    const response = await app.inject({
      method: "PUT",
      url: "/api/v1/admin/performing-rights-rates/no",
      headers: auth(adminUser),
      payload: { proName: "TONO", rateBasisPoints: 700 },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ country: "NO", proCode: "none" });
  });

  it("refuses a country code that is not a country", async () => {
    const adminUser = await seedUser("operator", true);

    const response = await app.inject({
      method: "PUT",
      url: "/api/v1/admin/performing-rights-rates/ATLANTIS",
      headers: auth(adminUser),
      payload: { proName: "Nobody", rateBasisPoints: 700 },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain("alpha-2");
  });

  /**
   * A rate is basis points, never a percentage. `7.5` typed where `750` was meant
   * charges a show 0.075%; the fraction is refused at the edge so it can never
   * reach the column.
   */
  it("refuses a rate outside 0..10 000 basis points, and any fraction of one", async () => {
    const adminUser = await seedUser("operator", true);
    const attempt = (rateBasisPoints: number) =>
      app.inject({
        method: "PUT",
        url: "/api/v1/admin/performing-rights-rates/FI",
        headers: auth(adminUser),
        payload: { proName: "Teosto", rateBasisPoints },
      });

    expect((await attempt(10_001)).statusCode).toBe(400);
    expect((await attempt(-1)).statusCode).toBe(400);
    expect((await attempt(7.5)).statusCode).toBe(400);
    expect((await attempt(0)).statusCode).toBe(200); // a real, configured zero
  });

  it("deletes a rate and audits the removal", async () => {
    const adminUser = await seedUser("operator", true);
    await app.inject({
      method: "PUT",
      url: "/api/v1/admin/performing-rights-rates/DK",
      headers: auth(adminUser),
      payload: { proName: "Koda", rateBasisPoints: 650 },
    });

    const removed = await app.inject({
      method: "DELETE",
      url: "/api/v1/admin/performing-rights-rates/dk",
      headers: auth(adminUser),
    });
    expect(removed.statusCode).toBe(204);

    const rows = await harness.db
      .select()
      .from(schema.performingRightsRates)
      .where(eq(schema.performingRightsRates.country, "DK"));
    expect(rows.length).toBe(0);

    const missing = await app.inject({
      method: "DELETE",
      url: "/api/v1/admin/performing-rights-rates/DK",
      headers: auth(adminUser),
    });
    expect(missing.statusCode).toBe(404);

    const [audit] = await harness.db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "admin.performing_rights_rate.delete"));
    expect((audit?.changes as { before?: { country?: string } })?.before?.country).toBe("DK");
  });

  /** The gate. A normal user may neither read the table nor write to it. */
  it("forbids a non-admin on every route, and writes nothing", async () => {
    const normalUser = await seedUser("operator", false);

    const list = await app.inject({
      method: "GET",
      url: "/api/v1/admin/performing-rights-rates",
      headers: auth(normalUser),
    });
    expect(list.statusCode).toBe(403);

    const write = await app.inject({
      method: "PUT",
      url: "/api/v1/admin/performing-rights-rates/GB",
      headers: auth(normalUser),
      payload: { proCode: "prs", proName: "PRS for Music", rateBasisPoints: 900 },
    });
    expect(write.statusCode).toBe(403);

    const remove = await app.inject({
      method: "DELETE",
      url: "/api/v1/admin/performing-rights-rates/GB",
      headers: auth(normalUser),
    });
    expect(remove.statusCode).toBe(403);

    const rows = await harness.db
      .select()
      .from(schema.performingRightsRates)
      .where(eq(schema.performingRightsRates.country, "GB"));
    expect(rows.length).toBe(0);
  });
});
