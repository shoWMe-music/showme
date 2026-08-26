import { PRESET_PERMISSION_SETS } from "@showme/auth";
import { schema } from "@showme/db";
import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import { convertMinorUnits } from "@showme/shared";
import { and, eq } from "drizzle-orm";
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
  // The operator is the PAYER on both deals — which is the only reason it sees the
  // venue's and the band's settlement lines (decisions #4: the operator's breadth is
  // emergent from party membership, never from a capability).
  await db.insert(schema.dealParties).values([
    { dealId: rental.id, participantId: pPart, roleInDeal: "payer" },
    { dealId: rental.id, participantId: vPart, roleInDeal: "payee" },
    { dealId: guarantee.id, participantId: pPart, roleInDeal: "payer" },
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
  it("shows the paying operator every line it funds but a performer only their own", async () => {
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
    // And never the operator's own line, which IS the event's margin.
    expect(
      bandBody.settlements.some(
        (row: { participantId: string }) => row.participantId === seed.pPart,
      ),
    ).toBe(false);
  });

  /**
   * A-07. `budget.view` used to be the whole access rule, so a co-operator with the
   * operator preset read every figure on the event. Visibility is membership of the
   * resource's party set — being an operator on the event is not itself the grant.
   */
  it("shows an operator that is a party to nothing only its own line", async () => {
    const seed = await seedWorkedExample("vis-outside");
    const coHost = await seedMemberWithSet(
      "vis-outside-cohost",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const [coHostPart] = await harness.db
      .insert(schema.eventParticipants)
      .values({
        eventId: seed.event.id,
        profileId: coHost.profileId,
        role: "co_host",
        permissionSetId: coHost.permissionSetId,
        status: "confirmed",
      })
      .returning();
    await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/compute`,
      headers: auth(seed.operator.userId),
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/events/${seed.event.id}/settlements`,
      headers: auth(coHost.userId),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    // Its own line and nothing else — not the band's entitlement, not the venue's.
    expect(body.settlements).toHaveLength(1);
    expect(body.settlements[0].participantId).toBe(coHostPart?.id);
    // Only transfers it is itself an end of (its own share of the residual).
    expect(body.transfers.length).toBeGreaterThan(0);
    for (const transfer of body.transfers as {
      fromParticipantId: string;
      toParticipantId: string;
    }[]) {
      expect([transfer.fromParticipantId, transfer.toParticipantId]).toContain(coHostPart?.id);
    }
    // It holds `budget.view` — which is now no part of the answer.
    expect(PRESET_PERMISSION_SETS.operator_full).toContain("budget.view");
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
    // The lines the operator funds — its own, the venue's and the band's. The agent
    // is a participant it can see on the event, but it is a party to no deal
    // (decisions #14: "never a separate entitled party"), so it has no line here and
    // the operator never sees the commission.
    expect(operatorBody.settlements).toHaveLength(3);
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

  /**
   * A-10. The commission "is settled manually like any transfer" and the private rows
   * go "only to the performer/agent … and never to the operator" (decisions #14) — but
   * the route required `settlement.edit`, which is in neither the `performer` nor the
   * `agent` preset. So the ONLY account that could settle it was the one account that
   * must never learn it exists, and the 200 handed back the amount, the representation
   * id and the performer→agent direction.
   */
  it("lets the performer settle its own commission transfer", async () => {
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

    // Neither preset holds `settlement.edit`; being an end of the transfer is the grant.
    expect(PRESET_PERMISSION_SETS.performer).not.toContain("settlement.edit");
    const paid = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${seed.event.id}/transfers/${transfer.id}`,
      headers: auth(seed.band.userId),
      payload: { state: "paid", expectedVersion: 1 },
    });
    expect(paid.statusCode).toBe(200);
    expect(paid.json().state).toBe("paid");
  });

  it("lets the agent settle the same commission transfer", async () => {
    const seed = await seedWorkedExample("commsettle-agent");
    const rep = await seedAgentRepresentation("commsettle-agent", seed);
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

    expect(PRESET_PERMISSION_SETS.agent).not.toContain("settlement.edit");
    const handled = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${seed.event.id}/transfers/${transfer.id}`,
      headers: auth(rep.agentUserId),
      payload: { state: "handled", expectedVersion: 1 },
    });
    expect(handled.statusCode).toBe(200);
    expect(handled.json().state).toBe("handled");
  });

  it("refuses the operator the commission transfer without disclosing it", async () => {
    const seed = await seedWorkedExample("commsettle-op");
    const rep = await seedAgentRepresentation("commsettle-op", seed);
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

    const response = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${seed.event.id}/transfers/${transfer.id}`,
      headers: auth(seed.operator.userId),
      payload: { state: "paid", expectedVersion: 1 },
    });

    // 404, not 403: a 403 would confirm the commission exists on this event.
    expect(response.statusCode).toBe(404);
    const raw = response.payload;
    expect(raw).not.toContain("60000"); // the amount
    expect(raw).not.toContain(rep.representation.id); // the representation
    expect(raw).not.toContain(rep.agentPart); // the performer→agent direction
    // And the row is untouched.
    const [after] = await harness.db
      .select()
      .from(schema.settlementTransfers)
      .where(eq(schema.settlementTransfers.id, transfer.id));
    expect(after?.state).toBe("owed");
    expect(after?.version).toBe(1);
  });

  it("keeps a commission the performer already paid across a recompute", async () => {
    const seed = await seedWorkedExample("commpaid");
    const rep = await seedAgentRepresentation("commpaid", seed);
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
    await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${seed.event.id}/transfers/${transfer.id}`,
      headers: auth(seed.band.userId),
      payload: { state: "paid", expectedVersion: 1 },
    });

    const recompute = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/compute`,
      headers: auth(seed.operator.userId),
    });
    expect(recompute.statusCode).toBe(200);

    const [after] = await harness.db
      .select()
      .from(schema.settlementTransfers)
      .where(eq(schema.settlementTransfers.representationId, rep.representation.id));
    expect(after?.id).toBe(transfer.id);
    expect(after?.state).toBe("paid");
    expect(after?.version).toBe(2);
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

  /**
   * A-09. Finalize returned a snapshot version and never wrote `settlements.status`,
   * so the `finalized` value in the enum was unreachable through the API — and the
   * figures behind the "immutable legal record" stayed as editable as before it.
   */
  it("finalize actually moves every settlement to `finalized`", async () => {
    const seed = await seedWorkedExample("final-status");
    await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/compute`,
      headers: auth(seed.operator.userId),
    });
    const before = await harness.db
      .select()
      .from(schema.settlements)
      .where(eq(schema.settlements.eventId, seed.event.id));
    expect(before.every((row) => row.status === "open")).toBe(true);

    const finalize = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/finalize`,
      headers: auth(seed.operator.userId),
    });
    expect(finalize.statusCode).toBe(200);

    const after = await harness.db
      .select()
      .from(schema.settlements)
      .where(eq(schema.settlements.eventId, seed.event.id));
    expect(after).toHaveLength(3);
    expect(after.every((row) => row.status === "finalized")).toBe(true);
    // And the snapshot records the frozen state, not the pre-finalize one.
    const [snapshot] = await harness.db
      .select()
      .from(schema.settlementSnapshots)
      .where(eq(schema.settlementSnapshots.eventId, seed.event.id));
    const stored = (snapshot?.data as { settlements: { status: string }[] }).settlements;
    expect(stored.every((row) => row.status === "finalized")).toBe(true);
  });

  it("refuses a recompute after finalize and leaves every figure untouched", async () => {
    const seed = await seedWorkedExample("final-lock");
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
    const frozen = await harness.db
      .select()
      .from(schema.settlements)
      .where(eq(schema.settlements.eventId, seed.event.id));

    // The audit's reproduction: a new budget line lands, then a recompute silently
    // replaces every figure with no new snapshot. Now the recompute is rejected.
    const [budget] = await harness.db
      .select()
      .from(schema.budgets)
      .where(eq(schema.budgets.eventId, seed.event.id));
    await harness.db.insert(schema.budgetLines).values({
      budgetId: budget?.id as string,
      kind: "revenue",
      label: "Late bar",
      amount: 50000n,
      collectedBy: seed.pPart,
    });

    const recompute = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/compute`,
      headers: auth(seed.operator.userId),
    });

    expect(recompute.statusCode).toBe(409);
    const after = await harness.db
      .select()
      .from(schema.settlements)
      .where(eq(schema.settlements.eventId, seed.event.id));
    const byRow = (rows: typeof after) =>
      rows.map((row) => `${row.id}|${row.version}|${JSON.stringify(row.computed)}`).sort();
    expect(byRow(after)).toEqual(byRow(frozen));
    // Exactly one snapshot — no figure moved behind the legal record.
    const snapshots = await harness.db
      .select()
      .from(schema.settlementSnapshots)
      .where(eq(schema.settlementSnapshots.eventId, seed.event.id));
    expect(snapshots).toHaveLength(1);
  });

  it("still lets a finalized settlement's transfers be marked paid", async () => {
    const seed = await seedWorkedExample("final-pay");
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
    const [transfer] = await harness.db
      .select()
      .from(schema.settlementTransfers)
      .where(eq(schema.settlementTransfers.eventId, seed.event.id));

    const paid = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${seed.event.id}/transfers/${transfer?.id}`,
      headers: auth(seed.operator.userId),
      payload: { state: "paid", expectedVersion: 1 },
    });

    expect(paid.statusCode).toBe(200);
    expect(paid.json().state).toBe("paid");
  });

  it("refuses to finalize the same settlement twice", async () => {
    const seed = await seedWorkedExample("final-twice");
    await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/compute`,
      headers: auth(seed.operator.userId),
    });
    const first = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/finalize`,
      headers: auth(seed.operator.userId),
    });
    const second = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/finalize`,
      headers: auth(seed.operator.userId),
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(409);
    const snapshots = await harness.db
      .select()
      .from(schema.settlementSnapshots)
      .where(eq(schema.settlementSnapshots.eventId, seed.event.id));
    expect(snapshots).toHaveLength(1);
  });

  it("refuses to finalize a settlement that was never computed", async () => {
    const seed = await seedWorkedExample("final-uncomputed");

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/finalize`,
      headers: auth(seed.operator.userId),
    });

    expect(response.statusCode).toBe(400);
  });

  /**
   * A-08. Compute used to `DELETE` every transfer for the event and re-`INSERT`, so a
   * transfer somebody had marked `paid` (version 2) came back `owed` (version 1) on
   * IDENTICAL inputs — the lost update decisions.md #8 says the optimistic lock exists
   * to make impossible ("never a silent overwrite").
   */
  it("keeps a transfer marked paid across a recompute on identical inputs", async () => {
    const seed = await seedWorkedExample("keep-paid");
    await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/compute`,
      headers: auth(seed.operator.userId),
    });
    const [transfer] = await harness.db
      .select()
      .from(schema.settlementTransfers)
      .where(eq(schema.settlementTransfers.eventId, seed.event.id));
    if (!transfer) throw new Error("no transfer to mark paid");
    const paid = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${seed.event.id}/transfers/${transfer.id}`,
      headers: auth(seed.operator.userId),
      payload: { state: "paid", expectedVersion: 1 },
    });
    expect(paid.json().version).toBe(2);

    const recompute = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/compute`,
      headers: auth(seed.operator.userId),
    });
    expect(recompute.statusCode).toBe(200);

    const [after] = await harness.db
      .select()
      .from(schema.settlementTransfers)
      .where(eq(schema.settlementTransfers.id, transfer.id));
    // Same row, same id, same recorded payment — not deleted and re-inserted.
    expect(after?.state).toBe("paid");
    expect(after?.version).toBe(2);
    expect(after?.amount).toBe(transfer.amount);
    const all = await harness.db
      .select()
      .from(schema.settlementTransfers)
      .where(eq(schema.settlementTransfers.eventId, seed.event.id));
    expect(all).toHaveLength(2); // no duplicate rows either
  });

  it("rejects a recompute that would rewrite a transfer already marked paid", async () => {
    const seed = await seedWorkedExample("rewrite-paid");
    await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/compute`,
      headers: auth(seed.operator.userId),
    });
    const transfers = await harness.db
      .select()
      .from(schema.settlementTransfers)
      .where(eq(schema.settlementTransfers.eventId, seed.event.id));
    const toBand = transfers.find((row) => row.toParticipant === seed.bPart);
    if (!toBand) throw new Error("no band transfer");
    await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${seed.event.id}/transfers/${toBand.id}`,
      headers: auth(seed.operator.userId),
      payload: { state: "paid", expectedVersion: 1 },
    });

    // The band's guarantee is renegotiated downwards AFTER the payment was recorded.
    await harness.db
      .update(schema.deals)
      .set({ guaranteeAmount: 250000n })
      .where(and(eq(schema.deals.eventId, seed.event.id), eq(schema.deals.structure, "guarantee")));

    const recompute = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/compute`,
      headers: auth(seed.operator.userId),
    });

    expect(recompute.statusCode).toBe(409);
    const [after] = await harness.db
      .select()
      .from(schema.settlementTransfers)
      .where(eq(schema.settlementTransfers.id, toBand.id));
    expect(after?.state).toBe("paid");
    expect(after?.amount).toBe(300000n);

    // The escape hatch is explicit and audited: put it back to `owed`, then recompute.
    await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${seed.event.id}/transfers/${toBand.id}`,
      headers: auth(seed.operator.userId),
      payload: { state: "owed", expectedVersion: 2 },
    });
    const retry = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/compute`,
      headers: auth(seed.operator.userId),
    });
    expect(retry.statusCode).toBe(200);
  });

  it("keeps a manual override and the row's version across a recompute", async () => {
    const seed = await seedWorkedExample("keep-override");
    await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/compute`,
      headers: auth(seed.operator.userId),
    });
    const rows = await harness.db
      .select()
      .from(schema.settlements)
      .where(eq(schema.settlements.eventId, seed.event.id));
    const bandSettlement = rows.find((row) => row.participantId === seed.bPart);
    if (!bandSettlement) throw new Error("no band settlement");
    await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${seed.event.id}/settlements/${bandSettlement.id}`,
      headers: auth(seed.operator.userId),
      payload: { manualOverrides: { note: "cash at door" }, expectedVersion: 1 },
    });

    await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/compute`,
      headers: auth(seed.operator.userId),
    });

    const [after] = await harness.db
      .select()
      .from(schema.settlements)
      .where(eq(schema.settlements.id, bandSettlement.id));
    expect(after?.manualOverrides).toEqual({ note: "cash at door" });
    expect(after?.version).toBe(2);
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

  /**
   * `isYours` and `approvedByYou` are what a screen hangs the sign-off control off.
   * Without them the operator — who is a party on the deals it funds and so reads
   * several lines — cannot tell which single line "you can only confirm your own
   * settlement" is about, and nothing anywhere says whether that signature has
   * already been given.
   */
  it("marks the caller's own settlement line, and whether they have signed it", async () => {
    const seed = await seedWorkedExample("own-line");
    await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/compute`,
      headers: auth(seed.operator.userId),
    });

    const asBand = await app.inject({
      method: "GET",
      url: `/api/v1/events/${seed.event.id}/settlements`,
      headers: auth(seed.band.userId),
    });
    const mine = asBand.json().settlements.filter((row: { isYours: boolean }) => row.isYours);
    expect(mine).toHaveLength(1);
    expect(mine[0].participantId).toBe(seed.bPart);
    expect(mine[0].approvedByYou).toBe(false);

    // The operator reads the same event and does NOT see the band's line as its own.
    const asOperator = await app.inject({
      method: "GET",
      url: `/api/v1/events/${seed.event.id}/settlements`,
      headers: auth(seed.operator.userId),
    });
    const bandLine = asOperator
      .json()
      .settlements.find((row: { participantId: string }) => row.participantId === seed.bPart);
    expect(bandLine.isYours).toBe(false);

    await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlements/${mine[0].id}/confirm`,
      headers: auth(seed.band.userId),
    });
    const afterSigning = await app.inject({
      method: "GET",
      url: `/api/v1/events/${seed.event.id}/settlements`,
      headers: auth(seed.band.userId),
    });
    expect(
      afterSigning.json().settlements.find((row: { isYours: boolean }) => row.isYours)
        .approvedByYou,
    ).toBe(true);
    // And the operator still never learns the band signed — that is the band's own
    // line, and `approvedByYou` is only ever read for the caller's own rows.
    const operatorView = await app.inject({
      method: "GET",
      url: `/api/v1/events/${seed.event.id}/settlements`,
      headers: auth(seed.operator.userId),
    });
    expect(
      operatorView
        .json()
        .settlements.find((row: { participantId: string }) => row.participantId === seed.bPart)
        .approvedByYou,
    ).toBe(false);
  });

  /** A signature given twice is still one signature (two tabs, or a re-visit). */
  it("records only one approval however many times the same party confirms", async () => {
    const seed = await seedWorkedExample("confirm-twice");
    await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/compute`,
      headers: auth(seed.operator.userId),
    });
    const rows = await harness.db
      .select()
      .from(schema.settlements)
      .where(eq(schema.settlements.eventId, seed.event.id));
    const bandSettlement = rows.find((row) => row.participantId === seed.bPart);
    if (!bandSettlement) throw new Error("no band settlement");

    const first = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlements/${bandSettlement.id}/confirm`,
      headers: auth(seed.band.userId),
    });
    const second = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlements/${bandSettlement.id}/confirm`,
      headers: auth(seed.band.userId),
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().id).toBe(first.json().id);

    const approvals = await harness.db
      .select()
      .from(schema.settlementApprovals)
      .where(eq(schema.settlementApprovals.partyParticipantId, seed.bPart));
    expect(approvals).toHaveLength(1);
  });

  /**
   * An approval is a signature. The route accepted any settlement id on the event, so
   * the operator — who holds `settlement.confirm` for its OWN line — could record the
   * band's approval of the band's money. Same party-scoping rule as the read (A-07).
   */
  it("refuses to let the operator confirm the band's settlement for them", async () => {
    const seed = await seedWorkedExample("confirm-forge");
    await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/compute`,
      headers: auth(seed.operator.userId),
    });
    const rows = await harness.db
      .select()
      .from(schema.settlements)
      .where(eq(schema.settlements.eventId, seed.event.id));
    const bandSettlement = rows.find((row) => row.participantId === seed.bPart);

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlements/${bandSettlement?.id}/confirm`,
      headers: auth(seed.operator.userId),
    });

    expect(response.statusCode).toBe(403);
    const approvals = await harness.db
      .select()
      .from(schema.settlementApprovals)
      .where(eq(schema.settlementApprovals.partyParticipantId, seed.bPart));
    expect(approvals).toHaveLength(0);
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

  /**
   * A-05. Conversion happened at COMPUTE with the live rate, while finalize re-read the
   * cache and wrote TODAY's rate into `data.lockedRates` without recomputing. An
   * entitlement produced at 11.0 was filed under a locked 5.0 — replay the locked rate
   * and you get 500 000, not 1 100 000. The audit record refuted itself.
   *
   * money.md:30 stores the locked rate "for reproducibility/audit", which only means
   * anything if the stored rate is the rate the stored figures came from. So finalize
   * re-derives the settlement with the rates it is about to lock and refuses to freeze
   * anything they no longer reproduce.
   */
  it("refuses to finalize figures the rates it would lock no longer reproduce", async () => {
    const seed = await seedFxExample("fxdrift");
    await cacheRate("EUR", "SEK", "11.0000000000");
    const compute = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/compute`,
      headers: auth(seed.operator.userId),
    });
    // 100.00 EUR × 11.0 = 1 100.00 SEK.
    expect(
      compute
        .json()
        .breakdowns.find((row: { participantId: string }) => row.participantId === seed.bPart)
        .entitlement,
    ).toBe("110000");

    // The rate moves before anyone finalizes.
    await cacheRate("EUR", "SEK", "5.0000000000");
    const finalize = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/finalize`,
      headers: auth(seed.operator.userId),
    });

    expect(finalize.statusCode).toBe(409);
    const snapshots = await harness.db
      .select()
      .from(schema.settlementSnapshots)
      .where(eq(schema.settlementSnapshots.eventId, seed.event.id));
    expect(snapshots).toHaveLength(0);
  });

  it("locks rates that reproduce the snapshot's own figures, arithmetically", async () => {
    const seed = await seedFxExample("fxrepro");
    await cacheRate("EUR", "SEK", "11.0000000000");
    await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/compute`,
      headers: auth(seed.operator.userId),
    });
    // The rate moves; the operator recomputes on it and only then finalizes.
    await cacheRate("EUR", "SEK", "5.0000000000");
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

    const [snapshot] = await harness.db
      .select()
      .from(schema.settlementSnapshots)
      .where(eq(schema.settlementSnapshots.eventId, seed.event.id));
    const data = snapshot?.data as {
      settlements: { participantId: string | null; computed: { entitlement: string } | null }[];
      lockedRates: { baseCurrency: string; rates: Record<string, string> };
    };
    const bandLine = data.settlements.find((row) => row.participantId === seed.bPart);
    if (!bandLine?.computed) throw new Error("no band line in the snapshot");

    // Replay the snapshot's OWN locked rate over the deal's native 100.00 EUR and it
    // must land exactly on the snapshot's own entitlement. This is the whole finding:
    // pre-fix the locked rate was 5.0 against a figure produced at 11.0.
    const replayed = convertMinorUnits(
      10_000n,
      "EUR",
      data.lockedRates.baseCurrency,
      data.lockedRates.rates.EUR as string,
    );
    expect(replayed.toString()).toBe(bandLine.computed.entitlement);
    expect(bandLine.computed.entitlement).toBe("50000");
    expect(data.lockedRates.rates.EUR).toBe("5.0000000000");
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
    const [budget] = await db.insert(schema.budgets).values({ eventId: event.id }).returning();
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

describe("settlement — GET /settlements (the caller's own, across events)", () => {
  /**
   * The Settlements screen lists settlements, not events (audit A-35). This endpoint is
   * what it reads, so its scoping is the thing standing between a performer and someone
   * else's money — asserted here rather than trusted to the caller.
   */
  it("returns only the caller's own rows, with their own figures", async () => {
    const seed = await seedWorkedExample("mine");
    await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/compute`,
      headers: auth(seed.operator.userId),
    });

    const asBand = await app.inject({
      method: "GET",
      url: "/api/v1/settlements",
      headers: auth("mine-band"),
    });

    expect(asBand.statusCode).toBe(200);
    const items = asBand.json().items;
    expect(items).toHaveLength(1);
    expect(items[0].participantId).toBe(seed.bPart);
    expect(items[0].entitlement).toBe("300000");
    expect(items[0].event.id).toBe(seed.event.id);
    expect(items[0].currency).toBe("SEK");
  });

  it("gives each party a different row for the same event", async () => {
    const seed = await seedWorkedExample("mine-two");
    await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/compute`,
      headers: auth(seed.operator.userId),
    });

    const band = await app.inject({
      method: "GET",
      url: "/api/v1/settlements",
      headers: auth("mine-two-band"),
    });
    const venue = await app.inject({
      method: "GET",
      url: "/api/v1/settlements",
      headers: auth("mine-two-venue"),
    });

    expect(band.json().items[0].participantId).toBe(seed.bPart);
    expect(venue.json().items[0].participantId).toBe(seed.vPart);
    expect(band.json().items[0].entitlement).not.toBe(venue.json().items[0].entitlement);
  });

  it("is empty for someone with no settlements rather than erroring", async () => {
    const outsider = await seedMemberWithSet(
      "mine-outsider",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );
    expect(outsider.profileId).toBeTruthy();

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/settlements",
      headers: auth("mine-outsider"),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().items).toEqual([]);
  });
});

/**
 * A-14 — the already-poisoned case. A budget line pointing at a foreign participant
 * used to 500 EVERY compute, forever, with an empty body (the API runs `logger: false`,
 * so nothing was written anywhere either). `assertBalanced` is right to refuse — Σ net = 0
 * is the invariant the engine rests on — but the operator was given no way to learn which
 * row was at fault. Compute now names the line and the DELETE that clears it.
 */
describe("settlement — a foreign budget-line reference is diagnosable (A-14)", () => {
  it("names the offending line with a 409 instead of an opaque 500, and stays fixable", async () => {
    const seed = await seedWorkedExample("poisoned");

    // A second event, whose participant id is foreign to the one being settled.
    const other = await seedWorkedExample("poisoned-other");

    // Write the row the pre-fix route would have accepted (201) — bypassing the
    // route on purpose: this is the state a DB already in production is in.
    const [budget] = await harness.db
      .select()
      .from(schema.budgets)
      .where(eq(schema.budgets.eventId, seed.event.id));
    if (!budget) throw new Error("budget lookup failed");
    const [poisoned] = await harness.db
      .insert(schema.budgetLines)
      .values({
        budgetId: budget.id,
        kind: "revenue",
        label: "Merch (mis-attributed)",
        amount: 50000n,
        collectedBy: other.pPart, // another event's participant
      })
      .returning();
    if (!poisoned) throw new Error("poisoned line seed failed");

    const blocked = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/compute`,
      headers: auth(seed.operator.userId),
    });
    expect(blocked.statusCode).toBe(409);
    const error = blocked.json().error;
    expect(error.code).toBe("conflict");
    expect(error.message).toContain(poisoned.id); // the offending line, by id
    expect(error.message).toContain("Merch (mis-attributed)"); // …and by label
    expect(error.message).toContain("collectedBy"); // …and the field at fault
    expect(error.message).toContain(
      `DELETE /events/${seed.event.id}/budgets/${budget.id}/lines/${poisoned.id}`,
    ); // …and the way out

    // No settlement was persisted off a budget that cannot balance.
    const rows = await harness.db
      .select()
      .from(schema.settlements)
      .where(eq(schema.settlements.eventId, seed.event.id));
    expect(rows).toHaveLength(0);

    // The way out actually works: remove the line, compute again, books balance.
    await harness.db.delete(schema.budgetLines).where(eq(schema.budgetLines.id, poisoned.id));
    const recovered = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/compute`,
      headers: auth(seed.operator.userId),
    });
    expect(recovered.statusCode).toBe(200);
    expect(recovered.json().pool).toBe("850000");
  });
});

/**
 * A-14, second half — a stored line that names NOBODY. Same arithmetic as the
 * foreign-id case (the amount moves the pool, no participant's `held` moves with
 * it), so it gets the same diagnosis rather than the same opaque 500. Rows like
 * these exist in any database written before the route required an attribution.
 */
describe("settlement — an unattributed budget line is diagnosable (A-14)", () => {
  /** Insert the row the pre-fix route accepted with a 201, bypassing the route. */
  async function seedUnattributedLine(
    prefix: string,
    line: { kind: "revenue" | "cost"; label: string },
  ) {
    const seed = await seedWorkedExample(prefix);
    const [budget] = await harness.db
      .select()
      .from(schema.budgets)
      .where(eq(schema.budgets.eventId, seed.event.id));
    if (!budget) throw new Error("budget lookup failed");
    const [stored] = await harness.db
      .insert(schema.budgetLines)
      .values({ budgetId: budget.id, amount: 100000n, ...line })
      .returning();
    if (!stored) throw new Error("unattributed line seed failed");
    return { seed, budgetId: budget.id, line: stored };
  }

  it("409s naming a revenue line that nobody collected", async () => {
    const { seed, budgetId, line } = await seedUnattributedLine("ghost-rev", {
      kind: "revenue",
      label: "Ghost revenue",
    });

    const blocked = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/compute`,
      headers: auth(seed.operator.userId),
    });
    expect(blocked.statusCode).toBe(409);
    const error = blocked.json().error;
    expect(error.code).toBe("conflict");
    expect(error.message).toContain(line.id);
    expect(error.message).toContain("Ghost revenue");
    expect(error.message).toContain("collectedBy");
    expect(error.message).toContain(
      `DELETE /events/${seed.event.id}/budgets/${budgetId}/lines/${line.id}`,
    );

    // Nothing persisted off books that cannot balance.
    const rows = await harness.db
      .select()
      .from(schema.settlements)
      .where(eq(schema.settlements.eventId, seed.event.id));
    expect(rows).toHaveLength(0);

    // The named DELETE is a real way out.
    await harness.db.delete(schema.budgetLines).where(eq(schema.budgetLines.id, line.id));
    const recovered = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/compute`,
      headers: auth(seed.operator.userId),
    });
    expect(recovered.statusCode).toBe(200);
    expect(recovered.json().pool).toBe("850000");
  });

  it("409s naming a cost line that nobody paid", async () => {
    const { seed, line } = await seedUnattributedLine("ghost-cost", {
      kind: "cost",
      label: "Ghost cost",
    });

    const blocked = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/compute`,
      headers: auth(seed.operator.userId),
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.message).toContain(line.id);
    expect(blocked.json().error.message).toContain("Ghost cost");
    expect(blocked.json().error.message).toContain("paidBy");
  });

  it("computes normally when every line is attributed — including a payee-less external cost", async () => {
    const seed = await seedWorkedExample("attributed");

    // The worked example's own cost is exactly this shape: paidBy set, no payee.
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/compute`,
      headers: auth(seed.operator.userId),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().pool).toBe("850000");
  });
});

/**
 * Settlement is where the audit/activity split bites hardest. `compute` is a
 * recalculation the operator runs a dozen times while the budget moves — audited
 * every time, and never history. `finalize`, an approval and a payment are
 * decisions, and they are the story. No row carries a figure.
 */
describe("settlement — what reaches an event's history", () => {
  it("records finalize, confirm and payment — never a recompute, and never an amount", async () => {
    const seed = await seedWorkedExample("act-hist");
    const activityFor = async (eventId: string) =>
      (
        await harness.db
          .select()
          .from(schema.activityLog)
          .where(eq(schema.activityLog.eventId, eventId))
      ).sort((left, right) => left.type.localeCompare(right.type));

    // Three computes → three audit rows, no history at all.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const compute = await app.inject({
        method: "POST",
        url: `/api/v1/events/${seed.event.id}/settlement/compute`,
        headers: auth(seed.operator.userId),
      });
      expect(compute.statusCode).toBe(200);
    }
    const computeAudits = await harness.db
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.eventId, seed.event.id),
          eq(schema.auditLog.action, "settlement.compute"),
        ),
      );
    expect(computeAudits).toHaveLength(3);
    expect(await activityFor(seed.event.id)).toHaveLength(0);

    // The band approves their own line → one party-scoped row.
    const bandSettlement = (
      await harness.db
        .select()
        .from(schema.settlements)
        .where(eq(schema.settlements.participantId, seed.bPart))
    )[0];
    if (!bandSettlement) throw new Error("band settlement missing");
    const confirmed = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlements/${bandSettlement.id}/confirm`,
      headers: auth(seed.band.userId),
    });
    expect(confirmed.statusCode).toBe(200);

    const finalized = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/finalize`,
      headers: auth(seed.operator.userId),
    });
    expect(finalized.statusCode).toBe(200);

    const transfer = (
      await harness.db
        .select()
        .from(schema.settlementTransfers)
        .where(eq(schema.settlementTransfers.eventId, seed.event.id))
    )[0];
    if (!transfer) throw new Error("transfer missing");
    const paid = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${seed.event.id}/transfers/${transfer.id}`,
      headers: auth(seed.operator.userId),
      payload: { state: "paid" },
    });
    expect(paid.statusCode).toBe(200);

    const rows = await activityFor(seed.event.id);
    expect(rows.map((row) => row.type)).toEqual([
      "settlement.confirmed",
      "settlement.finalized",
      "transfer.state_changed",
    ]);
    // Tiers: the approval is party-scoped to that settlement, finalize is
    // event-level (the figures stopped moving, which is everyone's news), the
    // payment is scoped to the transfer's two ends.
    expect(rows.map((row) => row.targetKind)).toEqual(["settlement", "event", "transfer"]);
    expect(rows.find((row) => row.type === "settlement.confirmed")?.targetId).toBe(
      bandSettlement.id,
    );
    // Not one figure anywhere in the summaries.
    const summaries = JSON.stringify(rows.map((row) => row.summary));
    expect(summaries).not.toContain("300000");
    expect(summaries).not.toMatch(/\d{5,}/);
  });

  it("never writes history for a private agent↔performer commission transfer", async () => {
    const seed = await seedWorkedExample("act-comm");
    const rep = await seedAgentRepresentation("act-comm", seed);
    await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/compute`,
      headers: auth(seed.operator.userId),
    });

    const commission = (
      await harness.db
        .select()
        .from(schema.settlementTransfers)
        .where(eq(schema.settlementTransfers.representationId, rep.representation.id))
    )[0];
    if (!commission) throw new Error("commission transfer missing");

    // The band marks their own commission paid — allowed, and audited.
    const paid = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${seed.event.id}/transfers/${commission.id}`,
      headers: auth(seed.band.userId),
      payload: { state: "paid" },
    });
    expect(paid.statusCode).toBe(200);

    const audited = await harness.db
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.eventId, seed.event.id),
          eq(schema.auditLog.action, "transfer.update"),
        ),
      );
    expect(audited).toHaveLength(1);

    // …and NOTHING in the feed. The operator sees every row on their own event,
    // so the only way to keep a commission out of their timeline is to never
    // write one (decisions #14, audit A-10).
    const rows = await harness.db
      .select()
      .from(schema.activityLog)
      .where(eq(schema.activityLog.eventId, seed.event.id));
    expect(rows.filter((row) => row.targetKind === "transfer")).toHaveLength(0);
  });
});

/**
 * The two budget-line rules the 2026-08 settlements meeting added, proven through
 * the API rather than only in the engine's own unit tests.
 */
describe("settlement — the cost rule and deal-assigned costs", () => {
  it("charges a split cost to the parties that agreed to carry it", async () => {
    const seed = await seedWorkedExample("cost-split");
    const { db } = harness;

    const [budget] = await db
      .select()
      .from(schema.budgets)
      .where(eq(schema.budgets.eventId, seed.event.id));
    if (!budget) throw new Error("budget lookup failed");

    // A 1,000.00 marketing bill the operator fronts, split 50/50 with the band.
    await db.insert(schema.budgetLines).values({
      budgetId: budget.id,
      kind: "cost",
      label: "Marketing",
      amount: 100000n,
      paidBy: seed.pPart,
      costSplit: { [seed.pPart]: 5000, [seed.bPart]: 5000 },
    });

    const computed = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/compute`,
      headers: auth("cost-split-op"),
    });
    expect(computed.statusCode).toBe(200);

    const band = computed
      .json()
      .breakdowns.find((row: { participantId: string }) => row.participantId === seed.bPart);
    // 3,000.00 guarantee less its half (500.00) of the marketing bill.
    expect(band.entitlement).toBe("250000");

    // Σ net = 0 is asserted by the engine, but assert it here too: the whole
    // point of the split is that it cannot quietly unbalance the books.
    const netSum = computed
      .json()
      .breakdowns.reduce((running: bigint, row: { net: string }) => running + BigInt(row.net), 0n);
    expect(netSum).toBe(0n);
  });

  it("does not count a cost assigned to a deal twice", async () => {
    const seed = await seedWorkedExample("deal-cost");
    const { db } = harness;

    const [budget] = await db
      .select()
      .from(schema.budgets)
      .where(eq(schema.budgets.eventId, seed.event.id));
    const [guarantee] = await db
      .select()
      .from(schema.deals)
      .where(eq(schema.deals.name, "Band guarantee"));
    if (!budget || !guarantee) throw new Error("lookup failed");

    const before = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/compute`,
      headers: auth("deal-cost-op"),
    });
    expect(before.statusCode).toBe(200);
    const operatorBefore = before
      .json()
      .breakdowns.find((row: { participantId: string }) => row.participantId === seed.pPart);

    // The planner's "Performer fee" row: the SAME 3,000.00 the deal already
    // guarantees, written down as a forecast and booked against that deal.
    await db.insert(schema.budgetLines).values({
      budgetId: budget.id,
      kind: "cost",
      label: "Performer fee",
      amount: 300000n,
      paidBy: seed.pPart,
      dealId: guarantee.id,
    });

    const after = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/compute`,
      headers: auth("deal-cost-op"),
    });
    expect(after.statusCode).toBe(200);
    const operatorAfter = after
      .json()
      .breakdowns.find((row: { participantId: string }) => row.participantId === seed.pPart);

    // Nothing moved: the settlement takes the band's entitlement from the
    // agreement, so the forecast line beside it changes no figure. Left in the
    // pool it would have cut the operator's residual by the whole 3,000.00.
    expect(operatorAfter.entitlement).toBe(operatorBefore.entitlement);
    expect(operatorAfter.net).toBe(operatorBefore.net);

    const netSum = after
      .json()
      .breakdowns.reduce((running: bigint, row: { net: string }) => running + BigInt(row.net), 0n);
    expect(netSum).toBe(0n);
  });
});
