import { PRESET_PERMISSION_SETS } from "@showme/auth";
import { schema } from "@showme/db";
import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TokenVerifier } from "./auth/token-verifier";
import { settlementRoutes } from "./routes/settlement";
import { buildTestApp, signEveryAgreement } from "./testing";

/**
 * TWO ROUTES, ONE SETTLEMENT, TWO ANSWERS (QA sweep run 3, r3:619 + r3:153).
 *
 * Measured on the running stack 2026-09-27, one co-promoter and one settlement:
 *
 *     GET /settlements                     → 200, entitlement 1000000
 *     GET /events/<that event>/settlements → 403 Missing capability: settlement.view.own
 *
 * The global list's access rule is its own joins — memberships → participant rows —
 * and it asks no capability. The event-scoped read asks for `settlement.view.own`,
 * which a co-promoter invited the way the dialog invites one (a role, and "Standard
 * for the role", which deliberately attaches NO permission set) did not have: the
 * `host`/`co_host` floor was `event.view` alone. The party who had been paid got a
 * blank Settlement tab, and the promise printed in the invite dialog — *"the event,
 * their schedule, and their own money"* — was two-thirds false.
 *
 * Fixed at the floor (`OPERATOR_FLOOR`), not at the route, so the two routes now
 * agree by construction: every standing participant's role guarantees them
 * `settlement.view.own`, and a capability nobody can be stripped of cannot be the
 * reason one route answers differently from the other.
 *
 * Both directions are checked here, because the fix moved both ends: a standing party
 * reads their own row on the event, and a party with no standing at all — still
 * `invited` — is no longer handed money from an event they cannot even open.
 */
const fakeVerifier: TokenVerifier = {
  async verify(token: string) {
    return { uid: token, email: `${token}@example.showme.test`, name: token };
  },
};

let harness: TestDatabase;
let app: FastifyInstance;

beforeAll(async () => {
  harness = await startTestDatabase();
  app = buildTestApp({ database: harness.db, tokenVerifier: fakeVerifier }, [settlementRoutes]);
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await harness?.stop();
});

const auth = (userId: string) => ({ authorization: `Bearer ${userId}` });

/** An operator profile whose owner is its only member. */
async function seedOperator(prefix: string, name: string, capabilities: readonly string[]) {
  const { db } = harness;
  const userId = `${prefix}-user`;
  await db
    .insert(schema.users)
    .values({ id: userId, email: `${userId}@x.showme.test`, kind: "operator" });
  const [profile] = await db
    .insert(schema.profiles)
    .values({ kind: "operator", ownerUserId: userId, name, slug: `${prefix}-slug` })
    .returning();
  if (!profile) throw new Error("profile seed failed");
  await db
    .insert(schema.profileMembers)
    .values({ profileId: profile.id, userId, role: "owner", status: "active" });
  if (capabilities.length === 0) return { userId, profileId: profile.id, permissionSetId: null };
  const [set] = await db
    .insert(schema.permissionSets)
    .values({ profileId: profile.id, name: "set", capabilities: [...capabilities] })
    .returning();
  return { userId, profileId: profile.id, permissionSetId: set?.id ?? null };
}

/** A crew profile whose owner is its only member — the seat with the thin floor. */
async function seedCrew(prefix: string, name: string) {
  const { db } = harness;
  const userId = `${prefix}-user`;
  await db
    .insert(schema.users)
    .values({ id: userId, email: `${userId}@x.showme.test`, kind: "team_and_crew" });
  const [profile] = await db
    .insert(schema.profiles)
    .values({ kind: "team_and_crew", ownerUserId: userId, name, slug: `${prefix}-slug` })
    .returning();
  if (!profile) throw new Error("profile seed failed");
  await db
    .insert(schema.profileMembers)
    .values({ profileId: profile.id, userId, role: "owner", status: "active" });
  return { userId, profileId: profile.id };
}

/**
 * A night with a door the host collects and a co-promoter on it — so `reconcile`
 * allocates the residual across both operators and writes the co-promoter a row.
 */
async function seedCoPromotedNight(prefix: string, coHostStatus: "accepted" | "invited") {
  const host = await seedOperator(`${prefix}-host`, "Host", PRESET_PERMISSION_SETS.operator_full);
  // The co-promoter as the invite dialog leaves them: a ROLE, and no permission set.
  const coHost = await seedOperator(`${prefix}-co`, "Co-promoter", []);
  const { event } = await seedNightFor(host, coHost, coHostStatus);
  return { event, host, coHost };
}

type SeededOperator = Awaited<ReturnType<typeof seedOperator>>;

/**
 * ANOTHER NIGHT FOR THE SAME TWO OPERATORS — split out because the question
 * "have *I* signed *this* line" only varies once one reader holds two of them.
 * A single-night fixture cannot tell "my own row's approval" from "any approval
 * this reader has given anywhere", and a mutation proved it: swapping the first
 * for the second survived until this existed.
 */
async function seedNightFor(
  host: SeededOperator,
  coHost: SeededOperator,
  coHostStatus: "accepted" | "invited",
) {
  const { db } = harness;

  const [event] = await db
    .insert(schema.events)
    .values({
      hostProfileId: host.profileId,
      title: "Co-promoted night",
      baseCurrency: "SEK",
      createdBy: host.userId,
    })
    .returning();
  if (!event) throw new Error("event seed failed");

  const parts = await db
    .insert(schema.eventParticipants)
    .values([
      {
        eventId: event.id,
        profileId: host.profileId,
        role: "host",
        permissionSetId: host.permissionSetId,
        status: "confirmed",
      },
      {
        eventId: event.id,
        profileId: coHost.profileId,
        role: "co_host",
        permissionSetId: null,
        status: coHostStatus,
      },
    ])
    .returning();
  const hostPart = parts.find((part) => part.profileId === host.profileId)?.id as string;

  const [budget] = await db.insert(schema.budgets).values({ eventId: event.id }).returning();
  if (!budget) throw new Error("budget seed failed");
  await db.insert(schema.budgetLines).values({
    budgetId: budget.id,
    kind: "revenue",
    label: "Door",
    amount: 2000000n,
    collectedBy: hostPart,
  });
  await signEveryAgreement(db, event.id);

  const computed = await app.inject({
    method: "POST",
    url: `/api/v1/events/${event.id}/settlement/compute`,
    headers: auth(host.userId),
  });
  expect(computed.statusCode).toBe(200);

  return { event };
}

describe("a settlement addressed to you is readable on its own event", () => {
  it("lets a co-promoter with no permission set read their own row", async () => {
    const night = await seedCoPromotedNight("own", "accepted");

    const list = await app.inject({
      method: "GET",
      url: "/api/v1/settlements",
      headers: auth(night.coHost.userId),
    });
    expect(list.statusCode).toBe(200);
    const listed = list.json().items;
    expect(listed).toHaveLength(1);
    expect(listed[0].entitlement).toBe("1000000");

    const scoped = await app.inject({
      method: "GET",
      url: `/api/v1/events/${night.event.id}/settlements`,
      headers: auth(night.coHost.userId),
    });
    expect(scoped.statusCode).toBe(200);
    const body = scoped.json();
    // Their own row, and only their own: the floor opens the route, never the roster.
    expect(body.settlements).toHaveLength(1);
    expect(body.settlements[0].computed.entitlement).toBe("1000000");
    // And nothing `budget.view` would have carried with it — the other half of the
    // dialog's sentence is "never the budget", and the pool is still refused.
    expect(body.ladder).toBeNull();
    expect(body.delivery).toEqual([]);
  });

  it("reads the review conversation on their own figure too", async () => {
    // The party being paid is the party most likely to have something to say about
    // the figure. Same gate, same floor — this is the request that also 403'd.
    const night = await seedCoPromotedNight("comments", "accepted");
    const comments = await app.inject({
      method: "GET",
      url: `/api/v1/events/${night.event.id}/settlement/comments`,
      headers: auth(night.coHost.userId),
    });
    expect(comments.statusCode).toBe(200);
    expect(comments.json()).toEqual([]);
  });
});

describe("a settlement is not listed to a party with no standing", () => {
  it("leaves an invited co-promoter's row out of their own list", async () => {
    const night = await seedCoPromotedNight("invited", "invited");

    // The row exists — `reconcile` allocates the residual across every operator
    // participant, and it does not ask who has answered their invitation.
    const rows = await harness.db
      .select()
      .from(schema.settlements)
      .where(eq(schema.settlements.eventId, night.event.id));
    expect(rows.length).toBeGreaterThan(1);

    const list = await app.inject({
      method: "GET",
      url: "/api/v1/settlements",
      headers: auth(night.coHost.userId),
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().items).toEqual([]);

    // Which agrees with the event itself: without standing there is no event to open.
    const scoped = await app.inject({
      method: "GET",
      url: `/api/v1/events/${night.event.id}/settlements`,
      headers: auth(night.coHost.userId),
    });
    expect(scoped.statusCode).toBe(404);
  });
});

describe("the list says whether YOU have signed your own line", () => {
  it("serves approvedByYou per reader, and a signature stays the signer's", async () => {
    const night = await seedCoPromotedNight("signed", "accepted");

    const sent = await app.inject({
      method: "POST",
      url: `/api/v1/events/${night.event.id}/settlement/status`,
      headers: auth(night.host.userId),
      payload: { status: "pending_review" },
    });
    expect(sent.statusCode).toBe(200);

    const listFor = async (userId: string) => {
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/settlements",
        headers: auth(userId),
      });
      expect(response.statusCode).toBe(200);
      return response.json().items as { id: string; status: string; approvedByYou: boolean }[];
    };

    // SENDING IT OUT MOVES EVERY PARTY, THE SENDER INCLUDED — which is exactly why
    // the status alone cannot answer "is somebody waiting on me". Both readers see
    // `pending_review`; neither has signed.
    const hostBefore = await listFor(night.host.userId);
    const coHostBefore = await listFor(night.coHost.userId);
    expect(hostBefore).toHaveLength(1);
    expect(coHostBefore).toHaveLength(1);
    expect(hostBefore[0]?.status).toBe("pending_review");
    expect(coHostBefore[0]?.status).toBe("pending_review");
    expect(hostBefore[0]?.approvedByYou).toBe(false);
    expect(coHostBefore[0]?.approvedByYou).toBe(false);

    const confirmed = await app.inject({
      method: "POST",
      url: `/api/v1/events/${night.event.id}/settlements/${coHostBefore[0]?.id}/confirm`,
      headers: auth(night.coHost.userId),
    });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json().approved).toBe(true);

    // The signer's own row flips.
    const coHostAfter = await listFor(night.coHost.userId);
    expect(coHostAfter[0]?.approvedByYou).toBe(true);

    // The host's own line is still unsigned, and the status is unchanged by one
    // signature — so nothing here was inferred from the status column.
    const hostAfter = await listFor(night.host.userId);
    expect(hostAfter[0]?.approvedByYou).toBe(false);
    expect(hostAfter[0]?.status).toBe("pending_review");
  });

  it("answers per ROW, not per reader — a second night stays unsigned", async () => {
    /*
     * THE CASE THAT MAKES THE FIELD MEAN ANYTHING, and it is only reachable with two.
     *
     * `GET /settlements` is reader-scoped: every row in it is already the caller's
     * own. So on a one-night fixture "did I approve THIS row" and "have I approved
     * ANYTHING" are the same sentence, and a mutation swapping one for the other
     * survived the test above. The defect it hides is a reader who signed last
     * month's night being told this month's is signed too — a signature claimed
     * where none was given.
     */
    const host = await seedOperator("two-host", "Host", PRESET_PERMISSION_SETS.operator_full);
    const coHost = await seedOperator("two-co", "Co-promoter", []);
    const first = await seedNightFor(host, coHost, "accepted");
    const second = await seedNightFor(host, coHost, "accepted");

    for (const night of [first, second]) {
      const sent = await app.inject({
        method: "POST",
        url: `/api/v1/events/${night.event.id}/settlement/status`,
        headers: auth(host.userId),
        payload: { status: "pending_review" },
      });
      expect(sent.statusCode).toBe(200);
    }

    const listed = await app.inject({
      method: "GET",
      url: "/api/v1/settlements",
      headers: auth(coHost.userId),
    });
    expect(listed.statusCode).toBe(200);
    const rows = listed.json().items as {
      id: string;
      approvedByYou: boolean;
      event: { id: string };
    }[];
    expect(rows).toHaveLength(2);

    const onFirst = rows.find((row) => row.event.id === first.event.id);
    const onSecond = rows.find((row) => row.event.id === second.event.id);
    if (!onFirst || !onSecond) throw new Error("both nights should be listed");

    const confirmed = await app.inject({
      method: "POST",
      url: `/api/v1/events/${first.event.id}/settlements/${onFirst.id}/confirm`,
      headers: auth(coHost.userId),
    });
    expect(confirmed.statusCode).toBe(200);

    const after = await app.inject({
      method: "GET",
      url: "/api/v1/settlements",
      headers: auth(coHost.userId),
    });
    const afterRows = after.json().items as { approvedByYou: boolean; event: { id: string } }[];
    expect(afterRows.find((row) => row.event.id === first.event.id)?.approvedByYou).toBe(true);
    // The one that matters: signing one night signs one night.
    expect(afterRows.find((row) => row.event.id === second.event.id)?.approvedByYou).toBe(false);
  });
});

describe("the list says whether you MAY sign it", () => {
  it("refuses the signature to crew, and the list says so instead of implying otherwise", async () => {
    /*
     * FOUND IN THE BROWSER, not reasoned out. `CREW_FLOOR` carries
     * `settlement.view.own` and deliberately not `settlement.confirm` — story.md's
     * crew boundary is *"the schedule and their own deal, never the budget"* — so a
     * crew member is shown their figures and has no control to sign them. Measured
     * as `professional@` on the running stack: POST …/confirm answered 403 while the
     * Dashboard's attention card was telling them to sign off.
     *
     * The route's refusal is the authority; `signableByYou` is that refusal made
     * readable, so no screen offers a signature the route will decline.
     */
    const host = await seedOperator("crewsign-host", "Host", PRESET_PERMISSION_SETS.operator_full);
    const coHost = await seedOperator("crewsign-co", "Co-promoter", []);
    const crew = await seedCrew("crewsign-crew", "Priya Sound");
    const { event } = await seedNightFor(host, coHost, "accepted");

    const [crewPart] = await harness.db
      .insert(schema.eventParticipants)
      .values({
        eventId: event.id,
        profileId: crew.profileId,
        role: "crew",
        permissionSetId: null,
        status: "confirmed",
      })
      .returning();
    if (!crewPart) throw new Error("crew participant seed failed");

    const recomputed = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/settlement/compute`,
      headers: auth(host.userId),
    });
    expect(recomputed.statusCode).toBe(200);
    const sent = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/settlement/status`,
      headers: auth(host.userId),
      payload: { status: "pending_review" },
    });
    expect(sent.statusCode).toBe(200);

    const crewList = await app.inject({
      method: "GET",
      url: "/api/v1/settlements",
      headers: auth(crew.userId),
    });
    expect(crewList.statusCode).toBe(200);
    const crewRows = crewList.json().items as {
      id: string;
      status: string;
      signableByYou: boolean;
      approvedByYou: boolean;
    }[];
    expect(crewRows).toHaveLength(1);
    // They can READ it — that is the whole reason the row is in the list at all.
    expect(crewRows[0]?.status).toBe("pending_review");
    expect(crewRows[0]?.signableByYou).toBe(false);
    expect(crewRows[0]?.approvedByYou).toBe(false);

    // And the field is not a guess: the route it describes refuses them, for the
    // capability the field is reporting.
    const refused = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/settlements/${crewRows[0]?.id}/confirm`,
      headers: auth(crew.userId),
    });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error.message).toContain("settlement.confirm");

    // THE CONTROL: on the same night, the co-promoter may. So the false above is
    // this reader's floor, not the field being wired to a constant.
    const coList = await app.inject({
      method: "GET",
      url: "/api/v1/settlements",
      headers: auth(coHost.userId),
    });
    const coRows = coList.json().items as { signableByYou: boolean }[];
    expect(coRows[0]?.signableByYou).toBe(true);
  });
});

describe("the approval roster counts who is being WAITED ON", () => {
  it("does not expect a signature from crew, and does expect one from an operator", async () => {
    /*
     * "Approval Status 0/6" badged all six parties Pending, crew included — and `CREW_FLOOR`
     * carries no `settlement.confirm`, so the counter could never reach its own denominator and
     * the word claimed something outstanding from somebody with no control to give it (run 12).
     *
     * DERIVED from the party's floor, because whether crew may sign at all is an open ruling
     * (decisions §25.6). This test pins the derivation, not a number: if `CREW_FLOOR` ever gains
     * the capability, the assertion below flips with it and that is the correct outcome.
     */
    const host = await seedOperator("expect-host", "Host", PRESET_PERMISSION_SETS.operator_full);
    const coHost = await seedOperator("expect-co", "Co-promoter", []);
    const crew = await seedCrew("expect-crew", "Priya Sound");
    const { event } = await seedNightFor(host, coHost, "accepted");

    const [crewPart] = await harness.db
      .insert(schema.eventParticipants)
      .values({
        eventId: event.id,
        profileId: crew.profileId,
        role: "crew",
        permissionSetId: null,
        status: "confirmed",
      })
      .returning();
    if (!crewPart) throw new Error("crew participant seed failed");

    const recomputed = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/settlement/compute`,
      headers: auth(host.userId),
    });
    expect(recomputed.statusCode).toBe(200);

    const read = await app.inject({
      method: "GET",
      url: `/api/v1/events/${event.id}/settlements`,
      headers: auth(host.userId),
    });
    expect(read.statusCode).toBe(200);
    const approvals = read.json().approvals as {
      participantId: string;
      approved: boolean;
      signatureExpected: boolean;
    }[];

    const crewRow = approvals.find((row) => row.participantId === crewPart.id);
    expect(crewRow, "the crew party is on the roster").toBeDefined();
    // On the roster — the operator still has to be told who is on the night — and not waited on.
    expect(crewRow?.signatureExpected).toBe(false);
    expect(crewRow?.approved).toBe(false);

    // THE CONTROL, and it is what makes the false above the FLOOR rather than the field being
    // wired to a constant: the operators on the same night are expected to sign.
    const operatorRows = approvals.filter((row) => row.participantId !== crewPart.id);
    expect(operatorRows.length).toBeGreaterThan(0);
    for (const row of operatorRows) {
      expect(row.signatureExpected, `participant ${row.participantId}`).toBe(true);
    }

    // And the whole point of the derivation: the counter can be satisfied. Every party the roster
    // waits on can actually sign, so approved === expected is reachable.
    expect(approvals.filter((row) => row.signatureExpected).length).toBe(operatorRows.length);
  });

  it("STILL EXPECTS a delegated act's signature — their agent gives it", async () => {
    /*
     * FOUND LIVE, not by a test. The first version of this derivation passed `delegated` into
     * `baselineCapabilities`, and a delegated performer's floor is `DELEGATED_PERFORMER_FLOOR`,
     * which carries no `settlement.confirm` — so Marlo Vance's line came back "not required" on the
     * seeded Album Release. That line absolutely is waiting on a signature: their AGENT gives it,
     * which is the whole of decisions #14 and §25.7.3 and is what the confirm route implements.
     *
     * Delegation moves WHO signs, not WHETHER a signature is expected. The roster's question is
     * "is this line waiting on somebody"; "can this party sign it themselves" is `signableByYou`,
     * and that one is about the reader.
     */
    const host = await seedOperator("delegexp-host", "Host", PRESET_PERMISSION_SETS.operator_full);
    const coHost = await seedOperator("delegexp-co", "Co-promoter", []);
    const { event } = await seedNightFor(host, coHost, "accepted");

    const act = await seedOperator("delegexp-act", "Marlo Vance", PRESET_PERMISSION_SETS.performer);
    const [actPart] = await harness.db
      .insert(schema.eventParticipants)
      .values({
        eventId: event.id,
        profileId: act.profileId,
        role: "performer",
        permissionSetId: act.permissionSetId,
        status: "confirmed",
        // The flag that hands their business capabilities to an agent (#14).
        details: { delegatedToAgentProfileId: coHost.profileId },
      })
      .returning();
    if (!actPart) throw new Error("act participant seed failed");

    // The roster is built from settlement ROWS, so the act needs one — recompute now that they
    // are on the bill.
    const recomputed = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/settlement/compute`,
      headers: auth(host.userId),
    });
    expect(recomputed.statusCode).toBe(200);

    const read = await app.inject({
      method: "GET",
      url: `/api/v1/events/${event.id}/settlements`,
      headers: auth(host.userId),
    });
    expect(read.statusCode).toBe(200);
    const approvals = read.json().approvals as {
      participantId: string;
      signatureExpected: boolean;
    }[];
    const actRow = approvals.find((row) => row.participantId === actPart.id);
    expect(actRow, "the act is on the roster").toBeDefined();
    // The act's own line, expected — whoever ends up giving it.
    expect(actRow?.signatureExpected).toBe(true);
  });

  it("expects a GRANTED party's signature BEFORE they give it, so the denominator cannot move", async () => {
    /*
     * QA sweep run 13. `settlement.confirm` is GRANTABLE (`isGrantable` — it is not a pool
     * capability), so an operator can hand it to a crew member through a permission set and an
     * `agent` preset carries it outright in order to sign for its act (#14). The floor cannot see
     * either. The roster used to ask the floor ALONE and then count an existing signature as its
     * own proof — so the party read "Not required", signed anyway, and the host watched **0/4
     * become 1/5**. Worse, before it moved, 4/4 claimed everyone had signed while a party that
     * could and may sign had not.
     *
     * THE READ BEFORE THE SIGNATURE IS THE WHOLE TEST. The previous version read the roster only
     * afterwards, so it could not tell "counted because they CAN" from "counted because they DID" —
     * which is exactly the defect. The assertion that matters is that the denominator is the same
     * number on both sides of the signature.
     */
    const host = await seedOperator("granted-host", "Host", PRESET_PERMISSION_SETS.operator_full);
    const coHost = await seedOperator("granted-co", "Co-promoter", []);
    const crew = await seedCrew("granted-crew", "Priya Sound");
    const { event } = await seedNightFor(host, coHost, "accepted");

    // The grant the floor cannot see: a crew permission set carrying the confirm capability.
    const [set] = await harness.db
      .insert(schema.permissionSets)
      .values({
        profileId: host.profileId,
        name: "crew, may sign",
        capabilities: ["event.view", "settlement.view.own", "settlement.confirm"],
      })
      .returning();
    const [crewPart] = await harness.db
      .insert(schema.eventParticipants)
      .values({
        eventId: event.id,
        profileId: crew.profileId,
        role: "crew",
        permissionSetId: set?.id ?? null,
        status: "confirmed",
      })
      .returning();
    if (!crewPart) throw new Error("crew participant seed failed");

    await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/settlement/compute`,
      headers: auth(host.userId),
    });

    const crewSettlements = await app.inject({
      method: "GET",
      url: "/api/v1/settlements",
      headers: auth(crew.userId),
    });
    const crewOwn = crewSettlements.json().items as { id: string; signableByYou: boolean }[];
    expect(crewOwn).toHaveLength(1);
    // The grant reaches them, which is what makes this case real rather than hypothetical.
    expect(crewOwn[0]?.signableByYou).toBe(true);

    // BEFORE — the grant is visible to the roster, so the crew line is already waited on.
    const before = await app.inject({
      method: "GET",
      url: `/api/v1/events/${event.id}/settlements`,
      headers: auth(host.userId),
    });
    const beforeApprovals = before.json().approvals as {
      participantId: string;
      approved: boolean;
      signatureExpected: boolean;
    }[];
    const crewBefore = beforeApprovals.find((row) => row.participantId === crewPart.id);
    expect(crewBefore?.approved, "not signed yet").toBe(false);
    expect(crewBefore?.signatureExpected, "expected from the grant, not from the signature").toBe(
      true,
    );
    const denominatorBefore = beforeApprovals.filter((row) => row.signatureExpected).length;
    // And it is NOT already satisfied — the thing "4/4" wrongly claimed.
    expect(beforeApprovals.filter((row) => row.approved).length).toBeLessThan(denominatorBefore);

    const signed = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/settlements/${crewOwn[0]?.id}/confirm`,
      headers: auth(crew.userId),
    });
    expect(signed.statusCode).toBe(200);

    const read = await app.inject({
      method: "GET",
      url: `/api/v1/events/${event.id}/settlements`,
      headers: auth(host.userId),
    });
    const approvals = read.json().approvals as {
      participantId: string;
      approved: boolean;
      signatureExpected: boolean;
    }[];
    const crewRow = approvals.find((row) => row.participantId === crewPart.id);
    expect(crewRow?.approved).toBe(true);
    expect(crewRow?.signatureExpected).toBe(true);

    // THE ASSERTION THE REPORT IS ABOUT: the goal did not move under the host.
    const approved = approvals.filter((row) => row.approved).length;
    const expected = approvals.filter((row) => row.signatureExpected).length;
    expect(expected, "the denominator is a standing fact").toBe(denominatorBefore);
    // And the ratio still cannot read above one.
    expect(approved).toBeLessThanOrEqual(expected);
  });

  it("expects the AGENCY's line, whose preset carries the capability its floor does not", async () => {
    /*
     * THE PARTY THE REPORT WAS ACTUALLY ABOUT (QA sweep run 13). Measured in the seed: the
     * "Agent — represents performer" preset grants `settlement.confirm`, because that is how an
     * agency signs for its ACT (#14, §25.7.3) — and a permission set attaches to a PARTICIPATION,
     * so it reaches the agency's own line too. The floor is `event.view` and sees none of it, so
     * the roster printed "Not required" over a party holding the Approve button.
     *
     * Paired with its own control, because a guard with two sources needs one test per source: an
     * `agent` participation with NO grant is still not expected, so the true above is the BAND and
     * not the role having been quietly added to the floor.
     */
    const host = await seedOperator("agency-host", "Host", PRESET_PERMISSION_SETS.operator_full);
    const coHost = await seedOperator("agency-co", "Co-promoter", []);
    const withGrant = await seedOperator("agency-a", "Astra Booking", []);
    const without = await seedOperator("agency-b", "Bare Booking", []);
    const { event } = await seedNightFor(host, coHost, "accepted");

    const [set] = await harness.db
      .insert(schema.permissionSets)
      .values({
        profileId: host.profileId,
        name: "agent — represents performer",
        capabilities: ["event.view", "deal.edit", "agreement.manage", "settlement.confirm"],
      })
      .returning();
    const agents = await harness.db
      .insert(schema.eventParticipants)
      .values([
        {
          eventId: event.id,
          profileId: withGrant.profileId,
          role: "agent",
          permissionSetId: set?.id ?? null,
          status: "confirmed",
        },
        {
          eventId: event.id,
          profileId: without.profileId,
          role: "agent",
          permissionSetId: null,
          status: "confirmed",
        },
      ])
      .returning();
    const [granted, bare] = agents;
    if (!granted || !bare) throw new Error("agent participant seed failed");

    await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/settlement/compute`,
      headers: auth(host.userId),
    });
    const read = await app.inject({
      method: "GET",
      url: `/api/v1/events/${event.id}/settlements`,
      headers: auth(host.userId),
    });
    const approvals = read.json().approvals as {
      participantId: string;
      approved: boolean;
      signatureExpected: boolean;
    }[];

    // Neither has signed, so nothing here can be the `|| approved` clause answering for the band.
    for (const row of approvals)
      expect(row.approved, `participant ${row.participantId}`).toBe(false);
    expect(
      approvals.find((row) => row.participantId === granted.id)?.signatureExpected,
      "the agency whose preset grants it",
    ).toBe(true);
    expect(
      approvals.find((row) => row.participantId === bare.id)?.signatureExpected,
      "THE CONTROL: an agent participation with no grant — its floor is `event.view`",
    ).toBe(false);
  });

  it("keeps counting a signature whose grant was REVOKED afterwards — the `|| approved` clause", async () => {
    /*
     * The one case the union genuinely cannot predict, and the only remaining reason that clause
     * exists. Its job has inverted: it used to be the patch that MADE the denominator move, and it
     * is now the only thing that stops it — an operator editing the permission set after a
     * signature would otherwise drop the denominator below the numerator and read 1/0.
     *
     * Tested rather than asserted in a comment, because a branch nothing can reach is not a
     * safeguard.
     */
    const host = await seedOperator("revoked-host", "Host", PRESET_PERMISSION_SETS.operator_full);
    const coHost = await seedOperator("revoked-co", "Co-promoter", []);
    const crew = await seedCrew("revoked-crew", "Priya Sound");
    const { event } = await seedNightFor(host, coHost, "accepted");

    const [set] = await harness.db
      .insert(schema.permissionSets)
      .values({
        profileId: host.profileId,
        name: "crew, may sign for now",
        capabilities: ["event.view", "settlement.view.own", "settlement.confirm"],
      })
      .returning();
    const [crewPart] = await harness.db
      .insert(schema.eventParticipants)
      .values({
        eventId: event.id,
        profileId: crew.profileId,
        role: "crew",
        permissionSetId: set?.id ?? null,
        status: "confirmed",
      })
      .returning();
    if (!crewPart || !set) throw new Error("crew participant seed failed");

    await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/settlement/compute`,
      headers: auth(host.userId),
    });
    const own = await app.inject({
      method: "GET",
      url: "/api/v1/settlements",
      headers: auth(crew.userId),
    });
    const ownRows = own.json().items as { id: string }[];
    const confirmed = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/settlements/${ownRows[0]?.id}/confirm`,
      headers: auth(crew.userId),
    });
    expect(confirmed.statusCode).toBe(200);

    // The operator takes the capability back — the signature already given stays given.
    await harness.db
      .update(schema.permissionSets)
      .set({ capabilities: ["event.view", "settlement.view.own"] })
      .where(eq(schema.permissionSets.id, set.id));

    const read = await app.inject({
      method: "GET",
      url: `/api/v1/events/${event.id}/settlements`,
      headers: auth(host.userId),
    });
    const approvals = read.json().approvals as {
      participantId: string;
      approved: boolean;
      signatureExpected: boolean;
    }[];
    const crewRow = approvals.find((row) => row.participantId === crewPart.id);
    expect(crewRow?.approved, "the signature survives the revocation").toBe(true);
    expect(crewRow?.signatureExpected, "and so does its place in the denominator").toBe(true);
    expect(approvals.filter((row) => row.approved).length).toBeLessThanOrEqual(
      approvals.filter((row) => row.signatureExpected).length,
    );
  });
});

describe("GET /settlements/awaiting-signature — where a signature is owed", () => {
  /*
   * A SIBLING OF `/deals/awaiting-signature`, and for the same reason: a settlement is reachable per
   * event or by id, so the Dashboard's attention card had no way to ask where one was waiting.
   *
   * Measured before it was built (QA sweep run 12): `GET /settlements` as the AGENT returns the
   * agency's own commission line only, while the event read returns their ACT's line too with
   * `signableByYou: true` — and confirm answers 200 for the agent, 403 for the act. The one account
   * able to sign that line was the one account never told it existed. Widening the money list was
   * the wrong answer: it would put an act's entitlement in the agency's "what am I owed".
   *
   * These four cases are the filters that used to live in the web card and now live here.
   */
  async function nightSentForReview(prefix: string) {
    const host = await seedOperator(`${prefix}-host`, "Host", PRESET_PERMISSION_SETS.operator_full);
    const coHost = await seedOperator(`${prefix}-co`, "Co-promoter", []);
    const crew = await seedCrew(`${prefix}-crew`, "Priya Sound");
    const { event } = await seedNightFor(host, coHost, "accepted");
    const [crewPart] = await harness.db
      .insert(schema.eventParticipants)
      .values({
        eventId: event.id,
        profileId: crew.profileId,
        role: "crew",
        permissionSetId: null,
        status: "confirmed",
      })
      .returning();
    if (!crewPart) throw new Error("crew seed failed");
    await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/settlement/compute`,
      headers: auth(host.userId),
    });
    const sent = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/settlement/status`,
      headers: auth(host.userId),
      payload: { status: "pending_review" },
    });
    expect(sent.statusCode).toBe(200);
    return { event, host, coHost, crew, crewPart };
  }

  const owed = async (userId: string) => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/settlements/awaiting-signature",
      headers: auth(userId),
    });
    expect(response.statusCode).toBe(200);
    return response.json().items as {
      settlementId: string;
      participantId: string;
      eventId: string;
      status: string;
      isYours: boolean;
      partyName: string | null;
    }[];
  };

  it("lists the reader's own line, and NOT crew's — who cannot sign", async () => {
    const night = await nightSentForReview("owed-basic");

    const forCoHost = await owed(night.coHost.userId);
    expect(forCoHost).toHaveLength(1);
    expect(forCoHost[0]?.isYours).toBe(true);
    expect(forCoHost[0]?.status).toBe("pending_review");
    expect(forCoHost[0]?.partyName).toBe("Co-promoter");

    // `CREW_FLOOR` carries `settlement.view.own` and deliberately not `settlement.confirm`, so
    // nobody is waiting on them and the card must not say otherwise.
    expect(await owed(night.crew.userId)).toEqual([]);
  });

  it("STOPS LISTING once the signature has been given", async () => {
    const night = await nightSentForReview("owed-signed");
    const before = await owed(night.coHost.userId);
    expect(before).toHaveLength(1);

    const confirmed = await app.inject({
      method: "POST",
      url: `/api/v1/events/${night.event.id}/settlements/${before[0]?.settlementId}/confirm`,
      headers: auth(night.coHost.userId),
    });
    expect(confirmed.statusCode).toBe(200);
    expect(await owed(night.coHost.userId)).toEqual([]);
    // And the HOST's own line is untouched by somebody else signing theirs.
    expect(await owed(night.host.userId)).toHaveLength(1);
  });

  it("lists nothing while the settlement is still OPEN — nobody has been asked yet", async () => {
    const host = await seedOperator("owed-open-host", "Host", PRESET_PERMISSION_SETS.operator_full);
    const coHost = await seedOperator("owed-open-co", "Co-promoter", []);
    const { event } = await seedNightFor(host, coHost, "accepted");
    // Computed but never sent: the figures exist and no signature has been requested.
    const rows = await harness.db
      .select()
      .from(schema.settlements)
      .where(eq(schema.settlements.eventId, event.id));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.status).toBe("open");
    expect(await owed(host.userId)).toEqual([]);
  });

  it("lists the DELEGATED ACT's line to their AGENT — the finding this route exists for", async () => {
    /*
     * decisions #14 / §25.7.3: the act hands over the signature and the agent gives it. The money
     * list cannot carry this line — it is the act's entitlement, not the agency's — so this is the
     * only place the agency can be told a signature is owed.
     */
    const host = await seedOperator(
      "owed-deleg-host",
      "Host",
      PRESET_PERMISSION_SETS.operator_full,
    );
    const coHost = await seedOperator("owed-deleg-co", "Co-promoter", []);
    const agency = await seedOperator("owed-deleg-agency", "Astra Booking", [
      ...PRESET_PERMISSION_SETS.agent,
    ]);
    const act = await seedOperator(
      "owed-deleg-act",
      "Marlo Vance",
      PRESET_PERMISSION_SETS.performer,
    );
    const { event } = await seedNightFor(host, coHost, "accepted");

    const [actPart] = await harness.db
      .insert(schema.eventParticipants)
      .values({
        eventId: event.id,
        profileId: act.profileId,
        role: "performer",
        permissionSetId: act.permissionSetId,
        status: "confirmed",
        details: { delegatedToAgentProfileId: agency.profileId },
      })
      .returning();
    await harness.db.insert(schema.eventParticipants).values({
      eventId: event.id,
      profileId: agency.profileId,
      role: "agent",
      permissionSetId: agency.permissionSetId,
      status: "confirmed",
    });
    if (!actPart) throw new Error("act seed failed");

    // The representation that moves the authority — active and confirmed by both sides, which is
    // what `liveEventDelegations` asks for (#14: by BOTH-party consent).
    await harness.db.insert(schema.representations).values({
      agentProfileId: agency.profileId,
      performerProfileId: act.profileId,
      region: ["SE"],
      commissionRate: 1000,
      proposedBy: "agent",
      status: "active",
      confirmedByAgent: true,
      confirmedByPerformer: true,
    });

    await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/settlement/compute`,
      headers: auth(host.userId),
    });
    await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/settlement/status`,
      headers: auth(host.userId),
      payload: { status: "pending_review" },
    });

    const forAgency = await owed(agency.userId);
    const actLine = forAgency.find((row) => row.participantId === actPart.id);
    expect(actLine, "the act's line is owed BY THE AGENCY").toBeDefined();
    expect(actLine?.isYours).toBe(false);
    expect(actLine?.partyName).toBe("Marlo Vance");

    // THE CONTROL, and the whole point: the ACT is not asked, because it is not theirs to give.
    expect(await owed(act.userId)).toEqual([]);
  });

  it("shows an agency ITS OWN act's line and not another agency's", async () => {
    /*
     * ASKED FOR BY A SURVIVING MUTATION. The delegation branch matches
     * `delegation.performerParticipantId === row.participantId`, and with one delegated act on the
     * night that is indistinguishable from "any delegation exists here" — the mutation replacing it
     * with `!= null` passed. The case it would break is the one that matters: TWO acts on one bill
     * with two different agencies, where the weaker predicate hands agency A its rival's act's
     * settlement line. Not a cosmetic slip — an act's figures reaching the wrong agency.
     */
    const host = await seedOperator("owed-two-host", "Host", PRESET_PERMISSION_SETS.operator_full);
    const coHost = await seedOperator("owed-two-co", "Co-promoter", []);
    const { event } = await seedNightFor(host, coHost, "accepted");

    const pair = async (tag: string, actName: string) => {
      const agency = await seedOperator(`owed-two-${tag}-ag`, `${actName} Agency`, [
        ...PRESET_PERMISSION_SETS.agent,
      ]);
      const act = await seedOperator(
        `owed-two-${tag}-act`,
        actName,
        PRESET_PERMISSION_SETS.performer,
      );
      const [actPart] = await harness.db
        .insert(schema.eventParticipants)
        .values({
          eventId: event.id,
          profileId: act.profileId,
          role: "performer",
          permissionSetId: act.permissionSetId,
          status: "confirmed",
          details: { delegatedToAgentProfileId: agency.profileId },
        })
        .returning();
      await harness.db.insert(schema.eventParticipants).values({
        eventId: event.id,
        profileId: agency.profileId,
        role: "agent",
        permissionSetId: agency.permissionSetId,
        status: "confirmed",
      });
      await harness.db.insert(schema.representations).values({
        agentProfileId: agency.profileId,
        performerProfileId: act.profileId,
        region: ["SE"],
        commissionRate: 1000,
        proposedBy: "agent",
        status: "active",
        confirmedByAgent: true,
        confirmedByPerformer: true,
      });
      if (!actPart) throw new Error(`${tag} act seed failed`);
      return { agency, act, actPart };
    };

    const first = await pair("a", "Marlo Vance");
    const second = await pair("b", "Neon Tide");

    await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/settlement/compute`,
      headers: auth(host.userId),
    });
    await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/settlement/status`,
      headers: auth(host.userId),
      payload: { status: "pending_review" },
    });

    const forFirst = await owed(first.agency.userId);
    const participantIds = forFirst.map((row) => row.participantId);
    expect(participantIds).toContain(first.actPart.id);
    // The one that matters: the rival's act is not this agency's to sign, or to be shown.
    expect(participantIds).not.toContain(second.actPart.id);
    expect(forFirst.find((row) => row.participantId === first.actPart.id)?.partyName).toBe(
      "Marlo Vance",
    );

    // And symmetrically, so the pass above is the matching and not an ordering accident.
    const forSecond = await owed(second.agency.userId);
    expect(forSecond.map((row) => row.participantId)).toContain(second.actPart.id);
    expect(forSecond.map((row) => row.participantId)).not.toContain(first.actPart.id);
  });
});

describe("a CANCELLED deal discloses nothing", () => {
  it("stops an observer's grant the moment the agreement is withdrawn", async () => {
    /*
     * QA sweep run 13's MAJOR. `partiesVisibleTo` joined `deal_parties → deals` filtering on
     * `deals.eventId` and nothing else, while every other reader of `deals` on this path excludes
     * cancelled (`reconcileEvent`, `hiddenCount`, `useBudgetSeed`). So a crew member whose only
     * qualifying rows were `observer` on two CANCELLED deals was served another party's whole
     * settlement — SEK 30,800, earned under a deal she was not a party to in any role.
     *
     * §25.7.2 calls cancelling "the NORMAL ending for an agreement", so these grants accumulated
     * over an event's life and never expired.
     */
    const host = await seedOperator("cxl-host", "Host", PRESET_PERMISSION_SETS.operator_full);
    const coHost = await seedOperator("cxl-co", "Co-promoter", []);
    const crew = await seedCrew("cxl-crew", "Priya Sound");
    const { event } = await seedNightFor(host, coHost, "accepted");

    const [crewPart] = await harness.db
      .insert(schema.eventParticipants)
      .values({
        eventId: event.id,
        profileId: crew.profileId,
        role: "crew",
        permissionSetId: null,
        status: "confirmed",
      })
      .returning();
    if (!crewPart) throw new Error("crew seed failed");
    /*
     * THE COUNTERPARTY MUST BE A NON-OPERATOR, and my first version used the co-host — which proved
     * nothing, because `partiesVisibleTo` strips every participant who OPERATES the event however
     * the deal is pointed (QA10-2). The control passed vacuously for a reason that had nothing to do
     * with `cancelled`. The sweep's own case is a performer: crew observing a Lantern Hall ↔ Neon
     * Tide deal was served Neon Tide's figures.
     */
    const act = await seedOperator("cxl-act", "Neon Tide", PRESET_PERMISSION_SETS.performer);
    const [actPart] = await harness.db
      .insert(schema.eventParticipants)
      .values({
        eventId: event.id,
        profileId: act.profileId,
        role: "performer",
        permissionSetId: act.permissionSetId,
        status: "confirmed",
      })
      .returning();
    if (!actPart) throw new Error("act participant seed failed");

    /*
     * A deal the crew member merely OBSERVES — #4's read-only way to share one. Inserted directly
     * because this test app registers only `settlementRoutes`; the subject is `partiesVisibleTo`,
     * not the deals routes.
     */
    const [observed] = await harness.db
      .insert(schema.deals)
      .values({
        eventId: event.id,
        type: "fee",
        structure: "guarantee",
        name: "A guarantee the engineer watches",
        currency: "SEK",
        guaranteeAmount: 500000n,
        createdBy: host.userId,
      })
      .returning();
    if (!observed) throw new Error("observed deal seed failed");
    await harness.db.insert(schema.dealParties).values([
      { dealId: observed.id, participantId: actPart.id, roleInDeal: "payee" },
      { dealId: observed.id, participantId: crewPart.id, roleInDeal: "observer" },
    ]);
    // Every agreement on the night has to be signed before the settlement will open.
    await signEveryAgreement(harness.db, event.id);
    const recomputed = await app.inject({
      method: "POST",
      url: `/api/v1/events/${event.id}/settlement/compute`,
      headers: auth(host.userId),
    });
    expect(recomputed.statusCode).toBe(200);

    const disclosedTo = async (userId: string) => {
      const response = await app.inject({
        method: "GET",
        url: `/api/v1/events/${event.id}/settlements`,
        headers: auth(userId),
      });
      expect(response.statusCode).toBe(200);
      return (response.json().settlements as { participantId: string }[]).map(
        (row) => row.participantId,
      );
    };

    /*
     * THE CONTROL FIRST, and it is what makes the assertion below about `cancelled` rather than
     * about observers: while the deal is LIVE, observing it does disclose the counterparty — that is
     * A-07's deliberate rule and it must not move.
     */
    const whileLive = await disclosedTo(crew.userId);
    expect(whileLive).toContain(actPart.id);

    /*
     * Withdraw it. No recompute: `partiesVisibleTo` reads the LIVE `deals` row on every request, so
     * the grant has to fall away on the next read rather than at the next reconciliation — which is
     * the half that made these accumulate.
     */
    await harness.db
      .update(schema.deals)
      .set({ status: "cancelled" })
      .where(eq(schema.deals.id, observed.id));

    // The agreement is withdrawn, so the grant it carried is withdrawn with it.
    const afterCancel = await disclosedTo(crew.userId);
    expect(afterCancel).not.toContain(actPart.id);
    // Their OWN row is untouched — this narrows what somebody else's membership discloses, never
    // what a party may read about their own money.
    expect(afterCancel).toContain(crewPart.id);
  });
});
