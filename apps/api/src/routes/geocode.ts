import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { HttpError } from "../errors";
import { createSlidingWindowRateLimiter } from "../lib/rate-limit";

const GeocodeQuery = z.object({
  query: z.string().min(3).max(200),
  limit: z.coerce.number().int().min(1).max(10).default(5),
  /** Narrow to one country when the profile already knows which one it is in. */
  country: z.string().length(2).optional(),
});

const GeocodeResponse = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      street: z.string().nullable(),
      postcode: z.string().nullable(),
      city: z.string().nullable(),
      country: z.string().nullable(),
      lat: z.number(),
      lng: z.number(),
    }),
  ),
});

/** A minute's worth of typing, generously: the client debounces to ~3/second at worst. */
const LOOKUPS_PER_MINUTE = 60;

/**
 * Address lookup for the profile editor (`GET /geocode?query=…`).
 *
 * Signed-in only, and deliberately not resource-scoped: there is nothing here to
 * authorize against. A geocode reveals nothing about shoWMe — it is a public
 * address database — so the rule is simply "a member of the platform", which is
 * what the global `authenticate` preHandler already establishes. What the route
 * really protects is the CREDENTIAL and the bill behind it, hence the per-user
 * rate limit rather than a capability check.
 *
 * The token itself never reaches the browser (`lib/geocode.ts`).
 */
export async function geocodeRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const lookupsPerUser = createSlidingWindowRateLimiter({
    limit: LOOKUPS_PER_MINUTE,
    windowMs: 60_000,
  });

  app.get(
    "/geocode",
    { schema: { querystring: GeocodeQuery, response: { 200: GeocodeResponse } } },
    async (request) => {
      const { geocoder } = request.server;
      if (!geocoder) {
        throw new HttpError(
          503,
          "Address lookup is not configured on this deployment",
          "geocoder_unavailable",
        );
      }
      if (!lookupsPerUser.take(request.principal?.userId ?? "anonymous")) {
        throw new HttpError(
          429,
          "Too many address lookups; wait a moment and keep typing",
          "rate_limited",
        );
      }

      const { query, limit, country } = request.query;
      try {
        return { results: await geocoder.search({ query, limit, country }) };
      } catch (error) {
        // The provider being down is not the caller's fault and must not read as
        // one: a 500 here would put a red toast on a venue who typed a valid
        // address. 502 says "upstream", and the message says which upstream.
        request.log.error({ error }, "geocoding provider failed");
        throw new HttpError(502, "The address lookup service did not answer", "geocoder_failed");
      }
    },
  );
}
