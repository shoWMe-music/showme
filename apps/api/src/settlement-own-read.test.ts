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

/**
 * A night with a door the host collects and a co-promoter on it — so `reconcile`
 * allocates the residual across both operators and writes the co-promoter a row.
 */
async function seedCoPromotedNight(prefix: string, coHostStatus: "accepted" | "invited") {
  const { db } = harness;
  const host = await seedOperator(`${prefix}-host`, "Host", PRESET_PERMISSION_SETS.operator_full);
  // The co-promoter as the invite dialog leaves them: a ROLE, and no permission set.
  const coHost = await seedOperator(`${prefix}-co`, "Co-promoter", []);

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

  return { event, host, coHost };
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
