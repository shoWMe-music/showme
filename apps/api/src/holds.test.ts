import { PRESET_PERMISSION_SETS } from "@showme/auth";
import { schema } from "@showme/db";
import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import { eq } from "drizzle-orm";
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
