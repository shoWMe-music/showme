import { schema } from "@showme/db";
import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TokenVerifier } from "./auth/token-verifier";
import { insightRoutes } from "./routes/insights";
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
  app = buildTestApp({ database: harness.db, tokenVerifier: fakeVerifier }, [insightRoutes]);
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await harness?.stop();
});

const auth = (uid: string) => ({ authorization: `Bearer ${uid}` });

let seq = 0;

/** Seed a user + owned operator profile + owner membership. */
async function seedOperator() {
  const { db } = harness;
  const id = `insights-op-${seq++}`;
  await db
    .insert(schema.users)
    .values({ id, email: `${id}@example.showme.test`, kind: "operator" });
  const [profile] = await db
    .insert(schema.profiles)
    .values({ kind: "operator", ownerUserId: id, name: id, slug: id })
    .returning();
  if (!profile) throw new Error("profile seed failed");
  await db
    .insert(schema.profileMembers)
    .values({ profileId: profile.id, userId: id, role: "owner", status: "active" });
  return { profileId: profile.id, ownerUserId: id };
}

/** Seed a bare user with no membership anywhere. */
async function seedStranger() {
  const id = `insights-stranger-${seq++}`;
  await harness.db
    .insert(schema.users)
    .values({ id, email: `${id}@example.showme.test`, kind: "operator" });
  return id;
}

async function seedEvent(
  hostProfileId: string,
  createdBy: string,
  status: "draft" | "confirmed",
  baseCurrency = "SEK",
) {
  const [event] = await harness.db
    .insert(schema.events)
    .values({ hostProfileId, title: `ev-${seq++}`, status, baseCurrency, createdBy })
    .returning();
  if (!event) throw new Error("event seed failed");
  return event.id;
}

describe("INSIGHTS — /insights/profiles/:id/summary", () => {
  it("counts events hosted and groups them by status for a member", async () => {
    const operator = await seedOperator();
    await seedEvent(operator.profileId, operator.ownerUserId, "confirmed");
    await seedEvent(operator.profileId, operator.ownerUserId, "confirmed");
    await seedEvent(operator.profileId, operator.ownerUserId, "draft");

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/insights/profiles/${operator.profileId}/summary`,
      headers: auth(operator.ownerUserId),
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.eventsHosted).toBe(3);
    expect(body.eventsByStatus).toMatchObject({ confirmed: 2, draft: 1 });
  });

  it("404s a non-member (no existence leak)", async () => {
    const operator = await seedOperator();
    const stranger = await seedStranger();

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/insights/profiles/${operator.profileId}/summary`,
      headers: auth(stranger),
    });
    expect(response.statusCode).toBe(404);
  });
});

describe("INSIGHTS — /insights/profiles/:id/revenue", () => {
  it("sums budget revenue lines as a string, excluding cost lines", async () => {
    const operator = await seedOperator();
    const eventId = await seedEvent(operator.profileId, operator.ownerUserId, "confirmed", "SEK");
    const [budget] = await harness.db
      .insert(schema.budgets)
      .values({ eventId, scope: "shared" })
      .returning();
    if (!budget) throw new Error("budget seed failed");
    await harness.db.insert(schema.budgetLines).values([
      { budgetId: budget.id, kind: "revenue", label: "Door", amount: 100000n, currency: "SEK" },
      { budgetId: budget.id, kind: "revenue", label: "Bar", amount: 50000n, currency: "SEK" },
      { budgetId: budget.id, kind: "cost", label: "Sound", amount: 30000n, currency: "SEK" },
    ]);

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/insights/profiles/${operator.profileId}/revenue`,
      headers: auth(operator.ownerUserId),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ totalRevenue: "150000", currency: "SEK" });
  });

  /**
   * A PRIVATE BOOK IS NOT THE EVENT'S REVENUE, AND SOMEBODY ELSE'S IS NOT THE HOST'S TO
   * COUNT (QA sweep run 9, QA9-1).
   *
   * This query filtered on the host profile and the line kind and nothing else, so an
   * operator's all-time figure carried every private book on their events — including a
   * CO-HOST's. Measured on the seed: SEK 238,345 where the shared ledgers total SEK 216,000,
   * the difference being two private books, SEK 12,345 of it Northlight's.
   *
   * `PLAN.md:215`: a private book is "the extra an operator MAY ALSO keep, existing only once
   * there is a co-host to keep it from". The detail route has always enforced that; this is
   * the aggregate catching up to it.
   *
   * Both private books are seeded — the host's own and another profile's — because the two
   * are excluded for DIFFERENT reasons and a fix that only skipped the stranger's would still
   * disagree with the panel beside it.
   */
  it("counts the shared ledger only — not a private book, not even the host's own", async () => {
    const operator = await seedOperator();
    const coPromoter = await seedOperator();
    const eventId = await seedEvent(operator.profileId, operator.ownerUserId, "confirmed", "SEK");

    const [shared] = await harness.db
      .insert(schema.budgets)
      .values({ eventId, scope: "shared" })
      .returning();
    const [mine] = await harness.db
      .insert(schema.budgets)
      .values({ eventId, scope: "private", ownerProfileId: operator.profileId })
      .returning();
    const [theirs] = await harness.db
      .insert(schema.budgets)
      .values({ eventId, scope: "private", ownerProfileId: coPromoter.profileId })
      .returning();
    if (!shared || !mine || !theirs) throw new Error("budget seed failed");

    await harness.db.insert(schema.budgetLines).values([
      { budgetId: shared.id, kind: "revenue", label: "Door", amount: 21600000n, currency: "SEK" },
      // The host's own extra margin — real, and not the event's shared revenue.
      { budgetId: mine.id, kind: "revenue", label: "My margin", amount: 1000000n, currency: "SEK" },
      // The co-promoter's, which the host may not read at all.
      {
        budgetId: theirs.id,
        kind: "revenue",
        label: "Their margin",
        amount: 1234500n,
        currency: "SEK",
      },
    ]);

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/insights/profiles/${operator.profileId}/revenue`,
      headers: auth(operator.ownerUserId),
    });

    expect(response.statusCode).toBe(200);
    // The shared ledger, exactly — the figure the Projections panel beside it shows.
    expect(response.json().totalRevenue).toBe("21600000");
    // Said explicitly, because these are the two numbers the defect produced.
    expect(response.json().totalRevenue).not.toBe("23834500");
    expect(response.json().totalRevenue).not.toBe("22600000");
  });

  it("returns zero for an operator with no revenue lines", async () => {
    const operator = await seedOperator();
    await seedEvent(operator.profileId, operator.ownerUserId, "draft", "EUR");

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/insights/profiles/${operator.profileId}/revenue`,
      headers: auth(operator.ownerUserId),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().totalRevenue).toBe("0");
  });

  it("404s a non-member (no existence leak)", async () => {
    const operator = await seedOperator();
    const stranger = await seedStranger();

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/insights/profiles/${operator.profileId}/revenue`,
      headers: auth(stranger),
    });
    expect(response.statusCode).toBe(404);
  });
});
