import { PRESET_PERMISSION_SETS } from "@showme/auth";
import { schema } from "@showme/db";
import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import { and, eq, isNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TokenVerifier } from "./auth/token-verifier";
import type { StorageSigner } from "./lib/storage";
import { createFileRoutes } from "./routes/files";
import { riderRoutes } from "./routes/riders";
import { buildTestApp } from "./testing";

/** Fake verifier: the bearer token IS the uid (mirrors app.test.ts). */
const fakeVerifier: TokenVerifier = {
  async verify(token: string) {
    return { uid: token, email: `${token}@example.com`, name: token };
  },
};

/** Deterministic signer — the bytes are irrelevant here; who gets a URL is not. */
const fakeSigner: StorageSigner = {
  async signUpload(path, contentType, maxBytes) {
    return {
      url: `signed-upload::${path}`,
      headers: { "content-type": contentType, "x-goog-content-length-range": `0,${maxBytes}` },
    };
  },
  async signDownload(path) {
    return `signed-download::${path}`;
  },
};

let harness: TestDatabase;
let app: FastifyInstance;

beforeAll(async () => {
  harness = await startTestDatabase();
  // The FILE routes ride along on purpose: who may download a rider's bytes is a
  // rider question, and asserting it needs both halves in one app.
  app = buildTestApp({ database: harness.db, tokenVerifier: fakeVerifier }, [
    riderRoutes,
    createFileRoutes(fakeSigner),
  ]);
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

/** Seed an event hosted by `operator` with each given profile joined as a participant. */
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
      title: "Rider Night",
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

describe("riders — profile library + event instances (copy-on-attach)", () => {
  it("performer creates a library rider, then attaches it to the event as an instance", async () => {
    const { db } = harness;
    const operator = await seedMemberWithSet(
      "r-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const performer = await seedMemberWithSet(
      "r-perf",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );
    const { event, participants } = await seedEvent(
      operator,
      [
        { ...operator, role: "host" },
        { ...performer, role: "performer" },
      ],
      "r-op",
    );
    const performerParticipant = participants.find((row) => row.profileId === performer.profileId);
    if (!performerParticipant) throw new Error("participant seed failed");

    // Create a LIBRARY rider (event_id NULL) on the performer's profile.
    const created = await app.inject({
      method: "POST",
      url: `/api/v1/profiles/${performer.profileId}/riders`,
      headers: auth("r-perf"),
      payload: { type: "tech", name: "Main Tech Rider", description: "2x DI, 4x monitors" },
    });
    expect(created.statusCode).toBe(201);
    const libraryRiderId = created.json().id;
    expect(created.json().eventId).toBeNull();
    expect(created.json().ownerProfileId).toBe(performer.profileId);

    // The library list returns it.
    const library = await app.inject({
      method: "GET",
      url: `/api/v1/profiles/${performer.profileId}/riders`,
      headers: auth("r-perf"),
    });
    expect(library.statusCode).toBe(200);
    expect(library.json()).toHaveLength(1);
    expect(library.json()[0].id).toBe(libraryRiderId);

    // Attach: COPY the library rider into an event instance.
    const attached = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/riders`,
      headers: auth("r-perf"),
      payload: { sourceRiderId: libraryRiderId },
    });
    expect(attached.statusCode).toBe(201);
    const instance = attached.json();
    expect(instance.id).not.toBe(libraryRiderId); // a new row
    expect(instance.eventId).toBe(event.id);
    expect(instance.sourceRiderId).toBe(libraryRiderId);
    expect(instance.ownerParticipantId).toBe(performerParticipant.id);
    expect(instance.name).toBe("Main Tech Rider"); // copied fields
    expect(instance.type).toBe("tech");

    // The event list returns the instance (event_id set), not the library rider.
    const eventRiders = await app.inject({
      method: "GET",
      url: `/api/v1/events/${event.id}/riders`,
      headers: auth("r-op"),
    });
    expect(eventRiders.statusCode).toBe(200);
    expect(eventRiders.json()).toHaveLength(1);
    expect(eventRiders.json()[0].id).toBe(instance.id);

    // Audit rows written for create + attach.
    const createAudit = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, libraryRiderId));
    expect(createAudit[0]?.action).toBe("rider.create");
    const attachAudit = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, instance.id));
    expect(attachAudit[0]?.action).toBe("rider.attach");

    // The instance really is an event-scoped row (event_id set), distinct from the library one.
    const libraryRows = await db
      .select()
      .from(schema.riders)
      .where(
        and(eq(schema.riders.ownerProfileId, performer.profileId), isNull(schema.riders.eventId)),
      );
    expect(libraryRows).toHaveLength(1);
  });

  it("scopes event riders by the crew member's sponsor (decisions #12)", async () => {
    const { db } = harness;
    const operator = await seedMemberWithSet(
      "rs-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const perfA = await seedMemberWithSet("rs-a", "performer", PRESET_PERMISSION_SETS.performer);
    const perfB = await seedMemberWithSet("rs-b", "performer", PRESET_PERMISSION_SETS.performer);
    const { event, participants } = await seedEvent(
      operator,
      [
        { ...operator, role: "host" },
        { ...perfA, role: "performer" },
        { ...perfB, role: "performer" },
      ],
      "rs-op",
    );
    const hostPart = participants.find((p) => p.profileId === operator.profileId)?.id as string;
    const aPart = participants.find((p) => p.profileId === perfA.profileId)?.id as string;

    // Each performer attaches their own rider instance.
    const attach = async (uid: string, profileId: string, name: string) => {
      const lib = await app.inject({
        method: "POST",
        url: `/api/v1/profiles/${profileId}/riders`,
        headers: auth(uid),
        payload: { type: "tech", name },
      });
      await app.inject({
        method: "POST",
        url: `/api/v1/events/${event.id}/riders`,
        headers: auth(uid),
        payload: { sourceRiderId: lib.json().id },
      });
    };
    await attach("rs-a", perfA.profileId, "A tech");
    await attach("rs-b", perfB.profileId, "B tech");

    // Seed crew members with distinct permission tiers + sponsors.
    const addCrew = async (
      uid: string,
      capabilities: readonly string[],
      sponsorParticipantId: string,
    ) => {
      const member = await seedMemberWithSet(uid, "performer", capabilities);
      await db.insert(schema.eventParticipants).values({
        eventId: event.id,
        profileId: member.profileId,
        role: "crew",
        permissionSetId: member.permissionSetId,
        status: "confirmed",
        details: { sponsorParticipantId },
      });
    };
    await addCrew("rs-tech-a", PRESET_PERMISSION_SETS.crew_technical, aPart); // sound eng for A
    await addCrew("rs-bar", PRESET_PERMISSION_SETS.crew_schedule_only, aPart); // bartender for A
    await addCrew("rs-tech-op", PRESET_PERMISSION_SETS.crew_technical, hostPart); // operator's sound eng

    const namesFor = async (uid: string) => {
      const response = await app.inject({
        method: "GET",
        url: `/api/v1/events/${event.id}/riders`,
        headers: auth(uid),
      });
      expect(response.statusCode).toBe(200);
      return (response.json() as Array<{ name: string }>).map((r) => r.name).sort();
    };

    // Operator sees every rider.
    expect(await namesFor("rs-op")).toEqual(["A tech", "B tech"]);
    // A performer sees only their own.
    expect(await namesFor("rs-a")).toEqual(["A tech"]);
    // A-sponsored technical crew (rider.view) sees ONLY A's rider — not B's.
    expect(await namesFor("rs-tech-a")).toEqual(["A tech"]);
    // A-sponsored bartender (no rider.view) sees nothing.
    expect(await namesFor("rs-bar")).toEqual([]);
    // Operator-sponsored technical crew sees ALL riders.
    expect(await namesFor("rs-tech-op")).toEqual(["A tech", "B tech"]);
  });

  it("scopes through an AGENT sponsor — the crew inherits the agent's represented reach", async () => {
    const { db } = harness;
    const operator = await seedMemberWithSet(
      "rg-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const perfA = await seedMemberWithSet("rg-a", "performer", PRESET_PERMISSION_SETS.performer);
    const perfB = await seedMemberWithSet("rg-b", "performer", PRESET_PERMISSION_SETS.performer);
    const { event, participants } = await seedEvent(
      operator,
      [
        { ...operator, role: "host" },
        { ...perfA, role: "performer" },
        { ...perfB, role: "performer" },
      ],
      "rg-op",
    );
    const aPart = participants.find((p) => p.profileId === perfA.profileId)?.id as string;

    const attach = async (uid: string, profileId: string, name: string) => {
      const lib = await app.inject({
        method: "POST",
        url: `/api/v1/profiles/${profileId}/riders`,
        headers: auth(uid),
        payload: { type: "tech", name },
      });
      await app.inject({
        method: "POST",
        url: `/api/v1/events/${event.id}/riders`,
        headers: auth(uid),
        payload: { sourceRiderId: lib.json().id },
      });
    };
    await attach("rg-a", perfA.profileId, "A tech");
    await attach("rg-b", perfB.profileId, "B tech");

    // An agent representing performer A (the delegation stamp the assignment writes).
    const agent = await seedMemberWithSet("rg-agent", "performer", PRESET_PERMISSION_SETS.agent);
    const [agentPart] = await db
      .insert(schema.eventParticipants)
      .values({
        eventId: event.id,
        profileId: agent.profileId,
        role: "agent",
        permissionSetId: agent.permissionSetId,
        status: "confirmed",
      })
      .returning();
    await db
      .update(schema.eventParticipants)
      .set({ details: { delegatedToAgentProfileId: agent.profileId } })
      .where(eq(schema.eventParticipants.id, aPart));
    // The standing agreement the stamp is a projection OF. Authority is resolved
    // against this row, never the stamp alone (A-19 follow-up), so a fixture that
    // stamps without it is modelling a state the product cannot produce.
    await db.insert(schema.representations).values({
      agentProfileId: agent.profileId,
      performerProfileId: perfA.profileId,
      isWorldwide: true,
      commissionRate: 1000,
      commissionableBasis: "deal_income",
      proposedBy: "agent",
      status: "active",
      confirmedByAgent: true,
      confirmedByPerformer: true,
    });

    // A crew member the AGENT brought (sponsored by the agent participant).
    const crew = await seedMemberWithSet(
      "rg-crew",
      "performer",
      PRESET_PERMISSION_SETS.crew_technical,
    );
    await db.insert(schema.eventParticipants).values({
      eventId: event.id,
      profileId: crew.profileId,
      role: "crew",
      permissionSetId: crew.permissionSetId,
      status: "confirmed",
      details: { sponsorParticipantId: agentPart?.id },
    });

    const namesFor = async (uid: string) => {
      const response = await app.inject({
        method: "GET",
        url: `/api/v1/events/${event.id}/riders`,
        headers: auth(uid),
      });
      expect(response.statusCode).toBe(200);
      return (response.json() as Array<{ name: string }>).map((r) => r.name).sort();
    };

    // The agent sees the rider of the performer they represent — not the other's.
    expect(await namesFor("rg-agent")).toEqual(["A tech"]);
    // The agent's crew inherits that reach: A's rider only, never B's.
    expect(await namesFor("rg-crew")).toEqual(["A tech"]);

    // A-19 follow-up: B fires the agent with notice, the notice matures, the sweep
    // has NOT run — so B's participation still carries the delegation stamp. The
    // stamp is not authority: B's rider must stay shut to the agent (and to the
    // crew that inherits their reach) the instant the agreement lapses.
    const bPart = participants.find((p) => p.profileId === perfB.profileId)?.id as string;
    await db
      .update(schema.eventParticipants)
      .set({ details: { delegatedToAgentProfileId: agent.profileId } })
      .where(eq(schema.eventParticipants.id, bPart));
    await db.insert(schema.representations).values({
      agentProfileId: agent.profileId,
      performerProfileId: perfB.profileId,
      isWorldwide: true,
      commissionRate: 1000,
      commissionableBasis: "deal_income",
      proposedBy: "agent",
      status: "active", // still `active` — an effective-dated termination, unswept
      terminatedAt: new Date("2026-01-01T00:00:00.000Z"),
      terminatedEffectiveAt: new Date("2026-01-01T00:00:00.000Z"),
      confirmedByAgent: true,
      confirmedByPerformer: true,
    });
    expect(await namesFor("rg-agent")).toEqual(["A tech"]);
    expect(await namesFor("rg-crew")).toEqual(["A tech"]);
  });

  it("lets a performer whose participation is DELEGATED to their agent still attach their own rider", async () => {
    // The bug behind "riders cannot upload": the delegated-performer FLOOR carried
    // no `rider.submit`, and the agent preset carries none either — so an act with
    // representation had nobody who could attach its tech rider. Delegation hands
    // an agent BUSINESS authority (negotiate, confirm), never the act's own
    // documents — the same rule that keeps `setlist.author` with the performer.
    const { db } = harness;
    const operator = await seedMemberWithSet(
      "rdel-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const performer = await seedMemberWithSet(
      "rdel-perf",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );
    const { event, participants } = await seedEvent(
      operator,
      [
        { ...operator, role: "host" },
        { ...performer, role: "performer" },
      ],
      "rdel-op",
    );
    const performerParticipant = participants.find((row) => row.profileId === performer.profileId);
    if (!performerParticipant) throw new Error("participant seed failed");

    // `seedMemberWithSet` takes the user's account kind; the AGENT event-role is
    // what matters here, and it is set on the participant row below.
    const agent = await seedMemberWithSet("rdel-agent", "performer", PRESET_PERMISSION_SETS.agent);
    await db.insert(schema.eventParticipants).values({
      eventId: event.id,
      profileId: agent.profileId,
      role: "agent",
      permissionSetId: agent.permissionSetId,
      status: "confirmed",
    });
    // The stamp is only a projection of this agreement — authority is resolved
    // against the representation, so the fixture needs both to be a real state.
    await db.insert(schema.representations).values({
      agentProfileId: agent.profileId,
      performerProfileId: performer.profileId,
      isWorldwide: true,
      commissionRate: 1000,
      commissionableBasis: "deal_income",
      proposedBy: "agent",
      status: "active",
      confirmedByAgent: true,
      confirmedByPerformer: true,
    });
    await db
      .update(schema.eventParticipants)
      .set({ details: { delegatedToAgentProfileId: agent.profileId } })
      .where(eq(schema.eventParticipants.id, performerParticipant.id));

    const library = await app.inject({
      method: "POST",
      url: `/api/v1/profiles/${performer.profileId}/riders`,
      headers: auth("rdel-perf"),
      payload: { type: "tech", name: "Delegated act tech rider" },
    });
    expect(library.statusCode).toBe(201);

    const attached = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/riders`,
      headers: auth("rdel-perf"),
      payload: { sourceRiderId: library.json().id },
    });
    expect(attached.statusCode).toBe(201);
    expect(attached.json()).toMatchObject({
      eventId: event.id,
      ownerParticipantId: performerParticipant.id,
      name: "Delegated act tech rider",
    });
  });

  it("lets the OPERATOR download the bytes of a rider submitted to them, and a stranger not", async () => {
    // The security shape of a rider: the performer owns the file, the operator is
    // the party it was submitted TO. Authorizing the download on file OWNERSHIP
    // alone gets that exactly backwards — the operator could read the rider's name
    // over the API and never open the PDF, while the rule that actually decides who
    // may see a rider (decisions #12) was consulted nowhere.
    const { db } = harness;
    const operator = await seedMemberWithSet(
      "rfile-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const performer = await seedMemberWithSet(
      "rfile-perf",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );
    const outsider = await seedMemberWithSet(
      "rfile-stranger",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );
    const { event } = await seedEvent(
      operator,
      [
        { ...operator, role: "host" },
        { ...performer, role: "performer" },
      ],
      "rfile-op",
    );

    // The performer uploads their rider PDF and attaches it to the show.
    const issued = await app.inject({
      method: "POST",
      url: "/api/v1/files/upload-url",
      headers: auth("rfile-perf"),
      payload: {
        path: `profiles/${performer.profileId}/riders/tech.pdf`,
        contentType: "application/pdf",
        kind: "document",
        sizeBytes: 2048,
        ownerProfileId: performer.profileId,
      },
    });
    expect(issued.statusCode).toBe(201);
    const { fileId } = issued.json();

    const library = await app.inject({
      method: "POST",
      url: `/api/v1/profiles/${performer.profileId}/riders`,
      headers: auth("rfile-perf"),
      payload: { type: "tech", name: "Tech rider", fileId },
    });
    expect(library.statusCode).toBe(201);
    const attached = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/riders`,
      headers: auth("rfile-perf"),
      payload: { sourceRiderId: library.json().id },
    });
    expect(attached.statusCode).toBe(201);

    const downloadAs = (uid: string) =>
      app.inject({
        method: "GET",
        url: `/api/v1/files/${fileId}/download-url`,
        headers: auth(uid),
      });

    expect((await downloadAs("rfile-perf")).statusCode).toBe(200); // its author
    expect((await downloadAs("rfile-op")).statusCode).toBe(200); // the party it was sent to
    // Nobody else. A 404, not a 403 — the existence of the file is not news either.
    expect((await downloadAs("rfile-stranger")).statusCode).toBe(404);
    expect(outsider.profileId).toBeTruthy();

    // And the reach is exactly the rider's: a crew member on the SAME event with
    // only the schedule tier still cannot see the rider, so still cannot read it.
    const crew = await seedMemberWithSet(
      "rfile-crew",
      "performer",
      PRESET_PERMISSION_SETS.crew_schedule_only,
    );
    await db.insert(schema.eventParticipants).values({
      eventId: event.id,
      profileId: crew.profileId,
      role: "crew",
      permissionSetId: crew.permissionSetId,
      status: "confirmed",
    });
    expect((await downloadAs("rfile-crew")).statusCode).toBe(404);
  });

  it("404s the profile library for a stranger to the profile (no leak)", async () => {
    const owner = await seedMemberWithSet("r-owner", "performer", PRESET_PERMISSION_SETS.performer);
    await seedMemberWithSet("r-stranger", "performer", PRESET_PERMISSION_SETS.performer);

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/profiles/${owner.profileId}/riders`,
      headers: auth("r-stranger"),
    });
    expect(response.statusCode).toBe(404);
  });

  it("removes an event instance (owner participant only)", async () => {
    const operator = await seedMemberWithSet(
      "rd-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const performer = await seedMemberWithSet(
      "rd-perf",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );
    const { event } = await seedEvent(
      operator,
      [
        { ...operator, role: "host" },
        { ...performer, role: "performer" },
      ],
      "rd-op",
    );

    const lib = await app.inject({
      method: "POST",
      url: `/api/v1/profiles/${performer.profileId}/riders`,
      headers: auth("rd-perf"),
      payload: { type: "hospitality", name: "Green Room" },
    });
    const attached = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/riders`,
      headers: auth("rd-perf"),
      payload: { sourceRiderId: lib.json().id },
    });
    const instanceId = attached.json().id;

    const removed = await app.inject({
      method: "DELETE",
      url: `/api/v1/events/${event.id}/riders/${instanceId}`,
      headers: auth("rd-perf"),
    });
    expect(removed.statusCode).toBe(204);

    const after = await app.inject({
      method: "GET",
      url: `/api/v1/events/${event.id}/riders`,
      headers: auth("rd-perf"),
    });
    expect(after.json()).toHaveLength(0);
  });
});


/**
 * The capability now says what was already true.
 *
 * `scopedEventRiders` has always returned every rider on an event to an
 * operator — it just decided that by reading `budget.view` as a proxy for "is an
 * operator", because `operator_full` did not carry `rider.view`. The gap was
 * invisible until something asked the honest question: the share dialog checked
 * whether the sharer held `rider.view`, so an operator could never put a rider
 * on a share link, on any event.
 *
 * Scope is unchanged and already covered by the read-scoping tests above — this
 * pins only the half that was missing.
 */
describe("rider.view — an operator holds the capability for the reach it already had", () => {
  it("is in the operator preset", () => {
    expect(PRESET_PERMISSION_SETS.operator_full).toContain("rider.view");
  });
});
