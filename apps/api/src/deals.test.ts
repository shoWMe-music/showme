import { PRESET_PERMISSION_SETS } from "@showme/auth";
import { schema } from "@showme/db";
import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TokenVerifier } from "./auth/token-verifier";
import { dealRoutes } from "./routes/deals";
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

/** Seed an event hosted by `operator`, with each given profile joined as a participant. */
async function seedEvent(
  operator: { profileId: string; permissionSetId: string },
  participants: {
    profileId: string;
    permissionSetId: string;
    role: "host" | "performer";
  }[],
  createdBy: string,
) {
  const { db } = harness;
  const [event] = await db
    .insert(schema.events)
    .values({
      hostProfileId: operator.profileId,
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
    if (!participantA || !participantB) throw new Error("participant seed failed");

    // Operator creates a split deal with a party line per performer.
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
          {
            participantId: participantA.id,
            roleInDeal: "split_member",
            share: { basisPoints: 5000 },
          },
          {
            participantId: participantB.id,
            roleInDeal: "split_member",
            share: { basisPoints: 5000 },
          },
        ],
      },
    });
    expect(created.statusCode).toBe(201);
    const dealId = created.json().id;
    expect(created.json().guaranteeAmount).toBe("500000"); // money is a string
    expect(created.json().parties).toHaveLength(2); // creator (operator) sees all

    // Operator GET: both party lines.
    const asOperator = await app.inject({
      method: "GET",
      url: `/api/v1/deals/${dealId}`,
      headers: auth("d-op"),
    });
    expect(asOperator.statusCode).toBe(200);
    expect(asOperator.json().parties).toHaveLength(2);

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
    if (!participant) throw new Error("participant seed failed");

    const created = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/deals`,
      headers: auth("v-op"),
      payload: {
        type: "performance",
        structure: "guarantee",
        name: "v1",
        parties: [{ participantId: participant.id, roleInDeal: "payee" }],
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
        parties: [{ participantId: perfPart, roleInDeal: "payee" }],
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
