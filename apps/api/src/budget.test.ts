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
    return { uid: token, email: `${token}@example.showme.test`, name: token };
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
    // The list also carries the operator's own private budget, opened for them
    // on read (see "provisioned on demand" below). This assertion is about the
    // shared budget the lines were written to, so pick it out by id rather than
    // assuming it is the only one.
    const body = list.json().filter((budget: { id: string }) => budget.id === budgetId);
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
      email: "bud-outsider@example.showme.test",
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
    const { eventId, coHostUid, coHostProfileId, sharedBudgetId, privateBudgetId } =
      await seedTwoOperatorEvent("priv-list");

    const list = await app.inject({
      method: "GET",
      url: `/api/v1/events/${eventId}/budgets`,
      headers: auth(coHostUid),
    });
    expect(list.statusCode).toBe(200); // the co-host DOES hold budget.view
    const ids = list.json().map((budget: { id: string }) => budget.id);
    // The co-host sees the shared ledger and the private book opened for THEM,
    // and — the point of this test — never the other operator's private one.
    expect(ids).toContain(sharedBudgetId);
    expect(ids).not.toContain(privateBudgetId);
    const owners = list
      .json()
      .filter((budget: { scope: string }) => budget.scope === "private")
      .map((budget: { ownerProfileId: string }) => budget.ownerProfileId);
    expect(owners).toEqual([coHostProfileId]);
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

  /**
   * THE DEAL SELECTOR'S TWO ANSWERS, ALL THE WAY TO THE ROW AND BACK.
   *
   * `budget_lines` carries two deal columns that say opposite things about the
   * money (schema `settlement.ts`): `deal_id` = this line IS the deal's own
   * figure, dropped at the settlement boundary; `attributed_deal_id` = a real
   * cost merely reported under the deal, settled like any other. The planner's
   * "Deal" selector offers each agreement under both senses, and the only reason
   * a chosen sense means anything is that it survives the write and comes back
   * on the read. Nothing tested that, and a selector whose answer is silently
   * dropped is exactly the "Not tied to a deal" symptom of ClickUp 86cbaxvf5.
   *
   * The switch at the end is the half that can go wrong quietly: moving a line
   * from one sense to the other has to CLEAR the first, or the CHECK constraint
   * (`num_nonnulls(deal_id, attributed_deal_id) <= 1`) rejects the row and the
   * operator's edit fails on a rule they never saw.
   */
  it("round-trips both senses of naming a deal, and switching between them clears the other", async () => {
    const seed = await seedTwoEvents("deal-senses");
    const [deal] = await harness.db
      .insert(schema.deals)
      .values({
        eventId: seed.eventId,
        type: "performance",
        structure: "door_split",
        name: "Headliner — Door Split",
        splitBasisPoints: 7000,
        createdBy: seed.operatorUid,
      })
      .returning();
    if (!deal) throw new Error("deal seed failed");

    const asTheDealsFigure = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.eventId}/budgets/${seed.budgetId}/lines`,
      headers: auth(seed.operatorUid),
      payload: {
        kind: "cost",
        label: "Performer fee",
        amount: "300000",
        paidBy: seed.hostParticipantId,
        dealId: deal.id,
      },
    });
    expect(asTheDealsFigure.statusCode).toBe(201);
    expect(asTheDealsFigure.json().dealId).toBe(deal.id);
    expect(asTheDealsFigure.json().attributedDealId).toBeNull();

    const reportedUnderIt = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.eventId}/budgets/${seed.budgetId}/lines`,
      headers: auth(seed.operatorUid),
      payload: {
        kind: "cost",
        label: "Green-room catering",
        amount: "50000",
        paidBy: seed.hostParticipantId,
        attributedDealId: deal.id,
      },
    });
    expect(reportedUnderIt.statusCode).toBe(201);
    expect(reportedUnderIt.json().attributedDealId).toBe(deal.id);
    expect(reportedUnderIt.json().dealId).toBeNull();

    // The read the planner actually makes.
    const budgets = await app.inject({
      method: "GET",
      url: `/api/v1/events/${seed.eventId}/budgets`,
      headers: auth(seed.operatorUid),
    });
    expect(budgets.statusCode).toBe(200);
    const lines = budgets.json()[0].lines as {
      label: string;
      dealId: string | null;
      attributedDealId: string | null;
    }[];
    expect(lines.find((line) => line.label === "Performer fee")?.dealId).toBe(deal.id);
    expect(lines.find((line) => line.label === "Green-room catering")?.attributedDealId).toBe(
      deal.id,
    );

    // Second thoughts: the catering was never a real cost of the night, it IS
    // what the agreement pays. Both columns are sent, so the old one is cleared.
    const switched = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${seed.eventId}/budgets/${seed.budgetId}/lines/${reportedUnderIt.json().id}`,
      headers: auth(seed.operatorUid),
      payload: { dealId: deal.id, attributedDealId: null },
    });
    expect(switched.statusCode).toBe(200);
    expect(switched.json().dealId).toBe(deal.id);
    expect(switched.json().attributedDealId).toBeNull();

    // And the two senses are refused together, whichever way round they arrive.
    const both = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${seed.eventId}/budgets/${seed.budgetId}/lines/${asTheDealsFigure.json().id}`,
      headers: auth(seed.operatorUid),
      payload: { attributedDealId: deal.id },
    });
    expect(both.statusCode).toBe(400);
    expect(both.json().error.message).toContain("never both");
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

/**
 * The bug this covers: `POST /events` created no budget and no route in the web
 * app ever called `POST /events/:id/budgets`, so the Budget Planner on every new
 * event was an empty state with nothing behind it and no affordance to get past
 * it. A production operator hosting their own event could not open a budget at
 * all — which read as a permission problem and was not one.
 */
describe("budgets — provisioned on demand", () => {
  it("opens a private budget for the operator who reads an event that has none", async () => {
    const seeded = await seedEvent("provision-solo");

    const before = await harness.db
      .select()
      .from(schema.budgets)
      .where(eq(schema.budgets.eventId, seeded.eventId));
    expect(before).toHaveLength(0); // seeded straight into the DB, as a legacy event

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/events/${seeded.eventId}/budgets`,
      headers: auth(seeded.operatorUid),
    });

    expect(response.statusCode).toBe(200);
    const budgets = response.json();
    expect(budgets).toHaveLength(1);
    expect(budgets[0].scope).toBe("private");
    expect(budgets[0].ownerProfileId).toBe(seeded.operatorProfileId);
    expect(budgets[0].lines).toEqual([]);
  });

  it("is idempotent — reading twice does not open a second budget", async () => {
    const seeded = await seedEvent("provision-twice");
    const read = () =>
      app.inject({
        method: "GET",
        url: `/api/v1/events/${seeded.eventId}/budgets`,
        headers: auth(seeded.operatorUid),
      });

    await read();
    await read();

    const rows = await harness.db
      .select()
      .from(schema.budgets)
      .where(eq(schema.budgets.eventId, seeded.eventId));
    expect(rows).toHaveLength(1);
  });

  it("survives two operators reading at the same moment", async () => {
    const seeded = await seedEvent("provision-race");
    const read = () =>
      app.inject({
        method: "GET",
        url: `/api/v1/events/${seeded.eventId}/budgets`,
        headers: auth(seeded.operatorUid),
      });

    await Promise.all([read(), read(), read()]);

    const rows = await harness.db
      .select()
      .from(schema.budgets)
      .where(eq(schema.budgets.eventId, seeded.eventId));
    expect(rows).toHaveLength(1);
  });

  // The rule the user set: private per profile, plus a shared ledger once the
  // event is actually co-hosted. A solo operator has nobody to reconcile with.
  it("adds ONE shared ledger once a co-host joins, and each operator keeps their own private book", async () => {
    const seeded = await seedEvent("provision-cohost");
    const coHost = await seedCoHost("provision-cohost", seeded.eventId);

    const hostView = await app.inject({
      method: "GET",
      url: `/api/v1/events/${seeded.eventId}/budgets`,
      headers: auth(seeded.operatorUid),
    });
    const coHostView = await app.inject({
      method: "GET",
      url: `/api/v1/events/${seeded.eventId}/budgets`,
      headers: auth(coHost.coHostUid),
    });

    const scopesFor = (response: Awaited<ReturnType<typeof app.inject>>) =>
      response
        .json()
        .map((budget: { scope: string; ownerProfileId: string | null }) => [
          budget.scope,
          budget.ownerProfileId,
        ])
        .sort();

    // Each sees the one shared ledger plus their OWN private book — never the
    // other operator's, which is the confidentiality rule the filter enforces.
    expect(scopesFor(hostView)).toEqual(
      [
        ["shared", null],
        ["private", seeded.operatorProfileId],
      ].sort(),
    );
    expect(scopesFor(coHostView)).toEqual(
      [
        ["shared", null],
        ["private", coHost.coHostProfileId],
      ].sort(),
    );

    const shared = await harness.db
      .select()
      .from(schema.budgets)
      .where(eq(schema.budgets.eventId, seeded.eventId));
    expect(shared.filter((budget) => budget.scope === "shared")).toHaveLength(1);
  });

  // A performer holds no `budget.view` (the ceiling refuses it), so the read is
  // refused before provisioning can run. Nothing is created in their name.
  it("creates nothing for a party who cannot see budgets at all", async () => {
    const seeded = await seedEvent("provision-performer");

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/events/${seeded.eventId}/budgets`,
      headers: auth(seeded.performerUid),
    });

    expect(response.statusCode).toBe(403);
    const rows = await harness.db
      .select()
      .from(schema.budgets)
      .where(eq(schema.budgets.eventId, seeded.eventId));
    expect(rows).toHaveLength(0);
  });
});

/**
 * `details` is the planner's arithmetic (a tier's price x how many), kept beside
 * the authoritative `amount` so reopening the planner shows the tiers back
 * rather than a single collapsed total.
 */
describe("budget lines — the planner's breakdown survives a round trip", () => {
  it("stores and returns unit amount and quantity", async () => {
    const seeded = await seedEvent("line-details");
    const listed = await app.inject({
      method: "GET",
      url: `/api/v1/events/${seeded.eventId}/budgets`,
      headers: auth(seeded.operatorUid),
    });
    const budgetId = listed.json()[0].id;

    const created = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seeded.eventId}/budgets/${budgetId}/lines`,
      headers: auth(seeded.operatorUid),
      payload: {
        kind: "revenue",
        label: "Early bird",
        amount: "150000", // 250.00 x 6, in minor units
        collectedBy: seeded.hostParticipantId,
        details: { basis: "ticket_tier", unitAmount: "25000", quantity: 6 },
      },
    });

    expect(created.statusCode).toBe(201);
    expect(created.json().details).toEqual({
      basis: "ticket_tier",
      unitAmount: "25000",
      quantity: 6,
    });

    const reread = await app.inject({
      method: "GET",
      url: `/api/v1/events/${seeded.eventId}/budgets`,
      headers: auth(seeded.operatorUid),
    });
    expect(reread.json()[0].lines[0].details).toEqual({
      basis: "ticket_tier",
      unitAmount: "25000",
      quantity: 6,
    });
  });

  it("leaves a hand-entered line without a breakdown", async () => {
    const seeded = await seedEvent("line-no-details");
    const listed = await app.inject({
      method: "GET",
      url: `/api/v1/events/${seeded.eventId}/budgets`,
      headers: auth(seeded.operatorUid),
    });
    const budgetId = listed.json()[0].id;

    const created = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seeded.eventId}/budgets/${budgetId}/lines`,
      headers: auth(seeded.operatorUid),
      payload: {
        kind: "cost",
        label: "Sound engineer",
        amount: "40000",
        paidBy: seeded.hostParticipantId,
      },
    });

    expect(created.statusCode).toBe(201);
    expect(created.json().details).toBeNull();
  });
});

/**
 * The planner's payment-processing assumption (migration 0015). The rule under
 * test is as much about what does NOT happen as what does: the rates are recorded
 * on the budget, and no `budget_lines` row appears — because a line is cash
 * somebody moved and `reconcile()` would lower the settlement pool by this guess.
 */
describe("budgets — planning assumptions are rates on the budget, not cost lines", () => {
  async function openBudget(prefix: string) {
    const seeded = await seedEvent(prefix);
    const listed = await app.inject({
      method: "GET",
      url: `/api/v1/events/${seeded.eventId}/budgets`,
      headers: auth(seeded.operatorUid),
    });
    return { seeded, budget: listed.json()[0] };
  }

  it("is null on a budget nobody has told what their provider charges", async () => {
    const { budget } = await openBudget("assumptions-empty");
    expect(budget.planningAssumptions).toBeNull();
  });

  it("records the rates and hands them back on the next read", async () => {
    const { seeded, budget } = await openBudget("assumptions-write");

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${seeded.eventId}/budgets/${budget.id}`,
      headers: auth(seeded.operatorUid),
      payload: {
        planningAssumptions: {
          paymentProcessing: { percentBasisPoints: 150, flatPerTicket: "50" },
        },
      },
    });

    expect(patched.statusCode).toBe(200);
    expect(patched.json().planningAssumptions).toEqual({
      paymentProcessing: { percentBasisPoints: 150, flatPerTicket: "50" },
    });

    const reread = await app.inject({
      method: "GET",
      url: `/api/v1/events/${seeded.eventId}/budgets`,
      headers: auth(seeded.operatorUid),
    });
    const reloaded = reread.json().find((row: { id: string }) => row.id === budget.id);
    expect(reloaded.planningAssumptions).toEqual({
      paymentProcessing: { percentBasisPoints: 150, flatPerTicket: "50" },
    });
  });

  // The whole reason the column exists: an estimated fee must never reach the
  // reconciliation as cash.
  it("writes no budget line, so the settlement pool is untouched", async () => {
    const { seeded, budget } = await openBudget("assumptions-no-line");

    await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${seeded.eventId}/budgets/${budget.id}`,
      headers: auth(seeded.operatorUid),
      payload: {
        planningAssumptions: {
          paymentProcessing: { percentBasisPoints: 250, flatPerTicket: "100" },
        },
      },
    });

    const lines = await harness.db
      .select()
      .from(schema.budgetLines)
      .where(eq(schema.budgetLines.budgetId, budget.id));
    expect(lines).toEqual([]);
  });

  it("clears the assumption when it is set back to null", async () => {
    const { seeded, budget } = await openBudget("assumptions-clear");
    const url = `/api/v1/events/${seeded.eventId}/budgets/${budget.id}`;

    await app.inject({
      method: "PATCH",
      url,
      headers: auth(seeded.operatorUid),
      payload: {
        planningAssumptions: {
          paymentProcessing: { percentBasisPoints: 150, flatPerTicket: "0" },
        },
      },
    });
    const cleared = await app.inject({
      method: "PATCH",
      url,
      headers: auth(seeded.operatorUid),
      payload: { planningAssumptions: null },
    });

    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().planningAssumptions).toBeNull();
  });

  it("rejects a percentage that is not integer basis points (money.md)", async () => {
    const { seeded, budget } = await openBudget("assumptions-float");

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${seeded.eventId}/budgets/${budget.id}`,
      headers: auth(seeded.operatorUid),
      payload: {
        planningAssumptions: { paymentProcessing: { percentBasisPoints: 1.5, flatPerTicket: "0" } },
      },
    });

    expect(patched.statusCode).toBe(400);
  });

  it("rejects a flat charge that is not a whole number of minor units", async () => {
    const { seeded, budget } = await openBudget("assumptions-decimal");

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${seeded.eventId}/budgets/${budget.id}`,
      headers: auth(seeded.operatorUid),
      payload: {
        planningAssumptions: {
          paymentProcessing: { percentBasisPoints: 150, flatPerTicket: "0.50" },
        },
      },
    });

    expect(patched.statusCode).toBe(400);
  });

  it("rejects a stale version with 409", async () => {
    const { seeded, budget } = await openBudget("assumptions-stale");

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${seeded.eventId}/budgets/${budget.id}`,
      headers: auth(seeded.operatorUid),
      payload: {
        planningAssumptions: {
          paymentProcessing: { percentBasisPoints: 150, flatPerTicket: "0" },
        },
        expectedVersion: budget.version + 5,
      },
    });

    expect(patched.statusCode).toBe(409);
  });

  it("refuses a performer who cannot edit the budget", async () => {
    const { seeded, budget } = await openBudget("assumptions-performer");

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${seeded.eventId}/budgets/${budget.id}`,
      headers: auth(seeded.performerUid),
      payload: { planningAssumptions: null },
    });

    expect(patched.statusCode).toBe(403);
  });

  it("404s a co-host trying to set assumptions on another operator's private budget", async () => {
    const seeded = await seedEvent("assumptions-private");
    const co = await seedCoHost("assumptions-private", seeded.eventId);
    const mine = await app.inject({
      method: "GET",
      url: `/api/v1/events/${seeded.eventId}/budgets`,
      headers: auth(seeded.operatorUid),
    });
    const privateBudget = mine.json().find((row: { scope: string }) => row.scope === "private");

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${seeded.eventId}/budgets/${privateBudget.id}`,
      headers: auth(co.coHostUid),
      payload: { planningAssumptions: null },
    });

    expect(patched.statusCode).toBe(404);
  });
});

describe("budget lines — the planner's other-revenue field", () => {
  it("round-trips an `other_revenue` basis distinct from a ticket tier", async () => {
    const seeded = await seedEvent("line-other-revenue");
    const listed = await app.inject({
      method: "GET",
      url: `/api/v1/events/${seeded.eventId}/budgets`,
      headers: auth(seeded.operatorUid),
    });
    const budgetId = listed.json()[0].id;

    const created = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seeded.eventId}/budgets/${budgetId}/lines`,
      headers: auth(seeded.operatorUid),
      payload: {
        kind: "revenue",
        label: "Other revenue",
        amount: "500000",
        collectedBy: seeded.hostParticipantId,
        details: { basis: "other_revenue", unitAmount: "500000", quantity: 1 },
      },
    });

    expect(created.statusCode).toBe(201);
    // Sponsorship must not read back as a ticket type — the planner splits its
    // revenue rows on exactly this field.
    expect(created.json().details.basis).toBe("other_revenue");
  });
});

describe("budget lines — the planner's custom revenue rows", () => {
  it("round-trips a `custom_revenue` basis, so it is not read back as a ticket tier", async () => {
    const seeded = await seedEvent("line-custom-revenue");
    const listed = await app.inject({
      method: "GET",
      url: `/api/v1/events/${seeded.eventId}/budgets`,
      headers: auth(seeded.operatorUid),
    });
    const budgetId = listed.json()[0].id;

    const created = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seeded.eventId}/budgets/${budgetId}/lines`,
      headers: auth(seeded.operatorUid),
      payload: {
        kind: "revenue",
        label: "Sponsorship",
        amount: "500000",
        collectedBy: seeded.hostParticipantId,
        details: { basis: "custom_revenue", unitAmount: "500000", quantity: 1 },
      },
    });

    expect(created.statusCode).toBe(201);
    expect(created.json().details.basis).toBe("custom_revenue");

    // And it survives the read the planner actually makes. Without the basis it
    // would come back among the ticket tiers as one ticket priced at 5 000.
    const reread = await app.inject({
      method: "GET",
      url: `/api/v1/events/${seeded.eventId}/budgets`,
      headers: auth(seeded.operatorUid),
    });
    const line = reread
      .json()[0]
      .lines.find((row: { label: string }) => row.label === "Sponsorship");
    expect(line.details.basis).toBe("custom_revenue");
    expect(line.amount).toBe("500000");
  });

  it("refuses a basis the planner does not have a field for", async () => {
    const seeded = await seedEvent("line-bad-basis");
    const listed = await app.inject({
      method: "GET",
      url: `/api/v1/events/${seeded.eventId}/budgets`,
      headers: auth(seeded.operatorUid),
    });
    const budgetId = listed.json()[0].id;

    const rejected = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seeded.eventId}/budgets/${budgetId}/lines`,
      headers: auth(seeded.operatorUid),
      payload: {
        kind: "revenue",
        label: "Mystery",
        amount: "100",
        collectedBy: seeded.hostParticipantId,
        details: { basis: "made_up", unitAmount: "100", quantity: 1 },
      },
    });

    expect(rejected.statusCode).toBe(400);
  });
});

/**
 * The cost-bearing rule — the 2026-08 settlements meeting's *"either a cost split
 * or a single payer"* (01:06:31). `cost_split` has existed as a column since the
 * schema was written and nothing read or wrote it; these are the rules that came
 * with exposing it.
 */
describe("budgets — a cost is borne by a split OR a single payer, never both", () => {
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

  it("stores a split and reads it back", async () => {
    const seed = await seedBudget("split-ok");

    const created = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.eventId}/budgets/${seed.budgetId}/lines`,
      headers: auth(seed.operatorUid),
      payload: {
        kind: "cost",
        label: "Marketing",
        amount: "100000",
        paidBy: seed.hostParticipantId,
        costSplit: {
          [seed.hostParticipantId]: 5000,
          [seed.performerParticipantId]: 5000,
        },
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().costSplit).toEqual({
      [seed.hostParticipantId]: 5000,
      [seed.performerParticipantId]: 5000,
    });

    // …and the stored row really carries it, not just the response.
    const [stored] = await harness.db
      .select()
      .from(schema.budgetLines)
      .where(eq(schema.budgetLines.id, created.json().id));
    expect(stored?.costSplit).toEqual({
      [seed.hostParticipantId]: 5000,
      [seed.performerParticipantId]: 5000,
    });
  });

  it("refuses a split alongside a payee — the rule stated twice", async () => {
    const seed = await seedBudget("split-both");

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.eventId}/budgets/${seed.budgetId}/lines`,
      headers: auth(seed.operatorUid),
      payload: {
        kind: "cost",
        label: "Hotel",
        amount: "50000",
        paidBy: seed.hostParticipantId,
        payeeParticipantId: seed.performerParticipantId,
        costSplit: { [seed.performerParticipantId]: 10000 },
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain("either by a split or by a single payer");
  });

  it("refuses a split over 100% but allows one under it", async () => {
    const seed = await seedBudget("split-total");

    const over = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.eventId}/budgets/${seed.budgetId}/lines`,
      headers: auth(seed.operatorUid),
      payload: {
        kind: "cost",
        label: "Security",
        amount: "50000",
        paidBy: seed.hostParticipantId,
        costSplit: {
          [seed.hostParticipantId]: 6000,
          [seed.performerParticipantId]: 6000,
        },
      },
    });
    expect(over.statusCode).toBe(400);
    expect(over.json().error.message).toContain("charges out more than the line is worth");

    // The positive control, same body shape: under 100% is a real arrangement.
    const under = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.eventId}/budgets/${seed.budgetId}/lines`,
      headers: auth(seed.operatorUid),
      payload: {
        kind: "cost",
        label: "Security",
        amount: "50000",
        paidBy: seed.hostParticipantId,
        costSplit: { [seed.performerParticipantId]: 6000 },
      },
    });
    expect(under.statusCode).toBe(201);
  });

  it("refuses a split on a revenue line — revenue has a collector, not bearers", async () => {
    const seed = await seedBudget("split-revenue");

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.eventId}/budgets/${seed.budgetId}/lines`,
      headers: auth(seed.operatorUid),
      payload: {
        kind: "revenue",
        label: "Merch",
        amount: "50000",
        collectedBy: seed.hostParticipantId,
        costSplit: { [seed.performerParticipantId]: 5000 },
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain("belongs only on a cost line");
  });

  it("refuses a split naming a participant from another event", async () => {
    const seed = await seedBudget("split-foreign");
    const elsewhere = await seedEvent("split-foreign-away");

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.eventId}/budgets/${seed.budgetId}/lines`,
      headers: auth(seed.operatorUid),
      payload: {
        kind: "cost",
        label: "Backline",
        amount: "50000",
        paidBy: seed.hostParticipantId,
        costSplit: { [elsewhere.hostParticipantId]: 5000 },
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain("costSplit names");
  });

  it("clears a split back to a shared cost on PATCH", async () => {
    const seed = await seedBudget("split-clear");

    const created = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.eventId}/budgets/${seed.budgetId}/lines`,
      headers: auth(seed.operatorUid),
      payload: {
        kind: "cost",
        label: "Production",
        amount: "80000",
        paidBy: seed.hostParticipantId,
        costSplit: { [seed.performerParticipantId]: 5000 },
      },
    });
    expect(created.statusCode).toBe(201);

    const cleared = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${seed.eventId}/budgets/${seed.budgetId}/lines/${created.json().id}`,
      headers: auth(seed.operatorUid),
      payload: { costSplit: null },
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().costSplit).toBeNull();
  });

  it("refuses a PATCH that would leave a line carrying both rules", async () => {
    const seed = await seedBudget("split-patch-both");

    const created = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.eventId}/budgets/${seed.budgetId}/lines`,
      headers: auth(seed.operatorUid),
      payload: {
        kind: "cost",
        label: "Hotel",
        amount: "50000",
        paidBy: seed.hostParticipantId,
        payeeParticipantId: seed.performerParticipantId,
      },
    });
    expect(created.statusCode).toBe(201);

    // The patch names only the split; the payee is already on the row, and the
    // check has to validate the row the edit WOULD PRODUCE.
    const response = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${seed.eventId}/budgets/${seed.budgetId}/lines/${created.json().id}`,
      headers: auth(seed.operatorUid),
      payload: { costSplit: { [seed.performerParticipantId]: 5000 } },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain("either by a split or by a single payer");
  });
});
