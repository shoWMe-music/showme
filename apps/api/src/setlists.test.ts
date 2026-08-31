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
    return { uid: token, email: `${token}@example.showme.test`, name: token };
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

type AccountKind = "operator" | "performer" | "team_and_crew" | "agent";
type ParticipantRole = "host" | "co_host" | "performer" | "support" | "crew" | "agent";

async function seedMemberWithSet(id: string, kind: AccountKind, capabilities: readonly string[]) {
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

async function seedEvent(
  operator: { profileId: string; permissionSetId: string },
  participants: {
    profileId: string;
    permissionSetId: string;
    role: ParticipantRole;
    /** `{ delegatedToAgentProfileId }` marks a performer represented by an agent. */
    details?: Record<string, unknown>;
  }[],
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
        details: participant.details,
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

describe("setlists — only the ACT authors (A-23)", () => {
  it("refuses crew and agent, admits the performer and a DELEGATED performer", async () => {
    const operator = await seedMemberWithSet(
      "s3-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const performer = await seedMemberWithSet(
      "s3-perf",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );
    const crew = await seedMemberWithSet(
      "s3-crew",
      "team_and_crew",
      PRESET_PERMISSION_SETS.crew_schedule_only,
    );
    const agent = await seedMemberWithSet("s3-agent", "agent", PRESET_PERMISSION_SETS.agent);
    // A performer who handed BUSINESS authority to that agent — artistic content stays.
    const delegated = await seedMemberWithSet(
      "s3-del",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );

    const { event } = await seedEvent(
      operator,
      [
        { ...operator, role: "host" },
        { ...performer, role: "performer" },
        { ...crew, role: "crew" },
        { ...agent, role: "agent" },
        {
          ...delegated,
          role: "performer",
          details: { delegatedToAgentProfileId: agent.profileId },
        },
      ],
      "s3-op",
    );
    // The standing agreement behind the delegation stamp — the capability engine
    // resolves against it, so the fixture needs it to model a real delegation.
    await harness.db.insert(schema.representations).values({
      agentProfileId: agent.profileId,
      performerProfileId: delegated.profileId,
      isWorldwide: true,
      commissionRate: 1000,
      commissionableBasis: "deal_income",
      proposedBy: "agent",
      status: "active",
      confirmedByAgent: true,
      confirmedByPerformer: true,
    });

    const put = (uid: string) =>
      app.inject({
        method: "PUT",
        url: `/api/v1/events/${event.id}/setlists`,
        headers: auth(uid),
        payload: { items: [{ title: "Song" }] },
      });

    // Crew: schedule.view is not authorship. The setlist is not their run-of-show.
    const asCrew = await put("s3-crew");
    expect(asCrew.statusCode).toBe(403);
    expect(asCrew.json().error.message).toContain("setlist.author");

    // Agent: business authority, never the songs (story.md's boundary).
    const asAgent = await put("s3-agent");
    expect(asAgent.statusCode).toBe(403);

    // The operator CONSUMES the setlist (PRO report) but never writes one.
    const asOperator = await put("s3-op");
    expect(asOperator.statusCode).toBe(403);

    // The act itself — and the delegated act, whose artistry did not transfer.
    expect((await put("s3-perf")).statusCode).toBe(200);
    expect((await put("s3-del")).statusCode).toBe(200);

    // Only the two performer rows exist — nobody else got a setlist in.
    const stored = await harness.db
      .select()
      .from(schema.setlists)
      .where(eq(schema.setlists.eventId, event.id));
    expect(stored).toHaveLength(2);
  });
});

describe("setlist shares — the crew's only legitimate access", () => {
  it("a share grants a crew participant read; revoking takes it back", async () => {
    const operator = await seedMemberWithSet(
      "s4-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const performer = await seedMemberWithSet(
      "s4-perf",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );
    const crew = await seedMemberWithSet(
      "s4-crew",
      "team_and_crew",
      PRESET_PERMISSION_SETS.crew_technical,
    );
    const { event, participants } = await seedEvent(
      operator,
      [
        { ...operator, role: "host" },
        { ...performer, role: "performer" },
        { ...crew, role: "crew" },
      ],
      "s4-op",
    );
    const crewParticipant = participants.find((row) => row.profileId === crew.profileId);
    if (!crewParticipant) throw new Error("crew participant seed failed");

    const authored = await app.inject({
      method: "PUT",
      url: `/api/v1/events/${event.id}/setlists`,
      headers: auth("s4-perf"),
      payload: { items: [{ title: "Cue 1" }, { title: "Cue 2" }] },
    });
    expect(authored.statusCode).toBe(200);
    const setlistId = authored.json().id;

    const crewSetlists = () =>
      app.inject({
        method: "GET",
        url: `/api/v1/events/${event.id}/setlists`,
        headers: auth("s4-crew"),
      });

    // Before the share: party-scoped away.
    expect((await crewSetlists()).json()).toHaveLength(0);

    // Crew cannot grant themselves access — sharing is the author's act.
    const crewSelfShare = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/setlists/${setlistId}/shares`,
      headers: auth("s4-crew"),
      payload: { participantId: crewParticipant.id },
    });
    expect(crewSelfShare.statusCode).toBe(403);

    // The author shares it (the lighting operator on a cued show).
    const shared = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/setlists/${setlistId}/shares`,
      headers: auth("s4-perf"),
      payload: { participantId: crewParticipant.id },
    });
    expect(shared.statusCode).toBe(201);
    expect(shared.json().participantId).toBe(crewParticipant.id);

    // Idempotent — sharing twice does not blow up or duplicate.
    const again = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/setlists/${setlistId}/shares`,
      headers: auth("s4-perf"),
      payload: { participantId: crewParticipant.id },
    });
    expect(again.statusCode).toBe(201);
    expect(again.json().id).toBe(shared.json().id);

    // Now the crew participant reads it — read only; they still cannot author.
    const afterShare = await crewSetlists();
    expect(afterShare.json()).toHaveLength(1);
    expect(afterShare.json()[0].id).toBe(setlistId);
    expect(afterShare.json()[0].items).toHaveLength(2);
    const crewWrite = await app.inject({
      method: "PUT",
      url: `/api/v1/events/${event.id}/setlists`,
      headers: auth("s4-crew"),
      payload: { items: [{ title: "Not yours" }] },
    });
    expect(crewWrite.statusCode).toBe(403);

    // The author sees who holds the grant.
    const grants = await app.inject({
      method: "GET",
      url: `/api/v1/events/${event.id}/setlists/${setlistId}/shares`,
      headers: auth("s4-perf"),
    });
    expect(grants.statusCode).toBe(200);
    expect(grants.json()).toHaveLength(1);

    // Revoke — the access goes away.
    const revoked = await app.inject({
      method: "DELETE",
      url: `/api/v1/events/${event.id}/setlists/${setlistId}/shares/${crewParticipant.id}`,
      headers: auth("s4-perf"),
    });
    expect(revoked.statusCode).toBe(204);
    expect((await crewSetlists()).json()).toHaveLength(0);

    // Both sides of the grant are audited.
    const audit = await harness.db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, setlistId));
    const actions = audit.map((row) => row.action);
    expect(actions).toContain("setlist.share");
    expect(actions).toContain("setlist.unshare");
  });

  it("refuses a share to a participant on another event, and a share of someone else's setlist", async () => {
    const operator = await seedMemberWithSet(
      "s5-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const performerA = await seedMemberWithSet(
      "s5-pa",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );
    const performerB = await seedMemberWithSet(
      "s5-pb",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );
    const outsider = await seedMemberWithSet(
      "s5-out",
      "team_and_crew",
      PRESET_PERMISSION_SETS.crew_schedule_only,
    );

    const here = await seedEvent(
      operator,
      [
        { ...operator, role: "host" },
        { ...performerA, role: "performer" },
        { ...performerB, role: "performer" },
      ],
      "s5-op",
    );
    const elsewhere = await seedEvent(
      operator,
      [
        { ...operator, role: "host" },
        { ...outsider, role: "crew" },
      ],
      "s5-op",
    );
    const otherEventParticipant = elsewhere.participants.find(
      (row) => row.profileId === outsider.profileId,
    );
    if (!otherEventParticipant) throw new Error("other-event participant seed failed");

    const authored = await app.inject({
      method: "PUT",
      url: `/api/v1/events/${here.event.id}/setlists`,
      headers: auth("s5-pa"),
      payload: { items: [{ title: "Song" }] },
    });
    expect(authored.statusCode).toBe(200);
    const setlistId = authored.json().id;

    // A share is an event-scoped grant — a participant from another event is a 400.
    const crossEvent = await app.inject({
      method: "POST",
      url: `/api/v1/events/${here.event.id}/setlists/${setlistId}/shares`,
      headers: auth("s5-pa"),
      payload: { participantId: otherEventParticipant.id },
    });
    expect(crossEvent.statusCode).toBe(400);

    // Performer B holds `setlist.author` but did not author THIS setlist.
    const notMine = await app.inject({
      method: "POST",
      url: `/api/v1/events/${here.event.id}/setlists/${setlistId}/shares`,
      headers: auth("s5-pb"),
      payload: { participantId: otherEventParticipant.id },
    });
    expect(notMine.statusCode).toBe(403);
  });
});

/**
 * WHOSE CLAIM, AND ON WHAT GROUND (A-25).
 *
 * The operator's standing over an act's setlist is the FILING — decisions.md
 * "Setlists" puts the performed-works report on the operator, and
 * `performing-rights.ts` states the obligation it discharges ("an operator who
 * puts on a show owes the local PRO"). It is emphatically not the budget: a
 * co-promoter handed the money sheet has been told about the money, and story.md
 * is explicit that an operator's broad visibility is *emergent* from the
 * relationships they actually hold, never a see-everything grant.
 *
 * The list route used to read `budget.view` as a stand-in for "is an operator",
 * the same proxy `rider.view` was fixed for in `presets.ts`. Here that proxy let
 * a purely financial grant read the songs.
 */
describe("setlists — the operator's claim is the FILING, not the budget", () => {
  it("a host holding budget.view but not performance_report.file sees no act's setlist", async () => {
    const operator = await seedMemberWithSet(
      "s6-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    // A co-promoter given the money sheet and nothing else: every pool capability
    // the ceiling allows a `co_host`, minus the filing.
    const moneyOnly = await seedMemberWithSet("s6-money", "operator", [
      "event.view",
      "budget.view",
      "budget.edit",
      "revenue.edit",
    ]);
    const performer = await seedMemberWithSet(
      "s6-perf",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );
    const { event } = await seedEvent(
      operator,
      [
        { ...operator, role: "host" },
        { ...moneyOnly, role: "co_host" },
        { ...performer, role: "performer" },
      ],
      "s6-op",
    );

    const authored = await app.inject({
      method: "PUT",
      url: `/api/v1/events/${event.id}/setlists`,
      headers: auth("s6-perf"),
      payload: { items: [{ title: "Neon Rooftops", duration: 245 }] },
    });
    expect(authored.statusCode).toBe(200);

    // The filing operator reads it — that is what the capability is for.
    const asFiler = await app.inject({
      method: "GET",
      url: `/api/v1/events/${event.id}/setlists`,
      headers: auth("s6-op"),
    });
    expect(asFiler.statusCode).toBe(200);
    expect(asFiler.json()).toHaveLength(1);

    // The co-promoter who only sees the money does not. Seeing the pool is not a
    // claim on the act's songs.
    const asMoneyOnly = await app.inject({
      method: "GET",
      url: `/api/v1/events/${event.id}/setlists`,
      headers: auth("s6-money"),
    });
    expect(asMoneyOnly.statusCode).toBe(200);
    expect(asMoneyOnly.json()).toHaveLength(0);
  });

  it("names the act on every row and marks the caller's own", async () => {
    const operator = await seedMemberWithSet(
      "s7-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const headliner = await seedMemberWithSet(
      "s7-head",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );
    const support = await seedMemberWithSet(
      "s7-supp",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );
    const { event } = await seedEvent(
      operator,
      [
        { ...operator, role: "host" },
        { ...headliner, role: "performer" },
        { ...support, role: "support" },
      ],
      "s7-op",
    );

    for (const uid of ["s7-head", "s7-supp"]) {
      const put = await app.inject({
        method: "PUT",
        url: `/api/v1/events/${event.id}/setlists`,
        headers: auth(uid),
        payload: { items: [{ title: `${uid} opener`, duration: 200 }] },
      });
      expect(put.statusCode).toBe(200);
      // The author's own row says so, so a screen never has to guess which of
      // the rows it may edit.
      expect(put.json().mine).toBe(true);
      expect(put.json().performerName).toBe(uid);
    }

    // The operator gets both, each naming the act that played it — the same join
    // the performed-works report makes, so a support slot's songs are never
    // filed under the headliner.
    const asOperator = await app.inject({
      method: "GET",
      url: `/api/v1/events/${event.id}/setlists`,
      headers: auth("s7-op"),
    });
    expect(asOperator.statusCode).toBe(200);
    expect(asOperator.json().map((row: { performerName: string }) => row.performerName)).toEqual([
      "s7-head",
      "s7-supp",
    ]);
    expect(asOperator.json().every((row: { mine: boolean }) => row.mine === false)).toBe(true);

    // …and the headliner sees exactly one row, flagged as theirs.
    const asHeadliner = await app.inject({
      method: "GET",
      url: `/api/v1/events/${event.id}/setlists`,
      headers: auth("s7-head"),
    });
    expect(asHeadliner.json()).toHaveLength(1);
    expect(asHeadliner.json()[0].mine).toBe(true);
    expect(asHeadliner.json()[0].performerName).toBe("s7-head");
  });
});

/**
 * The setlist is attached to the participant row that IS the act.
 *
 * One user can stand behind several participants on one event — a promoter who
 * also plays keeps both an operator profile and a performer profile, and the
 * capability engine unions across every row they reach. The upsert used to take
 * whichever row the database happened to return first, so the songs could land
 * on the HOST participant. Nothing rejects that write, and the damage is silent:
 * `performance-reports.ts` names each set by joining the participant to its
 * profile, so the act's songs would be filed with a society under the venue's
 * name.
 */
describe("setlists — the row the songs are attached to", () => {
  it("attaches to the performing participant when the author is also the host", async () => {
    const operator = await seedMemberWithSet(
      "s8-op",
      "operator",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const performer = await seedMemberWithSet(
      "s8-perf",
      "performer",
      PRESET_PERMISSION_SETS.performer,
    );
    // The same human runs the night and plays it: an admin on the operator
    // profile as well as the owner of their own act.
    await harness.db.insert(schema.profileMembers).values({
      profileId: operator.profileId,
      userId: "s8-perf",
      role: "admin",
      status: "active",
    });

    const { event, participants } = await seedEvent(
      operator,
      [
        { ...operator, role: "host" },
        { ...performer, role: "performer" },
      ],
      "s8-op",
    );
    const performingParticipant = participants.find((row) => row.profileId === performer.profileId);
    if (!performingParticipant) throw new Error("participant seed failed");

    const put = await app.inject({
      method: "PUT",
      url: `/api/v1/events/${event.id}/setlists`,
      headers: auth("s8-perf"),
      payload: { items: [{ title: "Ember", duration: 312 }] },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().participantId).toBe(performingParticipant.id);
    expect(put.json().performerName).toBe("s8-perf");
  });
});
