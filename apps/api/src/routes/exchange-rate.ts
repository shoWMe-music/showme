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

/** `from` narrows the list to what the display cache can convert — see the route. */
const CurrenciesQuery = z.object({ from: z.string().min(3).max(3).optional() });

/**
 * Display-only exchange rates (money.md): a live rate used to render an amount in
 * the viewer's currency. It never touches settled amounts — settlement locks its
 * own rate at finalize. Served from the shared backend cache (refreshed 6×/day by
 * the `apps/jobs` refresh job). Public: no auth, no principal.
 */
export async function exchangeRateRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /**
   * WHAT CAN ACTUALLY BE SHOWN, when the caller says what it is converting FROM.
   *
   * Without `from` this is the static table — every currency the product knows how
   * to denominate money in, which is what a base-currency picker needs.
   *
   * With `from` it is the far narrower set the display cache can actually reach:
   * the pairs `apps/jobs` has refreshed, plus the base itself. A preview chooser fed
   * the static list offered eight currencies and could convert to six — picking JPY
   * fired `GET /exchange-rate?from=SEK&to=JPY`, took a 404, and left the screen in
   * SEK with nothing said (measured 2026-09-26). An option that cannot work is worse
   * than an absent one: the reader concludes the figures are wrong rather than the
   * menu.
   */
  app.get(
    "/exchange-rate/currencies",
    {
      config: { public: true },
      schema: { querystring: CurrenciesQuery, response: { 200: CurrenciesResponse } },
    },
    async (request) => {
      const from = request.query.from?.toUpperCase();
      if (!from) return { currencies: Object.values(CURRENCIES) };

      const rows = await request.server.database
        .select({ quote: schema.exchangeRateCache.quote })
        .from(schema.exchangeRateCache)
        .where(eq(schema.exchangeRateCache.base, from));
      const reachable = new Set([from, ...rows.map((row) => row.quote)]);
      return {
        currencies: Object.values(CURRENCIES).filter((currency) => reachable.has(currency.code)),
      };
    },
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
