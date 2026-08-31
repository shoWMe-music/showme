import { schema } from "@showme/db";
import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TokenVerifier } from "./auth/token-verifier";
import { createGeocoder, parseMapboxFeature } from "./lib/geocode";
import { geocodeRoutes } from "./routes/geocode";
import { buildTestApp } from "./testing";

const fakeVerifier: TokenVerifier = {
  async verify(token: string) {
    return { uid: token, email: `${token}@example.showme.test`, name: token };
  },
};

/** A Mapbox `address` feature, trimmed to the fields the parser reads. */
const stockholmAddress = {
  id: "address.123",
  place_type: ["address"],
  place_name: "Hornsgatan 12, 118 20 Stockholm, Sweden",
  center: [18.0632, 59.3186] as [number, number],
  text: "Hornsgatan",
  address: "12",
  context: [
    { id: "postcode.1", text: "118 20" },
    { id: "place.1", text: "Stockholm" },
    { id: "region.1", text: "Stockholm County", short_code: "SE-AB" },
    { id: "country.1", text: "Sweden", short_code: "se" },
  ],
};

let harness: TestDatabase;

beforeAll(async () => {
  harness = await startTestDatabase();
  await harness.db.insert(schema.users).values({
    id: "geocode-user",
    email: "geocode@example.showme.test",
    name: "Geo",
    kind: "operator",
  });
});

afterAll(async () => {
  await harness?.stop();
});

/** Build an app whose geocoder answers from `features` and records the URL it was asked for. */
function appWithMapbox(
  features: unknown[],
  status = 200,
): { app: FastifyInstance; urls: string[] } {
  const urls: string[] = [];
  const fetchImplementation = (async (input: unknown) => {
    urls.push(String(input));
    return new Response(JSON.stringify({ features }), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  const app = buildTestApp(
    {
      database: harness.db,
      tokenVerifier: fakeVerifier,
      geocoder: createGeocoder({ mapboxAccessToken: "pk.test-token", fetchImplementation }),
    },
    [geocodeRoutes],
  );
  return { app, urls };
}

const authorized = { authorization: `Bearer ${"geocode-user"}` };

describe("parseMapboxFeature", () => {
  it("splits an address into the columns profile_locations holds", () => {
    expect(parseMapboxFeature(stockholmAddress)).toEqual({
      id: "address.123",
      label: "Hornsgatan 12, 118 20 Stockholm, Sweden",
      street: "Hornsgatan 12",
      postcode: "118 20",
      city: "Stockholm",
      // The ISO code, not "Sweden" — `profile_locations.country` is two letters
      // and the PATCH body caps it there.
      country: "SE",
      lat: 59.3186,
      lng: 18.0632,
    });
  });

  it("does not write a venue's NAME into the street", () => {
    const poi = parseMapboxFeature({
      id: "poi.9",
      place_type: ["poi"],
      place_name: "Debaser Strand, Hornstulls strand 4, Stockholm, Sweden",
      center: [18.03, 59.31],
      text: "Debaser Strand",
      context: [
        { id: "place.1", text: "Stockholm" },
        { id: "country.1", text: "Sweden", short_code: "se" },
      ],
    });
    expect(poi?.street).toBeNull();
    expect(poi?.city).toBe("Stockholm");
  });

  it("drops a feature with no coordinates rather than inventing them", () => {
    expect(parseMapboxFeature({ id: "x", place_name: "Nowhere" })).toBeNull();
  });
});

describe("GET /geocode", () => {
  it("returns parsed candidates and keeps the token server-side", async () => {
    const { app, urls } = appWithMapbox([stockholmAddress]);
    await app.ready();
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/geocode?query=Hornsgatan%2012&country=SE",
      headers: authorized,
    });
    expect(response.statusCode).toBe(200);
    const { results } = response.json();
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ street: "Hornsgatan 12", country: "SE", lat: 59.3186 });
    // The token appears in the OUTBOUND call and nowhere in what we send back.
    expect(urls[0]).toContain("access_token=pk.test-token");
    expect(urls[0]).toContain("country=se");
    expect(response.body).not.toContain("pk.test-token");
    await app.close();
  });

  it("refuses an anonymous caller", async () => {
    const { app } = appWithMapbox([stockholmAddress]);
    await app.ready();
    const response = await app.inject({ method: "GET", url: "/api/v1/geocode?query=Hornsgatan" });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("answers 503 — not 500 — when the deployment has no token", async () => {
    const app = buildTestApp(
      { database: harness.db, tokenVerifier: fakeVerifier, geocoder: null },
      [geocodeRoutes],
    );
    await app.ready();
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/geocode?query=Hornsgatan",
      headers: authorized,
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe("geocoder_unavailable");
    await app.close();
  });

  it("answers 502 when the provider fails, so a valid address never reads as our bug", async () => {
    const { app } = appWithMapbox([], 500);
    await app.ready();
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/geocode?query=Hornsgatan",
      headers: authorized,
    });
    expect(response.statusCode).toBe(502);
    expect(response.json().error.code).toBe("geocoder_failed");
    await app.close();
  });

  it("rate-limits one user's lookups without charging the provider for them", async () => {
    const { app, urls } = appWithMapbox([stockholmAddress]);
    await app.ready();
    let lastStatus = 200;
    for (let attempt = 0; attempt < 61; attempt += 1) {
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/geocode?query=Hornsgatan",
        headers: authorized,
      });
      lastStatus = response.statusCode;
    }
    expect(lastStatus).toBe(429);
    // 60 allowed, and the 61st never reached Mapbox — the point of the limit.
    expect(urls).toHaveLength(60);
    await app.close();
  });
});
