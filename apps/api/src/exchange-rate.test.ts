import { schema } from "@showme/db";
import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TokenVerifier } from "./auth/token-verifier";
import { exchangeRateRoutes } from "./routes/exchange-rate";
import { buildTestApp } from "./testing";

/** Fake verifier — exchange-rate routes are public, but buildTestApp requires one. */
const fakeVerifier: TokenVerifier = {
  async verify(token: string) {
    return { uid: token, email: `${token}@example.showme.test`, name: token };
  },
};

let harness: TestDatabase;
let app: FastifyInstance;

beforeAll(async () => {
  harness = await startTestDatabase();
  app = buildTestApp({ database: harness.db, tokenVerifier: fakeVerifier }, [exchangeRateRoutes]);
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await harness?.stop();
});

describe("exchange-rate currencies", () => {
  it("returns the static currency reference list", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/exchange-rate/currencies" });
    expect(response.statusCode).toBe(200);
    const { currencies } = response.json();
    const byCode = Object.fromEntries(currencies.map((c: { code: string }) => [c.code, c]));
    expect(byCode.EUR).toEqual({ code: "EUR", minorUnitExponent: 2, symbol: "€" });
    expect(byCode.SEK).toEqual({ code: "SEK", minorUnitExponent: 2, symbol: "kr" });
    expect(byCode.JPY).toEqual({ code: "JPY", minorUnitExponent: 0, symbol: "¥" });
  });
});

describe("exchange-rate lookup", () => {
  it("returns a cached rate for a pair", async () => {
    await harness.db.insert(schema.exchangeRateCache).values({
      base: "EUR",
      quote: "SEK",
      rate: "11.2500000000",
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/exchange-rate?from=EUR&to=SEK",
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.from).toBe("EUR");
    expect(body.to).toBe("SEK");
    expect(Number(body.rate)).toBeCloseTo(11.25);
    expect(typeof body.fetchedAt).toBe("string");
  });

  it("404s an uncached pair", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/exchange-rate?from=USD&to=KWD",
    });
    expect(response.statusCode).toBe(404);
  });
});
