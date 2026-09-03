import { PRESET_PERMISSION_SETS } from "@showme/auth";
import { schema } from "@showme/db";
import {
  REFERENCE_DEALS,
  REFERENCE_DOOR_SPLIT_POOL,
  REFERENCE_DOOR_SPLIT_SHARES,
  REFERENCE_DOOR_SPLIT_TERMS,
  REFERENCE_FORWARD_LOOKING_BUDGETS,
  REFERENCE_GUARANTEE_VS_DOOR_TERMS,
  breakdownFor,
  dealTermsAsTheEngineSeesThem,
  projectedProfit,
  referenceAlbumReleaseBudgetLines,
  referenceBudgetLines,
  referenceSettlement,
} from "@showme/db/reference-settlement";
import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import { dealEntitlement, serializeBreakdown, storeBreakdown } from "@showme/settlement";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TokenVerifier } from "./auth/token-verifier";
import { settlementRoutes } from "./routes/settlement";
import { buildTestApp, signEveryAgreement } from "./testing";

/**
 * The reference concluded event — the fixture both seeds ship as the platform's
 * worked example (audit A-13).
 *
 * It was broken in two ways at once, and the two failures protected each other. The
 * stored `computed` jsonb used `cashHeld` and carried no `participantId`, so
 * `GET /events/:id/settlements` 500'd on its own response schema for operator and
 * performer alike — which meant nobody could see that the FIGURES were wrong too: the
 * fixture took 70% of gross revenue where the deal (and the engine) takes 70% of the
 * pool, 6 300.00 SEK adrift on the settlement the whole product is demonstrated with.
 *
 * So this suite asserts both halves, on the fixture the seeds actually insert:
 *   1. the seeded snapshot SURVIVES the real route and its real response schema, for
 *      each viewer, with the figures each is entitled to see;
 *   2. those figures are exactly what `POST /settlement/compute` derives from the same
 *      rows — closing the loop through the API's own DB→engine mapping, which is the
 *      seam that A-01 (`splitBasisPoints`) already drifted at once.
 */

const fakeVerifier: TokenVerifier = {
  async verify(token: string) {
    return { uid: token, email: `${token}@example.showme.test`, name: token };
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

interface ReferenceEvent {
  eventId: string;
  hostParticipantId: string;
  performerParticipantId: string;
  dealId: string;
  operatorUserId: string;
  performerUserId: string;
}

/**
 * Insert the reference concluded event exactly the way `seed.ts` / `seed-e2e.ts` do:
 * the deal terms and the budget lines come from the shared fixture, and — when
 * `settled` — so does the stored snapshot, via the settlement engine.
 */
async function seedReferenceEvent(prefix: string, settled: boolean): Promise<ReferenceEvent> {
  const { db } = harness;
  const operator = await seedMemberWithSet(
    `${prefix}-operator`,
    "operator",
    PRESET_PERMISSION_SETS.operator_full,
  );
  const performer = await seedMemberWithSet(
    `${prefix}-performer`,
    "performer",
    PRESET_PERMISSION_SETS.performer,
  );

  const [event] = await db
    .insert(schema.events)
    .values({
      hostProfileId: operator.profileId,
      title: "Spring Warm-up",
      status: settled ? "concluded" : "confirmed",
      baseCurrency: "SEK",
      createdBy: operator.userId,
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
  const hostParticipantId = participants.find((row) => row.profileId === operator.profileId)
    ?.id as string;
  const performerParticipantId = participants.find((row) => row.profileId === performer.profileId)
    ?.id as string;

  const [deal] = await db
    .insert(schema.deals)
    .values({
      eventId: event.id,
      type: "performance",
      structure: REFERENCE_GUARANTEE_VS_DOOR_TERMS.structure,
      currency: "SEK",
      name: "Guarantee vs Door",
      payerParticipantId: hostParticipantId,
      guaranteeAmount: REFERENCE_GUARANTEE_VS_DOOR_TERMS.guaranteeAmount,
      splitBasisPoints: REFERENCE_GUARANTEE_VS_DOOR_TERMS.splitBasisPoints,
      status: "confirmed",
      createdBy: operator.userId,
    })
    .returning();
  if (!deal) throw new Error("deal seed failed");

  await db.insert(schema.dealParties).values([
    { dealId: deal.id, participantId: hostParticipantId, roleInDeal: "payer" },
    {
      dealId: deal.id,
      participantId: performerParticipantId,
      roleInDeal: "payee",
      share: {
        guaranteeAmount: REFERENCE_GUARANTEE_VS_DOOR_TERMS.guaranteeAmount.toString(),
        splitBasisPoints: REFERENCE_GUARANTEE_VS_DOOR_TERMS.splitBasisPoints,
        currency: "SEK",
      },
    },
  ]);

  const [budget] = await db
    .insert(schema.budgets)
    .values({ eventId: event.id, scope: "shared" })
    .returning();
  if (!budget) throw new Error("budget seed failed");

  const spine = { hostParticipantId, performerParticipantId, dealId: deal.id };
  await db.insert(schema.budgetLines).values(
    referenceBudgetLines(spine).map((line) => ({
      budgetId: budget.id,
      source: "manual" as const,
      ...line,
    })),
  );

  if (settled) {
    const result = referenceSettlement(spine);
    await db.insert(schema.settlements).values([
      {
        eventId: event.id,
        participantId: hostParticipantId,
        status: "finalized",
        computed: storeBreakdown(breakdownFor(result, hostParticipantId), result.ladder),
      },
      {
        eventId: event.id,
        participantId: performerParticipantId,
        status: "finalized",
        computed: storeBreakdown(breakdownFor(result, performerParticipantId), result.ladder),
      },
    ]);
    await db.insert(schema.settlementTransfers).values(
      result.transfers.map((transfer) => ({
        eventId: event.id,
        fromParticipant: transfer.fromParticipantId,
        toParticipant: transfer.toParticipantId,
        amount: transfer.amount,
        currency: "SEK",
        state: "owed" as const,
      })),
    );
  }

  // Signed, because since 2026-08-31 a settlement cannot open otherwise
  // (decisions.md #21). The fixture inserts its `deals` row straight into the
  // table, so it needs the agreement walked to `confirmed` the way the real
  // confirm routes walk it — which is exactly what `signEveryAgreement` does,
  // through the product's own `confirmDealIfComplete`.
  await signEveryAgreement(db, event.id);

  return {
    eventId: event.id,
    hostParticipantId,
    performerParticipantId,
    dealId: deal.id,
    operatorUserId: operator.userId,
    performerUserId: performer.userId,
  };
}

describe("the seeded reference settlement (A-13)", () => {
  /**
   * The arithmetic, spelled out, because the whole finding is that it was wrong and
   * plausible. `splitBasisPoints` is a share OF THE POOL, and the pool is revenue
   * minus costs paid to outsiders — the hotel names the performer, so it is a
   * deductible against her entitlement and leaves the pool alone.
   *
   *   pool       = 78 000 door − 9 000 sound & production            = 69 000
   *   performer  = max(18 000 guarantee, 70% × 69 000 = 48 300)      = 48 300
   *                less the 1 800 hotel                              = 46 500
   *   operator   = residual 69 000 − 48 300                          = 20 700
   *   held       = operator 78 000 − 10 800 = 67 200 · performer 0
   *   net        = operator 20 700 − 67 200 = −46 500 · performer +46 500  (Σ = 0)
   *
   * The pre-fix fixture took 70% of the 78 000 GROSS (54 600) and paid 52 800 —
   * 6 300.00 SEK too much, on the settlement the product is demonstrated with.
   */
  const POOL = "6900000";
  const PERFORMER_ENTITLEMENT = "4650000";
  const OPERATOR_ENTITLEMENT = "2070000";
  const OPERATOR_HELD = "6720000";
  const TRANSFER = "4650000";

  let settled: ReferenceEvent;

  beforeAll(async () => {
    settled = await seedReferenceEvent("reference-settled", true);
  });

  it("is readable by the operator, who sees both lines and the transfer it owes", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/events/${settled.eventId}/settlements`,
      headers: auth(settled.operatorUserId),
    });

    // A 500 here is the original finding: the stored jsonb failed the response schema.
    expect(response.statusCode).toBe(200);
    const body = response.json();

    const operatorLine = body.settlements.find(
      (row: { participantId: string }) => row.participantId === settled.hostParticipantId,
    );
    expect(operatorLine.computed).toEqual({
      participantId: settled.hostParticipantId,
      entitlement: OPERATOR_ENTITLEMENT,
      collected: "7800000",
      paid: "1080000",
      // Nothing moved before this night — the reference deal settles after it.
      prepaid: "0",
      held: OPERATOR_HELD,
      net: `-${TRANSFER}`,
      // The operator is on no deal of its own here — everything it keeps is the
      // residual, and saying so is the difference between a figure and an answer.
      lines: [],
      commissionEarned: "0",
      deductibles: "0",
      residual: OPERATOR_ENTITLEMENT,
    });

    // The ladder — gross, costs, and the adjusted net the 70% was taken from. The
    // operator holds `budget.view`, so it arrives; the performer's read below proves
    // it does not travel any further.
    expect(body.ladder).toEqual({
      revenue: "7800000",
      costs: "900000",
      pool: POOL,
      // No rental on this event, so the adjusted net IS the pool.
      offTheTop: "0",
      splitPool: POOL,
    });

    // The operator is the deal's payer, so it also sees the line it is paying.
    const performerLine = body.settlements.find(
      (row: { participantId: string }) => row.participantId === settled.performerParticipantId,
    );
    expect(performerLine.computed.entitlement).toBe(PERFORMER_ENTITLEMENT);

    expect(body.transfers).toHaveLength(1);
    expect(body.transfers[0]).toMatchObject({
      fromParticipantId: settled.hostParticipantId,
      toParticipantId: settled.performerParticipantId,
      amount: TRANSFER,
    });
  });

  it("is readable by the performer, who sees her own line and what she is owed", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/events/${settled.eventId}/settlements`,
      headers: auth(settled.performerUserId),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();

    // Party-scoped: a payee sees her own line, never the operator's margin.
    expect(body.settlements).toHaveLength(1);
    expect(body.settlements[0].computed).toEqual({
      participantId: settled.performerParticipantId,
      entitlement: PERFORMER_ENTITLEMENT,
      collected: "0",
      paid: "0",
      prepaid: "0",
      held: "0",
      net: TRANSFER,
      // WHY she is owed it: her 70% beat the 18 000 floor, and the hotel the
      // operator fronted came off afterwards.
      //
      // `pool` and `door` are ABSENT, and that is the point: they are the event's
      // adjusted net, which story.md:44 keeps from a performer as an inviolable
      // ceiling. Her own terms — that the door arm won, her percentage, her floor —
      // all survive, so the line still says what rule paid her.
      lines: [
        {
          dealId: settled.dealId,
          dealTotal: "4830000",
          amount: "4830000",
          basis: {
            kind: "guarantee_vs_door",
            won: "door",
            guarantee: "1800000",
            basisPoints: 7000,
          },
        },
      ],
      commissionEarned: "0",
      deductibles: "180000",
      // AND WHICH cost that was. The total alone is the figure that starts a
      // settlement argument — "less costs somebody else fronted on your behalf,
      // 1 800" with no way to ask about it except by asking (ClickUp `86cbcn1ue`).
      // It is HER portion of the line, so it sums to `deductibles` above.
      deductibleLines: [{ label: "Artist hotel", amount: "180000" }],
      residual: "0",
    });
    expect(body.transfers[0].amount).toBe(TRANSFER);

    // THE CEILING. The ladder is the whole night's takings and costs; a payee is
    // told her own line and nothing about the pool it came out of (story.md).
    expect(body.ladder).toBeNull();
  });

  it("lists the performer's payout on her own Settlements screen", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/settlements",
      headers: auth(settled.performerUserId),
    });

    expect(response.statusCode).toBe(200);
    const [item] = response.json().items;
    expect(item.entitlement).toBe(PERFORMER_ENTITLEMENT);
    expect(item.net).toBe(TRANSFER);
  });

  it("matches what the engine computes from the same rows", async () => {
    // The same fixture, not yet finalized, run through the real compute path — which
    // builds the engine input from the DATABASE rows rather than from the fixture's
    // own in-memory view of them. That mapping is where A-01 drifted (`basisPoints`
    // vs `splitBasisPoints`), so a seeded snapshot that agrees with the engine but
    // not with the mapping would still be a lie on screen.
    const fresh = await seedReferenceEvent("reference-fresh", false);

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/events/${fresh.eventId}/settlement/compute`,
      headers: auth(fresh.operatorUserId),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.pool).toBe(POOL);

    const expected = referenceSettlement({
      hostParticipantId: fresh.hostParticipantId,
      performerParticipantId: fresh.performerParticipantId,
      dealId: fresh.dealId,
    });
    expect(body.breakdowns).toEqual(expected.breakdowns.map(serializeBreakdown));
    expect(body.transfers).toEqual([
      {
        fromParticipantId: fresh.hostParticipantId,
        toParticipantId: fresh.performerParticipantId,
        amount: TRANSFER,
      },
    ]);

    // And the pool is revenue minus EXTERNAL costs only — the deductible stays out of it.
    expect(body.pool).toBe((7800000n - 900000n).toString());
  });
});

/**
 * The album release's shared door split — the OTHER half of the fixture rot.
 *
 * Its terms lived entirely in the two parties' `share` jsonb (60/40) while
 * `deals.split_basis_points` stayed NULL. But a party's share only DIVIDES a deal;
 * `dealEntitlement` SIZES it from the deal-level column. So the deal took 0% of the
 * pool, both performers settled at zero, and the venue kept the whole thing — the
 * residue A-01 flagged and left for A-13.
 *
 * The figures are not invented: A-01 records the signed snapshot for this deal as
 * Marlo Vance 3 000 000 (60%) and Neon Tide 2 000 000 (40%) on a 5 000 000 pool —
 * the split members taking the whole pool between them, divided 60/40.
 */
describe("the seeded album split deal (A-01's leftover)", () => {
  it("sizes a real entitlement for every reference deal, out of a real pool", () => {
    // The invariant that would have caught this, asked of every deal the seeds
    // insert: whatever a deal's structure, its DEAL-LEVEL terms must take something
    // out of the pool. A deal that sizes to zero pays its payees nothing, however
    // carefully their shares divide it — and nothing else in the suite notices,
    // because Σ net = 0 balances perfectly when everyone is owed nothing.
    for (const { label, terms } of REFERENCE_DEALS) {
      const entitlement = dealEntitlement(
        dealTermsAsTheEngineSeesThem(terms),
        REFERENCE_DOOR_SPLIT_POOL,
        0,
      );
      expect(entitlement, `${label} takes nothing out of the pool`).toBeGreaterThan(0n);
    }
  });

  it("pays the two split members their signed 60/40, not the venue", async () => {
    const { db } = harness;
    const operator = await seedMemberWithSet(
      "album-operator",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const headliner = await seedMemberWithSet(
      "album-headliner",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );
    const support = await seedMemberWithSet(
      "album-support",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );

    const [event] = await db
      .insert(schema.events)
      .values({
        hostProfileId: operator.profileId,
        title: "Album Release",
        baseCurrency: "SEK",
        createdBy: operator.userId,
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
          profileId: headliner.profileId,
          role: "performer",
          permissionSetId: headliner.permissionSetId,
          status: "confirmed",
        },
        {
          eventId: event.id,
          profileId: support.profileId,
          role: "performer",
          permissionSetId: support.permissionSetId,
          status: "confirmed",
        },
      ])
      .returning();
    const participantOf = (profileId: string) =>
      participants.find((row) => row.profileId === profileId)?.id as string;
    const hostParticipantId = participantOf(operator.profileId);
    const headlinerParticipantId = participantOf(headliner.profileId);
    const supportParticipantId = participantOf(support.profileId);

    // The deal exactly as the seed inserts it: deal-level terms size it, party
    // shares divide it.
    const [deal] = await db
      .insert(schema.deals)
      .values({
        eventId: event.id,
        type: "split",
        structure: REFERENCE_DOOR_SPLIT_TERMS.structure,
        currency: "SEK",
        name: "Album Release — Door Split",
        payerParticipantId: hostParticipantId,
        splitBasisPoints: REFERENCE_DOOR_SPLIT_TERMS.splitBasisPoints,
        agreementStatus: "confirmed",
        status: "confirmed",
        createdBy: operator.userId,
      })
      .returning();
    if (!deal) throw new Error("deal seed failed");

    await db.insert(schema.dealParties).values([
      { dealId: deal.id, participantId: hostParticipantId, roleInDeal: "payer" },
      {
        dealId: deal.id,
        participantId: headlinerParticipantId,
        roleInDeal: "split_member",
        share: {
          illustrativeAmount: REFERENCE_DOOR_SPLIT_SHARES.headlinerAmount.toString(),
          splitBasisPoints: REFERENCE_DOOR_SPLIT_SHARES.headlinerBasisPoints,
          currency: "SEK",
        },
      },
      {
        dealId: deal.id,
        participantId: supportParticipantId,
        roleInDeal: "split_member",
        share: {
          illustrativeAmount: REFERENCE_DOOR_SPLIT_SHARES.supportAmount.toString(),
          splitBasisPoints: REFERENCE_DOOR_SPLIT_SHARES.supportBasisPoints,
          currency: "SEK",
        },
      },
    ]);

    const [budget] = await db
      .insert(schema.budgets)
      .values({ eventId: event.id, scope: "shared" })
      .returning();
    if (!budget) throw new Error("budget seed failed");

    // The budget the seeds actually put on this event — six lines, two of revenue and
    // four of external cost — rather than one synthetic line already equal to the
    // pool. That substitution is the point: the seeded event now HAS a budget (it used
    // to have none, which is why the Financial Projections screen had nothing to
    // project), and the 60/40 below is only true if those six lines net to exactly the
    // pool the shares are quoted at. A single line worth the pool could not have
    // caught a costing that drifted; these can.
    await db.insert(schema.budgetLines).values(
      referenceAlbumReleaseBudgetLines({ hostParticipantId, dealId: deal.id }).map((line) => ({
        budgetId: budget.id,
        source: "manual" as const,
        ...line,
      })),
    );

    // The agreement is signed before the settlement may open (decisions.md #21).
    await signEveryAgreement(db, event.id);

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/settlement/compute`,
      headers: auth(operator.userId),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    const entitlementOf = (participantId: string) =>
      body.breakdowns.find((row: { participantId: string }) => row.participantId === participantId)
        ?.entitlement;

    // 83 000 revenue − 33 000 external cost, netting to the pool the signed shares
    // are quoted at. Stated against the constant, not the literal, so a budget line
    // that moves fails HERE rather than silently re-pricing both performers.
    expect(body.pool).toBe(REFERENCE_DOOR_SPLIT_POOL.toString());
    // Pre-fix these were "0" and "0", with the host holding the entire 5 000 000.
    expect(entitlementOf(headlinerParticipantId)).toBe(
      REFERENCE_DOOR_SPLIT_SHARES.headlinerAmount.toString(), // 60% — A-01's snapshot
    );
    expect(entitlementOf(supportParticipantId)).toBe(
      REFERENCE_DOOR_SPLIT_SHARES.supportAmount.toString(), // 40% — A-01's snapshot
    );
    expect(entitlementOf(hostParticipantId)).toBe("0"); // the split members take the pool

    // And the venue pays it out rather than keeping it.
    expect(body.transfers).toHaveLength(2);
    for (const transfer of body.transfers) {
      expect(transfer.fromParticipantId).toBe(hostParticipantId);
    }
  });
});

/**
 * The forward-looking budgets — the fixture gap that read as a broken screen.
 *
 * Financial Projections rolls up planned revenue against planned costs across the
 * event pipeline, and it computes that from budget lines. The seeds put a budget on
 * exactly one event — the CONCLUDED one — so both of the screen's forward-looking
 * scopes ("Confirmed", "Upcoming") matched real events and had nothing to sum over
 * them, and rendered a dash under every figure. Only "All events" showed anything, by
 * sweeping in a settled show from months earlier.
 *
 * Nothing was wrong with the code. The fixture simply had no data for the case the
 * screen exists to show — which, from where the user is sitting, is indistinguishable
 * from a bug, and was in fact reported as one.
 *
 * `REFERENCE_DEALS` already guards the neighbouring failure one level down (a deal
 * whose terms size to nothing out of a real pool). This is the same guard one level
 * up: an event still ahead of us whose budget projects nothing at all.
 */
describe("the seeded forward-looking budgets (the projections fixture)", () => {
  it("gives every event still ahead of us something to project", () => {
    // Deliberately not asserting the amounts: what makes a projection a projection is
    // that there IS one. A budget with no revenue divides by zero for its margin and
    // shows the same dash as no budget at all, which is the state being guarded.
    expect(REFERENCE_FORWARD_LOOKING_BUDGETS.length).toBeGreaterThan(0);
    for (const { label, lines } of REFERENCE_FORWARD_LOOKING_BUDGETS) {
      const { revenue, cost, profit } = projectedProfit(lines);
      expect(revenue, `${label} projects no revenue`).toBeGreaterThan(0n);
      expect(cost, `${label} projects revenue with no costs against it`).toBeGreaterThan(0n);
      expect(profit, `${label} projects a loss`).toBeGreaterThan(0n);
    }
  });

  it("sizes the confirmed event's pool to exactly the pool its signed shares are quoted at", () => {
    // The album release's budget is not free to be any plausible set of numbers: the
    // deal on it hands 100% of the pool to two performers at 60/40, and the seeds
    // quote their lines — and the agent commission derived from the headliner's —
    // as fixed amounts. Those amounts are only true if the budget nets to
    // REFERENCE_DOOR_SPLIT_POOL, so that identity is asserted rather than assumed.
    const { revenue, cost, profit } = projectedProfit(
      referenceAlbumReleaseBudgetLines({ hostParticipantId: "host", dealId: "deal" }),
    );
    expect(profit).toBe(REFERENCE_DOOR_SPLIT_POOL);
    expect(revenue).toBe(8_300_000n); // 83 000.00 SEK of tickets
    expect(cost).toBe(3_300_000n); // 33 000.00 SEK to outside suppliers

    // No cost line names a participant, so none of them is a deductible — which is
    // what keeps the projection screen's revenue−cost and the engine's pool the same
    // number on this event, and the two performers on exactly their signed shares.
    for (const line of referenceAlbumReleaseBudgetLines({ hostParticipantId: "host" })) {
      expect(line.payeeParticipantId, `"${line.label}" is a deductible, not a pool cost`).toBe(
        undefined,
      );
    }
  });
});
