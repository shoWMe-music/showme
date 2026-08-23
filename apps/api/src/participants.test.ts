import { PRESET_PERMISSION_SETS } from "@showme/auth";
import { schema } from "@showme/db";
import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TokenVerifier } from "./auth/token-verifier";
import { participantRoutes } from "./routes/participants";
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
  app = buildTestApp({ database: harness.db, tokenVerifier: fakeVerifier }, [participantRoutes]);
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

/** An operator with an event + host participant, plus a seeded performer profile. */
async function seedEventWithHost(prefix: string) {
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
      title: "Roster Night",
      baseCurrency: "SEK",
      createdBy: `${prefix}-op`,
    })
    .returning();
  if (!event) throw new Error("event seed failed");

  const [hostParticipant] = await db
    .insert(schema.eventParticipants)
    .values({
      eventId: event.id,
      profileId: operator.profileId,
      role: "host",
      permissionSetId: operator.permissionSetId,
      status: "confirmed",
    })
    .returning();
  if (!hostParticipant) throw new Error("host participant seed failed");

  return { operator, performer, event, hostParticipant };
}

describe("participants — authorize + serialize + audit", () => {
  it("lets an operator list with full fields and add a performer (with audit)", async () => {
    const { db } = harness;
    const { operator, performer, event } = await seedEventWithHost("list-op");

    const added = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/participants`,
      headers: auth("list-op-op"),
      payload: {
        profileId: performer.profileId,
        role: "performer",
        permissionSetId: performer.permissionSetId,
        performerTag: "headliner",
      },
    });
    expect(added.statusCode).toBe(201);
    expect(added.json().profileId).toBe(performer.profileId);
    expect(added.json().performerTag).toBe("headliner");
    // Operator tier: sees the permission set id on the row it just created.
    expect(added.json().permissionSetId).toBe(performer.permissionSetId);

    const audit = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, added.json().id));
    expect(audit).toHaveLength(1);
    expect(audit[0]?.action).toBe("participant.add");
    expect(audit[0]?.actorUserId).toBe("list-op-op");

    const list = await app.inject({
      method: "GET",
      url: `/api/v1/events/${event.id}/participants`,
      headers: auth("list-op-op"),
    });
    expect(list.statusCode).toBe(200);
    const rows = list.json();
    expect(rows).toHaveLength(2); // host + performer
    // Operator sees the full field set on every row.
    for (const row of rows) {
      expect(row).toHaveProperty("permissionSetId");
    }
    expect(rows.map((row: { role: string }) => row.role).sort()).toEqual(["host", "performer"]);
    expect(operator.profileId).toBeDefined();
  });

  it("writes a notification to the added profile's member on participant-add", async () => {
    const { db } = harness;
    const { performer, event } = await seedEventWithHost("notify");

    const added = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/participants`,
      headers: auth("notify-op"),
      payload: { profileId: performer.profileId, role: "performer" },
    });
    expect(added.statusCode).toBe(201);

    // The performer's active member ("notify-perf") gets a feed row; the acting
    // operator ("notify-op") does not (you never notify yourself).
    const forPerformer = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, "notify-perf"));
    expect(forPerformer).toHaveLength(1);
    expect(forPerformer[0]?.type).toBe("event.participant_added");
    expect(forPerformer[0]?.eventId).toBe(event.id);
    expect(forPerformer[0]?.title).toBe('Added to "Roster Night"');

    const forOperator = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, "notify-op"));
    expect(forOperator).toHaveLength(0);
  });

  it("shows a performer only the public fields of other participants", async () => {
    const { db } = harness;
    const { performer, event } = await seedEventWithHost("pub");

    await db.insert(schema.eventParticipants).values({
      eventId: event.id,
      profileId: performer.profileId,
      role: "performer",
      permissionSetId: performer.permissionSetId,
      status: "confirmed",
      details: { payNote: "secret" },
    });

    const list = await app.inject({
      method: "GET",
      url: `/api/v1/events/${event.id}/participants`,
      headers: auth("pub-perf"),
    });
    expect(list.statusCode).toBe(200);
    const rows = list.json();
    expect(rows).toHaveLength(2);
    // Public tier: every row carries only the public face — no set id / details.
    for (const row of rows) {
      expect(row).toHaveProperty("id");
      expect(row).toHaveProperty("profileId");
      expect(row).toHaveProperty("role");
      expect(row).toHaveProperty("status");
      expect(row).toHaveProperty("performerTag");
      expect(row.permissionSetId).toBeUndefined();
      expect(row.details).toBeUndefined();
    }
  });

  it("409s a duplicate (same event + profile)", async () => {
    const { performer, event } = await seedEventWithHost("dup");
    const payload = { profileId: performer.profileId, role: "performer" as const };

    const first = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/participants`,
      headers: auth("dup-op"),
      payload,
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/participants`,
      headers: auth("dup-op"),
      payload,
    });
    expect(second.statusCode).toBe(409);
  });

  it("403s changing the host's role", async () => {
    const { event, hostParticipant } = await seedEventWithHost("host");

    const response = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${event.id}/participants/${hostParticipant.id}`,
      headers: auth("host-op"),
      payload: { role: "performer" },
    });
    expect(response.statusCode).toBe(403);
  });

  it("403s a non-operator POST", async () => {
    const { db } = harness;
    const { performer, event } = await seedEventWithHost("perm");

    // Make the performer an actual participant so they can VIEW (not 404).
    await db.insert(schema.eventParticipants).values({
      eventId: event.id,
      profileId: performer.profileId,
      role: "performer",
      permissionSetId: performer.permissionSetId,
      status: "confirmed",
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/participants`,
      headers: auth("perm-perf"),
      payload: { profileId: performer.profileId, role: "crew" },
    });
    expect(response.statusCode).toBe(403);
  });
});

describe("participants — crew sponsor stamp (decisions #12)", () => {
  it("stamps the adder as the sponsor when crew is added directly", async () => {
    const { db } = harness;
    const { event, hostParticipant } = await seedEventWithHost("crew-sp");
    const crew = await seedMemberWithSet(
      "crew-sp-c",
      "performer",
      PRESET_PERMISSION_SETS.crew_technical,
    );

    const added = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/participants`,
      headers: auth("crew-sp-op"), // the operator/host
      payload: { profileId: crew.profileId, role: "crew" },
    });
    expect(added.statusCode).toBe(201);

    const [row] = await db
      .select()
      .from(schema.eventParticipants)
      .where(
        and(
          eq(schema.eventParticipants.eventId, event.id),
          eq(schema.eventParticipants.profileId, crew.profileId),
        ),
      );
    // Sponsored by the host → operator-scope rider reach when granted rider.view.
    expect((row?.details as { sponsorParticipantId: string }).sponsorParticipantId).toBe(
      hostParticipant.id,
    );
  });

  it("does not stamp a sponsor on a non-crew participant", async () => {
    const { db } = harness;
    const { event, performer } = await seedEventWithHost("nocrew-sp");
    await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/participants`,
      headers: auth("nocrew-sp-op"),
      payload: { profileId: performer.profileId, role: "performer" },
    });
    const [row] = await db
      .select()
      .from(schema.eventParticipants)
      .where(
        and(
          eq(schema.eventParticipants.eventId, event.id),
          eq(schema.eventParticipants.profileId, performer.profileId),
        ),
      );
    expect(row?.details ?? null).toBeNull();
  });
});

describe("participants — the grant_admin entitlement gate (paid plans only)", () => {
  /** A permission set owned by `profileId`, carrying `capabilities`. */
  async function seedPermissionSet(
    profileId: string,
    name: string,
    capabilities: readonly string[],
  ) {
    const [set] = await harness.db
      .insert(schema.permissionSets)
      .values({ profileId, name, capabilities: [...capabilities] })
      .returning();
    if (!set) throw new Error("permission set seed failed");
    return set.id;
  }

  it("403s a FREE host handing a performer an admin-grade set, and writes no participant", async () => {
    const { operator, performer, event } = await seedEventWithHost("ga-free");
    const adminSetId = await seedPermissionSet(
      operator.profileId,
      "operator_full",
      PRESET_PERMISSION_SETS.operator_full,
    );

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/participants`,
      headers: auth("ga-free-op"),
      payload: {
        profileId: performer.profileId,
        role: "co_host",
        permissionSetId: adminSetId,
      },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.message).toBe("Granting admin requires a paid plan");

    const rows = await harness.db
      .select()
      .from(schema.eventParticipants)
      .where(
        and(
          eq(schema.eventParticipants.eventId, event.id),
          eq(schema.eventParticipants.profileId, performer.profileId),
        ),
      );
    expect(rows).toHaveLength(0);
  });

  it("lets a PAID host hand out the same admin-grade set", async () => {
    const { operator, performer, event } = await seedEventWithHost("ga-paid");
    await harness.db
      .insert(schema.plans)
      .values({ profileId: operator.profileId, tier: "operator_pro" });
    const adminSetId = await seedPermissionSet(
      operator.profileId,
      "operator_full",
      PRESET_PERMISSION_SETS.operator_full,
    );

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/participants`,
      headers: auth("ga-paid-op"),
      payload: {
        profileId: performer.profileId,
        role: "co_host",
        permissionSetId: adminSetId,
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().permissionSetId).toBe(adminSetId);
  });

  it("403s the same grant made by UPDATE — the back door into event admin", async () => {
    const { db } = harness;
    const { operator, performer, event } = await seedEventWithHost("ga-patch");
    const [participant] = await db
      .insert(schema.eventParticipants)
      .values({
        eventId: event.id,
        profileId: performer.profileId,
        role: "performer",
        permissionSetId: performer.permissionSetId,
        status: "confirmed",
      })
      .returning();
    if (!participant) throw new Error("participant seed failed");
    const adminSetId = await seedPermissionSet(
      operator.profileId,
      "operator_full",
      PRESET_PERMISSION_SETS.operator_full,
    );

    const response = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${event.id}/participants/${participant.id}`,
      headers: auth("ga-patch-op"),
      payload: { permissionSetId: adminSetId },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.message).toBe("Granting admin requires a paid plan");

    const [after] = await db
      .select()
      .from(schema.eventParticipants)
      .where(eq(schema.eventParticipants.id, participant.id));
    expect(after?.permissionSetId).toBe(performer.permissionSetId);
  });

  it("never charges a free host for an ordinary performer / crew / agent set", async () => {
    const { operator, performer, event } = await seedEventWithHost("ga-plain");
    const crewSetId = await seedPermissionSet(
      operator.profileId,
      "crew_technical",
      PRESET_PERMISSION_SETS.crew_technical,
    );
    const agentSetId = await seedPermissionSet(
      operator.profileId,
      "agent",
      PRESET_PERMISSION_SETS.agent,
    );

    const added = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/participants`,
      headers: auth("ga-plain-op"),
      payload: {
        profileId: performer.profileId,
        role: "performer",
        permissionSetId: performer.permissionSetId,
      },
    });
    expect(added.statusCode).toBe(201);

    // Swapping between non-admin sets stays free, on both write paths.
    const patched = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${event.id}/participants/${added.json().id}`,
      headers: auth("ga-plain-op"),
      payload: { permissionSetId: crewSetId },
    });
    expect(patched.statusCode).toBe(200);

    const crew = await seedMemberWithSet("ga-plain-agent", "performer", ["event.view"]);
    const addedAgent = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/participants`,
      headers: auth("ga-plain-op"),
      payload: { profileId: crew.profileId, role: "agent", permissionSetId: agentSetId },
    });
    expect(addedAgent.statusCode).toBe(201);
  });
});
