import { PRESET_PERMISSION_SETS } from "@showme/auth";
import { schema } from "@showme/db";
import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TokenVerifier } from "./auth/token-verifier";
import {
  type EventThreadGraph,
  partyThreadRecipientUserIds,
  threadReaderParticipantIds,
  visibleThreads,
} from "./lib/message-threads";
import { messageRecipients } from "./lib/notify";
import { messageRoutes } from "./routes/messages";
import { buildTestApp } from "./testing";

/** Fake verifier: the bearer token IS the uid, so tests just send `Bearer <uid>`. */
const fakeVerifier: TokenVerifier = {
  async verify(token: string) {
    return { uid: token, email: `${token}@example.showme.test`, name: token };
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
  kind: "operator" | "performer" | "team_and_crew" | "agent",
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

// ── Threads ───────────────────────────────────────────────────────────────
//
// The rule under test is "who is in which thread". It is a pure function over the
// participation graph, so the first block drives it directly with no database at
// all — the negatives (a performer must NOT reach another performer's thread; an
// agent must NOT reach a performer they do not represent) are the point, and they
// are cheapest and clearest to state here. The blocks after it prove the same
// negatives survive the whole route stack.

const node = (
  id: string,
  role: "host" | "co_host" | "performer" | "support" | "crew" | "crew_lead" | "agent",
  overrides: { profileId?: string; sponsorParticipantId?: string | null } = {},
) => ({
  id,
  profileId: overrides.profileId ?? `${id}-profile`,
  profileName: id,
  role,
  sponsorParticipantId: overrides.sponsorParticipantId ?? null,
});

describe("message threads — the membership rule", () => {
  const graph: EventThreadGraph = {
    participants: [
      node("host", "host"),
      node("cohost", "co_host"),
      node("marlo", "performer"),
      node("neon", "performer"),
      node("priya", "crew"), // booked by the operator: no sponsor stamp
      node("subhire", "crew", { sponsorParticipantId: "marlo" }), // Marlo's own crew
      node("astra", "agent"),
    ],
    // Astra represents Marlo, and only Marlo.
    delegations: [{ agentProfileId: "astra-profile", performerProfileId: "marlo-profile" }],
  };

  it("puts the operators — all of them — on the other side of a booked performer", () => {
    // decisions #4: co-operators are transparent to each other, so the co-host is
    // in with the host rather than needing a thread of their own.
    expect([...threadReaderParticipantIds(graph, "neon")].sort()).toEqual([
      "cohost",
      "host",
      "neon",
    ]);
  });

  it("does NOT put one performer in another performer's thread", () => {
    expect(threadReaderParticipantIds(graph, "neon").has("marlo")).toBe(false);
    expect(threadReaderParticipantIds(graph, "marlo").has("neon")).toBe(false);
  });

  it("puts an agent in the thread of the performer they represent, and only that one", () => {
    // decisions #14 / the authorization skill's INVARIANT: the agent participation
    // is the projection of a representation, resolved per represented performer —
    // never a blanket event-level grant.
    expect(threadReaderParticipantIds(graph, "marlo").has("astra")).toBe(true);
    expect(threadReaderParticipantIds(graph, "neon").has("astra")).toBe(false);
  });

  it("drops the agent the moment the representation stops backing them", () => {
    // No sweep has run — the participant row is untouched. Only `delegations` is
    // empty, which is what `liveEventDelegations` returns past the effective
    // moment. Access ends there, past messages included.
    const lapsed: EventThreadGraph = { ...graph, delegations: [] };
    expect(threadReaderParticipantIds(lapsed, "marlo").has("astra")).toBe(false);
  });

  it("keeps a performer's sub-hire OFF the operator's screen", () => {
    // decisions #4: "a performer's private sub-hire (performer↔crew) is invisible
    // to the operator (not a party)". The old `party` visibility — operators plus
    // the sender — put exactly this conversation in front of the host.
    const readers = threadReaderParticipantIds(graph, "subhire");
    expect([...readers].sort()).toEqual(["marlo", "subhire"]);
    expect(readers.has("host")).toBe(false);
    expect(readers.has("cohost")).toBe(false);
  });

  it("does not recurse the sponsor chain — the lead's own counterparty stays out", () => {
    const chained: EventThreadGraph = {
      participants: [
        node("host", "host"),
        node("lead", "crew_lead"),
        node("hand", "crew", { sponsorParticipantId: "lead" }),
      ],
      delegations: [],
    };
    expect([...threadReaderParticipantIds(chained, "hand")].sort()).toEqual(["hand", "lead"]);
  });

  it("gives an operator and an agent no thread of their own", () => {
    // An operator IS the other side; an agent holds no slice of the event.
    expect(threadReaderParticipantIds(graph, "host").size).toBe(0);
    expect(threadReaderParticipantIds(graph, "astra").size).toBe(0);
  });

  it("shows each caller only the threads they stand in", () => {
    const keys = (participantIds: string[], isOperator: boolean) =>
      visibleThreads(graph, participantIds, isOperator)
        .map((thread) => thread.key)
        .sort();

    expect(keys(["host"], true)).toEqual([
      "all",
      "operators",
      "party:marlo",
      "party:neon",
      "party:priya",
    ]);
    // Marlo's sub-hire is hers; the operator never listed it above.
    expect(keys(["marlo"], false)).toEqual(["all", "party:marlo", "party:subhire"]);
    expect(keys(["neon"], false)).toEqual(["all", "party:neon"]);
    expect(keys(["priya"], false)).toEqual(["all", "party:priya"]);
    // The agent stands on Marlo's own edge only — not on the one between Marlo and
    // the engineer she sub-hired. A booking agent is not a manager (story.md).
    expect(keys(["astra"], false)).toEqual(["all", "party:marlo"]);
  });

  it("keeps the agent out of their performer's own sub-hire thread", () => {
    expect(threadReaderParticipantIds(graph, "subhire").has("astra")).toBe(false);
  });

  it("never offers the back office to anyone but a managing operator", () => {
    expect(keysOf(visibleThreads(graph, ["marlo"], false))).not.toContain("operators");
    expect(keysOf(visibleThreads(graph, ["astra"], false))).not.toContain("operators");
    expect(keysOf(visibleThreads(graph, ["priya"], false))).not.toContain("operators");
  });
});

const keysOf = (threads: { key: string }[]) => threads.map((thread) => thread.key);

/** The seeded event above, in Postgres: host, two performers, crew, agent. */
async function seedThreadedEvent(prefix: string) {
  const { db } = harness;
  const base = await seedEventWithParticipants(prefix);

  const other = await seedMemberWithSet(
    `${prefix}-other`,
    "performer",
    PRESET_PERMISSION_SETS.performer,
  );
  const [otherParticipant] = await db
    .insert(schema.eventParticipants)
    .values({
      eventId: base.event.id,
      profileId: other.profileId,
      role: "performer",
      permissionSetId: other.permissionSetId,
      status: "confirmed",
    })
    .returning();
  if (!otherParticipant) throw new Error("second performer seed failed");

  const agent = await seedMemberWithSet(`${prefix}-agent`, "agent", PRESET_PERMISSION_SETS.agent);
  const [agentParticipant] = await db
    .insert(schema.eventParticipants)
    .values({
      eventId: base.event.id,
      profileId: agent.profileId,
      role: "agent",
      permissionSetId: agent.permissionSetId,
      status: "confirmed",
    })
    .returning();
  if (!agentParticipant) throw new Error("agent participant seed failed");

  // The representation is what makes the agent row mean anything — a delegation
  // stamp with no agreement behind it is a state the app cannot produce, and a
  // fixture that invents one asserts against fiction (verify-e2e, "probes that lie").
  const [representation] = await db
    .insert(schema.representations)
    .values({
      agentProfileId: agent.profileId,
      performerProfileId: base.performer.profileId,
      isWorldwide: true,
      commissionRate: 1000,
      proposedBy: "agent",
      status: "active",
      startsAt: new Date(Date.now() - 86_400_000),
      confirmedByAgent: true,
      confirmedByPerformer: true,
    })
    .returning();
  if (!representation) throw new Error("representation seed failed");

  await db
    .update(schema.eventParticipants)
    .set({ details: { delegatedToAgentProfileId: agent.profileId } })
    .where(eq(schema.eventParticipants.id, base.performerParticipant.id));

  return { ...base, other, otherParticipant, agent, agentParticipant, representation };
}

const threadKeys = async (eventId: string, uid: string) => {
  const response = await app.inject({
    method: "GET",
    url: `/api/v1/events/${eventId}/message-threads`,
    headers: auth(uid),
  });
  expect(response.statusCode).toBe(200);
  return (response.json().items as { key: string }[]).map((thread) => thread.key).sort();
};

describe("message threads — over the routes", () => {
  it("lists each account exactly the threads it stands in", async () => {
    const seed = await seedThreadedEvent("thr-list");

    expect(await threadKeys(seed.event.id, "thr-list-op")).toEqual(
      [
        "all",
        "operators",
        `party:${seed.performerParticipant.id}`,
        `party:${seed.otherParticipant.id}`,
      ].sort(),
    );
    expect(await threadKeys(seed.event.id, "thr-list-perf")).toEqual([
      "all",
      `party:${seed.performerParticipant.id}`,
    ]);
    expect(await threadKeys(seed.event.id, "thr-list-other")).toEqual([
      "all",
      `party:${seed.otherParticipant.id}`,
    ]);
    // The agent stands where their performer stands — and nowhere else.
    expect(await threadKeys(seed.event.id, "thr-list-agent")).toEqual([
      "all",
      `party:${seed.performerParticipant.id}`,
    ]);
  });

  it("names every reader of a thread, so nothing looks private that is not", async () => {
    const seed = await seedThreadedEvent("thr-readers");
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/events/${seed.event.id}/message-threads`,
      headers: auth("thr-readers-perf"),
    });
    const mine = (response.json().items as { key: string; readers: { role: string }[] }[]).find(
      (thread) => thread.key === `party:${seed.performerParticipant.id}`,
    );
    expect(mine?.readers.map((reader) => reader.role).sort()).toEqual([
      "agent",
      "host",
      "performer",
    ]);
  });

  it("refuses to deliver one performer's thread to another performer", async () => {
    const seed = await seedThreadedEvent("thr-cross");

    const posted = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/messages`,
      headers: auth("thr-cross-op"),
      payload: {
        body: "Your load-in moved to 16:00",
        visibility: "party",
        threadParticipantId: seed.performerParticipant.id,
      },
    });
    expect(posted.statusCode).toBe(201);
    expect(posted.json().threadKey).toBe(`party:${seed.performerParticipant.id}`);

    // The addressed performer reads it.
    const mine = await app.inject({
      method: "GET",
      url: `/api/v1/events/${seed.event.id}/messages`,
      headers: auth("thr-cross-perf"),
    });
    expect(mine.json().map((row: { body: string }) => row.body)).toEqual([
      "Your load-in moved to 16:00",
    ]);

    // The OTHER performer gets nothing — not a redacted row, nothing.
    const theirs = await app.inject({
      method: "GET",
      url: `/api/v1/events/${seed.event.id}/messages`,
      headers: auth("thr-cross-other"),
    });
    expect(theirs.json()).toEqual([]);

    // And cannot address it either: not-in-the-thread is a 404, not a 403 —
    // learning the thread exists is already learning too much.
    const intrusion = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/messages`,
      headers: auth("thr-cross-other"),
      payload: {
        body: "who is this",
        visibility: "party",
        threadParticipantId: seed.performerParticipant.id,
      },
    });
    expect(intrusion.statusCode).toBe(404);
    expect(intrusion.json().error.message).toBe("Thread not found");
  });

  it("lets the agent read and post in their performer's thread — then not, once it lapses", async () => {
    const { db } = harness;
    const seed = await seedThreadedEvent("thr-agent");

    const posted = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/messages`,
      headers: auth("thr-agent-agent"),
      payload: {
        body: "Marlo confirms the 20:00 slot",
        visibility: "party",
        threadParticipantId: seed.performerParticipant.id,
      },
    });
    expect(posted.statusCode).toBe(201);

    // The agent is an outsider on the other performer's thread, same event.
    const wrongThread = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/messages`,
      headers: auth("thr-agent-agent"),
      payload: {
        body: "and about Neon Tide…",
        visibility: "party",
        threadParticipantId: seed.otherParticipant.id,
      },
    });
    expect(wrongThread.statusCode).toBe(404);

    // Terminate, effective a minute ago, and DO NOT run the sweep: the delegation
    // stamp is still on the participant row. Reads must be right anyway.
    await db
      .update(schema.representations)
      .set({
        terminatedEffectiveAt: new Date(Date.now() - 60_000),
        terminatedBy: "thr-agent-perf",
      })
      .where(eq(schema.representations.id, seed.representation.id));

    // The agent row no longer represents anyone here, so it grants nothing at all —
    // not even `event.view`. The event is 404, and with it the thread and its history.
    const afterList = await app.inject({
      method: "GET",
      url: `/api/v1/events/${seed.event.id}/messages`,
      headers: auth("thr-agent-agent"),
    });
    expect(afterList.statusCode).toBe(404);

    // And in the same instant the performer has her own thread back, with the
    // agent's message still in it — the record stands, the access ended.
    const performerList = await app.inject({
      method: "GET",
      url: `/api/v1/events/${seed.event.id}/messages`,
      headers: auth("thr-agent-perf"),
    });
    expect(performerList.statusCode).toBe(200);
    expect(performerList.json().map((row: { body: string }) => row.body)).toEqual([
      "Marlo confirms the 20:00 slot",
    ]);
    expect(await threadKeys(seed.event.id, "thr-agent-perf")).toEqual([
      "all",
      `party:${seed.performerParticipant.id}`,
    ]);
  });

  it("keeps a performer's sub-hire crew thread away from the operator", async () => {
    const { db } = harness;
    const seed = await seedEventWithParticipants("thr-sub");
    const crew = await seedMemberWithSet("thr-sub-crew", "team_and_crew", [
      ...PRESET_PERMISSION_SETS.crew_technical,
      "message.post",
    ]);
    const [crewParticipant] = await db
      .insert(schema.eventParticipants)
      .values({
        eventId: seed.event.id,
        profileId: crew.profileId,
        role: "crew",
        permissionSetId: crew.permissionSetId,
        status: "confirmed",
        // Brought by the performer, not the operator (decisions #12).
        details: { sponsorParticipantId: seed.performerParticipant.id },
      })
      .returning();
    if (!crewParticipant) throw new Error("crew participant seed failed");

    const posted = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/messages`,
      headers: auth("thr-sub-crew"),
      payload: {
        body: "Bringing my own desk, fee as agreed",
        visibility: "party",
        threadParticipantId: crewParticipant.id,
      },
    });
    expect(posted.statusCode).toBe(201);

    // The performer who hired them reads it.
    const performerList = await app.inject({
      method: "GET",
      url: `/api/v1/events/${seed.event.id}/messages`,
      headers: auth("thr-sub-perf"),
    });
    expect(performerList.json().map((row: { body: string }) => row.body)).toEqual([
      "Bringing my own desk, fee as agreed",
    ]);

    // The operator does not — and the thread is not even listed to them.
    const operatorList = await app.inject({
      method: "GET",
      url: `/api/v1/events/${seed.event.id}/messages`,
      headers: auth("thr-sub-op"),
    });
    expect(operatorList.json()).toEqual([]);
    expect(await threadKeys(seed.event.id, "thr-sub-op")).not.toContain(
      `party:${crewParticipant.id}`,
    );
  });

  it("refuses a non-operator writing into the back office", async () => {
    const seed = await seedEventWithParticipants("thr-backoffice");
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/messages`,
      headers: auth("thr-backoffice-perf"),
      payload: { body: "let me in", visibility: "operators" },
    });
    // Posting into a room you cannot read is not a feature.
    expect(response.statusCode).toBe(403);
    expect(response.json().error.message).toBe("Missing capability: budget.view");
  });

  it("filters the flat list to one thread on request, and keeps it flat by default", async () => {
    const seed = await seedThreadedEvent("thr-filter");
    for (const [body, threadParticipantId] of [
      ["room", null],
      ["for marlo", seed.performerParticipant.id],
      ["for neon", seed.otherParticipant.id],
    ] as const) {
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/events/${seed.event.id}/messages`,
        headers: auth("thr-filter-op"),
        payload: threadParticipantId
          ? { body, visibility: "party", threadParticipantId }
          : { body, visibility: "all" },
      });
      expect(response.statusCode).toBe(201);
    }

    // A caller that predates threads still gets one flat array of everything it
    // may read — the contract did not break, it grew two fields.
    const unfiltered = await app.inject({
      method: "GET",
      url: `/api/v1/events/${seed.event.id}/messages`,
      headers: auth("thr-filter-op"),
    });
    expect(unfiltered.json().map((row: { body: string }) => row.body)).toEqual([
      "room",
      "for marlo",
      "for neon",
    ]);

    const filtered = await app.inject({
      method: "GET",
      url: `/api/v1/events/${seed.event.id}/messages?threadKey=party:${seed.performerParticipant.id}`,
      headers: auth("thr-filter-op"),
    });
    expect(filtered.json().map((row: { body: string }) => row.body)).toEqual(["for marlo"]);
  });

  it("defaults an unaddressed party post to the sender's own thread", async () => {
    const seed = await seedEventWithParticipants("thr-default");
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/events/${seed.event.id}/messages`,
      headers: auth("thr-default-perf"),
      payload: { body: "no thread named", visibility: "party" },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().threadParticipantId).toBe(seed.performerParticipant.id);
  });
});

describe("message threads — realtime recipients", () => {
  // The nudge carries ids only, never the body, so the recipient set IS the privacy
  // boundary. Telling the host that a private sub-hire conversation is happening is
  // the exact leak threads exist to close.
  it("nudges a party thread's readers and nobody else", async () => {
    const seed = await seedThreadedEvent("thr-rt");

    const recipients = await partyThreadRecipientUserIds(
      harness.db,
      seed.event.id,
      "thr-rt-op",
      seed.performerParticipant.id,
    );

    expect(recipients).toEqual(["thr-rt-agent", "thr-rt-perf"]);
    expect(recipients).not.toContain("thr-rt-other");
  });

  it("does not nudge the operator about a sub-hire thread", async () => {
    const { db } = harness;
    const seed = await seedEventWithParticipants("thr-rt-sub");
    const crew = await seedMemberWithSet(
      "thr-rt-sub-crew",
      "team_and_crew",
      PRESET_PERMISSION_SETS.crew_technical,
    );
    const [crewParticipant] = await db
      .insert(schema.eventParticipants)
      .values({
        eventId: seed.event.id,
        profileId: crew.profileId,
        role: "crew",
        permissionSetId: crew.permissionSetId,
        status: "confirmed",
        details: { sponsorParticipantId: seed.performerParticipant.id },
      })
      .returning();
    if (!crewParticipant) throw new Error("crew participant seed failed");

    const recipients = await partyThreadRecipientUserIds(
      db,
      seed.event.id,
      "thr-rt-sub-crew",
      crewParticipant.id,
    );

    expect(recipients).toEqual(["thr-rt-sub-perf"]);
    expect(recipients).not.toContain("thr-rt-sub-op");
  });
});
