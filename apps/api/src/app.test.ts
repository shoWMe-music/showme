import { PRESET_PERMISSION_SETS } from "@showme/auth";
import { schema } from "@showme/db";
import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app";
import type { TokenVerifier } from "./auth/token-verifier";

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
  app = buildApp({ database: harness.db, tokenVerifier: fakeVerifier });
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await harness?.stop();
});

/** Seed a provisioned user (bare — no memberships). */
async function seedUser(id: string, kind: "operator" | "performer") {
  await harness.db.insert(schema.users).values({ id, email: `${id}@example.com`, kind });
}

/** Seed a user + profile + active membership + a permission set, return the ids. */
async function seedMemberWithSet(
  id: string,
  kind: "operator" | "performer",
  capabilities: readonly string[],
) {
  const { db } = harness;
  await seedUser(id, kind);
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

const auth = (uid: string) => ({ authorization: `Bearer ${uid}` });

describe("pipeline plumbing", () => {
  it("serves the public health route without auth", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });

  it("rejects an authed route with no token", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/me" });
    expect(response.statusCode).toBe(401);
  });

  it("JIT-provisions a user on first session, then reflects it at /me", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/auth/session",
      headers: auth("newbie"),
      payload: { kind: "operator", name: "Newbie" },
    });
    expect(created.statusCode).toBe(200);
    expect(created.json()).toMatchObject({ userId: "newbie", kind: "operator", memberships: [] });

    const me = await app.inject({ method: "GET", url: "/api/v1/me", headers: auth("newbie") });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ userId: "newbie", isAdmin: false });
  });

  it("refuses to provision a new user without a kind", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/session",
      headers: auth("kindless"),
      payload: {},
    });
    expect(response.statusCode).toBe(400);
  });
});

describe("events — authorize + serialize + audit", () => {
  it("serializes the hold rank for operators but redacts it for performers", async () => {
    const { db } = harness;
    const operator = await seedMemberWithSet(
      "ev-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const performer = await seedMemberWithSet(
      "ev-perf",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );

    const [event] = await db
      .insert(schema.events)
      .values({
        hostProfileId: operator.profileId,
        title: "Hold Night",
        baseCurrency: "SEK",
        status: "on_hold",
        holdRank: 2,
        createdBy: "ev-op",
      })
      .returning();
    if (!event) throw new Error("event seed failed");
    await db.insert(schema.eventParticipants).values([
      {
        eventId: event.id,
        profileId: operator.profileId,
        role: "host",
        permissionSetId: operator.permissionSetId,
      },
      {
        eventId: event.id,
        profileId: performer.profileId,
        role: "performer",
        permissionSetId: performer.permissionSetId,
      },
    ]);

    const asOperator = await app.inject({
      method: "GET",
      url: `/api/v1/events/${event.id}`,
      headers: auth("ev-op"),
    });
    expect(asOperator.statusCode).toBe(200);
    expect(asOperator.json().holdRank).toBe(2); // operator sees the rank

    const asPerformer = await app.inject({
      method: "GET",
      url: `/api/v1/events/${event.id}`,
      headers: auth("ev-perf"),
    });
    expect(asPerformer.statusCode).toBe(200);
    expect(asPerformer.json().title).toBe("Hold Night"); // authorized to view
    expect(asPerformer.json().holdRank).toBeUndefined(); // but never the rank
  });

  it("404s an event the caller cannot reach (no existence leak)", async () => {
    const { db } = harness;
    const operator = await seedMemberWithSet(
      "ev-owner",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    await seedUser("ev-stranger", "operator");
    const [event] = await db
      .insert(schema.events)
      .values({
        hostProfileId: operator.profileId,
        title: "Private",
        baseCurrency: "EUR",
        createdBy: "ev-owner",
      })
      .returning();
    if (!event) throw new Error("event seed failed");
    await db.insert(schema.eventParticipants).values({
      eventId: event.id,
      profileId: operator.profileId,
      role: "host",
      permissionSetId: operator.permissionSetId,
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/events/${event.id}`,
      headers: auth("ev-stranger"),
    });
    expect(response.statusCode).toBe(404);
  });

  it("edits an event and writes an audit row; forbids a performer", async () => {
    const { db } = harness;
    const operator = await seedMemberWithSet(
      "ed-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const performer = await seedMemberWithSet(
      "ed-perf",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );
    const [event] = await db
      .insert(schema.events)
      .values({
        hostProfileId: operator.profileId,
        title: "Before",
        baseCurrency: "EUR",
        createdBy: "ed-op",
      })
      .returning();
    if (!event) throw new Error("event seed failed");
    await db.insert(schema.eventParticipants).values([
      {
        eventId: event.id,
        profileId: operator.profileId,
        role: "host",
        permissionSetId: operator.permissionSetId,
      },
      {
        eventId: event.id,
        profileId: performer.profileId,
        role: "performer",
        permissionSetId: performer.permissionSetId,
      },
    ]);

    const edit = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${event.id}`,
      headers: auth("ed-op"),
      payload: { title: "After" },
    });
    expect(edit.statusCode).toBe(200);
    expect(edit.json().title).toBe("After");

    const auditRows = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, event.id));
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.action).toBe("event.update");
    expect(auditRows[0]?.actorUserId).toBe("ed-op");

    const forbidden = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${event.id}`,
      headers: auth("ed-perf"),
      payload: { title: "Nope" },
    });
    expect(forbidden.statusCode).toBe(403);
  });
});

describe("decisions #8 — concurrency & idempotency", () => {
  it("replays an idempotent create instead of making a second event", async () => {
    const { db } = harness;
    const operator = await seedMemberWithSet(
      "idem-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const headers = {
      ...auth("idem-op"),
      "x-profile-id": operator.profileId,
      "idempotency-key": "create-key-1",
    };

    const first = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers,
      payload: { title: "Fest", baseCurrency: "EUR" },
    });
    expect(first.statusCode).toBe(201);
    const firstId = first.json().id;

    const replay = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers,
      payload: { title: "Fest", baseCurrency: "EUR" },
    });
    expect(replay.statusCode).toBe(201);
    expect(replay.json().id).toBe(firstId); // same stored result

    const events = await db
      .select()
      .from(schema.events)
      .where(eq(schema.events.hostProfileId, operator.profileId));
    expect(events).toHaveLength(1); // not two
  });

  it("rejects a stale write with 409 (optimistic lock)", async () => {
    const operator = await seedMemberWithSet(
      "lock-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers: { ...auth("lock-op"), "x-profile-id": operator.profileId },
      payload: { title: "v1", baseCurrency: "EUR" },
    });
    const eventId = created.json().id;
    expect(created.json().version).toBe(1);

    const ok = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${eventId}`,
      headers: auth("lock-op"),
      payload: { title: "v2", expectedVersion: 1 },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().version).toBe(2);

    // Retry with the now-stale version → conflict.
    const stale = await app.inject({
      method: "PATCH",
      url: `/api/v1/events/${eventId}`,
      headers: auth("lock-op"),
      payload: { title: "v3", expectedVersion: 1 },
    });
    expect(stale.statusCode).toBe(409);
  });
});
