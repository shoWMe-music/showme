import { PRESET_PERMISSION_SETS, effectiveEventCapabilities, resolvePrincipal } from "@showme/auth";
import { schema } from "@showme/db";
import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TokenVerifier } from "./auth/token-verifier";
import { assignAgentToEvent } from "./lib/agent-assignment";
import { dealPartyRecipients } from "./lib/notify";
import { dealRoutes } from "./routes/deals";
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
  app = buildTestApp({ database: harness.db, tokenVerifier: fakeVerifier }, [dealRoutes]);
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await harness?.stop();
});

const auth = (uid: string) => ({ authorization: `Bearer ${uid}` });

/** Seed a user + profile + active membership + a permission set (app.test.ts pattern). */
async function seedMemberWithSet(
  id: string,
  kind: "operator" | "performer" | "agent" | "team_and_crew",
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

/** Seed an event hosted by `operator`, with each given profile joined as a participant. */
async function seedEvent(
  operator: { profileId: string; permissionSetId: string },
  participants: {
    profileId: string;
    permissionSetId: string;
    role: "host" | "co_host" | "performer" | "crew" | "crew_lead";
  }[],
  createdBy: string,
) {
  const { db } = harness;
  const [event] = await db
    .insert(schema.events)
    .values({
      hostProfileId: operator.profileId,
      // The venue is the host's own profile — its country is the territory test a
      // representation resolves against (decisions #14).
      venueProfileId: operator.profileId,
      title: "Split Night",
      baseCurrency: "SEK",
      createdBy,
    })
    .returning();
  if (!event) throw new Error("event seed failed");
  const rows = await db
    .insert(schema.eventParticipants)
    .values(
      participants.map((participant) => ({
        eventId: event.id,
        profileId: participant.profileId,
        role: participant.role,
        permissionSetId: participant.permissionSetId,
        status: "confirmed" as const,
      })),
    )
    .returning();
  return { event, participants: rows };
}

describe("deals — party-scoped visibility", () => {
  it("operator sees all parties on a split deal; each performer sees only their own line", async () => {
    const operator = await seedMemberWithSet(
      "d-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const perfA = await seedMemberWithSet("d-pa", "performer", PRESET_PERMISSION_SETS.performer);
    const perfB = await seedMemberWithSet("d-pb", "performer", PRESET_PERMISSION_SETS.performer);

    const { event, participants } = await seedEvent(
      operator,
      [
        { ...operator, role: "host" },
        { ...perfA, role: "performer" },
        { ...perfB, role: "performer" },
      ],
      "d-op",
    );
    const participantA = participants.find((p) => p.profileId === perfA.profileId);
    const participantB = participants.find((p) => p.profileId === perfB.profileId);
    const hostParticipant = participants.find((p) => p.profileId === operator.profileId);
    if (!participantA || !participantB || !hostParticipant) {
      throw new Error("participant seed failed");
    }

    // Operator creates a split deal — as the PAYER party. Its breadth of view is
    // emergent from that party line, not from `budget.view` (decisions #4).
    const created = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/deals`,
      headers: auth("d-op"),
      payload: {
        type: "split",
        structure: "door_split",
        name: "Door Split",
        currency: "SEK",
        guaranteeAmount: "500000",
        splitBasisPoints: 5000,
        parties: [
          { participantId: hostParticipant.id, roleInDeal: "payer" },
          {
            participantId: participantA.id,
            roleInDeal: "split_member",
            share: { splitBasisPoints: 5000 },
          },
          {
            participantId: participantB.id,
            roleInDeal: "split_member",
            share: { splitBasisPoints: 5000 },
          },
        ],
      },
    });
    expect(created.statusCode).toBe(201);
    const dealId = created.json().id;
    expect(created.json().guaranteeAmount).toBe("500000"); // money is a string
    expect(created.json().parties).toHaveLength(3); // operator is a party → sees all

    // Operator GET: both party lines.
    const asOperator = await app.inject({
      method: "GET",
      url: `/api/v1/deals/${dealId}`,
      headers: auth("d-op"),
    });
    expect(asOperator.statusCode).toBe(200);
    expect(asOperator.json().parties).toHaveLength(3);

    // Performer A GET: only their own line.
    const asPerformerA = await app.inject({
      method: "GET",
      url: `/api/v1/deals/${dealId}`,
      headers: auth("d-pa"),
    });
    expect(asPerformerA.statusCode).toBe(200);
    expect(asPerformerA.json().parties).toHaveLength(1);
    expect(asPerformerA.json().parties[0].participantId).toBe(participantA.id);

    // The event-scoped list is party-scoped the same way.
    const listAsB = await app.inject({
      method: "GET",
      url: `/api/v1/events/${event.id}/deals`,
      headers: auth("d-pb"),
    });
    expect(listAsB.statusCode).toBe(200);
    expect(listAsB.json()).toHaveLength(1);
    expect(listAsB.json()[0].parties).toHaveLength(1);
    expect(listAsB.json()[0].parties[0].participantId).toBe(participantB.id);

    // `isYours` marks the line the caller stands behind — the one and only line
    // `POST /deals/:did/confirm` will stamp for them. The operator reads all three
    // lines on its own deal, so without this it cannot tell which is its own, and a
    // screen would offer "Confirm" to a party with nothing left to confirm.
    const operatorParties = asOperator.json().parties as {
      participantId: string;
      isYours: boolean;
    }[];
    expect(
      operatorParties.filter((party) => party.isYours).map((party) => party.participantId),
    ).toEqual([hostParticipant.id]);
    expect(asPerformerA.json().parties[0].isYours).toBe(true);
    expect(listAsB.json()[0].parties[0].isYours).toBe(true);
  });

  it("404s a deal for a participant who is not a party on it (no leak)", async () => {
    const operator = await seedMemberWithSet(
      "n-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const party = await seedMemberWithSet("n-party", "performer", PRESET_PERMISSION_SETS.performer);
    const outsider = await seedMemberWithSet(
      "n-out",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );

    const { event, participants } = await seedEvent(
      operator,
      [
        { ...operator, role: "host" },
        { ...party, role: "performer" },
        { ...outsider, role: "performer" },
      ],
      "n-op",
    );
    const partyParticipant = participants.find((p) => p.profileId === party.profileId);
    if (!partyParticipant) throw new Error("participant seed failed");

    const created = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/deals`,
      headers: auth("n-op"),
      payload: {
        type: "performance",
        structure: "guarantee",
        name: "Guarantee",
        parties: [{ participantId: partyParticipant.id, roleInDeal: "payee" }],
      },
    });
    expect(created.statusCode).toBe(201);
    const dealId = created.json().id;

    // Outsider is on the event but not on this deal → not visible → 404.
    const asOutsider = await app.inject({
      method: "GET",
      url: `/api/v1/deals/${dealId}`,
      headers: auth("n-out"),
    });
    expect(asOutsider.statusCode).toBe(404);

    // The party themselves can see it.
    const asParty = await app.inject({
      method: "GET",
      url: `/api/v1/deals/${dealId}`,
      headers: auth("n-party"),
    });
    expect(asParty.statusCode).toBe(200);
  });
});

describe("deals — mutation + audit + optimistic lock", () => {
  it("writes an audit row on create", async () => {
    const { db } = harness;
    const operator = await seedMemberWithSet(
      "a-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const performer = await seedMemberWithSet(
      "a-perf",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );
    const { event, participants } = await seedEvent(
      operator,
      [
        { ...operator, role: "host" },
        { ...performer, role: "performer" },
      ],
      "a-op",
    );
    const participant = participants.find((p) => p.profileId === performer.profileId);
    if (!participant) throw new Error("participant seed failed");

    const created = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/deals`,
      headers: auth("a-op"),
      payload: {
        type: "performance",
        structure: "guarantee",
        name: "Fee",
        guaranteeAmount: "100000",
        parties: [{ participantId: participant.id, roleInDeal: "payee" }],
      },
    });
    expect(created.statusCode).toBe(201);
    const dealId = created.json().id;

    const auditRows = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, dealId));
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.action).toBe("deal.create");
    expect(auditRows[0]?.actorUserId).toBe("a-op");
  });

  it("rejects a stale PATCH with 409 (optimistic lock)", async () => {
    const operator = await seedMemberWithSet(
      "v-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const performer = await seedMemberWithSet(
      "v-perf",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );
    const { event, participants } = await seedEvent(
      operator,
      [
        { ...operator, role: "host" },
        { ...performer, role: "performer" },
      ],
      "v-op",
    );
    const participant = participants.find((p) => p.profileId === performer.profileId);
    const hostParticipant = participants.find((p) => p.profileId === operator.profileId);
    if (!participant || !hostParticipant) throw new Error("participant seed failed");

    const created = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/deals`,
      headers: auth("v-op"),
      payload: {
        type: "performance",
        structure: "guarantee",
        name: "v1",
        parties: [
          { participantId: hostParticipant.id, roleInDeal: "payer" },
          { participantId: participant.id, roleInDeal: "payee" },
        ],
      },
    });
    const dealId = created.json().id;
    expect(created.json().version).toBe(1);

    const ok = await app.inject({
      method: "PATCH",
      url: `/api/v1/deals/${dealId}`,
      headers: auth("v-op"),
      payload: { name: "v2", expectedVersion: 1 },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().version).toBe(2);
    expect(ok.json().name).toBe("v2");

    const stale = await app.inject({
      method: "PATCH",
      url: `/api/v1/deals/${dealId}`,
      headers: auth("v-op"),
      payload: { name: "v3", expectedVersion: 1 },
    });
    expect(stale.statusCode).toBe(409);
  });

  it("forbids a performer from editing a deal (deal.edit is operator-only)", async () => {
    const operator = await seedMemberWithSet(
      "f-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const performer = await seedMemberWithSet(
      "f-perf",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );
    const { event, participants } = await seedEvent(
      operator,
      [
        { ...operator, role: "host" },
        { ...performer, role: "performer" },
      ],
      "f-op",
    );
    const participant = participants.find((p) => p.profileId === performer.profileId);
    if (!participant) throw new Error("participant seed failed");

    const created = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/deals`,
      headers: auth("f-op"),
      payload: {
        type: "performance",
        structure: "guarantee",
        name: "Locked",
        parties: [{ participantId: participant.id, roleInDeal: "payee" }],
      },
    });
    const dealId = created.json().id;

    const forbidden = await app.inject({
      method: "PATCH",
      url: `/api/v1/deals/${dealId}`,
      headers: auth("f-perf"),
      payload: { name: "hacked" },
    });
    expect(forbidden.statusCode).toBe(403);
  });
});

/**
 * Seed an operator (payer) + two performers (payees) and create a split deal via
 * the route. Returns the deal id, the participant ids, and each party's uid so a
 * test can confirm as that party.
 */
async function seedSplitDeal(prefix: string) {
  const operator = await seedMemberWithSet(
    `${prefix}-op`,
    "operator",
    PRESET_PERMISSION_SETS.operator_full,
  );
  const perfA = await seedMemberWithSet(
    `${prefix}-a`,
    "performer",
    PRESET_PERMISSION_SETS.performer,
  );
  const perfB = await seedMemberWithSet(
    `${prefix}-b`,
    "performer",
    PRESET_PERMISSION_SETS.performer,
  );
  const { event, participants } = await seedEvent(
    operator,
    [
      { ...operator, role: "host" },
      { ...perfA, role: "performer" },
      { ...perfB, role: "performer" },
    ],
    `${prefix}-op`,
  );
  const hostPart = participants.find((p) => p.profileId === operator.profileId)?.id as string;
  const aPart = participants.find((p) => p.profileId === perfA.profileId)?.id as string;
  const bPart = participants.find((p) => p.profileId === perfB.profileId)?.id as string;

  const created = await app.inject({
    method: "POST",
    url: `/api/v1/events/${event.id}/deals`,
    headers: auth(`${prefix}-op`),
    payload: {
      type: "split",
      structure: "door_split",
      name: "Door split",
      parties: [
        { participantId: hostPart, roleInDeal: "payer" },
        { participantId: aPart, roleInDeal: "payee" },
        { participantId: bPart, roleInDeal: "payee" },
      ],
    },
  });
  expect(created.statusCode).toBe(201);
  return {
    event,
    dealId: created.json().id as string,
    opUid: `${prefix}-op`,
    aUid: `${prefix}-a`,
    bUid: `${prefix}-b`,
  };
}

const confirm = (dealId: string, uid: string) =>
  app.inject({ method: "POST", url: `/api/v1/deals/${dealId}/confirm`, headers: auth(uid) });

describe("deals — per-party confirm (decisions #1)", () => {
  it("confirms one party at a time and freezes the snapshot only when all have confirmed", async () => {
    const deal = await seedSplitDeal("dc");

    // Operator confirms its payer line — the agreement is not yet confirmed.
    const afterOp = await confirm(deal.dealId, deal.opUid);
    expect(afterOp.statusCode).toBe(200);
    expect(afterOp.json().agreementStatus).toBe("draft");
    // Operator sees every line (party-scoping): only its own is confirmed.
    const opParties = afterOp.json().parties as Array<{
      roleInDeal: string;
      confirmedAt: string | null;
    }>;
    expect(opParties.find((p) => p.roleInDeal === "payer")?.confirmedAt).not.toBeNull();
    expect(
      opParties.filter((p) => p.roleInDeal === "payee").every((p) => p.confirmedAt === null),
    ).toBe(true);

    // Performer A confirms — still pending B.
    const afterA = await confirm(deal.dealId, deal.aUid);
    expect(afterA.statusCode).toBe(200);
    expect(afterA.json().agreementStatus).toBe("draft");
    // Party-scoped: A sees only its own (now confirmed) line.
    expect(afterA.json().parties).toHaveLength(1);
    expect(afterA.json().parties[0].confirmedAt).not.toBeNull();

    // Performer B confirms — the last signatory → the agreement freezes.
    const afterB = await confirm(deal.dealId, deal.bUid);
    expect(afterB.statusCode).toBe(200);
    expect(afterB.json().agreementStatus).toBe("confirmed");

    // Every party is confirmed and the terms are frozen into confirmed_snapshot.
    const parties = await harness.db
      .select()
      .from(schema.dealParties)
      .where(eq(schema.dealParties.dealId, deal.dealId));
    expect(parties.every((p) => p.confirmedAt != null)).toBe(true);
    const [row] = await harness.db
      .select()
      .from(schema.deals)
      .where(eq(schema.deals.id, deal.dealId));
    expect(row?.agreementStatus).toBe("confirmed");
    expect(row?.confirmedSnapshot).not.toBeNull();
  });

  it("rejects a confirm from someone who is not a party to the deal", async () => {
    const operator = await seedMemberWithSet(
      "dcn-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const party = await seedMemberWithSet("dcn-a", "performer", PRESET_PERMISSION_SETS.performer);
    const outsider = await seedMemberWithSet(
      "dcn-x",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );
    const { event, participants } = await seedEvent(
      operator,
      [
        { ...operator, role: "host" },
        { ...party, role: "performer" },
        { ...outsider, role: "performer" },
      ],
      "dcn-op",
    );
    const aPart = participants.find((p) => p.profileId === party.profileId)?.id as string;
    const created = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/deals`,
      headers: auth("dcn-op"),
      payload: {
        type: "performance",
        name: "Fee",
        parties: [{ participantId: aPart, roleInDeal: "payee" }],
      },
    });

    // The outsider is an event participant but not a party on this deal.
    const rejected = await confirm(created.json().id, "dcn-x");
    expect(rejected.statusCode).toBe(400);
  });
});

const reopen = (dealId: string, uid: string, reason?: string) =>
  app.inject({
    method: "POST",
    url: `/api/v1/deals/${dealId}/reopen`,
    headers: auth(uid),
    payload: { reason },
  });

describe("deals — reopen (decisions #1)", () => {
  it("clears all confirmations, releases the snapshot, and records who/why", async () => {
    const deal = await seedSplitDeal("dr");
    await confirm(deal.dealId, deal.opUid);
    await confirm(deal.dealId, deal.aUid);
    await confirm(deal.dealId, deal.bUid);

    const reopened = await reopen(deal.dealId, deal.opUid, "renegotiate the door split");
    expect(reopened.statusCode).toBe(200);
    expect(reopened.json().agreementStatus).toBe("sent");

    const parties = await harness.db
      .select()
      .from(schema.dealParties)
      .where(eq(schema.dealParties.dealId, deal.dealId));
    expect(parties.every((p) => p.confirmedAt == null)).toBe(true);
    const [row] = await harness.db
      .select()
      .from(schema.deals)
      .where(eq(schema.deals.id, deal.dealId));
    expect(row?.confirmedSnapshot).toBeNull();
    expect((row?.reopen as { reason: string }).reason).toBe("renegotiate the door split");
  });

  it("refuses to reopen an agreement that is not confirmed (409)", async () => {
    const deal = await seedSplitDeal("dr2");
    const early = await reopen(deal.dealId, deal.opUid, "too soon");
    expect(early.statusCode).toBe(409);
  });

  it("forbids a performer (no agreement.manage) from reopening", async () => {
    const deal = await seedSplitDeal("dr3");
    await confirm(deal.dealId, deal.opUid);
    await confirm(deal.dealId, deal.aUid);
    await confirm(deal.dealId, deal.bUid);

    const forbidden = await reopen(deal.dealId, deal.aUid, "let me out");
    expect(forbidden.statusCode).toBe(403);
  });
});

describe("deals — send (decisions #1)", () => {
  it("moves a draft agreement to sent and refuses a non-draft", async () => {
    const deal = await seedSplitDeal("ds");
    const sent = await app.inject({
      method: "POST",
      url: `/api/v1/deals/${deal.dealId}/send`,
      headers: auth(deal.opUid),
    });
    expect(sent.statusCode).toBe(200);
    expect(sent.json().agreementStatus).toBe("sent");

    // Already sent → 409.
    const again = await app.inject({
      method: "POST",
      url: `/api/v1/deals/${deal.dealId}/send`,
      headers: auth(deal.opUid),
    });
    expect(again.statusCode).toBe(409);
  });

  it("forbids a performer (no agreement.manage) from sending", async () => {
    const deal = await seedSplitDeal("ds2");
    const forbidden = await app.inject({
      method: "POST",
      url: `/api/v1/deals/${deal.dealId}/send`,
      headers: auth(deal.aUid),
    });
    expect(forbidden.statusCode).toBe(403);
  });
});

describe("deals — advance marker (decisions #1)", () => {
  it("round-trips advanceAmount and marks the guarantee as the advance on a guarantee_vs_door deal", async () => {
    const operator = await seedMemberWithSet(
      "adv-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const perf = await seedMemberWithSet("adv-p", "performer", PRESET_PERMISSION_SETS.performer);
    const { event, participants } = await seedEvent(
      operator,
      [
        { ...operator, role: "host" },
        { ...perf, role: "performer" },
      ],
      "adv-op",
    );
    const perfPart = participants.find((p) => p.profileId === perf.profileId)?.id as string;
    const hostPart = participants.find((p) => p.profileId === operator.profileId)?.id as string;

    // The guarantee is the advance (paid before); the door split settles after.
    const created = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/deals`,
      headers: auth("adv-op"),
      payload: {
        type: "performance",
        structure: "guarantee_vs_door",
        name: "Guarantee vs door",
        currency: "SEK",
        guaranteeAmount: "300000",
        advanceAmount: "300000",
        splitBasisPoints: 7000,
        parties: [
          { participantId: hostPart, roleInDeal: "payer" },
          { participantId: perfPart, roleInDeal: "payee" },
        ],
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().advanceAmount).toBe("300000");
    expect(created.json().guaranteeAmount).toBe("300000");
    const dealId = created.json().id;

    // A PARTIAL advance (100k of the 300k guarantee).
    const partial = await app.inject({
      method: "PATCH",
      url: `/api/v1/deals/${dealId}`,
      headers: auth("adv-op"),
      payload: { advanceAmount: "100000" },
    });
    expect(partial.json().advanceAmount).toBe("100000");

    // Clearing it (null) removes the advance marker.
    const cleared = await app.inject({
      method: "PATCH",
      url: `/api/v1/deals/${dealId}`,
      headers: auth("adv-op"),
      payload: { advanceAmount: null },
    });
    expect(cleared.json().advanceAmount).toBeNull();
  });
});

describe("deals — realtime recipients are party-scoped", () => {
  // The reference app notified the WHOLE EVENT on any deal change. That predates
  // `deal.view.own`; here a shared split shows each performer only their own line,
  // so an event-wide notification would tell a performer that another party's terms
  // moved. Recipients must come from deal_parties, never from the event.
  it("reaches every party on the deal, minus the actor", async () => {
    const { dealId, opUid, aUid, bUid } = await seedSplitDeal("deal-rt");

    const recipients = await dealPartyRecipients(harness.db, dealId, opUid);

    expect(recipients).toEqual([aUid, bUid].sort());
    expect(recipients).not.toContain(opUid);
  });

  it("excludes whichever party is acting", async () => {
    const { dealId, opUid, aUid, bUid } = await seedSplitDeal("deal-rt-actor");

    const recipients = await dealPartyRecipients(harness.db, dealId, aUid);

    expect(recipients).toEqual([bUid, opUid].sort());
    expect(recipients).not.toContain(aUid);
  });

  it("does not reach an event participant who holds no party line", async () => {
    const { event, dealId, opUid } = await seedSplitDeal("deal-rt-bystander");
    // A crew member on the same event, with no line in the deal.
    const crew = await seedMemberWithSet(
      "deal-rt-bystander-crew",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );
    await harness.db.insert(schema.eventParticipants).values({
      eventId: event.id,
      profileId: crew.profileId,
      role: "crew",
      permissionSetId: crew.permissionSetId,
      status: "confirmed",
    });

    const recipients = await dealPartyRecipients(harness.db, dealId, opUid);

    expect(recipients).not.toContain("deal-rt-bystander-crew");
  });
});

/**
 * An event with a booking AGENT who represents exactly one of the two performers
 * on it (decisions #14). The agent reaches the event the normal way — an
 * `event_participants(role=agent)` row materialized by `assignAgentToEvent` — and
 * the represented performer's participation is flagged delegated. Two deals exist:
 * one for the represented performer, one for the performer the agent has nothing
 * to do with. Everything below turns on the difference between them.
 */
async function seedRepresentedAgent(prefix: string, region: string[] = ["SE"]) {
  const { db } = harness;
  const operator = await seedMemberWithSet(
    `${prefix}-op`,
    "operator",
    PRESET_PERMISSION_SETS.operator_full,
  );
  // The venue's country is what puts an event inside the representation's territory.
  await db
    .insert(schema.profileLocations)
    .values({ profileId: operator.profileId, country: "SE", isPrimary: true });
  const client = await seedMemberWithSet(
    `${prefix}-client`,
    "performer",
    PRESET_PERMISSION_SETS.performer,
  );
  const other = await seedMemberWithSet(
    `${prefix}-other`,
    "performer",
    PRESET_PERMISSION_SETS.performer,
  );
  const agent = await seedMemberWithSet(`${prefix}-agent`, "agent", PRESET_PERMISSION_SETS.agent);

  const { event, participants } = await seedEvent(
    operator,
    [
      { ...operator, role: "host" },
      { ...client, role: "performer" },
      { ...other, role: "performer" },
    ],
    `${prefix}-op`,
  );
  const hostPart = participants.find((p) => p.profileId === operator.profileId)?.id as string;
  const clientPart = participants.find((p) => p.profileId === client.profileId)?.id as string;
  const otherPart = participants.find((p) => p.profileId === other.profileId)?.id as string;

  const [representation] = await db
    .insert(schema.representations)
    .values({
      agentProfileId: agent.profileId,
      performerProfileId: client.profileId,
      region,
      commissionRate: 1500,
      proposedBy: "agent",
      status: "active",
      confirmedByAgent: true,
      confirmedByPerformer: true,
    })
    .returning();
  if (!representation) throw new Error("representation seed failed");
  const assigned = await db.transaction((tx) => assignAgentToEvent(tx, representation, event.id));
  expect(assigned).toBe(true);

  const deal = async (name: string, payeeParticipantId: string) => {
    const created = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/deals`,
      headers: auth(`${prefix}-op`),
      payload: {
        type: "performance",
        structure: "guarantee",
        name,
        currency: "SEK",
        guaranteeAmount: "400000",
        parties: [
          { participantId: hostPart, roleInDeal: "payer" },
          { participantId: payeeParticipantId, roleInDeal: "payee" },
        ],
      },
    });
    expect(created.statusCode).toBe(201);
    return created.json().id as string;
  };

  return {
    event,
    representationId: representation.id,
    agentProfileId: agent.profileId,
    opUid: `${prefix}-op`,
    agentUid: `${prefix}-agent`,
    clientUid: `${prefix}-client`,
    otherUid: `${prefix}-other`,
    hostPart,
    clientPart,
    otherPart,
    agentPart: (
      await db
        .select()
        .from(schema.eventParticipants)
        .where(
          and(
            eq(schema.eventParticipants.eventId, event.id),
            eq(schema.eventParticipants.profileId, agent.profileId),
          ),
        )
    )[0]?.id as string,
    clientDealId: await deal("Client guarantee", clientPart),
    otherDealId: await deal("Stranger guarantee", otherPart),
  };
}

/**
 * A-02 + A-03. The agent's `deal.edit` / `agreement.manage` come from an ordinary
 * participant row on the EVENT; authority over a given deal is resolved through the
 * `(agent, that deal's performer)` representation. The row is reachability; the
 * representation is authority.
 */
describe("deals — an agent's authority is per-deal, via the representation (decisions #14)", () => {
  it("acts on its client's deal and is an outsider on every other deal on the same event", async () => {
    const fixture = await seedRepresentedAgent("ag-scope");

    // READ — the client's deal is visible, scoped to the client's own line.
    const own = await app.inject({
      method: "GET",
      url: `/api/v1/deals/${fixture.clientDealId}`,
      headers: auth(fixture.agentUid),
    });
    expect(own.statusCode).toBe(200);
    expect(own.json().parties).toHaveLength(1);
    expect(own.json().parties[0].participantId).toBe(fixture.clientPart);

    // EDIT — allowed on the client's deal.
    const edited = await app.inject({
      method: "PATCH",
      url: `/api/v1/deals/${fixture.clientDealId}`,
      headers: auth(fixture.agentUid),
      payload: { guaranteeAmount: "450000" },
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().guaranteeAmount).toBe("450000");

    // The stranger's deal: invisible, and every mutation is a 404 — not a 403,
    // because visibility is not an existence leak.
    const stranger = fixture.otherDealId;
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/v1/deals/${stranger}`,
          headers: auth(fixture.agentUid),
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/api/v1/deals/${stranger}`,
          headers: auth(fixture.agentUid),
          payload: { name: "renamed by a stranger" },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/v1/deals/${stranger}/send`,
          headers: auth(fixture.agentUid),
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/api/v1/deals/${stranger}`,
          headers: auth(fixture.agentUid),
          payload: {},
        })
      ).statusCode,
    ).toBe(404);

    // The stranger's deal survived, untouched.
    const [survivor] = await harness.db
      .select()
      .from(schema.deals)
      .where(eq(schema.deals.id, stranger));
    expect(survivor?.name).toBe("Stranger guarantee");

    // The event listing shows the agent its client's deal and nothing else.
    const list = await app.inject({
      method: "GET",
      url: `/api/v1/events/${fixture.event.id}/deals`,
      headers: auth(fixture.agentUid),
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().map((deal: { id: string }) => deal.id)).toEqual([fixture.clientDealId]);
  });

  it("cannot reopen a deal it has no client on — the other act's confirmations stand", async () => {
    const fixture = await seedRepresentedAgent("ag-reopen");

    // The operator and the unrepresented performer sign the stranger's deal.
    expect((await confirm(fixture.otherDealId, fixture.opUid)).statusCode).toBe(200);
    expect((await confirm(fixture.otherDealId, fixture.otherUid)).statusCode).toBe(200);
    const [signed] = await harness.db
      .select()
      .from(schema.deals)
      .where(eq(schema.deals.id, fixture.otherDealId));
    expect(signed?.agreementStatus).toBe("confirmed");

    const attempt = await reopen(fixture.otherDealId, fixture.agentUid, "let me renegotiate this");
    expect(attempt.statusCode).toBe(404);

    // Nothing was cleared: the signatures on that agreement are intact.
    const parties = await harness.db
      .select()
      .from(schema.dealParties)
      .where(eq(schema.dealParties.dealId, fixture.otherDealId));
    expect(parties.every((party) => party.confirmedAt != null)).toBe(true);
    const [after] = await harness.db
      .select()
      .from(schema.deals)
      .where(eq(schema.deals.id, fixture.otherDealId));
    expect(after?.agreementStatus).toBe("confirmed");

    // On its client's deal, reopening IS its job.
    expect((await confirm(fixture.clientDealId, fixture.opUid)).statusCode).toBe(200);
    expect((await confirm(fixture.clientDealId, fixture.agentUid)).statusCode).toBe(200);
    const mine = await reopen(fixture.clientDealId, fixture.agentUid, "renegotiating");
    expect(mine.statusCode).toBe(200);
    expect(mine.json().agreementStatus).toBe("sent");
  });

  it("on a SHARED split it stands behind its client's line only — never the other act's", async () => {
    const fixture = await seedRepresentedAgent("ag-shared");

    // One split deal, two acts: the agent's client and a self-managed performer
    // (the coexistence the authorization skill calls out explicitly).
    const shared = await app.inject({
      method: "POST",
      url: `/api/v1/events/${fixture.event.id}/deals`,
      headers: auth(fixture.opUid),
      payload: {
        type: "split",
        structure: "door_split",
        name: "Shared door split",
        currency: "SEK",
        parties: [
          { participantId: fixture.hostPart, roleInDeal: "payer" },
          {
            participantId: fixture.clientPart,
            roleInDeal: "split_member",
            share: { splitBasisPoints: 6000 },
          },
          {
            participantId: fixture.otherPart,
            roleInDeal: "split_member",
            share: { splitBasisPoints: 4000 },
          },
        ],
      },
    });
    expect(shared.statusCode).toBe(201);
    const dealId = shared.json().id as string;

    // The agent has standing (its client is a party) — but reads ONE line.
    const read = await app.inject({
      method: "GET",
      url: `/api/v1/deals/${dealId}`,
      headers: auth(fixture.agentUid),
    });
    expect(read.statusCode).toBe(200);
    expect(read.json().parties).toHaveLength(1);
    expect(read.json().parties[0].participantId).toBe(fixture.clientPart);
    expect(read.json().parties[0].share).toEqual({ splitBasisPoints: 6000 });

    // Confirming stamps its client's line and leaves the other act's alone.
    expect((await confirm(dealId, fixture.agentUid)).statusCode).toBe(200);
    const parties = await harness.db
      .select()
      .from(schema.dealParties)
      .where(eq(schema.dealParties.dealId, dealId));
    expect(parties.find((p) => p.participantId === fixture.clientPart)?.confirmedAt).not.toBeNull();
    expect(parties.find((p) => p.participantId === fixture.otherPart)?.confirmedAt).toBeNull();
    expect(parties.find((p) => p.participantId === fixture.hostPart)?.confirmedAt).toBeNull();

    // ...and REOPEN must agree with confirm. The agent may unsign only what it may
    // sign: a deal-wide clear would tear up the signature of an act it does not
    // represent and has no relationship with.
    expect((await confirm(dealId, fixture.otherUid)).statusCode).toBe(200);
    expect((await confirm(dealId, fixture.opUid)).statusCode).toBe(200);
    const [ready] = await harness.db.select().from(schema.deals).where(eq(schema.deals.id, dealId));
    expect(ready?.agreementStatus).toBe("confirmed");

    expect((await reopen(dealId, fixture.agentUid, "renegotiating my act")).statusCode).toBe(200);

    const afterReopen = await harness.db
      .select()
      .from(schema.dealParties)
      .where(eq(schema.dealParties.dealId, dealId));
    // The client's line is released — that is the agent's own to withdraw.
    expect(afterReopen.find((p) => p.participantId === fixture.clientPart)?.confirmedAt).toBeNull();
    // The self-managed act's signature STANDS. This is the A-02 regression guard.
    expect(
      afterReopen.find((p) => p.participantId === fixture.otherPart)?.confirmedAt,
    ).not.toBeNull();
    // As does the venue's — also not the agent's to clear.
    expect(
      afterReopen.find((p) => p.participantId === fixture.hostPart)?.confirmedAt,
    ).not.toBeNull();
  });

  it("cannot make itself an entitled party on a deal", async () => {
    const fixture = await seedRepresentedAgent("ag-party");

    for (const roleInDeal of ["payee", "split_member", "commission", "payer"]) {
      const attempt = await app.inject({
        method: "POST",
        url: `/api/v1/events/${fixture.event.id}/deals`,
        headers: auth(fixture.agentUid),
        payload: {
          type: "performance",
          name: `Agent as ${roleInDeal}`,
          parties: [
            { participantId: fixture.clientPart, roleInDeal: "payee" },
            { participantId: fixture.agentPart, roleInDeal },
          ],
        },
      });
      expect(attempt.statusCode).toBe(400);
    }

    // The operator cannot slip one in either — it is an invariant of the deal, not
    // a rule about who is asking (decisions #14: never a separate entitled party).
    const byOperator = await app.inject({
      method: "POST",
      url: `/api/v1/events/${fixture.event.id}/deals`,
      headers: auth(fixture.opUid),
      payload: {
        type: "performance",
        name: "Operator pays the agent",
        parties: [{ participantId: fixture.agentPart, roleInDeal: "payee" }],
      },
    });
    expect(byOperator.statusCode).toBe(400);

    // Observer carries no entitlement, so it is the one role an agent may hold.
    const observer = await app.inject({
      method: "POST",
      url: `/api/v1/events/${fixture.event.id}/deals`,
      headers: auth(fixture.agentUid),
      payload: {
        type: "performance",
        name: "Client fee, agent watching",
        parties: [
          { participantId: fixture.clientPart, roleInDeal: "payee" },
          { participantId: fixture.agentPart, roleInDeal: "observer" },
        ],
      },
    });
    expect(observer.statusCode).toBe(201);
  });

  it("cannot author a deal for a performer it does not represent", async () => {
    const fixture = await seedRepresentedAgent("ag-create");

    const attempt = await app.inject({
      method: "POST",
      url: `/api/v1/events/${fixture.event.id}/deals`,
      headers: auth(fixture.agentUid),
      payload: {
        type: "performance",
        name: "Terms for someone else's act",
        parties: [
          { participantId: fixture.hostPart, roleInDeal: "payer" },
          { participantId: fixture.otherPart, roleInDeal: "payee" },
        ],
      },
    });
    expect(attempt.statusCode).toBe(403);
  });

  it("loses the deal with the representation — status and territory are read per request", async () => {
    const terminated = await seedRepresentedAgent("ag-term");
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/v1/deals/${terminated.clientDealId}`,
          headers: auth(terminated.agentUid),
        })
      ).statusCode,
    ).toBe(200);
    await harness.db
      .update(schema.representations)
      .set({ status: "terminated", terminatedAt: new Date() })
      .where(eq(schema.representations.id, terminated.representationId));
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/v1/deals/${terminated.clientDealId}`,
          headers: auth(terminated.agentUid),
        })
      ).statusCode,
    ).toBe(404);

    // Same for the territory: the venue is in SE, so an NO-only representation
    // reaches nothing here (the scope ceiling is in-region deals only).
    const outOfRegion = await seedRepresentedAgent("ag-region");
    await harness.db
      .update(schema.representations)
      .set({ region: ["NO"] })
      .where(eq(schema.representations.id, outOfRegion.representationId));
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/v1/deals/${outOfRegion.clientDealId}`,
          headers: auth(outOfRegion.agentUid),
        })
      ).statusCode,
    ).toBe(404);
  });
});

/**
 * A-03. Delegation moves the performer's ACTION capabilities to their agent — it
 * must not strand the deal with nobody able to sign it.
 */
describe("deals — a delegated performer's deal is confirmable (decisions #14)", () => {
  it("lets the agent confirm the represented performer's own party line", async () => {
    const fixture = await seedRepresentedAgent("ag-confirm");

    // The delegated performer keeps their VIEW floor…
    const asPerformer = await app.inject({
      method: "GET",
      url: `/api/v1/deals/${fixture.clientDealId}`,
      headers: auth(fixture.clientUid),
    });
    expect(asPerformer.statusCode).toBe(200);
    // …but the action moved to the agent, so their own confirm is refused.
    const byPerformer = await confirm(fixture.clientDealId, fixture.clientUid);
    expect(byPerformer.statusCode).toBe(403);

    // The agent signs the performer's line — the deadlock is gone.
    expect((await confirm(fixture.clientDealId, fixture.opUid)).statusCode).toBe(200);
    const byAgent = await confirm(fixture.clientDealId, fixture.agentUid);
    expect(byAgent.statusCode).toBe(200);
    expect(byAgent.json().agreementStatus).toBe("confirmed");

    // It stamped the PERFORMER's line (the agent is not a party), signed by the
    // agent's user — the audit trail of who acted.
    const parties = await harness.db
      .select()
      .from(schema.dealParties)
      .where(eq(schema.dealParties.dealId, fixture.clientDealId));
    const clientLine = parties.find((party) => party.participantId === fixture.clientPart);
    expect(clientLine?.confirmedAt).not.toBeNull();
    expect(clientLine?.confirmedBy).toBe(fixture.agentUid);
    expect(parties.some((party) => party.participantId === fixture.agentPart)).toBe(false);
  });

  it("leaves an undelegated performer confirming their own deal", async () => {
    const fixture = await seedRepresentedAgent("ag-undeleg");

    expect((await confirm(fixture.otherDealId, fixture.opUid)).statusCode).toBe(200);
    const byPerformer = await confirm(fixture.otherDealId, fixture.otherUid);
    expect(byPerformer.statusCode).toBe(200);
    expect(byPerformer.json().agreementStatus).toBe("confirmed");

    // And the agent could not have signed it for them: confirm only ever stamps the
    // lines the caller stands behind, and it stands behind none here (400 — the
    // route's own "not a party" answer, the same one any non-party gets).
    const byAgent = await confirm(fixture.otherDealId, fixture.agentUid);
    expect(byAgent.statusCode).toBe(400);
    const parties = await harness.db
      .select()
      .from(schema.dealParties)
      .where(eq(schema.dealParties.dealId, fixture.otherDealId));
    expect(parties.every((party) => party.confirmedBy !== fixture.agentUid)).toBe(true);
  });
});

/**
 * The owner's call, 2026-08-26: *"crew can confirm an agreement if it is with them.
 * If they are the payee."*
 *
 * Before it a venue↔crew deal was a DEAD END. Crew hold no `agreement.confirm` at
 * event scope — deliberately, because that is also what decides the show's DATE in
 * `routes/holds.ts` — and an agreement freezes only once EVERY non-observer party has
 * signed. So the operator could send the sound engineer their fee and nothing on the
 * platform could ever move it past `sent`.
 *
 * The grant is DEAL-scoped (`@showme/auth`'s `dealPartyBaselineCapabilities`): the
 * agreement that names you, and no other.
 */
describe("deals — a venue↔crew agreement can actually be confirmed (owner call 2026-08-26)", () => {
  /** Operator + crew on one event, with a fee deal already sent to both. */
  async function seedVenueCrewDeal(prefix: string) {
    const operator = await seedMemberWithSet(
      `${prefix}-op`,
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    // The THINNEST crew tier — the floor-plus-nothing bundle (decisions #12). If the
    // flow terminates for a `crew_schedule_only` door person it terminates for every
    // richer tier too.
    const crew = await seedMemberWithSet(
      `${prefix}-crew`,
      "team_and_crew",
      PRESET_PERMISSION_SETS.crew_schedule_only,
    );
    const { event, participants } = await seedEvent(
      operator,
      [
        { ...operator, role: "host" },
        { ...crew, role: "crew" },
      ],
      `${prefix}-op`,
    );
    const hostPart = participants.find((p) => p.profileId === operator.profileId)?.id as string;
    const crewPart = participants.find((p) => p.profileId === crew.profileId)?.id as string;

    const created = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/deals`,
      headers: auth(`${prefix}-op`),
      payload: {
        type: "fee",
        name: "Front-of-house engineer",
        currency: "SEK",
        guaranteeAmount: "450000",
        parties: [
          { participantId: hostPart, roleInDeal: "payer" },
          { participantId: crewPart, roleInDeal: "payee" },
        ],
      },
    });
    expect(created.statusCode).toBe(201);
    const dealId = created.json().id as string;

    const sent = await app.inject({
      method: "POST",
      url: `/api/v1/deals/${dealId}/send`,
      headers: auth(`${prefix}-op`),
    });
    expect(sent.statusCode).toBe(200);
    expect(sent.json().agreementStatus).toBe("sent");

    return { event, operator, crew, hostPart, crewPart, dealId, prefix };
  }

  it("still withholds `agreement.confirm` from crew at EVENT scope", async () => {
    const seed = await seedVenueCrewDeal("vc-scope");
    const event = await app.inject({
      method: "GET",
      url: `/api/v1/events/${seed.event.id}/deals`,
      headers: auth("vc-scope-crew"),
    });
    expect(event.statusCode).toBe(200);
    // The crew member sees their agreement — `deal.view.own` is in their floor …
    expect(event.json()).toHaveLength(1);
    // … and the capability that would let them decide the show's date is still absent.
    const principal = await resolvePrincipal(harness.db, "vc-scope-crew");
    if (!principal) throw new Error("principal not resolved");
    const capabilities = await effectiveEventCapabilities(harness.db, principal, seed.event.id);
    expect(capabilities.has("agreement.confirm")).toBe(false);
    expect(capabilities.has("budget.view")).toBe(false);
  });

  it("drives the deal to `confirmed` — the crew payee signs their own line", async () => {
    const seed = await seedVenueCrewDeal("vc-happy");

    // The operator signs the payer line; one signatory is still outstanding.
    const byOperator = await confirm(seed.dealId, "vc-happy-op");
    expect(byOperator.statusCode).toBe(200);
    expect(byOperator.json().agreementStatus).toBe("sent");

    // The crew member signs theirs — and the agreement freezes.
    const byCrew = await confirm(seed.dealId, "vc-happy-crew");
    expect(byCrew.statusCode).toBe(200);
    expect(byCrew.json().agreementStatus).toBe("confirmed");

    const [row] = await harness.db
      .select()
      .from(schema.deals)
      .where(eq(schema.deals.id, seed.dealId));
    expect(row?.agreementStatus).toBe("confirmed");
    expect(row?.confirmedSnapshot).not.toBeNull();

    const parties = await harness.db
      .select()
      .from(schema.dealParties)
      .where(eq(schema.dealParties.dealId, seed.dealId));
    expect(parties.every((party) => party.confirmedAt != null)).toBe(true);
    // Each line is signed by its OWN side — the crew user signed the crew line.
    expect(parties.find((party) => party.participantId === seed.crewPart)?.confirmedBy).toBe(
      "vc-happy-crew",
    );
    expect(parties.find((party) => party.participantId === seed.hostPart)?.confirmedBy).toBe(
      "vc-happy-op",
    );
  });

  it("refuses a crew member on an agreement they are NOT a party to", async () => {
    const seed = await seedVenueCrewDeal("vc-other");
    // A second crew member on the same event, with their own fee deal.
    const bystander = await seedMemberWithSet(
      "vc-other-crew2",
      "team_and_crew",
      PRESET_PERMISSION_SETS.crew_technical,
    );
    const [added] = await harness.db
      .insert(schema.eventParticipants)
      .values({
        eventId: seed.event.id,
        profileId: bystander.profileId,
        role: "crew",
        permissionSetId: bystander.permissionSetId,
        status: "confirmed" as const,
      })
      .returning();
    if (!added) throw new Error("participant seed failed");

    // They are ON the event, and they have an agreement of their OWN here — so this
    // is not "crew cannot confirm", it is "not this one".
    const own = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/deals`,
      headers: auth("vc-other-op"),
      payload: {
        type: "fee",
        name: "Lighting",
        currency: "SEK",
        guaranteeAmount: "200000",
        parties: [
          { participantId: seed.hostPart, roleInDeal: "payer" },
          { participantId: added.id, roleInDeal: "payee" },
        ],
      },
    });
    expect(own.statusCode).toBe(201);

    const rejected = await confirm(seed.dealId, "vc-other-crew2");
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json().error.message).toContain("not a party");

    // Nothing was stamped on the deal they reached for.
    const parties = await harness.db
      .select()
      .from(schema.dealParties)
      .where(eq(schema.dealParties.dealId, seed.dealId));
    expect(parties.every((party) => party.confirmedAt == null)).toBe(true);
    // And they cannot even READ it — visibility is party membership (decisions #4).
    const list = await app.inject({
      method: "GET",
      url: `/api/v1/events/${seed.event.id}/deals`,
      headers: auth("vc-other-crew2"),
    });
    expect(list.json().map((deal: { id: string }) => deal.id)).toEqual([own.json().id]);
  });

  it("refuses a crew OBSERVER — a shared agreement is watched, not signed", async () => {
    const seed = await seedVenueCrewDeal("vc-observer");
    const observer = await seedMemberWithSet(
      "vc-observer-crew2",
      "team_and_crew",
      PRESET_PERMISSION_SETS.crew_technical,
    );
    const [added] = await harness.db
      .insert(schema.eventParticipants)
      .values({
        eventId: seed.event.id,
        profileId: observer.profileId,
        role: "crew_lead",
        permissionSetId: observer.permissionSetId,
        status: "confirmed" as const,
      })
      .returning();
    if (!added) throw new Error("participant seed failed");
    await harness.db.insert(schema.dealParties).values({
      dealId: seed.dealId,
      participantId: added.id,
      roleInDeal: "observer",
    });

    // They are a party — they can see it — but an observer has no line to sign, so
    // the deal-scoped grant gives them nothing.
    const rejected = await confirm(seed.dealId, "vc-observer-crew2");
    expect(rejected.statusCode).toBe(403);
    expect(rejected.json().error.message).toContain("agreement.confirm");

    const parties = await harness.db
      .select()
      .from(schema.dealParties)
      .where(eq(schema.dealParties.dealId, seed.dealId));
    expect(parties.every((party) => party.confirmedAt == null)).toBe(true);
  });

  it("does not let a crew signatory sign anybody ELSE's line on their own deal", async () => {
    const seed = await seedVenueCrewDeal("vc-scoped");

    const byCrew = await confirm(seed.dealId, "vc-scoped-crew");
    expect(byCrew.statusCode).toBe(200);

    const parties = await harness.db
      .select()
      .from(schema.dealParties)
      .where(eq(schema.dealParties.dealId, seed.dealId));
    expect(
      parties.find((party) => party.participantId === seed.crewPart)?.confirmedAt,
    ).not.toBeNull();
    // The operator's payer line is untouched — confirm has no parameter for whose
    // line to sign, and the crew member stands behind exactly one.
    expect(parties.find((party) => party.participantId === seed.hostPart)?.confirmedAt).toBeNull();
    // …and the agreement has NOT frozen: a signatory is still outstanding.
    const [row] = await harness.db
      .select()
      .from(schema.deals)
      .where(eq(schema.deals.id, seed.dealId));
    expect(row?.agreementStatus).toBe("sent");
  });
});

/**
 * Co-promotion transparency, as the 2026-08 settlements meeting states it
 * (00:21:42, 00:25:48): *"Operators see all financials; collaborators see only the
 * portions relevant to their own deals. For co-promotions, all involved parties get
 * full transparency into the entire financial deal."*
 *
 * There is no new mechanism behind that sentence and there must not be one. A
 * co-promoter reads the whole agreement because they are a PARTY to it and hold
 * `budget.view` as a managing operator (decisions #4: "co-operator transparency =
 * co-operators are co-parties on the shared deals and share the budget — not an
 * override"). The performer standing beside them on the same deal still sees one
 * line: their own.
 *
 * The other half of the sentence — the shared ledger versus each operator's own
 * margin line — is `budget.test.ts` ("private scope is confidential to its owner"):
 * a private budget is by construction one operator's own book, never part of the
 * shared deal, so full transparency into the deal does not reach into it.
 */
describe("deals — a co-promoter sees the ENTIRE financial deal (meeting 00:25:48)", () => {
  it("gives the co-host every line of a deal it co-signs, and the performer only their own", async () => {
    const host = await seedMemberWithSet(
      "cp-host",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const coHost = await seedMemberWithSet(
      "cp-cohost",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const headliner = await seedMemberWithSet(
      "cp-head",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );
    const support = await seedMemberWithSet(
      "cp-supp",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );

    const { event, participants } = await seedEvent(
      host,
      [
        { ...host, role: "host" },
        { ...coHost, role: "co_host" },
        { ...headliner, role: "performer" },
        { ...support, role: "performer" },
      ],
      "cp-host",
    );
    const idOf = (profileId: string) =>
      participants.find((party) => party.profileId === profileId)?.id as string;

    const created = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/deals`,
      headers: auth("cp-host"),
      payload: {
        type: "split",
        structure: "door_split",
        name: "Co-promoted door split",
        currency: "SEK",
        splitBasisPoints: 7000,
        parties: [
          { participantId: idOf(host.profileId), roleInDeal: "payer" },
          { participantId: idOf(coHost.profileId), roleInDeal: "payer" },
          {
            participantId: idOf(headliner.profileId),
            roleInDeal: "split_member",
            share: { splitBasisPoints: 7000 },
          },
          {
            participantId: idOf(support.profileId),
            roleInDeal: "split_member",
            share: { splitBasisPoints: 3000 },
          },
        ],
      },
    });
    expect(created.statusCode).toBe(201);
    const dealId = created.json().id as string;

    const read = async (uid: string) => {
      const response = await app.inject({
        method: "GET",
        url: `/api/v1/deals/${dealId}`,
        headers: auth(uid),
      });
      expect(response.statusCode).toBe(200);
      return response.json() as {
        splitBasisPoints: number | null;
        parties: { participantId: string; roleInDeal: string; share: unknown; isYours: boolean }[];
      };
    };

    const byHost = await read("cp-host");
    const byCoHost = await read("cp-cohost");

    // The co-promoter's view is the host's view — every line, every share, in full.
    expect(byCoHost.parties).toHaveLength(4);
    expect(byCoHost.splitBasisPoints).toBe(7000);
    expect([...byCoHost.parties].map((party) => party.participantId).sort()).toEqual(
      [...byHost.parties].map((party) => party.participantId).sort(),
    );
    expect(
      byCoHost.parties.find((party) => party.participantId === idOf(headliner.profileId))?.share,
    ).toEqual({ splitBasisPoints: 7000 });
    expect(
      byCoHost.parties.find((party) => party.participantId === idOf(support.profileId))?.share,
    ).toEqual({ splitBasisPoints: 3000 });

    // And the performers beside them still see exactly one line each — theirs.
    const byHeadliner = await read("cp-head");
    expect(byHeadliner.parties).toHaveLength(1);
    expect(byHeadliner.parties[0]?.participantId).toBe(idOf(headliner.profileId));
    expect(byHeadliner.parties[0]?.isYours).toBe(true);

    const bySupport = await read("cp-supp");
    expect(bySupport.parties).toHaveLength(1);
    expect(bySupport.parties[0]?.participantId).toBe(idOf(support.profileId));
  });

  it("still shows a co-host NOTHING of a deal it is not a party to — transparency is party membership", async () => {
    const host = await seedMemberWithSet(
      "cp2-host",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const coHost = await seedMemberWithSet(
      "cp2-cohost",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const performer = await seedMemberWithSet(
      "cp2-perf",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );
    const crew = await seedMemberWithSet(
      "cp2-crew",
      "team_and_crew",
      PRESET_PERMISSION_SETS.crew_technical,
    );
    const { event, participants } = await seedEvent(
      host,
      [
        { ...host, role: "host" },
        { ...coHost, role: "co_host" },
        { ...performer, role: "performer" },
        { ...crew, role: "crew" },
      ],
      "cp2-host",
    );
    const idOf = (profileId: string) =>
      participants.find((party) => party.profileId === profileId)?.id as string;

    // A deal the HOST alone strikes with the crew — the co-promoter is not on it.
    // Being a co_host on the event is not the grant; being a party is.
    const hostOnly = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/deals`,
      headers: auth("cp2-host"),
      payload: {
        type: "fee",
        name: "House engineer, on the host's own book",
        currency: "SEK",
        guaranteeAmount: "150000",
        parties: [
          { participantId: idOf(host.profileId), roleInDeal: "payer" },
          { participantId: idOf(crew.profileId), roleInDeal: "payee" },
        ],
      },
    });
    expect(hostOnly.statusCode).toBe(201);

    const direct = await app.inject({
      method: "GET",
      url: `/api/v1/deals/${hostOnly.json().id}`,
      headers: auth("cp2-cohost"),
    });
    expect(direct.statusCode).toBe(404);
    const list = await app.inject({
      method: "GET",
      url: `/api/v1/events/${event.id}/deals`,
      headers: auth("cp2-cohost"),
    });
    expect(list.json()).toEqual([]);

    // The host, who IS a party, reads it in full — same event, same capability set,
    // opposite answer. The difference is the party line and nothing else.
    const byHost = await app.inject({
      method: "GET",
      url: `/api/v1/deals/${hostOnly.json().id}`,
      headers: auth("cp2-host"),
    });
    expect(byHost.statusCode).toBe(200);
    expect(byHost.json().parties).toHaveLength(2);
  });
});

/**
 * A-07 (deals half). `budget.view` is not a see-all: an operator reads a deal
 * because it is a party to it (decisions #4 — "if you are not a `deal_party`, you
 * cannot see the deal"; story.md — "no see-everything god-mode").
 */
describe("deals — an operator sees a deal by being a party, not by being the host", () => {
  it("hides a performer↔crew sub-hire from the venue, which is not a party to it", async () => {
    const { db } = harness;
    const operator = await seedMemberWithSet(
      "sub-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const performer = await seedMemberWithSet(
      "sub-perf",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );
    const crew = await seedMemberWithSet(
      "sub-crew",
      "team_and_crew",
      PRESET_PERMISSION_SETS.crew_technical,
    );
    const { event, participants } = await seedEvent(
      operator,
      [
        { ...operator, role: "host" },
        { ...performer, role: "performer" },
        { ...crew, role: "crew" },
      ],
      "sub-op",
    );
    const hostPart = participants.find((p) => p.profileId === operator.profileId)?.id as string;
    const performerPart = participants.find((p) => p.profileId === performer.profileId)
      ?.id as string;
    const crewPart = participants.find((p) => p.profileId === crew.profileId)?.id as string;

    // The main deal: operator (payer) ↔ performer (payee).
    const main = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/deals`,
      headers: auth("sub-op"),
      payload: {
        type: "performance",
        name: "Headline fee",
        currency: "SEK",
        guaranteeAmount: "800000",
        parties: [
          { participantId: hostPart, roleInDeal: "payer" },
          { participantId: performerPart, roleInDeal: "payee" },
        ],
      },
    });
    expect(main.statusCode).toBe(201);
    const mainDealId = main.json().id as string;

    // The SUB-HIRE: what the performer pays their own sound tech. The operator is
    // not a party — it is the performer's private arrangement.
    const [subHire] = await db
      .insert(schema.deals)
      .values({
        eventId: event.id,
        type: "fee",
        structure: "guarantee",
        name: "Sound tech sub-hire",
        currency: "SEK",
        guaranteeAmount: 90000n,
        createdBy: "sub-perf",
      })
      .returning();
    if (!subHire) throw new Error("sub-hire seed failed");
    await db.insert(schema.dealParties).values([
      { dealId: subHire.id, participantId: performerPart, roleInDeal: "payer" },
      { dealId: subHire.id, participantId: crewPart, roleInDeal: "payee" },
    ]);

    // The venue holds `budget.view` and hosts the event — and still cannot see it.
    const operatorRead = await app.inject({
      method: "GET",
      url: `/api/v1/deals/${subHire.id}`,
      headers: auth("sub-op"),
    });
    expect(operatorRead.statusCode).toBe(404);
    const operatorDelete = await app.inject({
      method: "DELETE",
      url: `/api/v1/deals/${subHire.id}`,
      headers: auth("sub-op"),
      payload: {},
    });
    expect(operatorDelete.statusCode).toBe(404);

    // The event listing shows the operator only the deal it is a party to.
    const list = await app.inject({
      method: "GET",
      url: `/api/v1/events/${event.id}/deals`,
      headers: auth("sub-op"),
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().map((deal: { id: string }) => deal.id)).toEqual([mainDealId]);

    // Both parties to the sub-hire see it — each their own line.
    const performerRead = await app.inject({
      method: "GET",
      url: `/api/v1/deals/${subHire.id}`,
      headers: auth("sub-perf"),
    });
    expect(performerRead.statusCode).toBe(200);
    expect(performerRead.json().parties).toHaveLength(1);
    expect(performerRead.json().parties[0].participantId).toBe(performerPart);

    const crewRead = await app.inject({
      method: "GET",
      url: `/api/v1/deals/${subHire.id}`,
      headers: auth("sub-crew"),
    });
    expect(crewRead.statusCode).toBe(200);
    expect(crewRead.json().parties[0].participantId).toBe(crewPart);
  });
});

/**
 * A-15. `custom` was a free-text deal type; it was removed because the settlement
 * engine can only reconcile a shape it recognises (PLAN.md:139, decisions.md #16.2).
 * It survived in the route's hand-copied Zod enum after the column dropped it, so the
 * write reached Postgres and blew up there. The rule: the four named types are the
 * whole vocabulary, and anything outside it is a caller error, not a server error.
 */
describe("deals — the type vocabulary is closed", () => {
  it("rejects the removed `custom` type with a 400 naming the allowed values", async () => {
    const operator = await seedMemberWithSet(
      "ct-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const performer = await seedMemberWithSet(
      "ct-perf",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );
    const { event, participants } = await seedEvent(
      operator,
      [
        { ...operator, role: "host" },
        { ...performer, role: "performer" },
      ],
      "ct-op",
    );
    const participant = participants.find((row) => row.profileId === performer.profileId);
    if (!participant) throw new Error("participant seed failed");

    const rejected = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/deals`,
      headers: auth("ct-op"),
      payload: {
        type: "custom",
        name: "Whatever we agreed on the phone",
        parties: [{ participantId: participant.id, roleInDeal: "payee" }],
      },
    });

    // 400 from the schema, NOT a 500 from the Postgres enum.
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json().error.code).toBe("validation");
    // The caller is told what it may send instead.
    const complaint = JSON.stringify(rejected.json());
    for (const allowed of schema.dealType.enumValues) {
      expect(complaint).toContain(allowed);
    }

    // Nothing was written.
    const rows = await harness.db
      .select()
      .from(schema.deals)
      .where(eq(schema.deals.eventId, event.id));
    expect(rows).toHaveLength(0);
  });

  it("still accepts each of the four surviving types", async () => {
    const operator = await seedMemberWithSet(
      "cs-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const performer = await seedMemberWithSet(
      "cs-perf",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );
    const { event, participants } = await seedEvent(
      operator,
      [
        { ...operator, role: "host" },
        { ...performer, role: "performer" },
      ],
      "cs-op",
    );
    const participant = participants.find((row) => row.profileId === performer.profileId);
    if (!participant) throw new Error("participant seed failed");

    expect(schema.dealType.enumValues).toEqual(["performance", "rental", "fee", "split"]);

    for (const type of schema.dealType.enumValues) {
      const created = await app.inject({
        method: "POST",
        url: `/api/v1/events/${event.id}/deals`,
        headers: auth("cs-op"),
        payload: {
          type,
          structure: "guarantee",
          name: `A ${type} deal`,
          guaranteeAmount: "100000",
          parties: [{ participantId: participant.id, roleInDeal: "payee" }],
        },
      });
      expect(created.statusCode, `${type} should be creatable`).toBe(201);
      expect(created.json().type).toBe(type);
    }
  });
});

/**
 * A-36. A share's amount was called `guaranteeAmount` and the engine never read it
 * as a floor, so a split member's line promised a figure no code would ever pay —
 * and `freezeSnapshot` copied that promise into the record both parties signed. A
 * floor is not missing from the model; it is the deal-level `guarantee_vs_door`
 * structure. The amount survives, honestly named.
 */
describe("deals — a share's amount is illustrative, never a floor (A-36)", () => {
  /** An operator, a performer, and the event participant row that joins them. */
  async function seedSplitFixture(prefix: string) {
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
    const { event, participants } = await seedEvent(
      operator,
      [
        { ...operator, role: "host" },
        { ...performer, role: "performer" },
      ],
      `${prefix}-op`,
    );
    const host = participants.find((row) => row.profileId === operator.profileId);
    const act = participants.find((row) => row.profileId === performer.profileId);
    if (!host || !act) throw new Error("participant seed failed");
    return { event, host, act, operatorUid: `${prefix}-op` };
  }

  it("takes `illustrativeAmount` on a share and returns it unchanged", async () => {
    const { event, host, act, operatorUid } = await seedSplitFixture("ill-ok");

    const created = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/deals`,
      headers: auth(operatorUid),
      payload: {
        type: "split",
        structure: "door_split",
        name: "Door split",
        currency: "SEK",
        splitBasisPoints: 10000,
        parties: [
          { participantId: host.id, roleInDeal: "payer" },
          {
            participantId: act.id,
            roleInDeal: "split_member",
            share: { splitBasisPoints: 6000, illustrativeAmount: "3000000", currency: "SEK" },
          },
        ],
      },
    });
    expect(created.statusCode).toBe(201);
    const line = created
      .json()
      .parties.find((party: { participantId: string }) => party.participantId === act.id);
    expect(line.share).toEqual({
      splitBasisPoints: 6000,
      illustrativeAmount: "3000000",
      currency: "SEK",
    });
  });

  it("refuses the old `guaranteeAmount` and says where a real floor lives", async () => {
    const { event, host, act, operatorUid } = await seedSplitFixture("ill-old");

    const rejected = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/deals`,
      headers: auth(operatorUid),
      payload: {
        type: "split",
        structure: "door_split",
        name: "Door split with a phantom floor",
        currency: "SEK",
        splitBasisPoints: 10000,
        parties: [
          { participantId: host.id, roleInDeal: "payer" },
          {
            participantId: act.id,
            roleInDeal: "split_member",
            share: { splitBasisPoints: 6000, guaranteeAmount: "3000000" },
          },
        ],
      },
    });
    expect(rejected.statusCode).toBe(400);
    // A refusal is only evidence when it refuses for the stated reason — and this
    // message has to teach, because the caller's mental model is the wrong one.
    const message = JSON.stringify(rejected.json());
    expect(message).toContain("illustrativeAmount");
    expect(message).toContain("guarantee_vs_door");

    // And nothing was stored: a rejected promise must not survive anywhere.
    const stored = await harness.db
      .select()
      .from(schema.deals)
      .where(eq(schema.deals.eventId, event.id));
    expect(stored).toHaveLength(0);
  });
});

/**
 * TERMS & CONDITIONS — the words of the agreement, beside its figures.
 *
 * The product owner asked for *"terms and conditions text box and template"* and,
 * in the same review, that *"we are not an agreements app"*. What that bought is
 * this column and nothing else: `deals.agreement_body_text`, plain text, written
 * on the Deals tab after the composer has stated the money.
 *
 * The one rule that is not cosmetic is the FREEZE. `confirmed_snapshot` is the
 * record of what was actually agreed, and terms that could move after the last
 * signature would be terms nobody signed. `freezeDealSnapshot` already copied the
 * column; until now nothing could ever put anything in it.
 */
describe("deals — terms & conditions text (product review 86cbaxv2a)", () => {
  const TERMS = "Cancellation: 30 days' notice.\nHospitality: 6 hot meals, 2 towels.";

  it("writes the terms, returns them, and freezes them into confirmed_snapshot", async () => {
    const deal = await seedSplitDeal("dterms");

    // Composing states no terms — they are written on the tab afterwards.
    const before = await app.inject({
      method: "GET",
      url: `/api/v1/deals/${deal.dealId}`,
      headers: auth(deal.opUid),
    });
    expect(before.json().agreementBodyText).toBeNull();

    const written = await app.inject({
      method: "PATCH",
      url: `/api/v1/deals/${deal.dealId}`,
      headers: auth(deal.opUid),
      payload: { agreementBodyText: TERMS, expectedVersion: before.json().version },
    });
    expect(written.statusCode).toBe(200);
    expect(written.json().agreementBodyText).toBe(TERMS);

    // A performer is a party, so it reads the terms it is being asked to sign —
    // the body is deal-level, and redacting it would be asking someone to sign
    // blind. Only the other parties' LINES are hidden from it.
    const asPerformer = await app.inject({
      method: "GET",
      url: `/api/v1/deals/${deal.dealId}`,
      headers: auth(deal.aUid),
    });
    expect(asPerformer.json().agreementBodyText).toBe(TERMS);
    expect(asPerformer.json().parties).toHaveLength(1);

    for (const uid of [deal.opUid, deal.aUid, deal.bUid]) {
      expect((await confirm(deal.dealId, uid)).statusCode).toBe(200);
    }

    const [row] = await harness.db
      .select()
      .from(schema.deals)
      .where(eq(schema.deals.id, deal.dealId));
    expect(row?.agreementStatus).toBe("confirmed");
    const snapshot = row?.confirmedSnapshot as { terms: { agreementBodyText: string | null } };
    expect(snapshot.terms.agreementBodyText).toBe(TERMS);
  });

  it("clears the terms when the box is emptied", async () => {
    const deal = await seedSplitDeal("dtermsclear");
    await app.inject({
      method: "PATCH",
      url: `/api/v1/deals/${deal.dealId}`,
      headers: auth(deal.opUid),
      payload: { agreementBodyText: TERMS },
    });
    const cleared = await app.inject({
      method: "PATCH",
      url: `/api/v1/deals/${deal.dealId}`,
      headers: auth(deal.opUid),
      payload: { agreementBodyText: null },
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().agreementBodyText).toBeNull();
  });

  it("records the change as history, without printing the terms into the feed", async () => {
    const deal = await seedSplitDeal("dtermsact");
    await app.inject({
      method: "PATCH",
      url: `/api/v1/deals/${deal.dealId}`,
      headers: auth(deal.opUid),
      payload: { agreementBodyText: TERMS },
    });
    const [entry] = await harness.db
      .select()
      .from(schema.activityLog)
      .where(
        and(
          eq(schema.activityLog.targetId, deal.dealId),
          eq(schema.activityLog.type, "deal.updated"),
        ),
      );
    const summary = entry?.summary as { fields: string[] };
    expect(summary.fields).toContain("agreementBodyText");
    expect(JSON.stringify(summary)).not.toContain("Hospitality");
  });
});
