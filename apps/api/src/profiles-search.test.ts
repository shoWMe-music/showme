import { schema } from "@showme/db";
import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TokenVerifier } from "./auth/token-verifier";
import { profileRoutes } from "./routes/profiles";
import { buildTestApp } from "./testing";

const fakeVerifier: TokenVerifier = {
  async verify(token: string) {
    return { uid: token, email: `${token}@example.showme.test`, emailVerified: true, name: token };
  },
};

let harness: TestDatabase;
let app: FastifyInstance;

beforeAll(async () => {
  harness = await startTestDatabase();
  app = buildTestApp({ database: harness.db, tokenVerifier: fakeVerifier }, [profileRoutes]);
  await app.ready();
  const { db } = harness;

  // A searcher (any authenticated user with a profile so the principal resolves).
  await db
    .insert(schema.users)
    .values({ id: "searcher", email: "searcher@example.showme.test", kind: "operator" });
  const [searcherProfile] = await db
    .insert(schema.profiles)
    .values({
      kind: "operator",
      ownerUserId: "searcher",
      name: "Searcher Ops",
      slug: "searcher-ops",
    })
    .returning();
  await db.insert(schema.profileMembers).values({
    profileId: searcherProfile?.id ?? "",
    userId: "searcher",
    role: "owner",
    status: "active",
  });

  // The searchable set.
  await db
    .insert(schema.users)
    .values({ id: "perf-owner", email: "perf@example.showme.test", kind: "performer" });
  const [ninaVox] = await db
    .insert(schema.profiles)
    .values({
      kind: "performer",
      ownerUserId: "perf-owner",
      name: "Nina Vox",
      slug: "nina-vox",
      isPublic: true,
      claimedAt: new Date(),
    })
    .returning();
  await db.insert(schema.profileLocations).values({
    profileId: ninaVox?.id ?? "",
    city: "Berlin",
    country: "DE",
    isPrimary: true,
  });
  await db.insert(schema.profiles).values({
    kind: "performer",
    ownerUserId: "perf-owner",
    name: "Nina Beats",
    slug: "nina-beats",
    isPublic: true,
    claimedAt: new Date(),
  });
  // Excluded: private performer, a non-matching name, and an operator-kind profile.
  await db.insert(schema.profiles).values({
    kind: "performer",
    ownerUserId: "perf-owner",
    name: "Nina Private",
    slug: "nina-private",
    isPublic: false,
  });
  await db.insert(schema.profiles).values({
    kind: "performer",
    ownerUserId: "perf-owner",
    name: "Zephyr",
    slug: "zephyr",
    isPublic: true,
  });
  await db.insert(schema.profiles).values({
    kind: "operator",
    ownerUserId: "searcher",
    name: "Nina Operator",
    slug: "nina-operator",
    isPublic: true,
  });
});

afterAll(async () => {
  await app?.close();
  await harness?.stop();
});

const auth = (uid: string) => ({ authorization: `Bearer ${uid}` });

describe("GET /profiles/search", () => {
  it("returns public performers matching the query, with card fields", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/profiles/search?q=nina&kind=performer&limit=20",
      headers: auth("searcher"),
    });
    expect(response.statusCode).toBe(200);
    const { items } = response.json() as {
      items: { name: string; slug: string; city: string | null; claimed: boolean }[];
    };
    const names = items.map((row) => row.name).sort();
    expect(names).toEqual(["Nina Beats", "Nina Vox"]); // public performers only

    const vox = items.find((row) => row.name === "Nina Vox");
    expect(vox?.slug).toBe("nina-vox");
    expect(vox?.city).toBe("Berlin");
    expect(vox?.claimed).toBe(true);
  });

  it("excludes private profiles, other kinds, and non-matches", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/profiles/search?q=nina&limit=20",
      headers: auth("searcher"),
    });
    const names = (response.json() as { items: { name: string }[] }).items.map((row) => row.name);
    expect(names).not.toContain("Nina Private"); // is_public = false
    expect(names).not.toContain("Nina Operator"); // kind defaults to performer
    expect(names).not.toContain("Zephyr"); // doesn't match "nina"
  });

  it("browses all public performers with no query, paginated by a stable seed", async () => {
    // 3 public performers exist: Nina Vox, Nina Beats, Zephyr.
    const page1 = await app.inject({
      method: "GET",
      url: "/api/v1/profiles/search?limit=2&seed=7",
      headers: auth("searcher"),
    });
    expect(page1.statusCode).toBe(200);
    const first = page1.json() as { items: { id: string; name: string }[]; hasMore: boolean };
    expect(first.items).toHaveLength(2);
    expect(first.hasMore).toBe(true);

    const page2 = await app.inject({
      method: "GET",
      url: "/api/v1/profiles/search?limit=2&offset=2&seed=7",
      headers: auth("searcher"),
    });
    const second = page2.json() as { items: { id: string; name: string }[]; hasMore: boolean };
    expect(second.items).toHaveLength(1);
    expect(second.hasMore).toBe(false);

    // Stable seed ⇒ the two pages partition the 3 performers with no overlap.
    const allNames = [...first.items, ...second.items].map((row) => row.name).sort();
    expect(allNames).toEqual(["Nina Beats", "Nina Vox", "Zephyr"]);
  });
});
