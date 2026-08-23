import { PRESET_PERMISSION_SETS } from "@showme/auth";
import { schema } from "@showme/db";
import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TokenVerifier } from "./auth/token-verifier";
import { budgetRoutes } from "./routes/budget";
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
  app = buildTestApp({ database: harness.db, tokenVerifier: fakeVerifier }, [budgetRoutes]);
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
  await db.insert(schema.users).values({ id, email: `${id}@example.com`, kind });
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

/**
 * Seed an operator-hosted event with the operator as `host` (holding
 * operator_full) and a performer participant. Returns the ids the tests need.
 */
async function seedEvent(prefix: string) {
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
      title: `${prefix} event`,
      baseCurrency: "SEK",
      createdBy: `${prefix}-op`,
    })
    .returning();
  if (!event) throw new Error("event seed failed");
  await db.insert(schema.eventParticipants).values([
    {
      eventId: event.id,
      profileId: operator.profileId,
      role: "host",
      permissionSetId: operator.permissionSetId,
      status: "confirmed",
    },
    {
      eventId: event.id,
      profileId: performer.profileId,
      role: "performer",
      permissionSetId: performer.permissionSetId,
      status: "confirmed",
    },
  ]);
  return {
    eventId: event.id,
    operatorUid: `${prefix}-op`,
    operatorProfileId: operator.profileId,
    performerUid: `${prefix}-perf`,
  };
}

/**
 * Add a SECOND operator to the event as `co_host` holding the full operator set —
 * the co-promoter from PLAN.md:215 who shares the event's budget but must never
 * see the other promoter's private one.
 */
async function seedCoHost(prefix: string, eventId: string) {
  const { db } = harness;
  const coHost = await seedMemberWithSet(
    `${prefix}-co`,
    "operator",
    PRESET_PERMISSION_SETS.operator_full,
  );
  await db.insert(schema.eventParticipants).values({
    eventId,
    profileId: coHost.profileId,
    role: "co_host",
    permissionSetId: coHost.permissionSetId,
    status: "confirmed",
  });
  return { coHostUid: `${prefix}-co`, coHostProfileId: coHost.profileId };
}

describe("budgets — authorize + money-as-string + audit", () => {
  it("lets an operator create a budget with revenue/cost lines and read them back as strings", async () => {
    const { db } = harness;
    const { eventId, operatorUid } = await seedEvent("bud");

    const createdBudget = await app.inject({
      method: "POST",
      url: `/api/v1/events/${eventId}/budgets`,
      headers: auth(operatorUid),
      payload: { scope: "shared" },
    });
    expect(createdBudget.statusCode).toBe(201);
    const budgetId = createdBudget.json().id;
    expect(createdBudget.json().version).toBe(1);
    expect(createdBudget.json().lines).toEqual([]);

    const revenue = await app.inject({
      method: "POST",
      url: `/api/v1/events/${eventId}/budgets/${budgetId}/lines`,
      headers: auth(operatorUid),
      payload: { kind: "revenue", label: "Ticket sales", amount: "1500000", currency: "SEK" },
    });
    expect(revenue.statusCode).toBe(201);
    expect(revenue.json().amount).toBe("1500000"); // STRING, never a number
    expect(typeof revenue.json().amount).toBe("string");

    const cost = await app.inject({
      method: "POST",
      url: `/api/v1/events/${eventId}/budgets/${budgetId}/lines`,
      headers: auth(operatorUid),
      payload: { kind: "cost", label: "Sound engineer", amount: "250000" },
    });
    expect(cost.statusCode).toBe(201);
    expect(cost.json().amount).toBe("250000");

    // Read the whole budget back.
    const list = await app.inject({
      method: "GET",
      url: `/api/v1/events/${eventId}/budgets`,
      headers: auth(operatorUid),
    });
    expect(list.statusCode).toBe(200);
    const body = list.json();
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe(budgetId);
    expect(body[0].lines).toHaveLength(2);
    for (const line of body[0].lines) {
      expect(typeof line.amount).toBe("string"); // amounts always cross the wire as strings
    }
    const amounts = body[0].lines.map((line: { amount: string }) => line.amount).sort();
    expect(amounts).toEqual(["1500000", "250000"]);

    // Audit rows written for the budget + both lines.
    const auditRows = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.eventId, eventId));
    const actions = auditRows.map((row) => row.action).sort();
    expect(actions).toEqual(["budget.create", "budget_line.create", "budget_line.create"]);
  });

  it("forbids a performer (no budget.view) from reading the budgets", async () => {
    const { eventId, operatorUid, performerUid } = await seedEvent("noview");
    await app.inject({
      method: "POST",
      url: `/api/v1/events/${eventId}/budgets`,
      headers: auth(operatorUid),
      payload: {},
    });

    const asPerformer = await app.inject({
      method: "GET",
      url: `/api/v1/events/${eventId}/budgets`,
      headers: auth(performerUid),
    });
    // Performer holds event.view but the ceiling strips budget.view → 403.
    expect(asPerformer.statusCode).toBe(403);
  });

  it("404s the budgets for a stranger who cannot even see the event", async () => {
    const { db } = harness;
    const { eventId } = await seedEvent("stranger");
    await db.insert(schema.users).values({
      id: "bud-outsider",
      email: "bud-outsider@example.com",
      kind: "operator",
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/events/${eventId}/budgets`,
      headers: auth("bud-outsider"),
    });
    expect(response.statusCode).toBe(404); // no event.view → no existence leak
  });

  it("edits a line, then rejects a stale version with 409", async () => {
    const { eventId, operatorUid } = await seedEvent("lock");
    const budget = await app.inject({
      method: "POST",
      url: `/api/v1/events/${eventId}/budgets`,
      headers: auth(operatorUid),
      payload: {},
    });
    const budgetId = budget.json().id;

    const line = await app.inject({
      method: "POST",
      url: `/api/v1/events/${eventId}/budgets/${budgetId}/lines`,
      headers: auth(operatorUid),
      payload: { kind: "cost", label: "Hotel", amount: "100000" },
    });
    const lineId = line.json().id;
    expect(line.json().version).toBe(1);

    const ok = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${eventId}/budgets/${budgetId}/lines/${lineId}`,
      headers: auth(operatorUid),
      payload: { amount: "120000", expectedVersion: 1 },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().amount).toBe("120000");
    expect(ok.json().version).toBe(2);

    // Retry with the now-stale version → conflict.
    const stale = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${eventId}/budgets/${budgetId}/lines/${lineId}`,
      headers: auth(operatorUid),
      payload: { amount: "130000", expectedVersion: 1 },
    });
    expect(stale.statusCode).toBe(409);
  });

  it("deletes a line and writes a delete audit row", async () => {
    const { db } = harness;
    const { eventId, operatorUid } = await seedEvent("del");
    const budget = await app.inject({
      method: "POST",
      url: `/api/v1/events/${eventId}/budgets`,
      headers: auth(operatorUid),
      payload: {},
    });
    const budgetId = budget.json().id;
    const line = await app.inject({
      method: "POST",
      url: `/api/v1/events/${eventId}/budgets/${budgetId}/lines`,
      headers: auth(operatorUid),
      payload: { kind: "revenue", label: "Bar", amount: "9000" },
    });
    const lineId = line.json().id;

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/v1/events/${eventId}/budgets/${budgetId}/lines/${lineId}`,
      headers: auth(operatorUid),
      payload: { expectedVersion: 1 },
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toEqual({ deleted: true });

    const remaining = await db
      .select()
      .from(schema.budgetLines)
      .where(eq(schema.budgetLines.id, lineId));
    expect(remaining).toHaveLength(0);

    const deleteAudit = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, lineId));
    expect(deleteAudit.some((row) => row.action === "budget_line.delete")).toBe(true);
  });

  it("records the ticketing source discriminator on a revenue line (decisions #15)", async () => {
    const { eventId, operatorUid } = await seedEvent("bud-src");
    const budget = await app.inject({
      method: "POST",
      url: `/api/v1/events/${eventId}/budgets`,
      headers: auth(operatorUid),
      payload: { scope: "shared" },
    });
    const budgetId = budget.json().id;

    // A provider-synced line carries source + provider_ref.
    const synced = await app.inject({
      method: "POST",
      url: `/api/v1/events/${eventId}/budgets/${budgetId}/lines`,
      headers: auth(operatorUid),
      payload: {
        kind: "revenue",
        source: "ticketing_provider",
        providerRef: "eventbrite:evt_123",
        label: "Eventbrite sales",
        amount: "1500000",
      },
    });
    expect(synced.statusCode).toBe(201);
    expect(synced.json().source).toBe("ticketing_provider");
    expect(synced.json().providerRef).toBe("eventbrite:evt_123");

    // A manual line defaults to source=manual with no provider ref.
    const manual = await app.inject({
      method: "POST",
      url: `/api/v1/events/${eventId}/budgets/${budgetId}/lines`,
      headers: auth(operatorUid),
      payload: { kind: "revenue", label: "Cash at door", amount: "50000" },
    });
    expect(manual.json().source).toBe("manual");
    expect(manual.json().providerRef).toBeNull();
  });
});
/**
 * A-06 — a private budget is ONE operator's margin line (PLAN.md:207,
 * "private = one operator"). A co-promoter holding `budget.view` + `budget.edit`
 * on the same event shares the SHARED budget and must not see, edit or delete the
 * other promoter's private one. Denials are 404, not 403: a 403 would itself
 * disclose that the co-promoter keeps a private budget.
 */
describe("budgets — private scope is confidential to its owner (A-06)", () => {
  /** Seed one event with two operators, a shared budget and the host's private budget. */
  async function seedTwoOperatorEvent(prefix: string) {
    const { eventId, operatorUid, operatorProfileId } = await seedEvent(prefix);
    const { coHostUid, coHostProfileId } = await seedCoHost(prefix, eventId);

    const shared = await app.inject({
      method: "POST",
      url: `/api/v1/events/${eventId}/budgets`,
      headers: auth(operatorUid),
      payload: { scope: "shared" },
    });
    expect(shared.statusCode).toBe(201);

    const priv = await app.inject({
      method: "POST",
      url: `/api/v1/events/${eventId}/budgets`,
      headers: auth(operatorUid),
      payload: { scope: "private", ownerProfileId: operatorProfileId },
    });
    expect(priv.statusCode).toBe(201);
    expect(priv.json().scope).toBe("private");

    const privateLine = await app.inject({
      method: "POST",
      url: `/api/v1/events/${eventId}/budgets/${priv.json().id}/lines`,
      headers: auth(operatorUid),
      payload: { kind: "revenue", label: "Promoter margin", amount: "400000" },
    });
    expect(privateLine.statusCode).toBe(201);

    return {
      eventId,
      operatorUid,
      operatorProfileId,
      coHostUid,
      coHostProfileId,
      sharedBudgetId: shared.json().id as string,
      privateBudgetId: priv.json().id as string,
      privateLineId: privateLine.json().id as string,
    };
  }

  it("shows the owner their own private budget and lets them edit its lines", async () => {
    const { eventId, operatorUid, operatorProfileId, privateBudgetId, privateLineId } =
      await seedTwoOperatorEvent("priv-own");

    const list = await app.inject({
      method: "GET",
      url: `/api/v1/events/${eventId}/budgets`,
      headers: auth(operatorUid),
    });
    expect(list.statusCode).toBe(200);
    const own = list.json().find((budget: { id: string }) => budget.id === privateBudgetId);
    expect(own).toBeDefined();
    expect(own.ownerProfileId).toBe(operatorProfileId);
    expect(own.lines).toHaveLength(1);
    expect(own.lines[0].label).toBe("Promoter margin");
    expect(own.lines[0].amount).toBe("400000");

    const lines = await app.inject({
      method: "GET",
      url: `/api/v1/events/${eventId}/budgets/${privateBudgetId}/lines`,
      headers: auth(operatorUid),
    });
    expect(lines.statusCode).toBe(200);
    expect(lines.json()).toHaveLength(1);

    const edited = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${eventId}/budgets/${privateBudgetId}/lines/${privateLineId}`,
      headers: auth(operatorUid),
      payload: { amount: "450000", expectedVersion: 1 },
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().amount).toBe("450000");
  });

  it("hides another operator's private budget from the co-host's list", async () => {
    const { eventId, coHostUid, sharedBudgetId, privateBudgetId } =
      await seedTwoOperatorEvent("priv-list");

    const list = await app.inject({
      method: "GET",
      url: `/api/v1/events/${eventId}/budgets`,
      headers: auth(coHostUid),
    });
    expect(list.statusCode).toBe(200); // the co-host DOES hold budget.view
    const ids = list.json().map((budget: { id: string }) => budget.id);
    expect(ids).toEqual([sharedBudgetId]);
    // Not even the private line's label or amount leaks through the shared budget.
    expect(JSON.stringify(list.json())).not.toContain("Promoter margin");
    expect(JSON.stringify(list.json())).not.toContain(privateBudgetId);
  });

  it("404s the co-host reading another operator's private budget lines by id", async () => {
    const { eventId, coHostUid, privateBudgetId } = await seedTwoOperatorEvent("priv-read");

    const lines = await app.inject({
      method: "GET",
      url: `/api/v1/events/${eventId}/budgets/${privateBudgetId}/lines`,
      headers: auth(coHostUid),
    });
    expect(lines.statusCode).toBe(404);
  });

  it("404s the co-host editing, adding to or deleting another operator's private lines", async () => {
    const { db } = harness;
    const { eventId, coHostUid, privateBudgetId, privateLineId } =
      await seedTwoOperatorEvent("priv-write");

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${eventId}/budgets/${privateBudgetId}/lines/${privateLineId}`,
      headers: auth(coHostUid),
      payload: { amount: "1", expectedVersion: 1 },
    });
    expect(patched.statusCode).toBe(404);

    const added = await app.inject({
      method: "POST",
      url: `/api/v1/events/${eventId}/budgets/${privateBudgetId}/lines`,
      headers: auth(coHostUid),
      payload: { kind: "cost", label: "Injected", amount: "1" },
    });
    expect(added.statusCode).toBe(404);

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/v1/events/${eventId}/budgets/${privateBudgetId}/lines/${privateLineId}`,
      headers: auth(coHostUid),
      payload: { expectedVersion: 1 },
    });
    expect(deleted.statusCode).toBe(404);

    // The row is untouched: original amount, original version, no injected line.
    const rows = await db
      .select()
      .from(schema.budgetLines)
      .where(eq(schema.budgetLines.budgetId, privateBudgetId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(privateLineId);
    expect(rows[0]?.amount).toBe(400000n);
    expect(rows[0]?.version).toBe(1);
  });

  it("keeps the shared budget visible and editable to both co-operators", async () => {
    const { eventId, operatorUid, coHostUid, sharedBudgetId } =
      await seedTwoOperatorEvent("priv-shared");

    const byCoHost = await app.inject({
      method: "POST",
      url: `/api/v1/events/${eventId}/budgets/${sharedBudgetId}/lines`,
      headers: auth(coHostUid),
      payload: { kind: "cost", label: "PA hire", amount: "80000" },
    });
    expect(byCoHost.statusCode).toBe(201);

    const byHost = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${eventId}/budgets/${sharedBudgetId}/lines/${byCoHost.json().id}`,
      headers: auth(operatorUid),
      payload: { amount: "90000", expectedVersion: 1 },
    });
    expect(byHost.statusCode).toBe(200);
    expect(byHost.json().amount).toBe("90000");

    for (const uid of [operatorUid, coHostUid]) {
      const list = await app.inject({
        method: "GET",
        url: `/api/v1/events/${eventId}/budgets`,
        headers: auth(uid),
      });
      const shared = list.json().find((budget: { id: string }) => budget.id === sharedBudgetId);
      expect(shared.lines).toHaveLength(1);
      expect(shared.lines[0].amount).toBe("90000");
    }
  });

  it("refuses to open a private budget owned by a profile the caller is not a member of", async () => {
    const { eventId, operatorUid } = await seedEvent("priv-forge");
    const { coHostProfileId } = await seedCoHost("priv-forge", eventId);

    // Opening a private budget in the co-host's name would be a readable back door.
    const forged = await app.inject({
      method: "POST",
      url: `/api/v1/events/${eventId}/budgets`,
      headers: auth(operatorUid),
      payload: { scope: "private", ownerProfileId: coHostProfileId },
    });
    expect(forged.statusCode).toBe(403);

    const missingOwner = await app.inject({
      method: "POST",
      url: `/api/v1/events/${eventId}/budgets`,
      headers: auth(operatorUid),
      payload: { scope: "private" },
    });
    expect(missingOwner.statusCode).toBe(400);
  });
});
