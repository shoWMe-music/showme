import { schema } from "@showme/db";
import { type SQL, and, eq, inArray, ne, or, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { PaginationQuery, decodeCursor, paginate } from "../lib/pagination";
import { serializeActivity } from "../serialize/activity";

/** Target kinds that are event-level news — visible to anyone who can view the event. */
const EVENT_LEVEL_KINDS = ["event", "schedule", "participant"] as const;

const ActivityItem = z.object({
  id: z.string(),
  type: z.string(),
  eventId: z.string().nullable(),
  actorDisplay: z.string().nullable(),
  targetKind: z.string().nullable(),
  targetId: z.string().nullable(),
  summary: z.unknown(),
  createdAt: z.string(),
});

const ActivityFeedResponse = z.object({
  items: z.array(ActivityItem),
  nextCursor: z.string().nullable(),
});

interface Cursor {
  createdAt: string;
  id: string;
}

/**
 * The user-facing activity feed (decisions #3), TARGET-SCOPED: a row is visible iff
 * the viewer can view its target — the same access model that gates the resource,
 * folded into one `WHERE` (no second visibility system). Event-level rows are seen
 * by all participants; deal/settlement rows only by their party; operators see
 * everything on their events. Falls out for free.
 */
export async function activityRoutes(fastify: FastifyInstance): Promise<void> {
  fastify
    .withTypeProvider<ZodTypeProvider>()
    .get(
      "/activity",
      { schema: { querystring: PaginationQuery, response: { 200: ActivityFeedResponse } } },
      async (request) => {
        const principal = request.principal;
        if (!principal) throw new Error("principal missing after authentication");
        const { database } = request.server;
        const { cursor, limit } = request.query;

        const viewerProfileIds = principal.memberships.map((m) => m.profileId);
        if (viewerProfileIds.length === 0) return { items: [], nextCursor: null };

        // The viewer's participant rows → reachable events, operator events, ids.
        const participants = await database
          .select({
            id: schema.eventParticipants.id,
            eventId: schema.eventParticipants.eventId,
            role: schema.eventParticipants.role,
          })
          .from(schema.eventParticipants)
          .where(
            and(
              inArray(schema.eventParticipants.profileId, viewerProfileIds),
              ne(schema.eventParticipants.status, "removed"),
            ),
          );

        const reachableEvents = [...new Set(participants.map((p) => p.eventId))];
        if (reachableEvents.length === 0) return { items: [], nextCursor: null };
        const operatorEvents = [
          ...new Set(
            participants
              .filter((p) => p.role === "host" || p.role === "co_host")
              .map((p) => p.eventId),
          ),
        ];
        const participantIds = participants.map((p) => p.id);

        // Party-scoped id lists: the viewer's deals and settlements.
        const dealPartyRows = await database
          .select({ dealId: schema.dealParties.dealId })
          .from(schema.dealParties)
          .where(inArray(schema.dealParties.participantId, participantIds));
        const viewerDealIds = [...new Set(dealPartyRows.map((d) => d.dealId))];

        const settlementRows = await database
          .select({ id: schema.settlements.id })
          .from(schema.settlements)
          .where(inArray(schema.settlements.participantId, participantIds));
        const viewerSettlementIds = settlementRows.map((s) => s.id);

        // The WHERE *is* the rule: reachable event AND a target the viewer may see.
        const visible: (SQL<unknown> | undefined)[] = [
          inArray(schema.activityLog.targetKind, [...EVENT_LEVEL_KINDS]),
        ];
        if (operatorEvents.length > 0) {
          visible.push(inArray(schema.activityLog.eventId, operatorEvents));
        }
        if (viewerDealIds.length > 0) {
          visible.push(
            and(
              eq(schema.activityLog.targetKind, "deal"),
              inArray(schema.activityLog.targetId, viewerDealIds),
            ),
          );
        }
        if (viewerSettlementIds.length > 0) {
          visible.push(
            and(
              eq(schema.activityLog.targetKind, "settlement"),
              inArray(schema.activityLog.targetId, viewerSettlementIds),
            ),
          );
        }

        const conditions = [inArray(schema.activityLog.eventId, reachableEvents), or(...visible)];
        if (cursor) {
          const decoded = decodeCursor<Cursor>(cursor);
          conditions.push(
            sql`(date_trunc('milliseconds', ${schema.activityLog.createdAt}), ${schema.activityLog.id}) < (${decoded.createdAt}::timestamptz, ${decoded.id}::uuid)`,
          );
        }

        const rows = await database
          .select()
          .from(schema.activityLog)
          .where(and(...conditions))
          .orderBy(
            sql`date_trunc('milliseconds', ${schema.activityLog.createdAt}) desc, ${schema.activityLog.id} desc`,
          )
          .limit(limit + 1);

        const { items, nextCursor } = paginate(rows, limit, (row) => ({
          createdAt: row.createdAt.toISOString(),
          id: row.id,
        }));
        return { items: items.map(serializeActivity), nextCursor };
      },
    );
}
