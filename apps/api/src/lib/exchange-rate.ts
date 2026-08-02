import type { Database } from "@showme/db";
import { schema } from "@showme/db";
import { and, eq, inArray } from "drizzle-orm";
import type { Transaction } from "./audit";

/**
 * Load the conversion rates (each non-base currency → base) from the cache. Keyed
 * by the source currency; the value is the NUMERIC(18,10) string "base per 1
 * source" (the `exchange_rate_cache` convention). Currencies equal to base — or
 * with no cached pair — are omitted; the caller decides whether a missing rate is
 * fatal (it is, for settlement money). Live during compute; frozen at finalize.
 */
export async function loadRatesToBase(
  db: Database | Transaction,
  baseCurrency: string,
  currencies: Iterable<string>,
): Promise<Map<string, string>> {
  const nonBase = [...new Set(currencies)].filter(
    (currency) => currency && currency !== baseCurrency,
  );
  const map = new Map<string, string>();
  if (nonBase.length === 0) return map;

  const rows = await db
    .select({ base: schema.exchangeRateCache.base, rate: schema.exchangeRateCache.rate })
    .from(schema.exchangeRateCache)
    .where(
      and(
        inArray(schema.exchangeRateCache.base, nonBase),
        eq(schema.exchangeRateCache.quote, baseCurrency),
      ),
    );
  for (const row of rows) map.set(row.base, row.rate);
  return map;
}
