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
  /**
   * The one currency this sum may be labelled with, or NULL when there is not one.
   *
   * decisions §25.8.1: *whenever the rows a tile sums are not all one currency, print `—` and a note
   * saying why.* This used to answer the FIRST hosted event's `base_currency` off a `limit(1)` with
   * no `ORDER BY` — so a host with one Oslo night read a SEK+NOK total labelled SEK, and the label
   * was also nondeterministic between identical requests (QA sweep run 14).
   */
  currency: z.string().nullable(),
  /**
   * Is `currency` null because the sum spans MORE THAN ONE, rather than because there is nothing to
   * label? The two need different sentences: a mix has to say so, and an empty ledger has nothing to
   * explain. `currency: null` alone cannot tell them apart, which is why this is a second field and
   * not an overloaded one.
   */
  mixedCurrency: z.boolean(),
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
        .where(
          and(
            eq(schema.events.hostProfileId, id),
            eq(schema.budgetLines.kind, "revenue"),
            /*
             * SHARED LEDGERS ONLY — this aggregated the private books too, and one of them
             * belonged to somebody else (QA sweep run 9, QA9-1).
             *
             * `PLAN.md:215`: a private book is *"the extra an operator MAY ALSO keep, existing
             * only once there is a co-host to keep it from."* Without this predicate the host's
             * all-time figure carried both private books on a co-promoted event — SEK 12,345 of
             * it the CO-HOST's — under a screen that says *"Every figure here comes from the
             * event's shared ledger"*. A leak, not a rounding error.
             *
             * The DETAIL route has always enforced this (`visibleBudgetFilter` in
             * `routes/budget.ts`), so the aggregate was contradicting the route it sits above.
             * The web's own `projectFromBudgets` filters to `scope === "shared"` for the panel
             * beside it, which is why the panel was right and only the footnote was wrong —
             * and why "shared" rather than "shared plus my own" is the answer: one definition,
             * and it is the panel's.
             */
            eq(schema.budgets.scope, "shared"),
          ),
        );

      /*
       * THE CURRENCIES OF THE ROWS THAT WERE ACTUALLY SUMMED — not of the profile's events.
       *
       * This was `select base_currency from events where host = id limit(1)`, with no `ORDER BY`: the
       * first hosted event's currency, labelling a sum of every hosted event's revenue. A host with
       * one Oslo night read a SEK+NOK total under "SEK", and two identical requests could disagree
       * (QA sweep run 14).
       *
       * The predicate is the SUM's, repeated deliberately. Asking `events` alone would let a hosted
       * night with no shared budget — which contributes nothing — report a mix that is not in the
       * figure, and refusing to name a currency the sum really is in would be the opposite defect.
       */
      const currencies = await database
        .selectDistinct({ currency: schema.events.baseCurrency })
        .from(schema.budgetLines)
        .innerJoin(schema.budgets, eq(schema.budgets.id, schema.budgetLines.budgetId))
        .innerJoin(schema.events, eq(schema.events.id, schema.budgets.eventId))
        .where(
          and(
            eq(schema.events.hostProfileId, id),
            eq(schema.budgetLines.kind, "revenue"),
            eq(schema.budgets.scope, "shared"),
          ),
        );
      const named = currencies.map((row) => row.currency).filter((code): code is string => !!code);

      return {
        totalRevenue: totals?.totalRevenue ?? "0",
        currency: named.length === 1 ? (named[0] as string) : null,
        mixedCurrency: named.length > 1,
      };
    },
  );
}
