import { PRESET_PERMISSION_SETS } from "@showme/auth";
import { schema } from "@showme/db";
import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TokenVerifier } from "./auth/token-verifier";
import { settlementRoutes } from "./routes/settlement";
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
  app = buildTestApp({ database: harness.db, tokenVerifier: fakeVerifier }, [settlementRoutes]);
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await harness?.stop();
});

const auth = (uid: string) => ({ authorization: `Bearer ${uid}` });

/** Seed a user + profile + active owner membership + a permission set. */
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
  return { userId: id, profileId: profile.id, permissionSetId: set.id };
}

/**
 * Seed the money.md worked example (minor units):
 *   operator P (host) + venue V (performer) + band B (performer)
 *   rental deal V guarantee 100000; guarantee deal B 300000
 *   revenue 1000000 collected by P; external cost 150000 paid by P
 * → pool 850000, P net −400000, V net +100000, B net +300000
 *   transfers P→V 100000, P→B 300000.
 */
async function seedWorkedExample(prefix: string) {
  const { db } = harness;
  const operator = await seedMemberWithSet(
    `${prefix}-op`,
    "operator",
    PRESET_PERMISSION_SETS.operator_full,
  );
  const venue = await seedMemberWithSet(
    `${prefix}-venue`,
    "performer",
    PRESET_PERMISSION_SETS.performer,
  );
  const band = await seedMemberWithSet(
    `${prefix}-band`,
    "performer",
    PRESET_PERMISSION_SETS.performer,
  );

  const [event] = await db
    .insert(schema.events)
    .values({
      hostProfileId: operator.profileId,
      title: "Settle Night",
      baseCurrency: "SEK",
      createdBy: operator.userId,
    })
    .returning();
  if (!event) throw new Error("event seed failed");

  const parts = await db
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
        profileId: venue.profileId,
        role: "performer",
        permissionSetId: venue.permissionSetId,
        status: "confirmed",
      },
      {
        eventId: event.id,
        profileId: band.profileId,
        role: "performer",
        permissionSetId: band.permissionSetId,
        status: "confirmed",
      },
    ])
    .returning();
  const pPart = parts.find((p) => p.profileId === operator.profileId)?.id as string;
  const vPart = parts.find((p) => p.profileId === venue.profileId)?.id as string;
  const bPart = parts.find((p) => p.profileId === band.profileId)?.id as string;

  const [rental] = await db
    .insert(schema.deals)
    .values({
      eventId: event.id,
      type: "rental",
      structure: "rental",
      name: "Venue rental",
      guaranteeAmount: 100000n,
      createdBy: operator.userId,
    })
    .returning();
  const [guarantee] = await db
    .insert(schema.deals)
    .values({
      eventId: event.id,
      type: "performance",
      structure: "guarantee",
      name: "Band guarantee",
      guaranteeAmount: 300000n,
      createdBy: operator.userId,
    })
    .returning();
  if (!rental || !guarantee) throw new Error("deal seed failed");
  await db.insert(schema.dealParties).values([
    { dealId: rental.id, participantId: vPart, roleInDeal: "payee" },
    { dealId: guarantee.id, participantId: bPart, roleInDeal: "payee" },
  ]);

  const [budget] = await db.insert(schema.budgets).values({ eventId: event.id }).returning();
  if (!budget) throw new Error("budget seed failed");
  await db.insert(schema.budgetLines).values([
    {
      budgetId: budget.id,
      kind: "revenue",
      label: "Tickets",
      amount: 1000000n,
      collectedBy: pPart,
    },
    { budgetId: budget.id, kind: "cost", label: "Sound hire", amount: 150000n, paidBy: pPart },
  ]);

  return { event, operator, venue, band, pPart, vPart, bPart };
}

describe("settlement — compute", () => {
  it("reconciles the worked example into per-participant settlements and transfers", async () => {
    const seed = await seedWorkedExample("compute");

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/compute`,
      headers: auth(seed.operator.userId),
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.pool).toBe("850000");

    const byId = new Map<string, string>(
      body.breakdowns.map((b: { participantId: string; net: string }) => [b.participantId, b.net]),
    );
    expect(byId.get(seed.pPart)).toBe("-400000");
    expect(byId.get(seed.vPart)).toBe("100000");
    expect(byId.get(seed.bPart)).toBe("300000");

    // One settlements row per participant.
    const rows = await harness.db
      .select()
      .from(schema.settlements)
      .where(eq(schema.settlements.eventId, seed.event.id));
    expect(rows).toHaveLength(3);

    // Transfers: P→V 100000 and P→B 300000.
    const transfers = await harness.db
      .select()
      .from(schema.settlementTransfers)
      .where(eq(schema.settlementTransfers.eventId, seed.event.id));
    expect(transfers).toHaveLength(2);
    const toV = transfers.find((t) => t.toParticipant === seed.vPart);
    const toB = transfers.find((t) => t.toParticipant === seed.bPart);
    expect(toV?.fromParticipant).toBe(seed.pPart);
    expect(toV?.amount).toBe(100000n);
    expect(toB?.fromParticipant).toBe(seed.pPart);
    expect(toB?.amount).toBe(300000n);

    // Audit row written in-transaction.
    const audit = await harness.db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, seed.event.id));
    expect(audit.some((a) => a.action === "settlement.compute")).toBe(true);
  });
});

describe("settlement — visibility (decisions #4)", () => {
  it("shows an operator every settlement but a performer only their own", async () => {
    const seed = await seedWorkedExample("vis");
    await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/compute`,
      headers: auth(seed.operator.userId),
    });

    const asOperator = await app.inject({
      method: "GET",
      url: `/api/v1/events/${seed.event.id}/settlements`,
      headers: auth(seed.operator.userId),
    });
    expect(asOperator.statusCode).toBe(200);
    expect(asOperator.json().settlements).toHaveLength(3);
    expect(asOperator.json().transfers).toHaveLength(2);

    const asBand = await app.inject({
      method: "GET",
      url: `/api/v1/events/${seed.event.id}/settlements`,
      headers: auth(seed.band.userId),
    });
    expect(asBand.statusCode).toBe(200);
    const bandBody = asBand.json();
    expect(bandBody.settlements).toHaveLength(1);
    expect(bandBody.settlements[0].participantId).toBe(seed.bPart);
    // Only the transfer the band is a party to (P→B).
    expect(bandBody.transfers).toHaveLength(1);
    expect(bandBody.transfers[0].toParticipantId).toBe(seed.bPart);
  });
});

/**
 * Add an agent representing the band at 20% commission and materialize the
 * assignment (agent participant + the band's delegated flag), as the assignment
 * flow does. Band entitlement 300000 × 20% = 60000; the band collected via the
 * event (agentCollects=false), so the band owes the agent 60000.
 */
async function seedAgentRepresentation(
  prefix: string,
  seed: Awaited<ReturnType<typeof seedWorkedExample>>,
) {
  const { db } = harness;
  const agentUserId = `${prefix}-agent`;
  await db
    .insert(schema.users)
    .values({ id: agentUserId, email: `${agentUserId}@x.com`, kind: "agent" });
  const [agentProfile] = await db
    .insert(schema.profiles)
    .values({ kind: "agent", ownerUserId: agentUserId, name: agentUserId, slug: agentUserId })
    .returning();
  if (!agentProfile) throw new Error("agent profile seed failed");
  await db
    .insert(schema.profileMembers)
    .values({ profileId: agentProfile.id, userId: agentUserId, role: "owner", status: "active" });
  const [agentSet] = await db
    .insert(schema.permissionSets)
    .values({
      profileId: agentProfile.id,
      name: "agent",
      capabilities: [...PRESET_PERMISSION_SETS.agent],
    })
    .returning();

  const [representation] = await db
    .insert(schema.representations)
    .values({
      agentProfileId: agentProfile.id,
      performerProfileId: seed.band.profileId,
      isWorldwide: true,
      commissionRate: 2000, // 20.00%
      agentCollects: false,
      proposedBy: "agent",
      status: "active",
      confirmedByAgent: true,
      confirmedByPerformer: true,
    })
    .returning();
  if (!representation) throw new Error("representation seed failed");

  const [agentPart] = await db
    .insert(schema.eventParticipants)
    .values({
      eventId: seed.event.id,
      profileId: agentProfile.id,
      role: "agent",
      permissionSetId: agentSet?.id,
      status: "accepted",
    })
    .returning();
  if (!agentPart) throw new Error("agent participant seed failed");

  // Delegate the band's participation to the agent (auth engine + commission read this).
  await db
    .update(schema.eventParticipants)
    .set({ details: { delegatedToAgentProfileId: agentProfile.id } })
    .where(eq(schema.eventParticipants.id, seed.bPart));

  return { agentUserId, agentProfileId: agentProfile.id, agentPart: agentPart.id, representation };
}

describe("settlement — representation commission (decisions #14)", () => {
  it("auto-creates a private performer↔agent commission settlement on compute", async () => {
    const seed = await seedWorkedExample("comm");
    const rep = await seedAgentRepresentation("comm", seed);

    const compute = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/compute`,
      headers: auth(seed.operator.userId),
    });
    expect(compute.statusCode).toBe(200);

    // A representation-scoped settlement, computed at 20% of the band's 300000.
    const commissionSettlements = await harness.db
      .select()
      .from(schema.settlements)
      .where(eq(schema.settlements.representationId, rep.representation.id));
    expect(commissionSettlements).toHaveLength(1);
    const computed = commissionSettlements[0]?.computed as { commission: string };
    expect(computed.commission).toBe("60000");

    // A private commission transfer band→agent, tagged with the representation.
    const commissionTransfers = await harness.db
      .select()
      .from(schema.settlementTransfers)
      .where(eq(schema.settlementTransfers.representationId, rep.representation.id));
    expect(commissionTransfers).toHaveLength(1);
    expect(commissionTransfers[0]?.fromParticipant).toBe(seed.bPart);
    expect(commissionTransfers[0]?.toParticipant).toBe(rep.agentPart);
    expect(commissionTransfers[0]?.amount).toBe(60000n);
    // The event settlement is untouched: the band still nets full gross (+300000).
    expect(commissionTransfers[0]?.state).toBe("owed");
  });

  it("hides the commission from the operator but shows it to the performer and agent", async () => {
    const seed = await seedWorkedExample("commvis");
    const rep = await seedAgentRepresentation("commvis", seed);
    await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/compute`,
      headers: auth(seed.operator.userId),
    });

    // Operator: sees the whole event settlement, NEVER the commission (decisions #14).
    const asOperator = await app.inject({
      method: "GET",
      url: `/api/v1/events/${seed.event.id}/settlements`,
      headers: auth(seed.operator.userId),
    });
    const operatorBody = asOperator.json();
    expect(operatorBody.commissions).toEqual([]);
    // Participant settlements only (P, V, B, + the agent's harmless net-0 line) —
    // the operator sees the agent as negotiator but never the commission.
    expect(operatorBody.settlements).toHaveLength(4);
    expect(operatorBody.transfers).toHaveLength(2); // event transfers only
    expect(
      operatorBody.transfers.every((t: { representationId?: string }) => !t.representationId),
    ).toBe(true);

    // Performer (the band): sees its own commission + the private transfer.
    const asBand = await app.inject({
      method: "GET",
      url: `/api/v1/events/${seed.event.id}/settlements`,
      headers: auth(seed.band.userId),
    });
    const bandBody = asBand.json();
    expect(bandBody.commissions).toHaveLength(1);
    expect(bandBody.commissions[0].commission).toBe("60000");
    expect(
      bandBody.transfers.some(
        (t: { representationId?: string }) => t.representationId === rep.representation.id,
      ),
    ).toBe(true);

    // Agent: sees the same commission from their side.
    const asAgent = await app.inject({
      method: "GET",
      url: `/api/v1/events/${seed.event.id}/settlements`,
      headers: auth(rep.agentUserId),
    });
    const agentBody = asAgent.json();
    expect(agentBody.commissions).toHaveLength(1);
    expect(agentBody.commissions[0].agentParticipantId).toBe(rep.agentPart);
  });

  it("settles the commission manually via the normal transfer flow", async () => {
    const seed = await seedWorkedExample("commsettle");
    const rep = await seedAgentRepresentation("commsettle", seed);
    await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/compute`,
      headers: auth(seed.operator.userId),
    });
    const [transfer] = await harness.db
      .select()
      .from(schema.settlementTransfers)
      .where(eq(schema.settlementTransfers.representationId, rep.representation.id));
    if (!transfer) throw new Error("no commission transfer");

    // The same owed→paid endpoint the event transfers use.
    const paid = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${seed.event.id}/transfers/${transfer.id}`,
      headers: auth(seed.operator.userId),
      payload: { state: "paid", expectedVersion: 1 },
    });
    expect(paid.statusCode).toBe(200);
    expect(paid.json().state).toBe("paid");
  });

  it("recompute is idempotent — no duplicate commission rows", async () => {
    const seed = await seedWorkedExample("commidem");
    const rep = await seedAgentRepresentation("commidem", seed);
    // Compute twice; the delete-before-insert must keep exactly one commission row.
    for (let run = 0; run < 2; run++) {
      await app.inject({
        method: "POST",
        url: `/api/v1/events/${seed.event.id}/settlement/compute`,
        headers: auth(seed.operator.userId),
      });
    }
    const settlements = await harness.db
      .select()
      .from(schema.settlements)
      .where(eq(schema.settlements.representationId, rep.representation.id));
    expect(settlements).toHaveLength(1);
    const transfers = await harness.db
      .select()
      .from(schema.settlementTransfers)
      .where(eq(schema.settlementTransfers.representationId, rep.representation.id));
    expect(transfers).toHaveLength(1);
  });
});

describe("settlement — finalize & transfer state", () => {
  it("finalize writes an immutable snapshot", async () => {
    const seed = await seedWorkedExample("final");
    await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/compute`,
      headers: auth(seed.operator.userId),
    });

    const finalize = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/finalize`,
      headers: auth(seed.operator.userId),
    });
    expect(finalize.statusCode).toBe(200);
    expect(finalize.json().version).toBe(1);

    const snapshots = await harness.db
      .select()
      .from(schema.settlementSnapshots)
      .where(eq(schema.settlementSnapshots.eventId, seed.event.id));
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.version).toBe(1);
  });

  it("marks a transfer paid and rejects a stale version with 409", async () => {
    const seed = await seedWorkedExample("state");
    await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/compute`,
      headers: auth(seed.operator.userId),
    });
    const [transfer] = await harness.db
      .select()
      .from(schema.settlementTransfers)
      .where(eq(schema.settlementTransfers.eventId, seed.event.id));
    if (!transfer) throw new Error("no transfer to update");

    const ok = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${seed.event.id}/transfers/${transfer.id}`,
      headers: auth(seed.operator.userId),
      payload: { state: "paid", expectedVersion: 1 },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().state).toBe("paid");
    expect(ok.json().version).toBe(2);

    const stale = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${seed.event.id}/transfers/${transfer.id}`,
      headers: auth(seed.operator.userId),
      payload: { state: "handled", expectedVersion: 1 },
    });
    expect(stale.statusCode).toBe(409);
  });

  it("records a manual override and a party confirmation", async () => {
    const seed = await seedWorkedExample("override");
    await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/compute`,
      headers: auth(seed.operator.userId),
    });
    const rows = await harness.db
      .select()
      .from(schema.settlements)
      .where(eq(schema.settlements.eventId, seed.event.id));
    const bandSettlement = rows.find((r) => r.participantId === seed.bPart);
    if (!bandSettlement) throw new Error("no band settlement");

    const override = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${seed.event.id}/settlements/${bandSettlement.id}`,
      headers: auth(seed.operator.userId),
      payload: {
        manualOverrides: { note: "cash paid at door", net: "290000" },
        expectedVersion: 1,
      },
    });
    expect(override.statusCode).toBe(200);
    expect(override.json().version).toBe(2);

    const [after] = await harness.db
      .select()
      .from(schema.settlements)
      .where(eq(schema.settlements.id, bandSettlement.id));
    expect((after?.manualOverrides as { net: string }).net).toBe("290000");

    // The band confirms its own settlement.
    const confirm = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlements/${bandSettlement.id}/confirm`,
      headers: auth(seed.band.userId),
    });
    expect(confirm.statusCode).toBe(200);
    expect(confirm.json().approved).toBe(true);

    const approvals = await harness.db
      .select()
      .from(schema.settlementApprovals)
      .where(eq(schema.settlementApprovals.partyParticipantId, seed.bPart));
    expect(approvals).toHaveLength(1);
  });
});

describe("settlement — multi-currency + locked FX (money.md, #7)", () => {
  // The cache table is global (PK base+quote), so upsert to stay test-isolated.
  const cacheRate = (base: string, quote: string, rate: string) =>
    harness.db
      .insert(schema.exchangeRateCache)
      .values({ base, quote, rate })
      .onConflictDoUpdate({
        target: [schema.exchangeRateCache.base, schema.exchangeRateCache.quote],
        set: { rate },
      });

  /** A SEK event with a guarantee in `dealCurrency`. */
  async function seedFxExample(prefix: string, dealCurrency = "EUR") {
    const { db } = harness;
    const operator = await seedMemberWithSet(
      `${prefix}-op`,
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const band = await seedMemberWithSet(
      `${prefix}-band`,
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );
    const [event] = await db
      .insert(schema.events)
      .values({
        hostProfileId: operator.profileId,
        title: "FX Night",
        baseCurrency: "SEK",
        createdBy: operator.userId,
      })
      .returning();
    if (!event) throw new Error("event seed failed");
    const parts = await db
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
          profileId: band.profileId,
          role: "performer",
          permissionSetId: band.permissionSetId,
          status: "confirmed",
        },
      ])
      .returning();
    const pPart = parts.find((p) => p.profileId === operator.profileId)?.id as string;
    const bPart = parts.find((p) => p.profileId === band.profileId)?.id as string;

    // A guarantee denominated in a non-base currency (100.00 of it).
    const [deal] = await db
      .insert(schema.deals)
      .values({
        eventId: event.id,
        type: "performance",
        structure: "guarantee",
        name: `${dealCurrency} guarantee`,
        currency: dealCurrency,
        guaranteeAmount: 10_000n,
        createdBy: operator.userId,
      })
      .returning();
    await db
      .insert(schema.dealParties)
      .values({ dealId: deal?.id as string, participantId: bPart, roleInDeal: "payee" });

    // Enough SEK cash collected by the operator to cover it.
    const [budget] = await db.insert(schema.budgets).values({ eventId: event.id }).returning();
    await db.insert(schema.budgetLines).values({
      budgetId: budget?.id as string,
      kind: "revenue",
      label: "Tickets",
      amount: 200_000n,
      collectedBy: pPart,
    });

    return { event, operator, pPart, bPart };
  }

  it("converts a EUR guarantee to the SEK base at the cached rate before reconciling", async () => {
    const seed = await seedFxExample("fx");
    await cacheRate("EUR", "SEK", "11.5000000000");

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/compute`,
      headers: auth(seed.operator.userId),
    });
    expect(response.statusCode).toBe(200);
    const byId = new Map<string, string>(
      response
        .json()
        .breakdowns.map((b: { participantId: string; net: string }) => [b.participantId, b.net]),
    );
    // 100.00 EUR × 11.5 = 1150.00 SEK entitlement for the band.
    expect(byId.get(seed.bPart)).toBe("115000");
    expect(byId.get(seed.pPart)).toBe("-115000");

    const transfers = await harness.db
      .select()
      .from(schema.settlementTransfers)
      .where(eq(schema.settlementTransfers.eventId, seed.event.id));
    expect(transfers.find((t) => t.toParticipant === seed.bPart)?.amount).toBe(115_000n);
  });

  it("finalize freezes the FX rate map into the snapshot", async () => {
    const seed = await seedFxExample("fxlock");
    await cacheRate("EUR", "SEK", "11.5000000000");
    await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/compute`,
      headers: auth(seed.operator.userId),
    });
    await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/finalize`,
      headers: auth(seed.operator.userId),
    });

    const [snapshot] = await harness.db
      .select()
      .from(schema.settlementSnapshots)
      .where(eq(schema.settlementSnapshots.eventId, seed.event.id));
    const locked = (
      snapshot?.data as { lockedRates: { rates: Record<string, string>; baseCurrency: string } }
    ).lockedRates;
    expect(locked.baseCurrency).toBe("SEK");
    expect(locked.rates.EUR).toBe("11.5000000000");
  });

  it("400s a compute when a required rate is not cached", async () => {
    const seed = await seedFxExample("fxmiss", "NOK"); // NOK deal, no NOK→SEK cached
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/compute`,
      headers: auth(seed.operator.userId),
    });
    expect(response.statusCode).toBe(400);
  });
});

describe("settlement — per-party split shares (A-01 regression)", () => {
  /**
   * The bug this guards: the engine read `share.basisPoints` while every real writer stored
   * `share.splitBasisPoints`, so a signed 60/40 deal paid out 50/50. It survived because
   * `Σ net = 0` validates the TOTAL, not the DISTRIBUTION — and because the only code writing
   * `basisPoints` was the test suite itself, which agreed with the engine and disagreed with
   * the database.
   *
   * So this fixture stores the share exactly as the API and the seed store it, and asserts the
   * amounts each party actually receives. Asserting balance alone passes either way, which is
   * precisely why nothing caught it.
   */
  async function seedSplit(prefix: string, shares: [number, number]) {
    const { db } = harness;
    const operator = await seedMemberWithSet(
      `${prefix}-op`,
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const actA = await seedMemberWithSet(
      `${prefix}-a`,
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );
    const actB = await seedMemberWithSet(
      `${prefix}-b`,
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );

    const [event] = await db
      .insert(schema.events)
      .values({
        hostProfileId: operator.profileId,
        title: "Split Night",
        baseCurrency: "SEK",
        createdBy: operator.userId,
      })
      .returning();
    if (!event) throw new Error("event seed failed");

    const parts = await db
      .insert(schema.eventParticipants)
      .values(
        [operator, actA, actB].map((member, index) => ({
          eventId: event.id,
          profileId: member.profileId,
          role: index === 0 ? ("host" as const) : ("performer" as const),
          permissionSetId: member.permissionSetId,
          status: "confirmed" as const,
        })),
      )
      .returning();
    const hostPart = parts.find((row) => row.profileId === operator.profileId)?.id as string;
    const aPart = parts.find((row) => row.profileId === actA.profileId)?.id as string;
    const bPart = parts.find((row) => row.profileId === actB.profileId)?.id as string;

    // Pool = 1 000 000 revenue − 150 000 cost = 850 000, all of it to the split.
    const [budget] = await db
      .insert(schema.budgets)
      .values({ eventId: event.id })
      .returning();
    if (!budget) throw new Error("budget seed failed");
    await db.insert(schema.budgetLines).values([
      {
        budgetId: budget.id,
        kind: "revenue",
        label: "Tickets",
        amount: 1000000n,
        collectedBy: hostPart,
      },
      { budgetId: budget.id, kind: "cost", label: "Sound hire", amount: 150000n, paidBy: hostPart },
    ]);

    const [deal] = await db
      .insert(schema.deals)
      .values({
        eventId: event.id,
        type: "performance",
        structure: "door_split",
        name: "Uneven split",
        currency: "SEK",
        splitBasisPoints: 10000,
        createdBy: operator.userId,
      })
      .returning();
    if (!deal) throw new Error("deal seed failed");

    await db.insert(schema.dealParties).values([
      { dealId: deal.id, participantId: hostPart, roleInDeal: "payer" },
      {
        dealId: deal.id,
        participantId: aPart,
        roleInDeal: "split_member",
        share: { splitBasisPoints: shares[0], currency: "SEK" },
      },
      {
        dealId: deal.id,
        participantId: bPart,
        roleInDeal: "split_member",
        share: { splitBasisPoints: shares[1], currency: "SEK" },
      },
    ]);

    return { event, operator, aPart, bPart };
  }

  const compute = (eventId: string, uid: string) =>
    app.inject({
      method: "POST",
      url: `/api/v1/events/${eventId}/settlement/compute`,
      headers: auth(uid),
    });

  const entitlementOf = (
    body: { breakdowns: { participantId: string; entitlement: string }[] },
    id: string,
  ) => body.breakdowns.find((row) => row.participantId === id)?.entitlement;

  it("honours an uneven split instead of paying everyone equally", async () => {
    const seed = await seedSplit("split-uneven", [6000, 4000]);

    const response = await compute(seed.event.id, seed.operator.userId);

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.pool).toBe("850000");
    expect(entitlementOf(body, seed.aPart)).toBe("510000"); // 60%
    expect(entitlementOf(body, seed.bPart)).toBe("340000"); // 40%
    // Pre-fix this was 425000/425000 — and it balanced.
    expect(entitlementOf(body, seed.aPart)).not.toBe(entitlementOf(body, seed.bPart));
  });

  it("balances either way, which is why balance alone never caught this", async () => {
    const seed = await seedSplit("split-balance", [7500, 2500]);

    const response = await compute(seed.event.id, seed.operator.userId);

    expect(response.statusCode).toBe(200);
    const body = response.json();
    const net = body.breakdowns.reduce(
      (total: bigint, row: { net: string }) => total + BigInt(row.net),
      0n,
    );
    expect(net).toBe(0n);
    expect(entitlementOf(body, seed.aPart)).toBe("637500"); // 75%
    expect(entitlementOf(body, seed.bPart)).toBe("212500"); // 25%
  });

  it("refuses to settle a share it cannot read rather than splitting equally", async () => {
    const { db } = harness;
    const seed = await seedSplit("split-unreadable", [5000, 5000]);
    // The exact pre-fix shape: an object carrying only a key the engine does not know.
    await db
      .update(schema.dealParties)
      .set({ share: { basisPoints: 6000 } })
      .where(eq(schema.dealParties.participantId, seed.aPart));

    const response = await compute(seed.event.id, seed.operator.userId);

    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain("splitBasisPoints");
  });
});
