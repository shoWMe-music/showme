import { PRESET_PERMISSION_SETS } from "@showme/auth";
import { schema } from "@showme/db";
import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TokenVerifier } from "./auth/token-verifier";
import { setlistRoutes } from "./routes/setlists";
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
  app = buildTestApp({ database: harness.db, tokenVerifier: fakeVerifier }, [setlistRoutes]);
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await harness?.stop();
});

const auth = (uid: string) => ({ authorization: `Bearer ${uid}` });

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

async function seedEvent(
  operator: { profileId: string; permissionSetId: string },
  participants: { profileId: string; permissionSetId: string; role: "host" | "performer" }[],
  createdBy: string,
) {
  const { db } = harness;
  const [event] = await db
    .insert(schema.events)
    .values({
      hostProfileId: operator.profileId,
      title: "Set Night",
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

describe("setlists — performer-authored, party-scoped, one per participant", () => {
  it("a performer upserts their setlist; a second PUT updates rather than duplicates", async () => {
    const { db } = harness;
    const operator = await seedMemberWithSet(
      "s-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const performer = await seedMemberWithSet(
      "s-perf",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );
    const { event, participants } = await seedEvent(
      operator,
      [
        { ...operator, role: "host" },
        { ...performer, role: "performer" },
      ],
      "s-op",
    );
    const performerParticipant = participants.find((row) => row.profileId === performer.profileId);
    if (!performerParticipant) throw new Error("participant seed failed");

    // First PUT — creates.
    const first = await app.inject({
      method: "PUT",
      url: `/api/v1/events/${event.id}/setlists`,
      headers: auth("s-perf"),
      payload: { items: [{ title: "Opener" }, { title: "Ballad" }] },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().participantId).toBe(performerParticipant.id);
    expect(first.json().items).toHaveLength(2);

    // Read back — the performer sees their own setlist.
    const readBack = await app.inject({
      method: "GET",
      url: `/api/v1/events/${event.id}/setlists`,
      headers: auth("s-perf"),
    });
    expect(readBack.statusCode).toBe(200);
    expect(readBack.json()).toHaveLength(1);
    expect(readBack.json()[0].items).toHaveLength(2);

    // Second PUT — updates the same row.
    const second = await app.inject({
      method: "PUT",
      url: `/api/v1/events/${event.id}/setlists`,
      headers: auth("s-perf"),
      payload: { items: [{ title: "New Opener" }] },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().id).toBe(first.json().id); // same row
    expect(second.json().items).toHaveLength(1);

    // Exactly one row in the DB (no duplicate).
    const rows = await db
      .select()
      .from(schema.setlists)
      .where(eq(schema.setlists.participantId, performerParticipant.id));
    expect(rows).toHaveLength(1);

    // Audit written.
    const audit = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, first.json().id));
    expect(audit.some((row) => row.action === "setlist.update")).toBe(true);
  });

  it("the operator sees all setlists; another performer sees only their own", async () => {
    const operator = await seedMemberWithSet(
      "s2-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const perfA = await seedMemberWithSet("s2-pa", "performer", PRESET_PERMISSION_SETS.performer);
    const perfB = await seedMemberWithSet("s2-pb", "performer", PRESET_PERMISSION_SETS.performer);
    const { event } = await seedEvent(
      operator,
      [
        { ...operator, role: "host" },
        { ...perfA, role: "performer" },
        { ...perfB, role: "performer" },
      ],
      "s2-op",
    );

    // Only performer A authors a setlist.
    const putA = await app.inject({
      method: "PUT",
      url: `/api/v1/events/${event.id}/setlists`,
      headers: auth("s2-pa"),
      payload: { items: [{ title: "Song" }] },
    });
    expect(putA.statusCode).toBe(200);

    // Operator (budget.view) sees it.
    const asOperator = await app.inject({
      method: "GET",
      url: `/api/v1/events/${event.id}/setlists`,
      headers: auth("s2-op"),
    });
    expect(asOperator.statusCode).toBe(200);
    expect(asOperator.json()).toHaveLength(1);

    // Performer B sees only their own (none) — not performer A's.
    const asPerformerB = await app.inject({
      method: "GET",
      url: `/api/v1/events/${event.id}/setlists`,
      headers: auth("s2-pb"),
    });
    expect(asPerformerB.statusCode).toBe(200);
    expect(asPerformerB.json()).toHaveLength(0);
  });
});
