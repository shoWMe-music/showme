import { PRESET_PERMISSION_SETS } from "@showme/auth";
import { schema } from "@showme/db";
import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import { convertMinorUnits } from "@showme/shared";
import { and, asc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TokenVerifier } from "./auth/token-verifier";
import { dealRoutes } from "./routes/deals";
import { settlementRoutes } from "./routes/settlement";
import { buildTestApp, signEveryAgreement } from "./testing";

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
  // `dealRoutes` rides along so the two ends of this question can be driven through
  // their REAL routes rather than by writing the column by hand: the deal lifecycle
  // is what moves `deals.status`, and the engine is what reads it. Asserting they
  // agree is the whole point of "deal status at the engine boundary" below, and a
  // hand-set column would only prove the fixture agrees with itself.
  app = buildTestApp({ database: harness.db, tokenVerifier: fakeVerifier }, [
    settlementRoutes,
    dealRoutes,
  ]);
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
  kind: "operator" | "performer" | "team_and_crew" | "agent",
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

  // Both agreements are signed, because since 2026-08-31 a settlement cannot
  // open otherwise — see `signEveryAgreement`. The state is written by the same
  // function the real confirm routes call, and the case below that drives those
  // routes on this very fixture proves the two land in the same place.
  await signEveryAgreement(db, event.id);

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

/**
 * "Not reconciled yet" and "you are not a party" are DIFFERENT ANSWERS, and this
 * pins the difference at the seam the screens read.
 *
 * Reported from the running app: the host operator of a confirmed event with a
 * confirmed door-split deal was told "You are not a party to this settlement" on
 * its own show. Nothing was wrong with party resolution — `reconcileEvent` builds
 * its participants from every `event_participants` row and the operator takes the
 * residual, so the host is always a party once the engine has run. The event had
 * simply never been computed, so `settlements` was empty and the browser read an
 * empty list as a statement about the reader.
 *
 * The route has no way to say "not yet" other than an empty list, so this is what
 * the empty list is allowed to mean: nothing has been run, for anybody. The moment
 * it has, the same caller's own line is there and flagged `isYours`. A change that
 * ever made the host's line absent from a computed event would fail the second
 * half — which is the assertion the copy fix is standing on.
 */
describe("settlement — an unreconciled event (empty is 'not yet', not 'not you')", () => {
  it("serves the host an empty settlement before compute and its own line after", async () => {
    const seed = await seedWorkedExample("notyet");

    const before = await app.inject({
      method: "GET",
      url: `/api/v1/events/${seed.event.id}/settlements`,
      headers: auth(seed.operator.userId),
    });
    expect(before.statusCode).toBe(200);
    const beforeBody = before.json();
    // Empty for the HOST — the party that collects the door and absorbs the
    // residual. Not a permission answer: it holds `budget.view` and still gets a
    // null ladder, because `ladderOf` reads the ladder off a stored settlement row
    // and there is none.
    expect(beforeBody.settlements).toHaveLength(0);
    expect(beforeBody.ladder).toBeNull();
    expect(beforeBody.transfers).toHaveLength(0);

    const compute = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/compute`,
      headers: auth(seed.operator.userId),
    });
    expect(compute.statusCode).toBe(200);

    const after = await app.inject({
      method: "GET",
      url: `/api/v1/events/${seed.event.id}/settlements`,
      headers: auth(seed.operator.userId),
    });
    expect(after.statusCode).toBe(200);
    const afterBody = after.json();
    const own = afterBody.settlements.find(
      (row: { participantId: string }) => row.participantId === seed.pPart,
    );
    expect(own).toBeDefined();
    expect(own.isYours).toBe(true);
    // The operator's line is the residual, and on this event it is holding the
    // cash — the negative net is exactly what "the host is a party" looks like.
    expect(own.computed.net).toBe("-400000");
    expect(afterBody.ladder).not.toBeNull();
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

  /**
   * The POOL, by whatever route it tries to leave.
   *
   * `ladder` is gated on `budget.view`, but the same figure rides inside every
   * percentage line's `basis`: `pool` IS `ladder.splitPool`, and `door` divided by
   * `basisPoints` reconstructs it. Gating one and serving the other is a ceiling
   * that only looks closed, and story.md:44 makes no allowance for the difference —
   * a performer sees "only their own slice — never the event budget/pool … even if
   * an operator wanted to show them (an inviolable ceiling)".
   *
   * What a performer KEEPS is their own terms: which rule fired and their own
   * percentage. The line still says what it is; it just cannot say what the whole
   * room took.
   */
  it("redacts the pool from a performer's basis, not just from the ladder", async () => {
    const seed = await seedWorkedExample("vis-pool");
    // Put the band on a percentage of the door, so its basis carries a pool at all.
    await harness.db
      .update(schema.deals)
      .set({ structure: "door_split", splitBasisPoints: 6000, guaranteeAmount: null })
      .where(eq(schema.deals.eventId, seed.event.id));
    await harness.db
      .update(schema.deals)
      .set({ structure: "rental", guaranteeAmount: 100000n, splitBasisPoints: null })
      // Scoped to THIS event as well as the name: every `seedWorkedExample` calls its
      // rental "Venue rental", and the suite shares one database.
      .where(and(eq(schema.deals.eventId, seed.event.id), eq(schema.deals.name, "Venue rental")));

    await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/compute`,
      headers: auth(seed.operator.userId),
    });

    type Line = { basis: { kind: string; pool?: string; door?: string; basisPoints?: number } };
    const linesOf = (body: { settlements: { computed: { lines?: Line[] } | null }[] }): Line[] =>
      body.settlements.flatMap((row) => row.computed?.lines ?? []);

    const asBand = await app.inject({
      method: "GET",
      url: `/api/v1/events/${seed.event.id}/settlements`,
      headers: auth(seed.band.userId),
    });
    expect(asBand.statusCode).toBe(200);
    const bandBody = asBand.json();
    expect(bandBody.ladder).toBeNull();
    const bandLines = linesOf(bandBody);
    // The seed must actually produce a pool-bearing line, or this test proves nothing.
    expect(bandLines.some((line) => line.basis.kind === "door_split")).toBe(true);
    for (const line of bandLines) {
      expect(line.basis.pool).toBeUndefined();
      expect(line.basis.door).toBeUndefined();
      // Their own term survives — the rule is still checkable, the base is not shown.
      if (line.basis.kind === "door_split") expect(line.basis.basisPoints).toBe(6000);
    }

    // The operator, who may read the pool, still gets every operand.
    const asOperator = await app.inject({
      method: "GET",
      url: `/api/v1/events/${seed.event.id}/settlements`,
      headers: auth(seed.operator.userId),
    });
    expect(asOperator.statusCode).toBe(200);
    const operatorBody = asOperator.json();
    expect(operatorBody.ladder).not.toBeNull();
    const doorLine = linesOf(operatorBody).find((line) => line.basis.kind === "door_split");
    expect(doorLine?.basis.pool).toBe(operatorBody.ladder.splitPool);
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
    .values({ id: agentUserId, email: `${agentUserId}@x.showme.test`, kind: "agent" });
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

describe("settlement — the review conversation and derived payment", () => {
  /**
   * The two statuses nobody sets.
   *
   * `partly_paid` and `paid` are a READ of the transfers, not a button — the
   * platform cannot know who holds cash (the 2026-08 meeting, 01:24:48), and
   * `decisions.md` #14 states the principle: "status is derived, not a new enum".
   * This drives the transfers one at a time and watches the settlement follow.
   */
  it("derives partly_paid and paid from the transfers, and refuses to be told", async () => {
    const seed = await seedWorkedExample("derive");
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

    const statusNow = async () => {
      const response = await app.inject({
        method: "GET",
        url: `/api/v1/events/${seed.event.id}/settlements`,
        headers: auth(seed.operator.userId),
      });
      return (response.json().settlements as { status: string }[]).map((row) => row.status);
    };
    expect((await statusNow()).every((status) => status === "finalized")).toBe(true);

    const transfers = await harness.db
      .select()
      .from(schema.settlementTransfers)
      .where(eq(schema.settlementTransfers.eventId, seed.event.id));
    expect(transfers.length).toBeGreaterThan(1);

    // One of several paid → partly_paid, on every party row.
    const first = transfers[0];
    await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${seed.event.id}/transfers/${first?.id}`,
      headers: auth(seed.operator.userId),
      payload: { state: "paid" },
    });
    expect((await statusNow()).every((status) => status === "partly_paid")).toBe(true);

    // The rest paid → paid.
    for (const transfer of transfers.slice(1)) {
      await app.inject({
        method: "PATCH",
        url: `/api/v1/events/${seed.event.id}/transfers/${transfer.id}`,
        headers: auth(seed.operator.userId),
        payload: { state: "paid" },
      });
    }
    expect((await statusNow()).every((status) => status === "paid")).toBe(true);

    // And it cannot be SET. The route's vocabulary is the review conversation
    // only — a body naming a derived status is refused by the schema itself.
    const told = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/status`,
      headers: auth(seed.operator.userId),
      payload: { status: "paid" },
    });
    expect(told.statusCode).toBe(400);
  });

  it("walks the review conversation, and lets a party dispute but not re-issue", async () => {
    const seed = await seedWorkedExample("review");
    await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/compute`,
      headers: auth(seed.operator.userId),
    });

    const send = (userId: string, status: string) =>
      app.inject({
        method: "POST",
        url: `/api/v1/events/${seed.event.id}/settlement/status`,
        headers: auth(userId),
        payload: { status },
      });

    // The operator sends it out.
    expect((await send(seed.operator.userId, "pending_review")).statusCode).toBe(200);

    // A COMMENT moves it on by itself — the remark IS the event, so it needs no
    // second action to record that the settlement came back.
    const commented = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/comments`,
      headers: auth(seed.band.userId),
      payload: { message: "The hotel came off twice." },
    });
    expect(commented.statusCode).toBe(201);
    expect(commented.json().status).toBe("comments_received");

    // The performer reads the thread and sees their own remark.
    const thread = await app.inject({
      method: "GET",
      url: `/api/v1/events/${seed.event.id}/settlement/comments`,
      headers: auth(seed.band.userId),
    });
    expect(thread.statusCode).toBe(200);
    expect(thread.json()).toHaveLength(1);
    expect(thread.json()[0].isYours).toBe(true);

    // A PARTY may dispute — the same authority that signs off, inverted.
    expect((await send(seed.band.userId, "dispute")).statusCode).toBe(200);

    // But may not re-issue: that is a statement about figures they do not own.
    expect((await send(seed.band.userId, "revised")).statusCode).toBe(403);

    // The operator can, and does.
    expect((await send(seed.operator.userId, "revised")).statusCode).toBe(200);
  });

  it("refuses to re-issue a finalized settlement, but still lets a party dispute it", async () => {
    const seed = await seedWorkedExample("locked");
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

    const reissue = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/status`,
      headers: auth(seed.operator.userId),
      payload: { status: "revised" },
    });
    expect(reissue.statusCode).toBe(409);

    // Frozen figures are exactly when a party most needs to object, and saying so
    // moves no money.
    const disputed = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/status`,
      headers: auth(seed.band.userId),
      payload: { status: "dispute" },
    });
    expect(disputed.statusCode).toBe(200);
  });

  it("keeps one party's remarks away from another party", async () => {
    const seed = await seedWorkedExample("thread");
    await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/compute`,
      headers: auth(seed.operator.userId),
    });
    await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/comments`,
      headers: auth(seed.band.userId),
      payload: { message: "Band only." },
    });
    await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/comments`,
      headers: auth(seed.operator.userId),
      payload: { message: "From the operator, to everyone." },
    });

    const asVenue = await app.inject({
      method: "GET",
      url: `/api/v1/events/${seed.event.id}/settlement/comments`,
      headers: auth(seed.venue.userId),
    });
    const venueMessages = (asVenue.json() as { message: string }[]).map((row) => row.message);
    // The event-side remark reaches them; the band's does not.
    expect(venueMessages).toContain("From the operator, to everyone.");
    expect(venueMessages).not.toContain("Band only.");

    // The operator reviewing the settlement reads the whole thread — a review
    // conversation they cannot see is not a review.
    const asOperator = await app.inject({
      method: "GET",
      url: `/api/v1/events/${seed.event.id}/settlement/comments`,
      headers: auth(seed.operator.userId),
    });
    expect((asOperator.json() as unknown[]).length).toBe(2);
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

    await signEveryAgreement(db, event.id);
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

  /**
   * The budget snapshot (#16.8) states its totals in BASE, so a line denominated
   * in another currency has to be converted before it is summed — and with the
   * rates that were in force when the copy was taken, which is why the capture
   * stores its own rate map rather than looking one up on read.
   */
  it("captures a non-base budget line converted to base, with the rates it used", async () => {
    const seed = await seedFxExample("fxsnap");
    await cacheRate("EUR", "SEK", "11.0000000000");
    const [budget] = await harness.db
      .select()
      .from(schema.budgets)
      .where(eq(schema.budgets.eventId, seed.event.id));
    // 100.00 EUR of merch, on a SEK event → 1 100.00 SEK at the cached rate.
    await harness.db.insert(schema.budgetLines).values({
      budgetId: budget?.id as string,
      kind: "revenue",
      label: "Merch (EUR)",
      amount: 10_000n,
      currency: "EUR",
      collectedBy: seed.pPart,
    });

    await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/compute`,
      headers: auth(seed.operator.userId),
    });

    const [capture] = await harness.db
      .select()
      .from(schema.budgetSnapshots)
      .where(eq(schema.budgetSnapshots.eventId, seed.event.id));
    expect(capture?.baseCurrency).toBe("SEK");
    expect(capture?.plannedRevenue).toBe(310000n); // 200 000 SEK + 110 000 SEK
    // The rate travels WITH the copy, so the total stays reproducible from the
    // lines even after the live cache has moved on.
    expect((capture?.data as { rates: Record<string, string> }).rates.EUR).toBe("11.0000000000");

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/events/${seed.event.id}/settlement/planned-vs-actual`,
      headers: auth(seed.operator.userId),
    });
    const body = response.json();
    const merch = body.lines.find((line: { label: string }) => line.label === "Merch (EUR)");
    expect(merch.planned.amount).toBe("10000"); // as typed, in EUR
    expect(merch.planned.currency).toBe("EUR");
    expect(merch.planned.amountBase).toBe("110000"); // and in SEK, for the arithmetic
    expect(body.plan.revenue).toBe("310000");
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

    await signEveryAgreement(db, event.id);
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

    // The line the engine actually read is the SETTLEMENT's copy of the poisoned
    // row (0025), so that is the id it names and the row that has to be fixed.
    // Naming the budget line would send the operator to correct a forecast the
    // settlement has already stopped listening to.
    const [copied] = await harness.db
      .select()
      .from(schema.settlementLines)
      .where(eq(schema.settlementLines.originBudgetLineId, poisoned.id));
    if (!copied) throw new Error("settlement copy not taken");

    expect(error.message).toContain(copied.id); // the offending line, by id
    expect(error.message).toContain("Merch (mis-attributed)"); // …and by label
    expect(error.message).toContain("collectedBy"); // …and the field at fault
    expect(error.message).toContain(
      `DELETE /events/${seed.event.id}/settlement/lines/${copied.id}`,
    ); // …and the way out

    // No settlement was persisted off a budget that cannot balance.
    const rows = await harness.db
      .select()
      .from(schema.settlements)
      .where(eq(schema.settlements.eventId, seed.event.id));
    expect(rows).toHaveLength(0);

    // The way out actually works: remove the line, compute again, books balance.
    // Deleting the BUDGET line here would change nothing — the copy is sealed,
    // which is the whole point of it.
    await harness.db.delete(schema.settlementLines).where(eq(schema.settlementLines.id, copied.id));
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
    const { seed, line } = await seedUnattributedLine("ghost-rev", {
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
    // The engine reads the SETTLEMENT's copy, so that is the row it names and
    // the row that has to be corrected (0025).
    const [copied] = await harness.db
      .select()
      .from(schema.settlementLines)
      .where(eq(schema.settlementLines.originBudgetLineId, line.id));
    if (!copied) throw new Error("settlement copy not taken");

    expect(error.message).toContain(copied.id);
    expect(error.message).toContain("Ghost revenue");
    expect(error.message).toContain("collectedBy");
    expect(error.message).toContain(
      `DELETE /events/${seed.event.id}/settlement/lines/${copied.id}`,
    );

    // Nothing persisted off books that cannot balance.
    const rows = await harness.db
      .select()
      .from(schema.settlements)
      .where(eq(schema.settlements.eventId, seed.event.id));
    expect(rows).toHaveLength(0);

    // The named DELETE is a real way out. It removes the settlement's line;
    // deleting the forecast would change nothing, the copy being sealed.
    await harness.db.delete(schema.settlementLines).where(eq(schema.settlementLines.id, copied.id));
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
    // The engine reads the SETTLEMENT's copy, so that is the row it names and
    // the row that has to be corrected (0025).
    const [copied] = await harness.db
      .select()
      .from(schema.settlementLines)
      .where(eq(schema.settlementLines.originBudgetLineId, line.id));
    if (!copied) throw new Error("settlement copy not taken");

    expect(blocked.json().error.message).toContain(copied.id);
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

/**
 * The three money rules the product owner settled on 2026-08-26, driven through
 * the real route against a real Postgres:
 *   1. a RENTAL settles off the top, before percentage deals divide what is left
 *   2. a percentage entitlement is floored at zero — the loss stays with the operator
 *   3. a `deal_parties.role_in_deal = 'commission'` line actually gets paid
 */
describe("settlement — the 2026-08-26 money rules", () => {
  /**
   * Pool 1 000 000; venue rents the room for 200 000; the band is on a 50% door
   * split with a production partner taking a 10% DISCLOSED commission off the
   * band's line.
   *
   * The commission party is `team_and_crew`, not an agent, and that is not an
   * arbitrary choice: `routes/deals.ts::assertPartiesAreEntitled` refuses an
   * `agent` participant any role but `observer` (decisions.md #14 — an agent is
   * never an entitled party on an event deal; its commission is a separate,
   * private representation settlement). A fixture with an agent here would be a
   * state the app cannot produce.
   *
   *   rental off the top → the split divides 800 000, not 1 000 000
   *   band line          → 400 000, of which the agency takes 40 000
   *   operator residual  → 1 000 000 − 200 000 − 400 000 = 400 000
   *
   * Before the change the band took 500 000 (half the whole pool) and the agency
   * took nothing at all.
   */
  async function seedRentalAndCommission(prefix: string) {
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
    const agency = await seedMemberWithSet(
      `${prefix}-agency`,
      "team_and_crew",
      PRESET_PERMISSION_SETS.crew_technical,
    );

    const [event] = await db
      .insert(schema.events)
      .values({
        hostProfileId: operator.profileId,
        title: "Rental Night",
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
          role: "host" as const,
          permissionSetId: operator.permissionSetId,
          status: "confirmed" as const,
        },
        {
          eventId: event.id,
          profileId: venue.profileId,
          role: "performer" as const,
          permissionSetId: venue.permissionSetId,
          status: "confirmed" as const,
        },
        {
          eventId: event.id,
          profileId: band.profileId,
          role: "performer" as const,
          permissionSetId: band.permissionSetId,
          status: "confirmed" as const,
        },
        {
          eventId: event.id,
          profileId: agency.profileId,
          role: "crew_lead" as const,
          permissionSetId: agency.permissionSetId,
          status: "confirmed" as const,
        },
      ])
      .returning();
    const hostPart = parts.find((row) => row.profileId === operator.profileId)?.id as string;
    const venuePart = parts.find((row) => row.profileId === venue.profileId)?.id as string;
    const bandPart = parts.find((row) => row.profileId === band.profileId)?.id as string;
    const agencyPart = parts.find((row) => row.profileId === agency.profileId)?.id as string;

    const [rental] = await db
      .insert(schema.deals)
      .values({
        eventId: event.id,
        type: "rental",
        structure: "rental",
        name: "Venue rental",
        guaranteeAmount: 200000n,
        createdBy: operator.userId,
      })
      .returning();
    const [door] = await db
      .insert(schema.deals)
      .values({
        eventId: event.id,
        type: "performance",
        structure: "door_split",
        name: "Band door split",
        splitBasisPoints: 5000,
        createdBy: operator.userId,
      })
      .returning();
    if (!rental || !door) throw new Error("deal seed failed");

    await db.insert(schema.dealParties).values([
      { dealId: rental.id, participantId: hostPart, roleInDeal: "payer" },
      { dealId: rental.id, participantId: venuePart, roleInDeal: "payee" },
      { dealId: door.id, participantId: hostPart, roleInDeal: "payer" },
      { dealId: door.id, participantId: bandPart, roleInDeal: "payee" },
      {
        dealId: door.id,
        participantId: agencyPart,
        roleInDeal: "commission",
        share: { splitBasisPoints: 1000, currency: "SEK" }, // 10.00% of the band's line
      },
    ]);

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
    ]);

    await signEveryAgreement(db, event.id);
    return { event, operator, hostPart, venuePart, bandPart, agencyPart, door };
  }

  const compute = (eventId: string, uid: string) =>
    app.inject({
      method: "POST",
      url: `/api/v1/events/${eventId}/settlement/compute`,
      headers: auth(uid),
    });

  it("settles the rental off the top and pays the disclosed commission", async () => {
    const seed = await seedRentalAndCommission("offtop");

    const response = await compute(seed.event.id, seed.operator.userId);
    expect(response.statusCode).toBe(200);
    const body = response.json();
    const entitlementOf = (id: string) =>
      body.breakdowns.find((row: { participantId: string }) => row.participantId === id)
        ?.entitlement;

    expect(body.pool).toBe("1000000");
    expect(entitlementOf(seed.venuePart)).toBe("200000"); // rental, off the top
    expect(entitlementOf(seed.bandPart)).toBe("360000"); // 50% of 800 000, less 10%
    expect(entitlementOf(seed.agencyPart)).toBe("40000"); // the commission line, now paid
    expect(entitlementOf(seed.hostPart)).toBe("400000"); // residual
    const netSum = body.breakdowns.reduce(
      (total: bigint, row: { net: string }) => total + BigInt(row.net),
      0n,
    );
    expect(netSum).toBe(0n);

    // The state, not just the response: a stored settlement row and a real transfer
    // to the commission party.
    const rows = await harness.db
      .select()
      .from(schema.settlements)
      .where(eq(schema.settlements.eventId, seed.event.id));
    expect(rows).toHaveLength(4);
    const transfers = await harness.db
      .select()
      .from(schema.settlementTransfers)
      .where(eq(schema.settlementTransfers.eventId, seed.event.id));
    const toAgency = transfers.find((row) => row.toParticipant === seed.agencyPart);
    expect(toAgency?.fromParticipant).toBe(seed.hostPart);
    expect(toAgency?.amount).toBe(40000n);

    // decisions.md #14 boundary: a DISCLOSED commission is an event deal party and
    // nothing else. No representation-scoped settlement is created by it — that
    // private agent↔performer path is driven by `representations`, not by this row
    // (and the deals route refuses an agent participant an entitled line at all).
    expect(rows.every((row) => row.representationId === null)).toBe(true);
  });

  it("refuses a commission party whose share states no rate", async () => {
    const { db } = harness;
    const seed = await seedRentalAndCommission("offtop-norate");
    await db
      .update(schema.dealParties)
      .set({ share: null })
      .where(
        and(
          eq(schema.dealParties.dealId, seed.door.id),
          eq(schema.dealParties.participantId, seed.agencyPart),
        ),
      );

    const response = await compute(seed.event.id, seed.operator.userId);

    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain("commission");
  });

  /**
   * A loss-making night on a pure door split: gross 200 000, costs 500 000 →
   * pool −300 000. The performer's share of the pool is floored at zero; the
   * operator carries the whole loss through the residual.
   */
  async function seedLossMakingDoorSplit(prefix: string, withDeductible: boolean) {
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
        title: "Quiet Night",
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
          role: "host" as const,
          permissionSetId: operator.permissionSetId,
          status: "confirmed" as const,
        },
        {
          eventId: event.id,
          profileId: band.profileId,
          role: "performer" as const,
          permissionSetId: band.permissionSetId,
          status: "confirmed" as const,
        },
      ])
      .returning();
    const hostPart = parts.find((row) => row.profileId === operator.profileId)?.id as string;
    const bandPart = parts.find((row) => row.profileId === band.profileId)?.id as string;

    const [door] = await db
      .insert(schema.deals)
      .values({
        eventId: event.id,
        type: "performance",
        structure: "door_split",
        name: "50% of the door",
        splitBasisPoints: 5000,
        createdBy: operator.userId,
      })
      .returning();
    if (!door) throw new Error("deal seed failed");
    await db.insert(schema.dealParties).values([
      { dealId: door.id, participantId: hostPart, roleInDeal: "payer" },
      { dealId: door.id, participantId: bandPart, roleInDeal: "payee" },
    ]);

    const [budget] = await db.insert(schema.budgets).values({ eventId: event.id }).returning();
    if (!budget) throw new Error("budget seed failed");
    await db.insert(schema.budgetLines).values([
      {
        budgetId: budget.id,
        kind: "revenue",
        label: "Tickets",
        amount: 200000n,
        collectedBy: hostPart,
      },
      { budgetId: budget.id, kind: "cost", label: "Sound hire", amount: 500000n, paidBy: hostPart },
      ...(withDeductible
        ? [
            {
              budgetId: budget.id,
              kind: "cost" as const,
              label: "Band hotel, fronted by the operator",
              amount: 80000n,
              paidBy: hostPart,
              payeeParticipantId: bandPart,
            },
          ]
        : []),
    ]);

    await signEveryAgreement(db, event.id);
    return { event, operator, hostPart, bandPart };
  }

  it("floors a door-split entitlement at zero and leaves the loss with the operator", async () => {
    const seed = await seedLossMakingDoorSplit("floor", false);

    const response = await compute(seed.event.id, seed.operator.userId);
    expect(response.statusCode).toBe(200);
    const body = response.json();
    const rowOf = (id: string) =>
      body.breakdowns.find((row: { participantId: string }) => row.participantId === id);

    expect(body.pool).toBe("-300000");
    expect(rowOf(seed.bandPart).entitlement).toBe("0"); // was −150 000
    expect(rowOf(seed.bandPart).net).toBe("0");
    expect(rowOf(seed.hostPart).entitlement).toBe("-300000"); // the operator eats it
    expect(rowOf(seed.hostPart).net).toBe("0"); // it holds exactly what it is owed
    const netSum = body.breakdowns.reduce(
      (total: bigint, row: { net: string }) => total + BigInt(row.net),
      0n,
    );
    expect(netSum).toBe(0n);

    // Nobody owes anybody: no transfer is written on a floored settlement.
    const transfers = await harness.db
      .select()
      .from(schema.settlementTransfers)
      .where(eq(schema.settlementTransfers.eventId, seed.event.id));
    expect(transfers).toHaveLength(0);
  });

  it("still settles a NEGATIVE net when the performer owes a deductible back", async () => {
    // The floor is on the share of the pool, not on the net. A performer whose
    // hotel the operator fronted owes that money back however bad the night was.
    const seed = await seedLossMakingDoorSplit("floor-deductible", true);

    const response = await compute(seed.event.id, seed.operator.userId);
    expect(response.statusCode).toBe(200);
    const body = response.json();
    const rowOf = (id: string) =>
      body.breakdowns.find((row: { participantId: string }) => row.participantId === id);

    expect(rowOf(seed.bandPart).entitlement).toBe("-80000"); // 0 floored share − the hotel
    expect(rowOf(seed.bandPart).net).toBe("-80000");
    expect(rowOf(seed.hostPart).net).toBe("80000");
    const transfers = await harness.db
      .select()
      .from(schema.settlementTransfers)
      .where(eq(schema.settlementTransfers.eventId, seed.event.id));
    expect(transfers).toHaveLength(1);
    expect(transfers[0]?.fromParticipant).toBe(seed.bandPart);
    expect(transfers[0]?.toParticipant).toBe(seed.hostPart);
    expect(transfers[0]?.amount).toBe(80000n);
  });
});

/**
 * The budget snapshot (decisions.md #16.8).
 *
 * The seeded worked example IS the plan: tickets 1 000 000 collected by the
 * operator, sound hire 150 000 paid by the operator → a planned pool of 850 000,
 * which is the same 850 000 the engine reports. Every figure below is that
 * fixture moved by a stated amount, so all of it is checkable by hand.
 */
describe("settlement — the budget snapshot (decisions #16.8)", () => {
  const snapshotsOf = (eventId: string) =>
    harness.db
      .select()
      .from(schema.budgetSnapshots)
      .where(eq(schema.budgetSnapshots.eventId, eventId))
      .orderBy(asc(schema.budgetSnapshots.version));

  const plannedVsActual = (eventId: string, userId: string) =>
    app.inject({
      method: "GET",
      url: `/api/v1/events/${eventId}/settlement/planned-vs-actual`,
      headers: auth(userId),
    });

  const computeFor = (eventId: string, userId: string) =>
    app.inject({
      method: "POST",
      url: `/api/v1/events/${eventId}/settlement/compute`,
      headers: auth(userId),
    });

  const budgetOf = async (eventId: string) => {
    const [budget] = await harness.db
      .select()
      .from(schema.budgets)
      .where(and(eq(schema.budgets.eventId, eventId), eq(schema.budgets.scope, "shared")));
    if (!budget) throw new Error("budget missing");
    return budget;
  };

  /** Move the seeded "Tickets" line — the box office coming in. */
  /**
   * Restate what the night ACTUALLY took — on the settlement's own copy.
   *
   * Not on `budget_lines`. Since 0025 the settlement holds a copy of the budget
   * and the budget is never changed from the settlement, so editing the forecast
   * here would restate the plan and leave the actual untouched — which is the
   * behaviour this whole split exists to prevent.
   *
   * Returns the BUDGET line's id, because that is what planned-vs-actual pairs
   * the two sides on (`origin_budget_line_id`) and therefore what a caller finds
   * the row by.
   */
  async function restateTickets(eventId: string, amount: bigint) {
    const budget = await budgetOf(eventId);
    const [line] = await harness.db
      .select()
      .from(schema.budgetLines)
      .where(
        and(eq(schema.budgetLines.budgetId, budget.id), eq(schema.budgetLines.label, "Tickets")),
      );
    if (!line) throw new Error("tickets line missing");
    const [copied] = await harness.db
      .select()
      .from(schema.settlementLines)
      .where(eq(schema.settlementLines.originBudgetLineId, line.id));
    if (!copied) throw new Error("settlement copy not taken — compute first");
    await harness.db
      .update(schema.settlementLines)
      .set({ amount })
      .where(eq(schema.settlementLines.id, copied.id));
    return { budgetId: budget.id, lineId: line.id };
  }

  const sumPoolEffects = (lines: { poolEffect: string }[]) =>
    lines.reduce((total, line) => total + BigInt(line.poolEffect), 0n).toString();

  it("the FIRST compute captures version 1 — the plan of record", async () => {
    const seed = await seedWorkedExample("snap-first");
    expect(await snapshotsOf(seed.event.id)).toHaveLength(0);

    expect((await computeFor(seed.event.id, seed.operator.userId)).statusCode).toBe(200);

    const rows = await snapshotsOf(seed.event.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.version).toBe(1);
    expect(rows[0]?.reason).toBe("compute");
    expect(rows[0]?.settlementSnapshotId).toBeNull();
    expect(rows[0]?.baseCurrency).toBe("SEK");
    // The seeded budget, summed by the same rule the engine applies.
    expect(rows[0]?.plannedRevenue).toBe(1000000n);
    expect(rows[0]?.plannedCosts).toBe(150000n);
    expect(rows[0]?.plannedPool).toBe(850000n);
  });

  it("recomputing an UNCHANGED budget captures nothing", async () => {
    const seed = await seedWorkedExample("snap-dedupe");
    await computeFor(seed.event.id, seed.operator.userId);
    await computeFor(seed.event.id, seed.operator.userId);
    await computeFor(seed.event.id, seed.operator.userId);

    // Three computes, one capture: the budget never moved, so nothing did.
    expect(await snapshotsOf(seed.event.id)).toHaveLength(1);
  });

  it("a MOVED budget captures a new version and leaves version 1 alone", async () => {
    const seed = await seedWorkedExample("snap-moved");
    await computeFor(seed.event.id, seed.operator.userId);
    await restateTickets(seed.event.id, 840000n); // the box office came in 160 000 short
    await computeFor(seed.event.id, seed.operator.userId);

    const rows = await snapshotsOf(seed.event.id);
    expect(rows).toHaveLength(2);
    // The plan of record is IMMUTABLE — the whole point of the table.
    expect(rows[0]?.version).toBe(1);
    expect(rows[0]?.plannedRevenue).toBe(1000000n);
    expect(rows[0]?.plannedPool).toBe(850000n);
    expect(rows[1]?.version).toBe(2);
    expect(rows[1]?.plannedRevenue).toBe(840000n);
    expect(rows[1]?.plannedPool).toBe(690000n);
  });

  it("answers planned-vs-actual with the real figures, per line and in total", async () => {
    const seed = await seedWorkedExample("snap-compare");
    await computeFor(seed.event.id, seed.operator.userId);
    const { lineId } = await restateTickets(seed.event.id, 840000n);
    await computeFor(seed.event.id, seed.operator.userId);

    const response = await plannedVsActual(seed.event.id, seed.operator.userId);
    expect(response.statusCode).toBe(200);
    const body = response.json();

    expect(body.baseCurrency).toBe("SEK");
    expect(body.plan.source).toBe("plan");
    expect(body.plan.version).toBe(1);
    expect(body.plan.revenue).toBe("1000000");
    expect(body.plan.costs).toBe("150000");
    expect(body.plan.pool).toBe("850000");
    // Not finalized, so the actual is the budget as it stands right now.
    expect(body.actual.source).toBe("live");
    expect(body.actual.revenue).toBe("840000");
    expect(body.actual.pool).toBe("690000");
    expect(body.variance).toEqual({ revenue: "-160000", costs: "0", pool: "-160000" });
    // The settlement's own pool agrees with the budget's arithmetic here.
    expect(body.settlementPool).toBe("690000");
    // One operator, so nothing is hidden from them.
    expect(body.plan.withheldBudgetCount).toBe(0);
    expect(body.actual.withheldBudgetCount).toBe(0);

    const tickets = body.lines.find((line: { lineId: string }) => line.lineId === lineId);
    expect(tickets.status).toBe("both");
    expect(tickets.kind).toBe("revenue");
    expect(tickets.planned.amount).toBe("1000000");
    expect(tickets.actual.amount).toBe("840000");
    expect(tickets.variance).toBe("-160000");
    expect(tickets.poolEffect).toBe("-160000");
    // The cost never moved.
    const sound = body.lines.find((line: { label: string }) => line.label === "Sound hire");
    expect(sound.variance).toBe("0");
    expect(sound.poolEffect).toBe("0");

    // THE INVARIANT a Financials tab rests on: the line effects account for the
    // whole pool variance, so no part of it is left unattributable.
    expect(sumPoolEffects(body.lines)).toBe(body.variance.pool);

    // The captures are the history of the settlement conversation, oldest first.
    expect(body.captures.map((capture: { version: number }) => capture.version)).toEqual([1, 2]);
  });

  it("reports a line added after the plan, and one removed before the actual", async () => {
    const seed = await seedWorkedExample("snap-churn");
    await computeFor(seed.event.id, seed.operator.userId);

    // A cost nobody planned for, and a planned one that never happened — both on
    // the SETTLEMENT's copy, which is where a night's surprises are recorded. Done
    // to the budget these would be forecast revisions and the settlement, sealed,
    // would rightly ignore them.
    const [added] = await harness.db
      .insert(schema.settlementLines)
      .values({
        eventId: seed.event.id,
        // No origin: it was never budgeted, which is what makes it `added`.
        kind: "cost",
        label: "Broken window",
        amount: 40000n,
        paidBy: seed.pPart,
      })
      .returning();
    await harness.db
      .delete(schema.settlementLines)
      .where(
        and(
          eq(schema.settlementLines.eventId, seed.event.id),
          eq(schema.settlementLines.label, "Sound hire"),
        ),
      );
    await computeFor(seed.event.id, seed.operator.userId);

    const body = (await plannedVsActual(seed.event.id, seed.operator.userId)).json();
    const brokenWindow = body.lines.find((line: { lineId: string }) => line.lineId === added?.id);
    expect(brokenWindow.status).toBe("added");
    expect(brokenWindow.planned).toBeNull();
    expect(brokenWindow.variance).toBe("40000");
    expect(brokenWindow.poolEffect).toBe("-40000"); // an unplanned cost lowers the pool

    const sound = body.lines.find((line: { label: string }) => line.label === "Sound hire");
    expect(sound.status).toBe("removed");
    expect(sound.actual).toBeNull();
    expect(sound.poolEffect).toBe("150000"); // a planned cost that never landed

    // 850 000 planned → 1 000 000 − 40 000 = 960 000 actual.
    expect(body.actual.pool).toBe("960000");
    expect(body.variance.pool).toBe("110000");
    expect(sumPoolEffects(body.lines)).toBe(body.variance.pool);
  });

  it("finalize captures the budget the frozen figures came out of, and stops the comparison moving", async () => {
    const seed = await seedWorkedExample("snap-finalize");
    await computeFor(seed.event.id, seed.operator.userId);
    await restateTickets(seed.event.id, 840000n);
    await computeFor(seed.event.id, seed.operator.userId);

    const finalize = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/finalize`,
      headers: auth(seed.operator.userId),
    });
    expect(finalize.statusCode).toBe(200);

    const rows = await snapshotsOf(seed.event.id);
    expect(rows).toHaveLength(3);
    const frozen = rows[2];
    expect(frozen?.reason).toBe("finalize");
    expect(frozen?.plannedPool).toBe(690000n);
    // Joined to the legal record, so the frozen figures stay checkable against
    // the budget they came out of.
    const [settlementSnapshot] = await harness.db
      .select()
      .from(schema.settlementSnapshots)
      .where(eq(schema.settlementSnapshots.eventId, seed.event.id));
    expect(frozen?.settlementSnapshotId).toBe(settlementSnapshot?.id);

    // Editing the budget after the freeze must not restate what was concluded.
    await restateTickets(seed.event.id, 5n);
    const body = (await plannedVsActual(seed.event.id, seed.operator.userId)).json();
    expect(body.actual.source).toBe("finalize");
    expect(body.actual.version).toBe(3);
    expect(body.actual.pool).toBe("690000");
    expect(body.variance.pool).toBe("-160000");
  });

  it("says plan: null on an event that has never been computed, rather than inventing one", async () => {
    const seed = await seedWorkedExample("snap-empty");

    const body = (await plannedVsActual(seed.event.id, seed.operator.userId)).json();
    expect(body.plan).toBeNull();
    expect(body.variance).toBeNull();
    expect(body.captures).toEqual([]);
    // The live budget is still readable — there is simply nothing to compare it to.
    expect(body.actual.source).toBe("live");
    expect(body.actual.pool).toBe("850000");
    expect(body.settlementPool).toBeNull();
    // Every line is "added": it exists now, and existed in no plan.
    expect(body.lines.every((line: { status: string }) => line.status === "added")).toBe(true);
  });

  /**
   * THE POOL CEILING (story.md:44). A budget snapshot is the whole night's money,
   * so the route is gated on `budget.view` — which `POOL_CAPABILITIES` makes
   * ungrantable to any role but host/co_host, so an operator cannot hand it over
   * even deliberately. Both halves are checked here: the performer preset is
   * refused, and so is a performer holding a set that literally lists the
   * capability.
   */
  it("refuses a performer, even one whose permission set claims budget.view", async () => {
    const seed = await seedWorkedExample("snap-ceiling");
    await computeFor(seed.event.id, seed.operator.userId);

    const asBand = await plannedVsActual(seed.event.id, seed.band.userId);
    expect(asBand.statusCode).toBe(403);

    // Now hand the band a set that names the capability outright. The ceiling,
    // not the set, is what decides.
    const [set] = await harness.db
      .select()
      .from(schema.permissionSets)
      .where(eq(schema.permissionSets.profileId, seed.band.profileId));
    if (!set) throw new Error("permission set missing");
    await harness.db
      .update(schema.permissionSets)
      .set({ capabilities: [...set.capabilities, "budget.view"] })
      .where(eq(schema.permissionSets.id, set.id));

    const granted = await plannedVsActual(seed.event.id, seed.band.userId);
    expect(granted.statusCode).toBe(403);
    const raw = JSON.stringify(granted.json());
    expect(raw).not.toContain("850000");
    expect(raw).not.toContain("1000000");
  });

  it("hides a co-operator's private budget and says how much it withheld", async () => {
    const seed = await seedWorkedExample("snap-private");
    // A second operator co-hosts, and keeps a private margin line of their own.
    const coHost = await seedMemberWithSet(
      "snap-private-cohost",
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
    const [privateBudget] = await harness.db
      .insert(schema.budgets)
      .values({ eventId: seed.event.id, scope: "private", ownerProfileId: coHost.profileId })
      .returning();
    if (!privateBudget || !coHostPart) throw new Error("private budget seed failed");
    await harness.db.insert(schema.budgetLines).values({
      budgetId: privateBudget.id,
      kind: "cost",
      label: "Co-promoter's own fee",
      amount: 47000n,
      paidBy: coHostPart.id,
    });
    await computeFor(seed.event.id, seed.operator.userId);

    /**
     * A PRIVATE BUDGET NEVER BECOMES A SETTLEMENT LINE.
     *
     * "If you have a co host, the shared budget is the one that is copied, and
     * the other party never sees that — they only see relevant data to their part
     * of the deal" (the product owner, 2026-08-27). So the co-promoter's own
     * margin stays their internal accounting: it does not enter the settlement,
     * does not move the pool the parties divide, and cannot leak to the host
     * because it was never copied.
     *
     * Which makes the privacy question structural rather than a filter anybody
     * has to remember to apply — the strongest form the guarantee can take.
     */
    const asOwner = (await plannedVsActual(seed.event.id, coHost.userId)).json();
    // Even to its OWNER, the settled side excludes it — it is not settlement money.
    expect(asOwner.actual.pool).toBe("850000"); // 1 000 000 − 150 000, the shared budget
    expect(
      asOwner.lines.some(
        (line: { label: string; actual: unknown }) =>
          line.label === "Co-promoter's own fee" && line.actual !== null,
      ),
    ).toBe(false);

    // The host never sees the line or the amount anywhere in the payload.
    const asHost = (await plannedVsActual(seed.event.id, seed.operator.userId)).json();
    expect(asHost.actual.pool).toBe("850000");
    expect(JSON.stringify(asHost)).not.toContain("Co-promoter's own fee");
    expect(JSON.stringify(asHost)).not.toContain("47000");
    // The PLAN still withholds it the way it always did — the forecast is still
    // grouped by budget, and one of those budgets is not the host's to read.
    expect(asHost.plan.withheldBudgetCount).toBe(1);
  });

  /**
   * A cost line carrying `deal_id` IS the deal's own figure, and `reconcileEvent`
   * drops it at the engine boundary (migration 0019). The planned pool applies the
   * identical rule, or it could never tie out against the settlement's.
   */
  it("excludes a deal's own figure from the planned pool, exactly as the engine does", async () => {
    const seed = await seedWorkedExample("snap-dealfigure");
    const budget = await budgetOf(seed.event.id);
    const [deal] = await harness.db
      .select()
      .from(schema.deals)
      .where(and(eq(schema.deals.eventId, seed.event.id), eq(schema.deals.structure, "guarantee")));
    if (!deal) throw new Error("guarantee deal missing");
    const [feeLine] = await harness.db
      .insert(schema.budgetLines)
      .values({
        budgetId: budget.id,
        kind: "cost",
        label: "Band fee (from the deal)",
        amount: 300000n,
        paidBy: seed.pPart,
        dealId: deal.id,
      })
      .returning();

    const compute = await computeFor(seed.event.id, seed.operator.userId);
    expect(compute.json().pool).toBe("850000"); // the engine ignored the line

    const rows = await snapshotsOf(seed.event.id);
    expect(rows[0]?.plannedCosts).toBe(150000n); // and so did the capture
    expect(rows[0]?.plannedPool).toBe(850000n);

    const body = (await plannedVsActual(seed.event.id, seed.operator.userId)).json();
    expect(body.actual.pool).toBe("850000");
    expect(body.settlementPool).toBe("850000");
    // The line is still SHOWN — the operator planned it and wants to see it — it
    // simply contributes nothing to the pool, and says which it is.
    const fee = body.lines.find((line: { lineId: string }) => line.lineId === feeLine?.id);
    expect(fee.actual.countsTowardPool).toBe(false);
    expect(fee.poolEffect).toBe("0");
  });
});

describe("settlement lines — the settlement's own copy of the budget", () => {
  /**
   * "The settlement has a copy of the budget. The budget is never changed from
   * the settlement" (the product owner, 2026-08-27). These pin both halves.
   */
  const linesOf = (eventId: string) =>
    harness.db
      .select()
      .from(schema.settlementLines)
      .where(eq(schema.settlementLines.eventId, eventId));

  const budgetFor = async (eventId: string) => {
    const [budget] = await harness.db
      .select()
      .from(schema.budgets)
      .where(eq(schema.budgets.eventId, eventId));
    if (!budget) throw new Error("budget missing");
    return budget;
  };

  it("copies the budget on the first compute, and never again", async () => {
    const seed = await seedWorkedExample("copy-once");
    await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/compute`,
      headers: auth(seed.operator.userId),
    });

    const copied = await linesOf(seed.event.id);
    expect(copied.length).toBeGreaterThan(0);
    expect(copied.every((line) => line.originBudgetLineId !== null)).toBe(true);

    // A budget edited AFTER the copy is a forecast revised after the fact. The
    // settlement is sealed from it: recomputing must not pull the change in.
    const budget = await budgetFor(seed.event.id);
    await harness.db.insert(schema.budgetLines).values({
      budgetId: budget.id,
      kind: "cost",
      label: "Late idea",
      amount: 5000n,
      paidBy: seed.pPart,
    });
    await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/compute`,
      headers: auth(seed.operator.userId),
    });

    const after = await linesOf(seed.event.id);
    expect(after).toHaveLength(copied.length);
    expect(after.some((line) => line.label === "Late idea")).toBe(false);
  });

  it("settles what the SETTLEMENT says, leaving the budget untouched", async () => {
    const seed = await seedWorkedExample("copy-edit");
    await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/compute`,
      headers: auth(seed.operator.userId),
    });
    const [tickets] = (await linesOf(seed.event.id)).filter((line) => line.label === "Tickets");
    if (!tickets) throw new Error("tickets copy missing");

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${seed.event.id}/settlement/lines/${tickets.id}`,
      headers: auth(seed.operator.userId),
      payload: { amount: "840000", expectedVersion: tickets.version },
    });
    expect(patched.statusCode).toBe(200);

    const recomputed = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/compute`,
      headers: auth(seed.operator.userId),
    });
    // 840 000 − 150 000 of costs.
    expect(recomputed.json().pool).toBe("690000");

    // THE RULE: the forecast is exactly where it was.
    const budget = await budgetFor(seed.event.id);
    const [forecast] = await harness.db
      .select()
      .from(schema.budgetLines)
      .where(
        and(eq(schema.budgetLines.budgetId, budget.id), eq(schema.budgetLines.label, "Tickets")),
      );
    expect(forecast?.amount).toBe(1000000n);
  });

  it("adds a line nobody budgeted for, and settles it", async () => {
    const seed = await seedWorkedExample("copy-add");
    await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/compute`,
      headers: auth(seed.operator.userId),
    });

    const added = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/lines`,
      headers: auth(seed.operator.userId),
      payload: { kind: "cost", label: "Broken window", amount: "40000", paidBy: seed.pPart },
    });
    expect(added.statusCode).toBe(201);
    // Never budgeted, so it pairs with no forecast line — which is the truth.
    expect(added.json().originBudgetLineId).toBeNull();

    const recomputed = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/compute`,
      headers: auth(seed.operator.userId),
    });
    expect(recomputed.json().pool).toBe("810000"); // 850 000 − 40 000
  });

  it("refuses every write once the figures are finalized", async () => {
    const seed = await seedWorkedExample("copy-frozen");
    await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/compute`,
      headers: auth(seed.operator.userId),
    });
    const [line] = await linesOf(seed.event.id);
    if (!line) throw new Error("copy missing");
    await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/finalize`,
      headers: auth(seed.operator.userId),
    });

    // Finalize freezes an immutable snapshot; a line edited underneath it would
    // silently contradict the legal record.
    for (const attempt of [
      app.inject({
        method: "PATCH",
        url: `/api/v1/events/${seed.event.id}/settlement/lines/${line.id}`,
        headers: auth(seed.operator.userId),
        payload: { amount: "1" },
      }),
      app.inject({
        method: "POST",
        url: `/api/v1/events/${seed.event.id}/settlement/lines`,
        headers: auth(seed.operator.userId),
        payload: { kind: "cost", label: "Too late", amount: "100", paidBy: seed.pPart },
      }),
      app.inject({
        method: "DELETE",
        url: `/api/v1/events/${seed.event.id}/settlement/lines/${line.id}`,
        headers: auth(seed.operator.userId),
      }),
    ]) {
      expect((await attempt).statusCode).toBe(409);
    }
  });

  it("refuses a party who may read the settlement but not restate it", async () => {
    const seed = await seedWorkedExample("copy-guard");
    await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/compute`,
      headers: auth(seed.operator.userId),
    });
    // The performer holds `settlement.view.own` and no `settlement.edit` — the
    // night's figures are not theirs to rewrite.
    const blocked = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/lines`,
      headers: auth(seed.band.userId),
      payload: { kind: "cost", label: "My taxi", amount: "5000", paidBy: seed.pPart },
    });
    expect(blocked.statusCode).toBe(403);
  });
});

/**
 * WHICH DEALS MAY SETTLE — `deals.status` at the engine boundary.
 *
 * `reconcileEvent` used to read EVERY `deals` row of the event, whatever its
 * `status`, so a **cancelled** agreement still produced an entitlement and still
 * generated a transfer. A cancelled deal is the one state the enum has that means
 * "this is no longer an agreement": nobody is owed anything under it, and paying it
 * out is money leaving on the strength of a contract that was withdrawn.
 *
 * Dropping it cannot unbalance the night. The operator's line is the **residual**
 * (pool − Σ everyone else), so an entitlement that disappears is absorbed there and
 * `Σ net = 0` still holds — which every case below asserts rather than assumes.
 *
 * `draft` is deliberately NOT filtered here, and that is not an oversight — see the
 * skipped case at the bottom.
 */
describe("settlement — deal status at the engine boundary", () => {
  /** Σ net = 0, read off the wire rather than trusted from inside the engine. */
  const sumOfNets = (body: { breakdowns: { net: string }[] }): bigint =>
    body.breakdowns.reduce((running, row) => running + BigInt(row.net), 0n);

  it("does not settle a cancelled deal", async () => {
    const seed = await seedWorkedExample("status-cancelled");
    // The band's guarantee is withdrawn. The venue's rental stands.
    await harness.db
      .update(schema.deals)
      .set({ status: "cancelled" })
      .where(and(eq(schema.deals.eventId, seed.event.id), eq(schema.deals.name, "Band guarantee")));

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/compute`,
      headers: auth(seed.operator.userId),
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();

    // The pool is untouched — a deal is an entitlement, never a cash line.
    expect(body.pool).toBe("850000");

    const byId = new Map<string, string>(
      body.breakdowns.map((row: { participantId: string; net: string }) => [
        row.participantId,
        row.net,
      ]),
    );
    // The band is owed nothing and holds nothing.
    expect(byId.get(seed.bPart)).toBe("0");
    // The venue's rental is unaffected.
    expect(byId.get(seed.vPart)).toBe("100000");
    // The withdrawn 300 000 stays with the operator, which takes the residual.
    expect(byId.get(seed.pPart)).toBe("-100000");
    expect(sumOfNets(body)).toBe(0n);

    // And no transfer is generated for the cancelled deal.
    const transfers = await harness.db
      .select()
      .from(schema.settlementTransfers)
      .where(eq(schema.settlementTransfers.eventId, seed.event.id));
    expect(transfers).toHaveLength(1);
    expect(transfers[0]?.toParticipant).toBe(seed.vPart);
    expect(transfers[0]?.amount).toBe(100000n);
  });

  it("still settles a confirmed deal", async () => {
    const seed = await seedWorkedExample("status-confirmed");
    await harness.db
      .update(schema.deals)
      .set({ status: "confirmed" })
      .where(eq(schema.deals.eventId, seed.event.id));

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/compute`,
      headers: auth(seed.operator.userId),
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.pool).toBe("850000");

    const byId = new Map<string, string>(
      body.breakdowns.map((row: { participantId: string; net: string }) => [
        row.participantId,
        row.net,
      ]),
    );
    expect(byId.get(seed.pPart)).toBe("-400000");
    expect(byId.get(seed.vPart)).toBe("100000");
    expect(byId.get(seed.bPart)).toBe("300000");
    expect(sumOfNets(body)).toBe(0n);
  });

  /**
   * A cancelled deal that is ALSO the subject of a planner cost line stays out on
   * both sides. A `deal_id` cost line is the deal's own figure written into the
   * plan — a forecast, dropped at the engine boundary so the deal stays the
   * authority (see "a cost line assigned to a deal" above). Withdrawing the deal
   * must not resurrect that forecast as real cash, or the pool would fall by a fee
   * nobody is paying.
   */
  it("keeps a cancelled deal's planner line out of the pool as well", async () => {
    const seed = await seedWorkedExample("status-cancelled-line");
    const [cancelled] = await harness.db
      .update(schema.deals)
      .set({ status: "cancelled" })
      .where(and(eq(schema.deals.eventId, seed.event.id), eq(schema.deals.name, "Band guarantee")))
      .returning();
    if (!cancelled) throw new Error("deal update failed");

    const [budget] = await harness.db
      .select()
      .from(schema.budgets)
      .where(eq(schema.budgets.eventId, seed.event.id));
    if (!budget) throw new Error("budget missing");
    await harness.db.insert(schema.budgetLines).values({
      budgetId: budget.id,
      kind: "cost",
      label: "Band guarantee (planned)",
      amount: 300000n,
      paidBy: seed.pPart,
      dealId: cancelled.id,
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/compute`,
      headers: auth(seed.operator.userId),
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.pool).toBe("850000");
    expect(sumOfNets(body)).toBe(0n);
  });

  /**
   * WHAT THIS CHANGE DOES TO A SETTLEMENT THAT IS ALREADY FINALIZED: nothing.
   *
   * A finalized settlement is the record of what was agreed, with its FX locked
   * into the snapshot, and it must not move because a deal was cancelled
   * afterwards. It cannot: `assertNotFinalized` refuses the recompute outright
   * (audit A-09), so the stored figures and the snapshot both stand exactly as
   * they were. Cancelling a deal after the fact is a credit note, not a rewrite.
   */
  it("does not rewrite a finalized settlement when a deal is cancelled afterwards", async () => {
    const seed = await seedWorkedExample("status-cancelled-final");
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
    const frozen = await harness.db
      .select()
      .from(schema.settlements)
      .where(eq(schema.settlements.eventId, seed.event.id));

    await harness.db
      .update(schema.deals)
      .set({ status: "cancelled" })
      .where(and(eq(schema.deals.eventId, seed.event.id), eq(schema.deals.name, "Band guarantee")));

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
    expect(after.map((row) => row.computed)).toEqual(frozen.map((row) => row.computed));
    expect(after.every((row) => row.status === "finalized")).toBe(true);
  });

  /**
   * The other side of the same coin: a settlement that is COMPUTED but not yet
   * finalized. Cancelling a deal moves the figures, so finalize refuses rather than
   * freezing a snapshot whose locked rates and figures disagree — the operator is
   * told to recompute and re-confirm. Never a silent rewrite (decisions #8).
   */
  it("refuses to finalize stale figures after a deal is cancelled", async () => {
    const seed = await seedWorkedExample("status-cancelled-stale");
    await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/compute`,
      headers: auth(seed.operator.userId),
    });
    await harness.db
      .update(schema.deals)
      .set({ status: "cancelled" })
      .where(and(eq(schema.deals.eventId, seed.event.id), eq(schema.deals.name, "Band guarantee")));

    const stale = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/finalize`,
      headers: auth(seed.operator.userId),
    });
    expect(stale.statusCode).toBe(409);

    // Recompute, and the same finalize now succeeds on figures that agree.
    const recompute = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/compute`,
      headers: auth(seed.operator.userId),
    });
    expect(recompute.statusCode).toBe(200);
    expect(sumOfNets(recompute.json())).toBe(0n);
    const finalize = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/finalize`,
      headers: auth(seed.operator.userId),
    });
    expect(finalize.statusCode).toBe(200);
  });

  /**
   * THE `it.skip` THAT USED TO SIT HERE IS GONE, AND SO IS THE THING THAT BLOCKED IT.
   *
   * It was titled "does not settle a draft deal — BLOCKED: `deals.status` has no
   * writer", and it asserted that a draft deal pays everybody nothing. Two things
   * happened on 2026-08-31, in this order.
   *
   * First the block was lifted: `deals.status` gained a real writer — the last
   * signature advances it (`lib/deal-confirmation.ts`), `reopen` puts it back,
   * migration 0030 backfilled the rows signed before it existed, and
   * `PATCH /deals/:did` now refuses a hand-set `confirmed`.
   *
   * Then the product decision the skipped case was waiting on was actually taken,
   * and it went the OTHER way from what that case proposed: **"a settlement cannot
   * open unless the deal is signed"** (the product owner). Not "drop the unsigned
   * deals from the maths" — refuse the whole reconciliation at the door.
   *
   * **The distinction is the entire point, and the measurement that used to live
   * here is what makes it legible.** Flipping the engine's own clause to
   * `eq(status, 'confirmed')` turned **33 of this file's 76 tests** red, every one
   * of them the same way: `expected '0' to be '300000'`, with transfer lists
   * arriving empty. That is exactly the failure mode the owner's rule exists to
   * make impossible — a deal one signature short pays its performer **zero** while
   * `Σ net = 0` still holds perfectly, because the operator's residual absorbs the
   * missing entitlement and no field in the response says an agreement went
   * missing. A refusal at the door is legible; a zero inside a balanced settlement
   * is not.
   *
   * So the clause was never flipped. `reconcileEvent` still drops `cancelled` and
   * nothing else, and `assertEveryAgreementSigned` — checking the very rows that
   * clause returns — decides whether the maths runs at all. The 33 fixtures were
   * not wrong either: they build deals nobody has signed, which is genuinely what
   * an operator has on the day they open the settlement screen early. They now
   * sign them, through `signEveryAgreement`, and the case below drives the real
   * `send`/`confirm` endpoints on the same fixture to prove that helper is not
   * inventing a state the app cannot reach.
   */
  it("settles a deal signed through the real confirm route, which now reads `confirmed`", async () => {
    const seed = await seedWorkedExample("status-signed");
    // Reopen through the REAL route, so the deal is genuinely back to `sent` with
    // every confirmation cleared — the product's own way of un-signing something.
    const [guarantee] = await harness.db
      .select()
      .from(schema.deals)
      .where(and(eq(schema.deals.eventId, seed.event.id), eq(schema.deals.name, "Band guarantee")));
    if (!guarantee) throw new Error("deal seed failed");
    const reopened = await app.inject({
      method: "POST",
      url: `/api/v1/deals/${guarantee.id}/reopen`,
      headers: auth(seed.operator.userId),
      payload: { reason: "renegotiating the fee" },
    });
    expect(reopened.statusCode).toBe(200);
    const [afterReopen] = await harness.db
      .select()
      .from(schema.deals)
      .where(eq(schema.deals.id, guarantee.id));
    expect(afterReopen?.status).toBe("draft");
    expect(afterReopen?.agreementStatus).toBe("sent");

    // The lifecycle as the app walks it: both signatories sign. Nothing here writes
    // `status` — it moves because the agreement completed.
    for (const userId of [seed.operator.userId, seed.band.userId]) {
      const signed = await app.inject({
        method: "POST",
        url: `/api/v1/deals/${guarantee.id}/confirm`,
        headers: auth(userId),
      });
      expect(signed.statusCode).toBe(200);
    }
    const [afterSigning] = await harness.db
      .select()
      .from(schema.deals)
      .where(eq(schema.deals.id, guarantee.id));
    expect(afterSigning?.status).toBe("confirmed");
    expect(afterSigning?.agreementStatus).toBe("confirmed");
    // The REAL route and `signEveryAgreement` land in the same place — which is
    // what licenses every other fixture in this file to use the shortcut.
    expect(afterSigning?.confirmedSnapshot).not.toBeNull();

    // And the night reconciles exactly as the worked example says — the lifecycle
    // moved columns, not figures.
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/compute`,
      headers: auth(seed.operator.userId),
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.pool).toBe("850000");
    const byId = new Map<string, string>(
      body.breakdowns.map((row: { participantId: string; net: string }) => [
        row.participantId,
        row.net,
      ]),
    );
    expect(byId.get(seed.pPart)).toBe("-400000");
    expect(byId.get(seed.vPart)).toBe("100000");
    expect(byId.get(seed.bPart)).toBe("300000");
    expect(sumOfNets(body)).toBe(0n);
  });
});

/**
 * THE DOOR — "a settlement cannot open unless the deal is signed" (the product
 * owner, 2026-08-31).
 *
 * The block above is about WHICH deals the engine reads. This one is about whether
 * it reads them at all. `assertEveryAgreementSigned` sits at the top of
 * `reconcileEvent`, so it guards **both** doors into the arithmetic — compute and
 * finalize — and checks precisely the rows that function is about to settle.
 *
 * Every case here drives the deal lifecycle through its REAL routes (`send`,
 * `confirm`, `reopen`, the status PATCH), because the whole question is what the
 * app can actually produce.
 */
describe("settlement — the door: an unsigned agreement holds it shut", () => {
  /** Σ net = 0, read off the wire rather than trusted from inside the engine. */
  const sumOfNets = (body: { breakdowns: { net: string }[] }): bigint =>
    body.breakdowns.reduce((running, row) => running + BigInt(row.net), 0n);

  const compute = (eventId: string, userId: string) =>
    app.inject({
      method: "POST",
      url: `/api/v1/events/${eventId}/settlement/compute`,
      headers: auth(userId),
    });

  /** The deal the worked example hangs its 300 000 guarantee on. */
  async function bandGuaranteeOf(eventId: string) {
    const [deal] = await harness.db
      .select()
      .from(schema.deals)
      .where(and(eq(schema.deals.eventId, eventId), eq(schema.deals.name, "Band guarantee")));
    if (!deal) throw new Error("deal seed failed");
    return deal;
  }

  it("refuses to compute while an agreement is waiting on a signature, and says whose", async () => {
    const seed = await seedWorkedExample("door-unsigned");
    const guarantee = await bandGuaranteeOf(seed.event.id);
    // Reopened for renegotiation: back to `sent`, both confirmations cleared.
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/v1/deals/${guarantee.id}/reopen`,
          headers: auth(seed.operator.userId),
          payload: {},
        })
      ).statusCode,
    ).toBe(200);

    const refused = await compute(seed.event.id, seed.operator.userId);
    // 409, not 403: the operator MAY run this settlement — it is the event's state
    // that refuses, exactly as `assertNotFinalized` means it.
    expect(refused.statusCode).toBe(409);
    const message = refused.json().error.message as string;
    // The message has to name the agreement and what it is waiting for, or the
    // settlement is unopenable with no diagnosis.
    expect(message).toContain("Band guarantee");
    expect(message).toContain(guarantee.id);
    expect(message).toContain("waiting on 2 of 2 signatures");
    // The venue's rental IS signed, so it is not on the list.
    expect(message).not.toContain("Venue rental");

    // A REFUSAL WRITES NOTHING. `ensureSettlementLines` seals the settlement's copy
    // of the budget away from the planner the first time it runs; leaving that
    // behind on a refused compute would silently detach the budget the operator is
    // about to go and edit.
    const settlements = await harness.db
      .select()
      .from(schema.settlements)
      .where(eq(schema.settlements.eventId, seed.event.id));
    expect(settlements).toHaveLength(0);
    const lines = await harness.db
      .select()
      .from(schema.settlementLines)
      .where(eq(schema.settlementLines.eventId, seed.event.id));
    expect(lines).toHaveLength(0);
  });

  it("names an agreement that was never even sent, in its own words", async () => {
    const seed = await seedWorkedExample("door-draft");
    // A third agreement, composed through the real route and therefore a DRAFT —
    // terms nobody has been shown yet.
    const created = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/deals`,
      headers: auth(seed.operator.userId),
      payload: {
        type: "fee",
        structure: "guarantee",
        name: "Support fee",
        guaranteeAmount: "50000",
        parties: [
          { participantId: seed.pPart, roleInDeal: "payer" },
          { participantId: seed.bPart, roleInDeal: "payee" },
        ],
      },
    });
    expect(created.statusCode).toBe(201);

    const refused = await compute(seed.event.id, seed.operator.userId);
    expect(refused.statusCode).toBe(409);
    const message = refused.json().error.message as string;
    expect(message).toContain("Support fee");
    expect(message).toContain("has not been sent to its parties");

    // Sent, but only half signed — the wording moves with the state.
    const sent = await app.inject({
      method: "POST",
      url: `/api/v1/deals/${created.json().id}/send`,
      headers: auth(seed.operator.userId),
    });
    expect(sent.statusCode).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/v1/deals/${created.json().id}/confirm`,
          headers: auth(seed.operator.userId),
        })
      ).statusCode,
    ).toBe(200);
    const half = await compute(seed.event.id, seed.operator.userId);
    expect(half.statusCode).toBe(409);
    expect(half.json().error.message).toContain("waiting on 1 of 2 signatures");

    // The band signs, and the door opens on all three agreements.
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/v1/deals/${created.json().id}/confirm`,
          headers: auth(seed.band.userId),
        })
      ).statusCode,
    ).toBe(200);
    const opened = await compute(seed.event.id, seed.operator.userId);
    expect(opened.statusCode).toBe(200);
    const body = opened.json();
    const byId = new Map<string, string>(
      body.breakdowns.map((row: { participantId: string; net: string }) => [
        row.participantId,
        row.net,
      ]),
    );
    // 300 000 guarantee + 50 000 support fee to the band; the venue's rental
    // unchanged; the operator takes what is left of the 850 000 pool.
    expect(byId.get(seed.bPart)).toBe("350000");
    expect(byId.get(seed.vPart)).toBe("100000");
    expect(byId.get(seed.pPart)).toBe("-450000");
    expect(sumOfNets(body)).toBe(0n);
  });

  /**
   * AN EVENT WITH NO DEALS AT ALL IS NOT BLOCKED, and that is deliberate rather
   * than incidental.
   *
   * A show with only budget lines — an operator reconciling their own door and
   * their own costs — has no agreement to wait for. Refusing it would make the
   * settlement unreachable with no action that opens it, which is a gate that
   * strands work rather than one that protects money. story.md has the operator
   * taking the residual, and with nobody else entitled the residual is the whole
   * pool.
   */
  it("opens for an event with no deals at all — there is nothing to wait for", async () => {
    const seed = await seedWorkedExample("door-no-deals");
    const deals = await harness.db
      .select()
      .from(schema.deals)
      .where(eq(schema.deals.eventId, seed.event.id));
    for (const deal of deals) {
      await harness.db.delete(schema.dealParties).where(eq(schema.dealParties.dealId, deal.id));
    }
    await harness.db.delete(schema.deals).where(eq(schema.deals.eventId, seed.event.id));

    const response = await compute(seed.event.id, seed.operator.userId);
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.pool).toBe("850000");
    const byId = new Map<string, string>(
      body.breakdowns.map((row: { participantId: string; net: string }) => [
        row.participantId,
        row.net,
      ]),
    );
    // The operator collected the pool and is entitled to all of it — net zero, and
    // nothing to transfer to anybody.
    expect(byId.get(seed.pPart)).toBe("0");
    expect(byId.get(seed.vPart)).toBe("0");
    expect(byId.get(seed.bPart)).toBe("0");
    expect(sumOfNets(body)).toBe(0n);
    expect(body.transfers).toHaveLength(0);
  });

  /**
   * A CANCELLED DEAL DOES NOT HOLD THE DOOR SHUT. It is withdrawn — nobody is
   * waiting on a signature for an agreement that is no longer happening, and
   * `reconcileEvent` already entitles nobody under it (`ne(status, 'cancelled')`).
   * The gate reads the rows that clause returns, so the two cannot disagree.
   */
  it("is not held shut by a cancelled deal, however unsigned it is", async () => {
    const seed = await seedWorkedExample("door-cancelled");
    const guarantee = await bandGuaranteeOf(seed.event.id);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/v1/deals/${guarantee.id}/reopen`,
          headers: auth(seed.operator.userId),
          payload: {},
        })
      ).statusCode,
    ).toBe(200);
    // Unsigned, so the door is shut...
    expect((await compute(seed.event.id, seed.operator.userId)).statusCode).toBe(409);

    // ...until the agreement is withdrawn through the real route.
    const cancelled = await app.inject({
      method: "PATCH",
      url: `/api/v1/deals/${guarantee.id}`,
      headers: auth(seed.operator.userId),
      payload: { status: "cancelled" },
    });
    expect(cancelled.statusCode).toBe(200);

    const response = await compute(seed.event.id, seed.operator.userId);
    expect(response.statusCode).toBe(200);
    const body = response.json();
    const byId = new Map<string, string>(
      body.breakdowns.map((row: { participantId: string; net: string }) => [
        row.participantId,
        row.net,
      ]),
    );
    // The band is owed nothing under a withdrawn deal; the venue's signed rental
    // stands; the operator absorbs the difference in the residual.
    expect(byId.get(seed.bPart)).toBe("0");
    expect(byId.get(seed.vPart)).toBe("100000");
    expect(byId.get(seed.pPart)).toBe("-100000");
    expect(sumOfNets(body)).toBe(0n);
  });

  /**
   * FINALIZE IS THE SECOND DOOR, and it refuses too.
   *
   * It re-derives the whole settlement through `reconcileEvent` before freezing an
   * immutable snapshot and locking the FX. Freezing the legal record of what each
   * party is owed under an agreement that has been reopened for renegotiation is
   * precisely the record that must not be written — the terms are, by definition,
   * in flux. A rule enforced at one call site is enforced nowhere.
   */
  it("refuses to finalize while an agreement is unsigned, and freezes nothing", async () => {
    const seed = await seedWorkedExample("door-finalize");
    expect((await compute(seed.event.id, seed.operator.userId)).statusCode).toBe(200);

    const guarantee = await bandGuaranteeOf(seed.event.id);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/v1/deals/${guarantee.id}/reopen`,
          headers: auth(seed.operator.userId),
          payload: {},
        })
      ).statusCode,
    ).toBe(200);

    const refused = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/finalize`,
      headers: auth(seed.operator.userId),
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.message).toContain("Band guarantee");

    const rows = await harness.db
      .select()
      .from(schema.settlements)
      .where(eq(schema.settlements.eventId, seed.event.id));
    expect(rows.every((row) => row.status !== "finalized")).toBe(true);
    const snapshots = await harness.db
      .select()
      .from(schema.settlementSnapshots)
      .where(eq(schema.settlementSnapshots.eventId, seed.event.id));
    expect(snapshots).toHaveLength(0);
  });

  /**
   * WHAT A REOPENED DEAL DOES TO A SETTLEMENT SOMEBODY IS MID-WAY THROUGH: it stops
   * the FIGURES moving, and nothing else.
   *
   * This is the case worth being careful about, because a gate that strands work is
   * worse than no gate. `POST /deals/:did/reopen` clears every confirmation and puts
   * the deal back to `sent`, so from that moment the door is shut — but the review
   * conversation, a party's objection, and marking cash as received all carry on,
   * because none of them restates the night. The way out is one act: sign the
   * agreement again, or withdraw it.
   */
  it("stops a recompute after a reopen, but strands nothing that was already open", async () => {
    const seed = await seedWorkedExample("door-reopen-midway");
    expect((await compute(seed.event.id, seed.operator.userId)).statusCode).toBe(200);
    const before = await harness.db
      .select()
      .from(schema.settlements)
      .where(eq(schema.settlements.eventId, seed.event.id));

    const guarantee = await bandGuaranteeOf(seed.event.id);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/v1/deals/${guarantee.id}/reopen`,
          headers: auth(seed.operator.userId),
          payload: {},
        })
      ).statusCode,
    ).toBe(200);

    // The figures may not move...
    expect((await compute(seed.event.id, seed.operator.userId)).statusCode).toBe(409);

    // ...and they have not: the stored breakdowns are byte-for-byte what the
    // compute before the reopen wrote.
    const after = await harness.db
      .select()
      .from(schema.settlements)
      .where(eq(schema.settlements.eventId, seed.event.id));
    expect(after.map((row) => row.computed)).toEqual(before.map((row) => row.computed));

    // Everything that is not the arithmetic carries on. Reading it:
    const read = await app.inject({
      method: "GET",
      url: `/api/v1/events/${seed.event.id}/settlements`,
      headers: auth(seed.band.userId),
    });
    expect(read.statusCode).toBe(200);
    // Saying it is wrong:
    const commented = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/comments`,
      headers: auth(seed.band.userId),
      payload: { message: "My fee is being renegotiated — hold this." },
    });
    expect(commented.statusCode).toBe(201);
    const disputed = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/status`,
      headers: auth(seed.band.userId),
      payload: { status: "dispute" },
    });
    expect(disputed.statusCode).toBe(200);
    // And recording cash that really did move:
    const [transfer] = await harness.db
      .select()
      .from(schema.settlementTransfers)
      .where(eq(schema.settlementTransfers.eventId, seed.event.id));
    if (!transfer) throw new Error("transfer missing");
    const paid = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${seed.event.id}/transfers/${transfer.id}`,
      headers: auth(seed.operator.userId),
      payload: { state: "paid" },
    });
    expect(paid.statusCode).toBe(200);

    // The one act that reopens the door is the one the reopen was for.
    for (const userId of [seed.operator.userId, seed.band.userId]) {
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/api/v1/deals/${guarantee.id}/confirm`,
            headers: auth(userId),
          })
        ).statusCode,
      ).toBe(200);
    }
    const reopened = await compute(seed.event.id, seed.operator.userId);
    expect(reopened.statusCode).toBe(200);
    expect(sumOfNets(reopened.json())).toBe(0n);
  });

  /**
   * A FINALIZED SETTLEMENT IS UNTOUCHED, and it answers with the RIGHT refusal.
   *
   * Ordering matters here: `assertNotFinalized` runs before `reconcileEvent`, so a
   * finalized settlement whose deal is later reopened still says "finalized — the
   * figures are locked", not "go and get a signature". Telling an operator to chase
   * a signature that would change nothing is the "right status, wrong reason" trap
   * the verify-e2e skill names.
   */
  it("keeps saying `finalized` — not `unsigned` — once the figures are frozen", async () => {
    const seed = await seedWorkedExample("door-reopen-finalized");
    expect((await compute(seed.event.id, seed.operator.userId)).statusCode).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/v1/events/${seed.event.id}/settlement/finalize`,
          headers: auth(seed.operator.userId),
        })
      ).statusCode,
    ).toBe(200);

    const guarantee = await bandGuaranteeOf(seed.event.id);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/v1/deals/${guarantee.id}/reopen`,
          headers: auth(seed.operator.userId),
          payload: {},
        })
      ).statusCode,
    ).toBe(200);

    const refused = await compute(seed.event.id, seed.operator.userId);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.message).toContain("finalized");
    expect(refused.json().error.message).not.toContain("Band guarantee");

    // And the transfers can still be settled, which is the whole point of the
    // finalized state.
    const [transfer] = await harness.db
      .select()
      .from(schema.settlementTransfers)
      .where(eq(schema.settlementTransfers.eventId, seed.event.id));
    if (!transfer) throw new Error("transfer missing");
    const paid = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${seed.event.id}/transfers/${transfer.id}`,
      headers: auth(seed.operator.userId),
      payload: { state: "paid" },
    });
    expect(paid.statusCode).toBe(200);
  });
});

/**
 * THE STANDALONE OPERATOR'S NIGHT, AND WHY IT STILL BALANCES.
 *
 * The product owner asked that a user *"be able to use the system also as a
 * standalone"*, and the deal composer's guard — *"Nobody on this agreement is
 * paid by it"* — was what stopped them: alone on the event, the only line an
 * operator can write is their own, and the guard then demanded they name
 * THEMSELVES as "Is paid", which is nonsense for someone planning their own night.
 *
 * The relaxation is safe for one reason, and this is the reason rather than an
 * assertion of it: `reconcile()`'s `settleDeal` returns `0n` the moment a deal
 * names no payee, so a deal that entitles nobody claims nothing from the pool —
 * and the operator's entitlement is `pool − Σ everyone else`, so the whole pool
 * lands on the operator's own line and `Σ net = 0` holds exactly. The figures
 * below are the same with the deal and without it; only the RECORD differs, which
 * is the entire point of allowing it.
 */
describe("settlement — a deal that entitles nobody", () => {
  async function seedStandaloneNight(prefix: string) {
    const { db } = harness;
    const operator = await seedMemberWithSet(
      `${prefix}-solo-op`,
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const [event] = await db
      .insert(schema.events)
      .values({
        hostProfileId: operator.profileId,
        title: "My own night",
        baseCurrency: "SEK",
        createdBy: operator.userId,
      })
      .returning();
    if (!event) throw new Error("event seed failed");
    const [host] = await db
      .insert(schema.eventParticipants)
      .values({
        eventId: event.id,
        profileId: operator.profileId,
        role: "host",
        permissionSetId: operator.permissionSetId,
        status: "confirmed",
      })
      .returning();
    if (!host) throw new Error("participant seed failed");

    const [budget] = await db.insert(schema.budgets).values({ eventId: event.id }).returning();
    if (!budget) throw new Error("budget seed failed");
    await db.insert(schema.budgetLines).values([
      {
        budgetId: budget.id,
        kind: "revenue",
        label: "Tickets",
        amount: 1000000n,
        collectedBy: host.id,
      },
      { budgetId: budget.id, kind: "cost", label: "Sound hire", amount: 200000n, paidBy: host.id },
    ]);
    return { event, operator, host };
  }

  it("leaves the whole pool with the operator, and Σ net = 0", async () => {
    const { db } = harness;
    const seed = await seedStandaloneNight("entitles-nobody");

    // The deal the composer used to refuse: written through the REAL route, with
    // the operator's own line and no payee at all.
    const created = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/deals`,
      headers: auth(seed.operator.userId),
      payload: {
        type: "performance",
        structure: "guarantee",
        name: "What I agreed to pay the DJ, on paper",
        guaranteeAmount: "300000",
        paymentTiming: "at_settlement",
        parties: [{ participantId: seed.host.id, roleInDeal: "payer" }],
      },
    });
    expect(created.statusCode).toBe(201);
    // A settlement cannot open on an unsigned agreement (decisions #21), and the
    // operator's own payer line is a signatory like any other.
    await signEveryAgreement(db, seed.event.id);

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/compute`,
      headers: auth(seed.operator.userId),
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.pool).toBe("800000");

    const breakdowns = body.breakdowns as { participantId: string; net: string }[];
    expect(breakdowns).toHaveLength(1);
    expect(breakdowns[0]?.participantId).toBe(seed.host.id);
    // Entitled to the whole pool and holding the whole pool → owed nothing, owing
    // nothing. THE CONSERVATION LAW, read off the response rather than trusted.
    expect(breakdowns[0]?.net).toBe("0");
    const sum = breakdowns.reduce((running, row) => running + BigInt(row.net), 0n);
    expect(sum).toBe(0n);

    // Nothing moves, because nobody is owed anything.
    const transfers = await db
      .select()
      .from(schema.settlementTransfers)
      .where(eq(schema.settlementTransfers.eventId, seed.event.id));
    expect(transfers).toHaveLength(0);

    // The stored settlement says the same thing the response did.
    const rows = await db
      .select()
      .from(schema.settlements)
      .where(eq(schema.settlements.eventId, seed.event.id));
    expect(rows).toHaveLength(1);
    const stored = rows[0]?.computed as { entitlement: string; net: string } | null;
    expect(stored?.entitlement).toBe("800000");
    expect(stored?.net).toBe("0");
  });

  it("settles identically whether or not the payee-less deal is there", async () => {
    const { db } = harness;
    const withoutDeal = await seedStandaloneNight("no-deal");
    const bare = await app.inject({
      method: "POST",
      url: `/api/v1/events/${withoutDeal.event.id}/settlement/compute`,
      headers: auth(withoutDeal.operator.userId),
    });
    expect(bare.statusCode).toBe(200);

    const withDeal = await seedStandaloneNight("with-deal");
    const created = await app.inject({
      method: "POST",
      url: `/api/v1/events/${withDeal.event.id}/deals`,
      headers: auth(withDeal.operator.userId),
      payload: {
        type: "performance",
        structure: "door_split",
        name: "A split with nobody on the other end",
        splitBasisPoints: 5000,
        paymentTiming: "at_settlement",
        parties: [{ participantId: withDeal.host.id, roleInDeal: "payer" }],
      },
    });
    expect(created.statusCode).toBe(201);
    await signEveryAgreement(db, withDeal.event.id);
    const settled = await app.inject({
      method: "POST",
      url: `/api/v1/events/${withDeal.event.id}/settlement/compute`,
      headers: auth(withDeal.operator.userId),
    });
    expect(settled.statusCode).toBe(200);

    expect(settled.json().pool).toBe(bare.json().pool);
    expect(settled.json().breakdowns[0].net).toBe(bare.json().breakdowns[0].net);
    expect(settled.json().breakdowns[0].entitlement).toBe(bare.json().breakdowns[0].entitlement);
  });

  /**
   * The one shape the relaxation had to close, and the reason the deal routes
   * refuse it: `reconcile()` throws a bare Error on an advance with no payee, so
   * a row written before that guard existed would 500 every compute forever. The
   * engine's own message is not a diagnosis, so the settlement turns it into one.
   */
  it("refuses to compute a stored deal that prepaid nobody, naming the deal", async () => {
    const { db } = harness;
    const seed = await seedStandaloneNight("prepaid-nobody");
    const [deal] = await db
      .insert(schema.deals)
      .values({
        eventId: seed.event.id,
        type: "performance",
        structure: "guarantee",
        name: "Advance into the void",
        guaranteeAmount: 300000n,
        advanceAmount: 100000n,
        paymentTiming: "before_event",
        createdBy: seed.operator.userId,
      })
      .returning();
    if (!deal) throw new Error("deal seed failed");
    await db
      .insert(schema.dealParties)
      .values({ dealId: deal.id, participantId: seed.host.id, roleInDeal: "payer" });
    await signEveryAgreement(db, seed.event.id);

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/settlement/compute`,
      headers: auth(seed.operator.userId),
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.message).toContain("Advance into the void");
    expect(response.json().error.message).toContain("names nobody it was paid to");
  });
});
