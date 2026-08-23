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
  const participants = await db
    .insert(schema.eventParticipants)
    .values([
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
    ])
    .returning();
  // Every budget line has to say who held the cash (A-14), so the tests need the
  // participant ids, not just the profile ids.
  const hostParticipantId = participants.find((row) => row.profileId === operator.profileId)
    ?.id as string;
  const performerParticipantId = participants.find((row) => row.profileId === performer.profileId)
    ?.id as string;
  return {
    eventId: event.id,
    operatorUid: `${prefix}-op`,
    operatorProfileId: operator.profileId,
    performerUid: `${prefix}-perf`,
    hostParticipantId,
    performerParticipantId,
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
  const [participant] = await db
    .insert(schema.eventParticipants)
    .values({
      eventId,
      profileId: coHost.profileId,
      role: "co_host",
      permissionSetId: coHost.permissionSetId,
      status: "confirmed",
    })
    .returning();
  return {
    coHostUid: `${prefix}-co`,
    coHostProfileId: coHost.profileId,
    coHostParticipantId: participant?.id as string,
  };
}

describe("budgets — authorize + money-as-string + audit", () => {
  it("lets an operator create a budget with revenue/cost lines and read them back as strings", async () => {
    const { db } = harness;
    const { eventId, operatorUid, hostParticipantId } = await seedEvent("bud");

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
      payload: {
        kind: "revenue",
        label: "Ticket sales",
        amount: "1500000",
        currency: "SEK",
        collectedBy: hostParticipantId,
      },
    });
    expect(revenue.statusCode).toBe(201);
    expect(revenue.json().amount).toBe("1500000"); // STRING, never a number
    expect(typeof revenue.json().amount).toBe("string");

    const cost = await app.inject({
      method: "POST",
      url: `/api/v1/events/${eventId}/budgets/${budgetId}/lines`,
      headers: auth(operatorUid),
      payload: {
        kind: "cost",
        label: "Sound engineer",
        amount: "250000",
        paidBy: hostParticipantId,
      },
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
    const { eventId, operatorUid, hostParticipantId } = await seedEvent("lock");
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
      payload: { kind: "cost", label: "Hotel", amount: "100000", paidBy: hostParticipantId },
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
    const { eventId, operatorUid, hostParticipantId } = await seedEvent("del");
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
      payload: { kind: "revenue", label: "Bar", amount: "9000", collectedBy: hostParticipantId },
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
    const { eventId, operatorUid, hostParticipantId } = await seedEvent("bud-src");
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
        collectedBy: hostParticipantId,
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
      payload: {
        kind: "revenue",
        label: "Cash at door",
        amount: "50000",
        collectedBy: hostParticipantId,
      },
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
    const { eventId, operatorUid, operatorProfileId, hostParticipantId } = await seedEvent(prefix);
    const { coHostUid, coHostProfileId, coHostParticipantId } = await seedCoHost(prefix, eventId);

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
      payload: {
        kind: "revenue",
        label: "Promoter margin",
        amount: "400000",
        collectedBy: hostParticipantId,
      },
    });
    expect(privateLine.statusCode).toBe(201);

    return {
      eventId,
      operatorUid,
      operatorProfileId,
      hostParticipantId,
      coHostUid,
      coHostProfileId,
      coHostParticipantId,
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
    const { eventId, coHostUid, coHostParticipantId, privateBudgetId, privateLineId } =
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
      payload: { kind: "cost", label: "Injected", amount: "1", paidBy: coHostParticipantId },
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
    const { eventId, operatorUid, coHostUid, coHostParticipantId, sharedBudgetId } =
      await seedTwoOperatorEvent("priv-shared");

    const byCoHost = await app.inject({
      method: "POST",
      url: `/api/v1/events/${eventId}/budgets/${sharedBudgetId}/lines`,
      headers: auth(coHostUid),
      payload: { kind: "cost", label: "PA hire", amount: "80000", paidBy: coHostParticipantId },
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

/**
 * A-14 — a budget line's `collected_by` / `paid_by` / `payee_participant_id` /
 * `deal_id` are plain foreign keys, so Postgres only ever asked "does this row
 * exist", never "does it belong to THIS event". A reference to another event's
 * participant was accepted with a 201 and then broke `POST /settlement/compute`
 * forever: the cash raised the pool but was credited to a participant this event's
 * breakdowns do not contain, so Σ net ≠ 0. Every case below must be a 4xx with a
 * usable message AND must leave the table empty.
 */
describe("budgets — line references are event-scoped (A-14)", () => {
  /** How many lines the budget currently holds — the "nothing was written" assertion. */
  async function lineCount(budgetId: string): Promise<number> {
    const rows = await harness.db
      .select()
      .from(schema.budgetLines)
      .where(eq(schema.budgetLines.budgetId, budgetId));
    return rows.length;
  }

  /** An event with a shared budget, plus a SECOND event whose participant ids are foreign to it. */
  async function seedTwoEvents(prefix: string) {
    const here = await seedEvent(`${prefix}-here`);
    const elsewhere = await seedEvent(`${prefix}-away`);

    const budget = await app.inject({
      method: "POST",
      url: `/api/v1/events/${here.eventId}/budgets`,
      headers: auth(here.operatorUid),
      payload: { scope: "shared" },
    });
    expect(budget.statusCode).toBe(201);

    const [foreignParticipant] = await harness.db
      .select()
      .from(schema.eventParticipants)
      .where(eq(schema.eventParticipants.eventId, elsewhere.eventId));
    if (!foreignParticipant) throw new Error("foreign participant seed failed");

    return {
      ...here,
      budgetId: budget.json().id as string,
      foreignEventId: elsewhere.eventId,
      foreignParticipantId: foreignParticipant.id,
    };
  }

  it("rejects a collectedBy naming another event's participant, and writes nothing", async () => {
    const seed = await seedTwoEvents("xevent");

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.eventId}/budgets/${seed.budgetId}/lines`,
      headers: auth(seed.operatorUid),
      payload: {
        kind: "revenue",
        label: "Tickets",
        amount: "1000000",
        collectedBy: seed.foreignParticipantId,
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("bad_request");
    expect(response.json().error.message).toContain("not a participant on this event");
    expect(response.json().error.message).toContain("collectedBy");
    expect(await lineCount(seed.budgetId)).toBe(0);
  });

  it("rejects paidBy and payeeParticipantId from another event too", async () => {
    const seed = await seedTwoEvents("xevent-cost");

    const paidBy = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.eventId}/budgets/${seed.budgetId}/lines`,
      headers: auth(seed.operatorUid),
      payload: {
        kind: "cost",
        label: "Sound hire",
        amount: "150000",
        paidBy: seed.foreignParticipantId,
      },
    });
    expect(paidBy.statusCode).toBe(400);
    expect(paidBy.json().error.message).toContain("paidBy");

    const payee = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.eventId}/budgets/${seed.budgetId}/lines`,
      headers: auth(seed.operatorUid),
      payload: {
        kind: "cost",
        label: "Hotel",
        amount: "50000",
        paidBy: seed.hostParticipantId,
        payeeParticipantId: seed.foreignParticipantId,
      },
    });
    expect(payee.statusCode).toBe(400);
    expect(payee.json().error.message).toContain("payeeParticipantId");

    expect(await lineCount(seed.budgetId)).toBe(0);
  });

  it("rejects a PROFILE id sent where a participant id belongs (the easy mistake)", async () => {
    const seed = await seedTwoEvents("profile-id");

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.eventId}/budgets/${seed.budgetId}/lines`,
      headers: auth(seed.operatorUid),
      payload: {
        kind: "revenue",
        label: "Tickets",
        amount: "1000000",
        // A real uuid of this event's own operator — but a PROFILE, not a participant.
        collectedBy: seed.operatorProfileId,
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain("not a profile id");
    expect(await lineCount(seed.budgetId)).toBe(0);
  });

  it("rejects a participant id that does not exist at all (no raw FK violation)", async () => {
    const seed = await seedTwoEvents("ghost");

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.eventId}/budgets/${seed.budgetId}/lines`,
      headers: auth(seed.operatorUid),
      payload: {
        kind: "revenue",
        label: "Tickets",
        amount: "1000000",
        collectedBy: "00000000-0000-4000-8000-000000000000",
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("bad_request");
    expect(await lineCount(seed.budgetId)).toBe(0);
  });

  it("rejects a dealId belonging to another event", async () => {
    const seed = await seedTwoEvents("xevent-deal");
    const [foreignDeal] = await harness.db
      .insert(schema.deals)
      .values({
        eventId: seed.foreignEventId,
        type: "performance",
        structure: "guarantee",
        name: "Someone else's deal",
        createdBy: "xevent-deal-away-op",
      })
      .returning();
    if (!foreignDeal) throw new Error("deal seed failed");

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.eventId}/budgets/${seed.budgetId}/lines`,
      headers: auth(seed.operatorUid),
      payload: {
        kind: "cost",
        label: "Backline",
        amount: "20000",
        paidBy: seed.hostParticipantId,
        dealId: foreignDeal.id,
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain("not a deal on this event");
    expect(await lineCount(seed.budgetId)).toBe(0);
  });

  it("rejects a non-numeric amount as validation, not an uncaught BigInt()", async () => {
    const seed = await seedTwoEvents("amount");

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.eventId}/budgets/${seed.budgetId}/lines`,
      headers: auth(seed.operatorUid),
      payload: { kind: "revenue", label: "Tickets", amount: "abc" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("validation");
    expect(await lineCount(seed.budgetId)).toBe(0);

    // …and the same on the edit path.
    const good = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.eventId}/budgets/${seed.budgetId}/lines`,
      headers: auth(seed.operatorUid),
      payload: {
        kind: "revenue",
        label: "Tickets",
        amount: "1000000",
        collectedBy: seed.hostParticipantId,
      },
    });
    expect(good.statusCode).toBe(201);

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${seed.eventId}/budgets/${seed.budgetId}/lines/${good.json().id}`,
      headers: auth(seed.operatorUid),
      payload: { amount: "12.50", expectedVersion: 1 },
    });
    expect(patched.statusCode).toBe(400);
    expect(patched.json().error.code).toBe("validation");

    const rows = await harness.db
      .select()
      .from(schema.budgetLines)
      .where(eq(schema.budgetLines.budgetId, seed.budgetId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.amount).toBe(1000000n); // untouched
  });

  it("rejects an EDIT that repoints a good line at another event's participant", async () => {
    const seed = await seedTwoEvents("xevent-patch");

    const created = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.eventId}/budgets/${seed.budgetId}/lines`,
      headers: auth(seed.operatorUid),
      payload: {
        kind: "revenue",
        label: "Tickets",
        amount: "1000000",
        collectedBy: seed.hostParticipantId,
      },
    });
    expect(created.statusCode).toBe(201);

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${seed.eventId}/budgets/${seed.budgetId}/lines/${created.json().id}`,
      headers: auth(seed.operatorUid),
      payload: { collectedBy: seed.foreignParticipantId, expectedVersion: 1 },
    });
    expect(patched.statusCode).toBe(400);

    const rows = await harness.db
      .select()
      .from(schema.budgetLines)
      .where(eq(schema.budgetLines.budgetId, seed.budgetId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.collectedBy).toBe(seed.hostParticipantId); // still the original
    expect(rows[0]?.version).toBe(1);
  });

  it("still accepts a reference to a participant of THIS event", async () => {
    const seed = await seedTwoEvents("ok");
    const [own] = await harness.db
      .select()
      .from(schema.eventParticipants)
      .where(eq(schema.eventParticipants.eventId, seed.eventId));
    if (!own) throw new Error("participant seed failed");

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.eventId}/budgets/${seed.budgetId}/lines`,
      headers: auth(seed.operatorUid),
      payload: { kind: "revenue", label: "Tickets", amount: "1000000", collectedBy: own.id },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().collectedBy).toBe(own.id);
  });
});

/**
 * A-14, second half — the same "cash belongs to nobody" state, reached by simply
 * OMITTING the field instead of pointing it at a foreign event. `collected_by` and
 * `paid_by` are nullable columns, so `{"kind":"revenue","amount":"1000000"}` was a
 * 201 and then a permanent 500 on compute, by identical arithmetic: the amount moves
 * the pool, no participant's `held` moves with it, Σ net ≠ 0.
 *
 * `payeeParticipantId` must STAY optional — NULL there is the off-platform supplier
 * that makes a cost an external pool cost, and it reconciles correctly.
 */
describe("budgets — every line must say who held the cash (A-14)", () => {
  async function seedBudget(prefix: string) {
    const event = await seedEvent(prefix);
    const budget = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.eventId}/budgets`,
      headers: auth(event.operatorUid),
      payload: { scope: "shared" },
    });
    expect(budget.statusCode).toBe(201);
    return { ...event, budgetId: budget.json().id as string };
  }

  async function lineCount(budgetId: string): Promise<number> {
    const rows = await harness.db
      .select()
      .from(schema.budgetLines)
      .where(eq(schema.budgetLines.budgetId, budgetId));
    return rows.length;
  }

  it("rejects revenue with no collectedBy, and writes nothing", async () => {
    const seed = await seedBudget("ghost-rev");

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.eventId}/budgets/${seed.budgetId}/lines`,
      headers: auth(seed.operatorUid),
      payload: { kind: "revenue", label: "Ghost revenue", amount: "1000000" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("bad_request");
    expect(response.json().error.message).toContain("collectedBy");
    expect(await lineCount(seed.budgetId)).toBe(0);
  });

  it("rejects a cost with no paidBy, and writes nothing", async () => {
    const seed = await seedBudget("ghost-cost");

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.eventId}/budgets/${seed.budgetId}/lines`,
      headers: auth(seed.operatorUid),
      payload: { kind: "cost", label: "Ghost cost", amount: "1000000" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain("paidBy");
    expect(await lineCount(seed.budgetId)).toBe(0);
  });

  it("still accepts an external-supplier cost — paidBy set, NO payee (the reference shape)", async () => {
    const seed = await seedBudget("external");

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.eventId}/budgets/${seed.budgetId}/lines`,
      headers: auth(seed.operatorUid),
      payload: {
        kind: "cost",
        label: "PA hire",
        amount: "1000000",
        paidBy: seed.hostParticipantId,
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().paidBy).toBe(seed.hostParticipantId);
    // NULL payee is the whole point of an external cost — it stays a pool cost.
    expect(response.json().payeeParticipantId).toBeNull();
  });

  it("rejects a PATCH that nulls the attribution of an existing line", async () => {
    const seed = await seedBudget("unattribute");

    const created = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.eventId}/budgets/${seed.budgetId}/lines`,
      headers: auth(seed.operatorUid),
      payload: {
        kind: "revenue",
        label: "Tickets",
        amount: "1000000",
        collectedBy: seed.hostParticipantId,
      },
    });
    expect(created.statusCode).toBe(201);

    const nulled = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${seed.eventId}/budgets/${seed.budgetId}/lines/${created.json().id}`,
      headers: auth(seed.operatorUid),
      payload: { collectedBy: null, expectedVersion: 1 },
    });
    expect(nulled.statusCode).toBe(400);
    expect(nulled.json().error.message).toContain("collectedBy");

    // …and the line is untouched.
    const rows = await harness.db
      .select()
      .from(schema.budgetLines)
      .where(eq(schema.budgetLines.budgetId, seed.budgetId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.collectedBy).toBe(seed.hostParticipantId);
    expect(rows[0]?.version).toBe(1);
  });

  it("rejects a PATCH that flips a paid-for cost into revenue, leaving no collector", async () => {
    const seed = await seedBudget("flip-kind");

    const created = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.eventId}/budgets/${seed.budgetId}/lines`,
      headers: auth(seed.operatorUid),
      payload: {
        kind: "cost",
        label: "PA hire",
        amount: "1000000",
        paidBy: seed.hostParticipantId,
      },
    });
    expect(created.statusCode).toBe(201);

    // The patch validates the row it WOULD PRODUCE: revenue with no collectedBy.
    const flipped = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${seed.eventId}/budgets/${seed.budgetId}/lines/${created.json().id}`,
      headers: auth(seed.operatorUid),
      payload: { kind: "revenue", expectedVersion: 1 },
    });
    expect(flipped.statusCode).toBe(400);
    expect(flipped.json().error.message).toContain("collectedBy");

    // The same flip WITH a collector is fine.
    const withCollector = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${seed.eventId}/budgets/${seed.budgetId}/lines/${created.json().id}`,
      headers: auth(seed.operatorUid),
      payload: { kind: "revenue", collectedBy: seed.hostParticipantId, expectedVersion: 1 },
    });
    expect(withCollector.statusCode).toBe(200);
    expect(withCollector.json().kind).toBe("revenue");
    expect(withCollector.json().collectedBy).toBe(seed.hostParticipantId);
  });
});
