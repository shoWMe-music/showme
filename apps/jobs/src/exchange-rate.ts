import type { Database } from "@showme/db";
import { schema } from "@showme/db";
import { CURRENCIES } from "@showme/shared";
import { sql } from "drizzle-orm";

const API_BASE_URL = "https://v6.exchangerate-api.com/v6";

/**
 * Recommended schedule: every 4 hours (6× per day) → ~180 calls/month, well under
 * the free tier's 1500/month. Wire `REFRESH_CRON` into a Cloud Run Job trigger.
 */
export const REFRESH_CRON = "0 */4 * * *";

/** USD→all rates, as returned by ExchangeRate-API (`rates[X]` = X per 1 USD). */
export interface UsdRates {
  base: string;
  rates: Record<string, number>;
}

/** Injected so the refresh is testable without hitting the live API. */
export type RateFetcher = () => Promise<UsdRates>;

interface ExchangeRateApiResponse {
  result: string;
  base_code: string;
  conversion_rates: Record<string, number>;
}

/**
 * Fetch USD→all from ExchangeRate-API v6. ONE call per refresh — every currency
 * pair is derived as a cross-rate, so no extra calls. Key: `EXCHANGE_RATE_API`.
 */
export function createExchangeRateApiFetcher(apiKey: string): RateFetcher {
  return async () => {
    const response = await fetch(`${API_BASE_URL}/${apiKey}/latest/USD`);
    if (!response.ok) {
      throw new Error(`ExchangeRate-API returned ${response.status} ${response.statusText}`);
    }
    const data = (await response.json()) as ExchangeRateApiResponse;
    if (data.result !== "success") {
      throw new Error(`ExchangeRate-API unsuccessful result: ${data.result}`);
    }
    return { base: data.base_code, rates: data.conversion_rates };
  };
}

/**
 * Refresh the DISPLAY-only exchange-rate cache (money.md — never touches settled
 * amounts). Fetches USD→all once, then upserts every cross-pair among the known
 * currencies (`rate(from→to) = rates[to] / rates[from]`) into `exchange_rate_cache`,
 * so ONE backend call serves every user. Returns the number of pairs written.
 */
export async function refreshExchangeRates(
  db: Database,
  fetchRates: RateFetcher,
  now: Date = new Date(),
): Promise<number> {
  const { rates } = await fetchRates();
  const codes = Object.keys(CURRENCIES).filter((code) => typeof rates[code] === "number");

  const rows = [];
  for (const base of codes) {
    for (const quote of codes) {
      if (base === quote) continue;
      const from = rates[base];
      const to = rates[quote];
      if (!from || !to) continue;
      rows.push({ base, quote, rate: (to / from).toFixed(10), fetchedAt: now });
    }
  }
  if (rows.length === 0) {
    return 0;
  }

  await db
    .insert(schema.exchangeRateCache)
    .values(rows)
    .onConflictDoUpdate({
      target: [schema.exchangeRateCache.base, schema.exchangeRateCache.quote],
      set: { rate: sql`excluded.rate`, fetchedAt: sql`excluded.fetched_at` },
    });
  return rows.length;
}

/** Convenience runner for the scheduled job — reads the key from the environment. */
export async function runExchangeRateRefresh(db: Database): Promise<number> {
  const apiKey = process.env.EXCHANGE_RATE_API?.trim();
  if (!apiKey) {
    throw new Error("EXCHANGE_RATE_API is not set");
  }
  return refreshExchangeRates(db, createExchangeRateApiFetcher(apiKey));
}
