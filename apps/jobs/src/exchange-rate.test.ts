import { schema } from "@showme/db";
import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type RateFetcher, refreshExchangeRates } from "./exchange-rate";

let harness: TestDatabase;

beforeAll(async () => {
  harness = await startTestDatabase();
});

afterAll(async () => {
  await harness?.stop();
});

function rateOf(base: string, quote: string) {
  return harness.db
    .select()
    .from(schema.exchangeRateCache)
    .where(and(eq(schema.exchangeRateCache.base, base), eq(schema.exchangeRateCache.quote, quote)));
}

describe("refreshExchangeRates", () => {
  it("derives cross-rates from a single USD fetch and upserts the cache", async () => {
    const fetcher: RateFetcher = async () => ({
      base: "USD",
      rates: { USD: 1, EUR: 0.9, SEK: 10, JPY: 150 },
    });
    const now = new Date("2026-07-21T00:00:00.000Z");

    const written = await refreshExchangeRates(harness.db, fetcher, now);
    expect(written).toBe(12); // 4 currencies → 4×3 ordered pairs

    const [usdEur] = await rateOf("USD", "EUR");
    expect(Number(usdEur?.rate)).toBeCloseTo(0.9, 8);

    // EUR→SEK = (SEK per USD) / (EUR per USD) = 10 / 0.9
    const [eurSek] = await rateOf("EUR", "SEK");
    expect(Number(eurSek?.rate)).toBeCloseTo(10 / 0.9, 6);

    // A currency not in the fetch (KWD) is skipped.
    const [usdKwd] = await rateOf("USD", "KWD");
    expect(usdKwd).toBeUndefined();
  });

  it("upserts existing pairs on re-refresh (no duplicates)", async () => {
    const first: RateFetcher = async () => ({ base: "USD", rates: { USD: 1, EUR: 0.9, SEK: 10 } });
    const second: RateFetcher = async () => ({ base: "USD", rates: { USD: 1, EUR: 0.8, SEK: 11 } });

    await refreshExchangeRates(harness.db, first, new Date("2026-07-21T00:00:00.000Z"));
    await refreshExchangeRates(harness.db, second, new Date("2026-07-22T00:00:00.000Z"));

    const usdEurRows = await rateOf("USD", "EUR");
    expect(usdEurRows).toHaveLength(1); // updated in place, not duplicated
    expect(Number(usdEurRows[0]?.rate)).toBeCloseTo(0.8, 8);
  });
});
