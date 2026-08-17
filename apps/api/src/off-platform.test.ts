import { PRESET_PERMISSION_SETS } from "@showme/auth";
import { schema } from "@showme/db";
import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import { and, eq, isNull, ne } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FirebaseUser, TokenVerifier } from "./auth/token-verifier";
import { participantRoutes } from "./routes/participants";
import { sessionRoutes } from "./routes/session";
import { buildTestApp } from "./testing";

/**
 * Configurable fake verifier: tests register `token → FirebaseUser` so a
 * performer's signup email can be made to match the stub email an operator used,
 * and `emailVerified` can be toggled to exercise the claim gate.
 */
const identities: Record<string, FirebaseUser> = {};
const fakeVerifier: TokenVerifier = {
  async verify(token: string) {
    const identity = identities[token];
    if (!identity) throw new Error(`no identity for ${token}`);
    return identity;
  },
};

let harness: TestDatabase;
let app: FastifyInstance;

beforeAll(async () => {
  harness = await startTestDatabase();
  app = buildTestApp({ database: harness.db, tokenVerifier: fakeVerifier }, [
    participantRoutes,
    sessionRoutes,
  ]);
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await harness?.stop();
});

const auth = (uid: string) => ({ authorization: `Bearer ${uid}` });

/** Seed an operator (user + profile + active owner membership + operator_full set)
 * running one event, and register its verifier identity. Returns the ids. */
async function seedOperatorEvent(prefix: string) {
  const { db } = harness;
  const opUid = `${prefix}-op`;
  identities[opUid] = { uid: opUid, email: `${opUid}@example.com`, emailVerified: true };
  await db
    .insert(schema.users)
    .values({ id: opUid, email: `${opUid}@example.com`, kind: "operator" });
  const [profile] = await db
    .insert(schema.profiles)
    .values({ kind: "operator", ownerUserId: opUid, name: `${prefix} Ops`, slug: `${prefix}-ops` })
    .returning();
  if (!profile) throw new Error("operator profile seed failed");
  await db
    .insert(schema.profileMembers)
    .values({ profileId: profile.id, userId: opUid, role: "owner", status: "active" });
  const [set] = await db
    .insert(schema.permissionSets)
    .values({
      profileId: profile.id,
      name: "operator_full",
      capabilities: [...PRESET_PERMISSION_SETS.operator_full],
    })
    .returning();
  if (!set) throw new Error("permission set seed failed");
  const [event] = await db
    .insert(schema.events)
    .values({
      hostProfileId: profile.id,
      title: `${prefix} Show`,
      baseCurrency: "EUR",
      createdBy: opUid,
    })
    .returning();
  if (!event) throw new Error("event seed failed");
  await db.insert(schema.eventParticipants).values({
    eventId: event.id,
    profileId: profile.id,
    role: "host",
    permissionSetId: set.id,
    status: "confirmed",
  });
  return { opUid, opProfileId: profile.id, eventId: event.id };
}

const opHeaders = (uid: string, profileId: string) => ({
  ...auth(uid),
  "x-profile-id": profileId,
});

describe("off-platform performers → stub → claim", () => {
  it("adds a performer by email as an unclaimed performer stub + participant", async () => {
    const { opUid, opProfileId, eventId } = await seedOperatorEvent("add");

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/events/${eventId}/participants/off-platform`,
      headers: opHeaders(opUid, opProfileId),
      payload: { name: "Nina Vox", email: "Nina@Example.com", role: "performer" },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.name).toBe("Nina Vox");
    expect(body.role).toBe("performer");

    // A performer-kind stub exists, unclaimed, with an email-bearing member.
    const [stub] = await harness.db
      .select()
      .from(schema.profiles)
      .where(and(eq(schema.profiles.id, body.profileId), eq(schema.profiles.kind, "performer")));
    expect(stub).toBeTruthy();
    expect(stub?.claimedAt).toBeNull();

    const [member] = await harness.db
      .select()
      .from(schema.profileMembers)
      .where(eq(schema.profileMembers.profileId, body.profileId));
    expect(member?.email).toBe("nina@example.com"); // normalized lowercase
    expect(member?.userId).toBeNull();
    expect(member?.status).toBe("active");
  });

  it("lets the performer claim it on signup and inherit the event", async () => {
    const { opUid, opProfileId, eventId } = await seedOperatorEvent("claim");
    await app.inject({
      method: "POST",
      url: `/api/v1/events/${eventId}/participants/off-platform`,
      headers: opHeaders(opUid, opProfileId),
      payload: { name: "Remy", email: "remy@example.com", role: "performer" },
    });

    // The performer signs up with the SAME (verified) email.
    const performerUid = "claim-remy";
    identities[performerUid] = {
      uid: performerUid,
      email: "remy@example.com",
      emailVerified: true,
    };
    const session = await app.inject({
      method: "POST",
      url: "/api/v1/auth/session",
      headers: auth(performerUid),
      payload: { kind: "performer", name: "Remy" },
    });
    expect(session.statusCode).toBe(200);
    const memberships: { profileId: string; kind: string }[] = session.json().memberships;
    expect(memberships.length).toBe(1);
    const claimedProfileId = memberships[0]?.profileId;

    // The stub is now claimed by them.
    const [claimed] = await harness.db
      .select()
      .from(schema.profiles)
      .where(eq(schema.profiles.id, claimedProfileId ?? ""));
    expect(claimed?.claimedAt).not.toBeNull();
    expect(claimed?.ownerUserId).toBe(performerUid);

    // Inheritance: the access join (user → member → profile → participant → event)
    // now returns the event for the freshly-signed-up performer.
    const reachable = await harness.db
      .select({ eventId: schema.events.id })
      .from(schema.events)
      .innerJoin(schema.eventParticipants, eq(schema.eventParticipants.eventId, schema.events.id))
      .innerJoin(
        schema.profileMembers,
        eq(schema.profileMembers.profileId, schema.eventParticipants.profileId),
      )
      .where(
        and(
          eq(schema.profileMembers.userId, performerUid),
          eq(schema.profileMembers.status, "active"),
          ne(schema.eventParticipants.status, "removed"),
        ),
      );
    expect(reachable.map((row) => row.eventId)).toContain(eventId);

    // And end-to-end through the real pipeline: she can now view the roster.
    const roster = await app.inject({
      method: "GET",
      url: `/api/v1/events/${eventId}/participants`,
      headers: opHeaders(performerUid, claimedProfileId ?? ""),
    });
    expect(roster.statusCode).toBe(200);
  });

  it("does NOT claim when the email is unverified", async () => {
    const { opUid, opProfileId, eventId } = await seedOperatorEvent("unverified");
    await app.inject({
      method: "POST",
      url: `/api/v1/events/${eventId}/participants/off-platform`,
      headers: opHeaders(opUid, opProfileId),
      payload: { name: "Unv", email: "unv@example.com" },
    });

    const uid = "unverified-signup";
    identities[uid] = { uid, email: "unv@example.com", emailVerified: false };
    const session = await app.inject({
      method: "POST",
      url: "/api/v1/auth/session",
      headers: auth(uid),
      payload: { kind: "performer", name: "Unv" },
    });
    expect(session.statusCode).toBe(200);
    expect(session.json().memberships).toHaveLength(0);

    const stillUnclaimed = await harness.db
      .select()
      .from(schema.profileMembers)
      .where(
        and(
          eq(schema.profileMembers.email, "unv@example.com"),
          isNull(schema.profileMembers.userId),
        ),
      );
    expect(stillUnclaimed.length).toBe(1);
  });

  it("does NOT claim a performer stub for a differently-kinded account", async () => {
    const { opUid, opProfileId, eventId } = await seedOperatorEvent("mismatch");
    await app.inject({
      method: "POST",
      url: `/api/v1/events/${eventId}/participants/off-platform`,
      headers: opHeaders(opUid, opProfileId),
      payload: { name: "Mm", email: "mm@example.com" },
    });

    const uid = "mismatch-operator";
    identities[uid] = { uid, email: "mm@example.com", emailVerified: true };
    const session = await app.inject({
      method: "POST",
      url: "/api/v1/auth/session",
      headers: auth(uid),
      payload: { kind: "operator", name: "Mm" }, // operator ≠ performer stub
    });
    expect(session.statusCode).toBe(200);
    expect(session.json().memberships).toHaveLength(0);
  });

  it("seeds the stub email from a linked contact card", async () => {
    const { opUid, opProfileId, eventId } = await seedOperatorEvent("contact");
    const [contact] = await harness.db
      .insert(schema.contacts)
      .values({
        ownerProfileId: opProfileId,
        name: "Iris Lang",
        persons: [{ name: "Iris Lang", email: "iris@example.com" }],
      })
      .returning();
    if (!contact) throw new Error("contact seed failed");

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/events/${eventId}/participants/off-platform`,
      headers: opHeaders(opUid, opProfileId),
      payload: { contactId: contact.id, role: "performer" },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.name).toBe("Iris Lang");

    const [member] = await harness.db
      .select()
      .from(schema.profileMembers)
      .where(eq(schema.profileMembers.profileId, body.profileId));
    expect(member?.email).toBe("iris@example.com");

    // The contact is now linked to the invitation that was spun from it.
    const [linkedContact] = await harness.db
      .select()
      .from(schema.contacts)
      .where(eq(schema.contacts.id, contact.id));
    expect(linkedContact?.invitationId).not.toBeNull();
  });
});
