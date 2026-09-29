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
