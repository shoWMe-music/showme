import { schema } from "@showme/db";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { notFound } from "../errors";
import { requireEventCapability } from "../lib/authorize";
import { resolveEventCountry } from "../lib/event-territory";

const EventParams = z.object({ id: z.string().uuid() });

/**
 * The tariff, or null. Null is a real answer here, not an error: it is what tells
 * the Budget Planner to keep printing its qualified 6% estimate instead of a
 * rate nobody published.
 */
const RateResponse = z
  .object({
    proCode: z.string(),
    proName: z.string(),
    rateBasisPoints: z.number(),
    sourceUrl: z.string().nullable(),
    sourceNote: z.string().nullable(),
  })
  .nullable();

const PerformingRightsRateResponse = z.object({
  /** ISO 3166-1 alpha-2, or null when the show cannot be placed. */
  country: z.string().nullable(),
  rate: RateResponse,
});

/**
 * "What PRO rate governs this show?" — the resolution step, and only that.
 *
 * It returns the RATE, not the fee. The planner is a live sheet: the ticket
 * revenue the fee is charged on changes with every keystroke and is not saved
 * until the operator flushes it, so the arithmetic belongs in the browser against
 * the draft (`estimatePerformingRightsFee` in `@showme/shared`, which is where
 * every other figure on that screen is computed too — CLAUDE.md keeps the money
 * math in framework-agnostic TS). What the browser cannot know is which country
 * the show is in and what an admin configured for it. That is this route.
 */
export async function performingRightsRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/events/:id/performing-rights-rate",
    { schema: { params: EventParams, response: { 200: PerformingRightsRateResponse } } },
    async (request) => {
      const { database } = request.server;
      const { id } = request.params;

      // Gated with the planner it feeds. `budget.view` is operator-only (the
      // ceiling in the auth engine), so a performer on the bill cannot read the
      // operator's cost planning through this door either.
      await requireEventCapability(request, id, "budget.view");

      const [event] = await database
        .select({ venueProfileId: schema.events.venueProfileId })
        .from(schema.events)
        .where(eq(schema.events.id, id));
      if (!event) throw notFound("Event not found");

      const country = await resolveEventCountry(database, event.venueProfileId);
      if (country === null) return { country: null, rate: null };

      const [rate] = await database
        .select()
        .from(schema.performingRightsRates)
        .where(eq(schema.performingRightsRates.country, country));

      return {
        country,
        rate: rate
          ? {
              proCode: rate.proCode,
              proName: rate.proName,
              rateBasisPoints: rate.rateBasisPoints,
              sourceUrl: rate.sourceUrl,
              sourceNote: rate.sourceNote,
            }
          : null,
      };
    },
  );
}
