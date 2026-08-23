import { PRESET_PERMISSION_SETS } from "@showme/auth";
import { schema } from "@showme/db";
import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TokenVerifier } from "./auth/token-verifier";
import { messageRecipients } from "./lib/notify";
import { messageRoutes } from "./routes/messages";
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
  app = buildTestApp({ database: harness.db, tokenVerifier: fakeVerifier }, [messageRoutes]);
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

/** An operator with an event + host participant, plus a performer participant. */
async function seedEventWithParticipants(prefix: string) {
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
      title: "Backstage Chat",
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

  const [performerParticipant] = await db
    .insert(schema.eventParticipants)
    .values({
      eventId: event.id,
      profileId: performer.profileId,
      role: "performer",
      permissionSetId: performer.permissionSetId,
      status: "confirmed",
    })
    .returning();
  if (!performerParticipant) throw new Error("performer participant seed failed");

  return { operator, performer, event, hostParticipant, performerParticipant };
}

describe("messages — visibility + audit", () => {
  it("hides operators-only notes from a performer but shows the all-visibility message", async () => {
    const { db } = harness;
    const { event } = await seedEventWithParticipants("msg-vis");

    // Operator posts an internal note (operators-only) and a public one (all).
    const internal = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/messages`,
      headers: auth("msg-vis-op"),
      payload: { body: "Internal budget note", visibility: "operators" },
    });
    expect(internal.statusCode).toBe(201);
    expect(internal.json().visibility).toBe("operators");
    expect(internal.json().senderUserId).toBe("msg-vis-op");
    // Operator posted as their host participant on this event.
    expect(internal.json().senderParticipantId).not.toBeNull();

    const publicNote = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/messages`,
      headers: auth("msg-vis-op"),
      payload: { body: "Doors at 7", visibility: "all" },
    });
    expect(publicNote.statusCode).toBe(201);

    // The post is audited.
    const audit = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, publicNote.json().id));
    expect(audit).toHaveLength(1);
    expect(audit[0]?.action).toBe("message.post");
    expect(audit[0]?.actorUserId).toBe("msg-vis-op");

    // Operator sees both.
    const operatorList = await app.inject({
      method: "GET",
      url: `/api/v1/events/${event.id}/messages`,
      headers: auth("msg-vis-op"),
    });
    expect(operatorList.statusCode).toBe(200);
    expect(operatorList.json()).toHaveLength(2);

    // Performer sees only the `all` message, not the operators-only note.
    const performerList = await app.inject({
      method: "GET",
      url: `/api/v1/events/${event.id}/messages`,
      headers: auth("msg-vis-perf"),
    });
    expect(performerList.statusCode).toBe(200);
    const rows = performerList.json();
    expect(rows).toHaveLength(1);
    expect(rows[0].body).toBe("Doors at 7");
    expect(rows[0].visibility).toBe("all");
  });

  it("shows a party message to its sender and to operators, but not to a bystander", async () => {
    const { event } = await seedEventWithParticipants("msg-party");
    // A second performer who is a participant but not the party sender.
    const other = await seedMemberWithSet("msg-party-other", "performer", [
      ...PRESET_PERMISSION_SETS.performer,
    ]);
    await harness.db.insert(schema.eventParticipants).values({
      eventId: event.id,
      profileId: other.profileId,
      role: "performer",
      permissionSetId: other.permissionSetId,
      status: "confirmed",
    });

    const partyNote = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/messages`,
      headers: auth("msg-party-perf"),
      payload: { body: "My private line", visibility: "party" },
    });
    expect(partyNote.statusCode).toBe(201);

    // Sender sees their own party message.
    const senderList = await app.inject({
      method: "GET",
      url: `/api/v1/events/${event.id}/messages`,
      headers: auth("msg-party-perf"),
    });
    expect(senderList.json().map((row: { body: string }) => row.body)).toContain("My private line");

    // Operator sees it too.
    const operatorList = await app.inject({
      method: "GET",
      url: `/api/v1/events/${event.id}/messages`,
      headers: auth("msg-party-op"),
    });
    expect(operatorList.json().map((row: { body: string }) => row.body)).toContain(
      "My private line",
    );

    // A bystanding performer does not.
    const bystanderList = await app.inject({
      method: "GET",
      url: `/api/v1/events/${event.id}/messages`,
      headers: auth("msg-party-other"),
    });
    expect(bystanderList.json()).toHaveLength(0);
  });
});

describe("messages — realtime recipients", () => {
  // Who gets the `event.message_posted` nudge must mirror `canSeeMessage`. Over-
  // notifying is a privacy leak: a performer learning that an operators-only note
  // exists is exactly what `visibility` is there to prevent. The payload itself
  // carries ids only, so this recipient set is the whole protection.
  it("an all-visibility message reaches every participant except the sender", async () => {
    const { event } = await seedEventWithParticipants("msg-rt-all");

    const recipients = await messageRecipients(harness.db, event.id, "msg-rt-all-op", "all");

    expect(recipients).toEqual(["msg-rt-all-perf"]);
    expect(recipients).not.toContain("msg-rt-all-op");
  });

  it("an operators-only message never reaches a performer", async () => {
    const { event } = await seedEventWithParticipants("msg-rt-ops");

    // Posted BY the performer, so the host is the only legitimate recipient.
    const recipients = await messageRecipients(
      harness.db,
      event.id,
      "msg-rt-ops-perf",
      "operators",
    );

    expect(recipients).toEqual(["msg-rt-ops-op"]);
    expect(recipients).not.toContain("msg-rt-ops-perf");
  });

  it("a party message reaches operators only — the sender is the other reader and is excluded", async () => {
    const { event } = await seedEventWithParticipants("msg-rt-party");

    const recipients = await messageRecipients(harness.db, event.id, "msg-rt-party-perf", "party");

    expect(recipients).toEqual(["msg-rt-party-op"]);
  });

  it("skips a member whose profile membership is not active", async () => {
    const { db } = harness;
    const { event, performer } = await seedEventWithParticipants("msg-rt-inactive");
    await db
      .update(schema.profileMembers)
      .set({ status: "revoked" })
      .where(eq(schema.profileMembers.profileId, performer.profileId));

    const recipients = await messageRecipients(db, event.id, "msg-rt-inactive-op", "all");

    expect(recipients).toEqual([]);
  });
});
