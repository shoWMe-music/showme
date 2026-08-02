import { schema } from "@showme/db";
import { and, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireProfileRole } from "../lib/authorize";

const IdParams = z.object({ id: z.string().uuid() });

const SummaryResponse = z.object({
  eventsHosted: z.number(),
  eventsByStatus: z.record(z.string(), z.number()),
});

const RevenueResponse = z.object({
  totalRevenue: z.string(),
  currency: z.string().nullable(),
});

const ANY_ROLE = ["owner", "admin", "editor", "viewer", "crew"] as const;
const REVENUE_ROLES = ["owner", "admin"] as const;

/**
 * Operator-facing analytics — on-the-fly SQL aggregates over a profile's hosted
 * events. Read-only; scoped by per-profile role via `requireProfileRole` (a
 * non-member is 404, no existence leak). Money is aggregated and returned as a
 * STRING (money.md's boundary), never a float.
 */
export async function insightRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // A member's headline counts: events hosted, plus a per-status breakdown.
  app.get(
    "/insights/profiles/:id/summary",
    { schema: { params: IdParams, response: { 200: SummaryResponse } } },
    async (request) => {
      const { database } = request.server;
      const { id } = request.params;

      requireProfileRole(request, id, [...ANY_ROLE]);

      const rows = await database
        .select({
          status: schema.events.status,
          count: sql<number>`count(*)::int`,
        })
        .from(schema.events)
        .where(eq(schema.events.hostProfileId, id))
        .groupBy(schema.events.status);

      const eventsByStatus: Record<string, number> = {};
      let eventsHosted = 0;
      for (const row of rows) {
        eventsByStatus[row.status] = row.count;
        eventsHosted += row.count;
      }

      return { eventsHosted, eventsByStatus };
    },
  );

  // Owner/admin revenue roll-up: sum of revenue budget lines across hosted events.
  app.get(
    "/insights/profiles/:id/revenue",
    { schema: { params: IdParams, response: { 200: RevenueResponse } } },
    async (request) => {
      const { database } = request.server;
      const { id } = request.params;

      requireProfileRole(request, id, [...REVENUE_ROLES]);

      const [totals] = await database
        .select({
          totalRevenue: sql<string>`coalesce(sum(${schema.budgetLines.amount}), 0)::text`,
        })
        .from(schema.budgetLines)
        .innerJoin(schema.budgets, eq(schema.budgets.id, schema.budgetLines.budgetId))
        .innerJoin(schema.events, eq(schema.events.id, schema.budgets.eventId))
        .where(and(eq(schema.events.hostProfileId, id), eq(schema.budgetLines.kind, "revenue")));

      const [event] = await database
        .select({ currency: schema.events.baseCurrency })
        .from(schema.events)
        .where(eq(schema.events.hostProfileId, id))
        .limit(1);

      return {
        totalRevenue: totals?.totalRevenue ?? "0",
        currency: event?.currency ?? null,
      };
    },
  );
}
