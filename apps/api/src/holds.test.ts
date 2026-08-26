import { PRESET_PERMISSION_SETS } from "@showme/auth";
import { schema } from "@showme/db";
import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TokenVerifier } from "./auth/token-verifier";
import { holdRoutes } from "./routes/holds";
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
  app = buildTestApp({ database: harness.db, tokenVerifier: fakeVerifier }, [holdRoutes]);
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
  kind: "operator" | "performer" | "agent" | "team_and_crew",
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
 * Seed `count` on_hold events on the SAME (event_date, venue, stage) at ranks
 * 1..count, all hosted by `operator`, with `performer` joined as a performer
 * participant on each. Returns the event ids in rank order.
 */
async function seedHoldPool(
  prefix: string,
  operatorUid: string,
  operator: { profileId: string; permissionSetId: string },
  performer: { profileId: string; permissionSetId: string },
  count: number,
) {
  const { db } = harness;
  const [stage] = await db
    .insert(schema.stages)
    .values({ venueProfileId: operator.profileId, name: `${prefix}-stage` })
    .returning();
  if (!stage) throw new Error("stage seed failed");
  const ids: string[] = [];
  for (let rank = 1; rank <= count; rank++) {
    const [event] = await db
      .insert(schema.events)
      .values({
        hostProfileId: operator.profileId,
        title: `${prefix} hold ${rank}`,
        baseCurrency: "SEK",
        status: "on_hold",
        eventDate: "2026-09-01",
        venueProfileId: operator.profileId,
        stageId: stage.id,
        holdRank: rank,
        holdAutoPromote: true,
        createdBy: operatorUid,
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
    ids.push(event.id);
  }
  return ids;
}

/** Read one event's status + hold_rank. */
async function readEvent(id: string) {
  const [row] = await harness.db.select().from(schema.events).where(eq(schema.events.id, id));
  if (!row) throw new Error("event not found");
  return row;
}

describe("holds — rank (operator only)", () => {
  it("re-ranks a hold to rank 1 and shifts the others down", async () => {
    const operator = await seedMemberWithSet(
      "h-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const performer = await seedMemberWithSet(
      "h-perf",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );
    const [first, second, third] = await seedHoldPool("rank", "h-op", operator, performer, 3);
    if (!first || !second || !third) throw new Error("seed failed");

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/events/${third}/hold/rank`,
      headers: auth("h-op"),
      payload: { holdRank: 1 },
    });
    expect(response.statusCode).toBe(200);

    // third → 1, and the former 1 and 2 shift down to 2 and 3.
    expect((await readEvent(third)).holdRank).toBe(1);
    expect((await readEvent(first)).holdRank).toBe(2);
    expect((await readEvent(second)).holdRank).toBe(3);
  });

  it("forbids a non-operator from setting the rank", async () => {
    const operator = await seedMemberWithSet(
      "h-op2",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const performer = await seedMemberWithSet(
      "h-perf2",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );
    const [first] = await seedHoldPool("rank2", "h-op2", operator, performer, 3);
    if (!first) throw new Error("seed failed");

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/events/${first}/hold/rank`,
      headers: auth("h-perf2"),
      payload: { holdRank: 1 },
    });
    expect(response.statusCode).toBe(403);
  });
});

describe("holds — confirm / decline (booked performer)", () => {
  it("lets the performer confirm rank 1, cancelling the sibling holds", async () => {
    const operator = await seedMemberWithSet(
      "c-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const performer = await seedMemberWithSet(
      "c-perf",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );
    const [first, second, third] = await seedHoldPool("confirm", "c-op", operator, performer, 3);
    if (!first || !second || !third) throw new Error("seed failed");

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/events/${first}/hold/confirm`,
      headers: auth("c-perf"),
    });
    expect(response.statusCode).toBe(200);

    expect((await readEvent(first)).status).toBe("confirmed");
    expect((await readEvent(second)).status).toBe("cancelled");
    expect((await readEvent(third)).status).toBe("cancelled");

    // The confirm is audited.
    const audit = await harness.db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, first));
    expect(audit.some((row) => row.action === "hold.confirm")).toBe(true);
  });

  it("forbids a non-performer from confirming", async () => {
    const operator = await seedMemberWithSet(
      "c-op2",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const performer = await seedMemberWithSet(
      "c-perf2",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );
    const [first] = await seedHoldPool("confirm2", "c-op2", operator, performer, 3);
    if (!first) throw new Error("seed failed");

    // The operator holds event.view but is not a performer participant → forbidden.
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/events/${first}/hold/confirm`,
      headers: auth("c-op2"),
    });
    expect(response.statusCode).toBe(403);
  });

  it("compacts the remaining auto-promote holds when the performer declines", async () => {
    const operator = await seedMemberWithSet(
      "d-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const performer = await seedMemberWithSet(
      "d-perf",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );
    const [first, second, third] = await seedHoldPool("decline", "d-op", operator, performer, 3);
    if (!first || !second || !third) throw new Error("seed failed");

    // Decline rank 1 → the pool loses rank 1; ranks 2 and 3 promote to 1 and 2.
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/events/${first}/hold/decline`,
      headers: auth("d-perf"),
    });
    expect(response.statusCode).toBe(200);

    expect((await readEvent(first)).status).toBe("cancelled");
    const secondRow = await readEvent(second);
    const thirdRow = await readEvent(third);
    expect(secondRow.status).toBe("on_hold");
    expect(secondRow.holdRank).toBe(1);
    expect(thirdRow.status).toBe("on_hold");
    expect(thirdRow.holdRank).toBe(2);
  });
});

/** Join an extra profile to an already-seeded event, with optional participant details. */
async function addParticipant(
  eventId: string,
  member: { profileId: string; permissionSetId: string },
  role: "performer" | "support" | "crew" | "agent",
  details?: Record<string, unknown>,
) {
  await harness.db.insert(schema.eventParticipants).values({
    eventId,
    profileId: member.profileId,
    role,
    permissionSetId: member.permissionSetId,
    status: "confirmed",
    ...(details ? { details } : {}),
  });
}

/**
 * Stamp the booked performer's participation as delegated to `agentProfileId`
 * (decisions #14) AND seed the standing representation it projects. The stamp on
 * its own is not authority — every reader resolves it against a live
 * representation (A-19 follow-up) — so a fixture with only the stamp models a
 * state the assignment path never produces.
 */
async function delegateToAgent(
  eventId: string,
  performerProfileId: string,
  agentProfileId: string,
) {
  await harness.db
    .update(schema.eventParticipants)
    .set({ details: { delegatedToAgentProfileId: agentProfileId } })
    .where(
      and(
        eq(schema.eventParticipants.eventId, eventId),
        eq(schema.eventParticipants.profileId, performerProfileId),
      ),
    );
  await seedRepresentation(agentProfileId, performerProfileId);
}

/**
 * The standing agent↔performer agreement a delegation stamp projects. Pass
 * `terminatedEffectiveAt` in the past to model a notice period that has MATURED
 * but not yet been swept — the row is still `active`, the stamp is still there.
 */
async function seedRepresentation(
  agentProfileId: string,
  performerProfileId: string,
  terminatedEffectiveAt: Date | null = null,
) {
  await harness.db.insert(schema.representations).values({
    agentProfileId,
    performerProfileId,
    terminatedAt: terminatedEffectiveAt,
    terminatedEffectiveAt,
    isWorldwide: true,
    commissionRate: 1000,
    commissionableBasis: "deal_income",
    proposedBy: "agent",
    status: "active",
    confirmedByAgent: true,
    confirmedByPerformer: true,
  });
}

/**
 * A-04 — the date decision goes through the capability engine (`agreement.confirm`)
 * PLUS the booked-act relationship, not a bare `role ∈ {performer, support}` string.
 * Confirming writes `events.status` for the WHOLE event and cascade-cancels the
 * competing holds, so only the act the date is held for — or the agent it delegated
 * to — may take it.
 */
describe("holds — who may accept the date (A-04)", () => {
  it("lets the booked performer confirm, but forbids a support act on the same event", async () => {
    const operator = await seedMemberWithSet(
      "a4-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const performer = await seedMemberWithSet(
      "a4-perf",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );
    const support = await seedMemberWithSet(
      "a4-support",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );
    const [first, second] = await seedHoldPool("a4-support", "a4-op", operator, performer, 2);
    if (!first || !second) throw new Error("seed failed");
    await addParticipant(first, support, "support");

    // The support act holds `agreement.confirm` for its OWN agreement — but the
    // headliner's date is not theirs to take.
    const supportConfirm = await app.inject({
      method: "POST",
      url: `/api/v1/events/${first}/hold/confirm`,
      headers: auth("a4-support"),
    });
    expect(supportConfirm.statusCode).toBe(403);

    // …nor to cancel: decline would cancel the show out from under the headliner.
    const supportDecline = await app.inject({
      method: "POST",
      url: `/api/v1/events/${first}/hold/decline`,
      headers: auth("a4-support"),
    });
    expect(supportDecline.statusCode).toBe(403);

    // Nothing moved — the event and its competing sibling are untouched.
    expect((await readEvent(first)).status).toBe("on_hold");
    expect((await readEvent(second)).status).toBe("on_hold");

    // The booked performer still can.
    const booked = await app.inject({
      method: "POST",
      url: `/api/v1/events/${first}/hold/confirm`,
      headers: auth("a4-perf"),
    });
    expect(booked.statusCode).toBe(200);
    expect((await readEvent(first)).status).toBe("confirmed");
    expect((await readEvent(second)).status).toBe("cancelled");
  });

  it("forbids a DELEGATED performer and lets their agent confirm instead", async () => {
    const operator = await seedMemberWithSet(
      "a4-op2",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const performer = await seedMemberWithSet(
      "a4-perf2",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );
    const agent = await seedMemberWithSet("a4-agent", "agent", PRESET_PERMISSION_SETS.agent);
    const [first, second] = await seedHoldPool("a4-agent", "a4-op2", operator, performer, 2);
    if (!first || !second) throw new Error("seed failed");
    await delegateToAgent(first, performer.profileId, agent.profileId);
    await addParticipant(first, agent, "agent");

    // Delegation, not revocation: the performer keeps the view floor, and the
    // action capability moved to the agent (decisions #14).
    const delegatedPerformer = await app.inject({
      method: "POST",
      url: `/api/v1/events/${first}/hold/confirm`,
      headers: auth("a4-perf2"),
    });
    expect(delegatedPerformer.statusCode).toBe(403);
    expect(delegatedPerformer.json().error.message).toContain("agreement.confirm");
    expect((await readEvent(first)).status).toBe("on_hold");

    // The agent — whose job this is (story.md) — confirms for the act they represent.
    const agentConfirm = await app.inject({
      method: "POST",
      url: `/api/v1/events/${first}/hold/confirm`,
      headers: auth("a4-agent"),
    });
    expect(agentConfirm.statusCode).toBe(200);
    expect((await readEvent(first)).status).toBe("confirmed");
    expect((await readEvent(second)).status).toBe("cancelled");
  });

  // A-19 follow-up. The agent still legitimately represents the SUPPORT act, so
  // they keep standing on the event — but the headliner fired them with notice and
  // that notice has matured. The delegation stamp on the headliner survives until
  // the sweep runs, and reading it raw would let a fired agent take the act's date.
  it("forbids an agent whose notice period on the booked act has already matured", async () => {
    const operator = await seedMemberWithSet(
      "a4-op6",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const performer = await seedMemberWithSet(
      "a4-perf6",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );
    const support = await seedMemberWithSet(
      "a4-support6",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );
    const agent = await seedMemberWithSet("a4-agent6", "agent", PRESET_PERMISSION_SETS.agent);
    const [first] = await seedHoldPool("a4-agent6", "a4-op6", operator, performer, 2);
    if (!first) throw new Error("seed failed");

    // Still representing the support act — so the agent keeps event standing.
    await addParticipant(first, support, "support", {
      delegatedToAgentProfileId: agent.profileId,
    });
    await seedRepresentation(agent.profileId, support.profileId);
    // The headliner's agreement lapsed, but its stamp is still on the participant.
    await harness.db
      .update(schema.eventParticipants)
      .set({ details: { delegatedToAgentProfileId: agent.profileId } })
      .where(
        and(
          eq(schema.eventParticipants.eventId, first),
          eq(schema.eventParticipants.profileId, performer.profileId),
        ),
      );
    await seedRepresentation(
      agent.profileId,
      performer.profileId,
      new Date("2026-01-01T00:00:00.000Z"),
    );
    await addParticipant(first, agent, "agent");

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/events/${first}/hold/confirm`,
      headers: auth("a4-agent6"),
    });
    expect(response.statusCode).toBe(403);
    expect((await readEvent(first)).status).toBe("on_hold");

    // …and the headliner has their own date decision back, without waiting for cron.
    const booked = await app.inject({
      method: "POST",
      url: `/api/v1/events/${first}/hold/confirm`,
      headers: auth("a4-perf6"),
    });
    expect(booked.statusCode).toBe(200);
  });

  it("forbids an agent who represents nobody booked on this event", async () => {
    const operator = await seedMemberWithSet(
      "a4-op3",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const performer = await seedMemberWithSet(
      "a4-perf3",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );
    const support = await seedMemberWithSet(
      "a4-support3",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );
    const agent = await seedMemberWithSet("a4-agent3", "agent", PRESET_PERMISSION_SETS.agent);
    const [first] = await seedHoldPool("a4-agent3", "a4-op3", operator, performer, 2);
    if (!first) throw new Error("seed failed");
    // The agent represents the SUPPORT act only — not the act the date is held for.
    await addParticipant(first, support, "support", {
      delegatedToAgentProfileId: agent.profileId,
    });
    await seedRepresentation(agent.profileId, support.profileId);
    await addParticipant(first, agent, "agent");

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/events/${first}/hold/confirm`,
      headers: auth("a4-agent3"),
    });
    expect(response.statusCode).toBe(403);
    expect((await readEvent(first)).status).toBe("on_hold");
  });

  it("forbids crew — no `agreement.confirm` at all", async () => {
    const operator = await seedMemberWithSet(
      "a4-op4",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const performer = await seedMemberWithSet(
      "a4-perf4",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );
    const crew = await seedMemberWithSet(
      "a4-crew",
      "team_and_crew",
      PRESET_PERMISSION_SETS.crew_technical,
    );
    const [first] = await seedHoldPool("a4-crew", "a4-op4", operator, performer, 2);
    if (!first) throw new Error("seed failed");
    await addParticipant(first, crew, "crew");

    const confirm = await app.inject({
      method: "POST",
      url: `/api/v1/events/${first}/hold/confirm`,
      headers: auth("a4-crew"),
    });
    expect(confirm.statusCode).toBe(403);

    const decline = await app.inject({
      method: "POST",
      url: `/api/v1/events/${first}/hold/decline`,
      headers: auth("a4-crew"),
    });
    expect(decline.statusCode).toBe(403);
    expect((await readEvent(first)).status).toBe("on_hold");
  });

  it("hides the routes entirely from a stranger (404, no existence leak)", async () => {
    const operator = await seedMemberWithSet(
      "a4-op5",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const performer = await seedMemberWithSet(
      "a4-perf5",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );
    const stranger = await seedMemberWithSet(
      "a4-stranger",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );
    expect(stranger.profileId).toBeTruthy();
    const [first] = await seedHoldPool("a4-stranger", "a4-op5", operator, performer, 2);
    if (!first) throw new Error("seed failed");

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/events/${first}/hold/confirm`,
      headers: auth("a4-stranger"),
    });
    expect(response.statusCode).toBe(404);
    expect((await readEvent(first)).status).toBe("on_hold");
  });
});

describe("holds — the free-tier event cap (entitlement layer)", () => {
  /** Fill the host's rolling window with `count` counted (confirmed) events. */
  async function fillCountedEvents(
    operator: { profileId: string; permissionSetId: string },
    operatorUid: string,
    count: number,
  ) {
    for (let index = 0; index < count; index++) {
      await harness.db.insert(schema.events).values({
        hostProfileId: operator.profileId,
        title: `Counted ${index}`,
        baseCurrency: "SEK",
        status: "confirmed",
        createdBy: operatorUid,
      });
    }
  }

  it("403s a hold confirm that would take a free host past the cap, leaving the pool intact", async () => {
    const operator = await seedMemberWithSet(
      "cap-h-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const performer = await seedMemberWithSet(
      "cap-h-perf",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );
    await fillCountedEvents(operator, "cap-h-op", 3);
    const [first, second] = await seedHoldPool("cap-hold", "cap-h-op", operator, performer, 2);
    if (!first || !second) throw new Error("seed failed");

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/events/${first}/hold/confirm`,
      headers: auth("cap-h-perf"),
    });
    expect(response.statusCode).toBe(403);

    // Nothing moved: the target is still held, and the sibling was NOT cancelled.
    expect((await readEvent(first)).status).toBe("on_hold");
    expect((await readEvent(second)).status).toBe("on_hold");
  });

  it("lets the same confirm through once the host's plan is paid", async () => {
    const operator = await seedMemberWithSet(
      "cap-h2-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const performer = await seedMemberWithSet(
      "cap-h2-perf",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );
    await fillCountedEvents(operator, "cap-h2-op", 3);
    await harness.db
      .insert(schema.plans)
      .values({ profileId: operator.profileId, tier: "operator_pro" });
    const [first, second] = await seedHoldPool("cap-hold2", "cap-h2-op", operator, performer, 2);
    if (!first || !second) throw new Error("seed failed");

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/events/${first}/hold/confirm`,
      headers: auth("cap-h2-perf"),
    });
    expect(response.statusCode).toBe(200);
    expect((await readEvent(first)).status).toBe("confirmed");
    expect((await readEvent(second)).status).toBe("cancelled");
  });

  it("never gates a decline — leaving the counted set costs nothing", async () => {
    const operator = await seedMemberWithSet(
      "cap-h3-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const performer = await seedMemberWithSet(
      "cap-h3-perf",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );
    await fillCountedEvents(operator, "cap-h3-op", 3);
    const [first] = await seedHoldPool("cap-hold3", "cap-h3-op", operator, performer, 2);
    if (!first) throw new Error("seed failed");

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/events/${first}/hold/decline`,
      headers: auth("cap-h3-perf"),
    });
    expect(response.statusCode).toBe(200);
    expect((await readEvent(first)).status).toBe("cancelled");
  });
});

/**
 * A hold decision is not one event's news. Confirming rank 1 cancels the siblings,
 * and each of those is a separate booking whose own participants are owed an
 * explanation — so the write fans across events, inside the one transaction.
 */
describe("holds — what reaches each event's history", () => {
  it("writes the win on the confirmed event and the loss on every cancelled sibling", async () => {
    const operator = await seedMemberWithSet(
      "hist-hold-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const performer = await seedMemberWithSet(
      "hist-hold-perf",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );
    const [first, second, third] = await seedHoldPool(
      "hist-hold",
      "hist-hold-op",
      operator,
      performer,
      3,
    );
    if (!first || !second || !third) throw new Error("seed failed");

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/events/${first}/hold/confirm`,
      headers: auth("hist-hold-perf"),
    });
    expect(response.statusCode).toBe(200);

    const historyOf = async (eventId: string) =>
      (
        await harness.db
          .select()
          .from(schema.activityLog)
          .where(eq(schema.activityLog.eventId, eventId))
      ).map((row) => ({ type: row.type, targetKind: row.targetKind }));

    expect(await historyOf(first)).toEqual([{ type: "hold.confirmed", targetKind: "event" }]);
    // The losers learn they lost — but not how many rivals there were, nor which.
    for (const sibling of [second, third]) {
      expect(await historyOf(sibling)).toEqual([{ type: "hold.lost", targetKind: "event" }]);
    }
  });

  it("keeps a rank change behind `event.edit`, where the rank itself lives", async () => {
    const operator = await seedMemberWithSet(
      "hist-rank-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const performer = await seedMemberWithSet(
      "hist-rank-perf",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );
    const [, second] = await seedHoldPool("hist-rank", "hist-rank-op", operator, performer, 3);
    if (!second) throw new Error("seed failed");

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/events/${second}/hold/rank`,
      headers: auth("hist-rank-op"),
      payload: { holdRank: 1 },
    });
    expect(response.statusCode).toBe(200);

    const rows = await harness.db
      .select()
      .from(schema.activityLog)
      .where(eq(schema.activityLog.eventId, second));
    expect(rows).toHaveLength(1);
    // Kind `hold`, not `event`: the performer holding this date must not read
    // their own position in the operator's pool off the timeline.
    expect(rows[0]?.targetKind).toBe("hold");
    expect(rows[0]?.type).toBe("hold.ranked");
    expect(rows[0]?.summary).toEqual({ from: 2, to: 1 });
  });
});
