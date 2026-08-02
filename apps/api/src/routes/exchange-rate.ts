import { schema } from "@showme/db";
import { CURRENCIES } from "@showme/shared";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { notFound } from "../errors";

const CurrenciesResponse = z.object({
  currencies: z.array(
    z.object({
      code: z.string(),
      minorUnitExponent: z.number(),
      symbol: z.string(),
    }),
  ),
});

const ExchangeRateQuery = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
});

const ExchangeRateResponse = z.object({
  from: z.string(),
  to: z.string(),
  rate: z.string(),
  fetchedAt: z.string(),
});

/**
 * Display-only exchange rates (money.md): a live rate used to render an amount in
 * the viewer's currency. It never touches settled amounts — settlement locks its
 * own rate at finalize. Served from the shared backend cache (refreshed 6×/day by
 * the `apps/jobs` refresh job). Public: no auth, no principal.
 */
export async function exchangeRateRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/exchange-rate/currencies",
    { config: { public: true }, schema: { response: { 200: CurrenciesResponse } } },
    async () => ({ currencies: Object.values(CURRENCIES) }),
  );

  app.get(
    "/exchange-rate",
    {
      config: { public: true },
      schema: { querystring: ExchangeRateQuery, response: { 200: ExchangeRateResponse } },
    },
    async (request) => {
      const { database } = request.server;
      const { from, to } = request.query;

      const [row] = await database
        .select()
        .from(schema.exchangeRateCache)
        .where(
          and(eq(schema.exchangeRateCache.base, from), eq(schema.exchangeRateCache.quote, to)),
        );
      if (!row) throw notFound("No cached rate for this pair");

      return {
        from: row.base,
        to: row.quote,
        rate: row.rate,
        fetchedAt: row.fetchedAt.toISOString(),
      };
    },
  );
}
