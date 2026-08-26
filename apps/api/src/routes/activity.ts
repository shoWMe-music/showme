import { effectiveEventCapabilitiesForEvents } from "@showme/auth";
import { schema } from "@showme/db";
import type { Capability } from "@showme/shared";
import { type SQL, and, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  ACTIVITY_KIND_CAPABILITY,
  ACTIVITY_OPERATOR_CAPABILITY,
  ACTIVITY_PARTICIPANT_SCOPED_KINDS,
  type ActivityTargetKind,
} from "../lib/activity";
import { PaginationQuery, decodeCursor, paginate } from "../lib/pagination";
import { serializeActivity } from "../serialize/activity";

/** Party-scoped kinds — gated by membership of the target row, not by a capability. */
const PARTY_SCOPED_KINDS = ["deal", "settlement", "transfer"] as const;

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

/** Optional per-event scope for an event's own history tab. */
const ActivityQuery = PaginationQuery.extend({ eventId: z.string().uuid().optional() });

interface Cursor {
  createdAt: string;
  id: string;
}

/**
 * The user-facing activity feed (decisions #3), TARGET-SCOPED: a row is visible iff
 * the viewer can view its target — the same access model that gates the resource,
 * folded into one `WHERE` (no second visibility system). Event-level rows are seen
 * by all participants; deal/settlement/transfer rows only by their party; rider and
 * setlist rows only by the participant they are about; operators see everything on
 * their events.
 *
 * The scoping is by the viewer's EFFECTIVE CAPABILITIES on each event, resolved by
 * the same engine every route uses (`effectiveEventCapabilitiesForEvents`), not by
 * their event ROLE. A role is only a candidate: a `co_host` carrying a `view_only`
 * permission set holds no `budget.view`, and reading the role would have handed
 * them the operator tier — the pool figures the serializer redacts from the budget
 * screen itself. Two extra queries, whatever the number of events; no N+1.
 */
export async function activityRoutes(fastify: FastifyInstance): Promise<void> {
  fastify
    .withTypeProvider<ZodTypeProvider>()
    .get(
      "/activity",
      { schema: { querystring: ActivityQuery, response: { 200: ActivityFeedResponse } } },
      async (request) => {
        const principal = request.principal;
        if (!principal) throw new Error("principal missing after authentication");
        const { database } = request.server;
        const { cursor, limit, eventId } = request.query;

        const viewerProfileIds = principal.memberships.map((membership) => membership.profileId);
        if (viewerProfileIds.length === 0) return { items: [], nextCursor: null };

        // The viewer's participant rows → reachable events and the participant ids
        // that party-scoping joins through.
        const participants = await database
          .select({
            id: schema.eventParticipants.id,
            eventId: schema.eventParticipants.eventId,
          })
          .from(schema.eventParticipants)
          .where(
            and(
              inArray(schema.eventParticipants.profileId, viewerProfileIds),
              ne(schema.eventParticipants.status, "removed"),
            ),
          );

        let reachableEvents = [...new Set(participants.map((row) => row.eventId))];
        // Per-event history: narrow to the one event, but only if the viewer can
        // actually reach it — an unreachable id yields an empty feed, not a leak.
        if (eventId) {
          if (!reachableEvents.includes(eventId)) return { items: [], nextCursor: null };
          reachableEvents = [eventId];
        }
        if (reachableEvents.length === 0) return { items: [], nextCursor: null };
        const participantIds = participants
          .filter((row) => reachableEvents.includes(row.eventId))
          .map((row) => row.id);

        // What the viewer may actually DO on each reachable event — the authority
        // for which kinds they may read about.
        const capabilitiesByEvent = await effectiveEventCapabilitiesForEvents(
          database,
          principal,
          reachableEvents,
        );

        // Events grouped by the kind-set they admit. Most viewers hold the same
        // capabilities across all their events, so this collapses to one or two
        // `(event_id IN …) AND (target_kind IN …)` clauses rather than one per event.
        const eventsByKindSet = new Map<string, { eventIds: string[]; kinds: string[] }>();
        const operatorEvents: string[] = [];
        for (const reachableEventId of reachableEvents) {
          const capabilities = capabilitiesByEvent.get(reachableEventId) ?? new Set<Capability>();
          if (capabilities.has(ACTIVITY_OPERATOR_CAPABILITY)) {
            operatorEvents.push(reachableEventId);
            continue; // operators see every kind on their events — no kind filter needed
          }
          const kinds = (
            Object.entries(ACTIVITY_KIND_CAPABILITY) as [ActivityTargetKind, Capability][]
          )
            .filter(([, capability]) => capabilities.has(capability))
            .map(([kind]) => kind);
          if (kinds.length === 0) continue;
          const key = kinds.join(",");
          const bucket = eventsByKindSet.get(key);
          if (bucket) bucket.eventIds.push(reachableEventId);
          else eventsByKindSet.set(key, { eventIds: [reachableEventId], kinds });
        }

        // Party-scoped id lists: the viewer's deals, settlements and transfers.
        const dealPartyRows = await database
          .select({ dealId: schema.dealParties.dealId })
          .from(schema.dealParties)
          .where(inArray(schema.dealParties.participantId, participantIds));
        const viewerDealIds = [...new Set(dealPartyRows.map((row) => row.dealId))];

        const settlementRows = await database
          .select({ id: schema.settlements.id })
          .from(schema.settlements)
          .where(inArray(schema.settlements.participantId, participantIds));
        const viewerSettlementIds = settlementRows.map((row) => row.id);

        // A transfer is settled by EITHER end of it — the same "party membership,
        // not an operator capability" rule the transfer route itself applies.
        // Commission transfers are excluded here as well as at the write side, so
        // neither their amount nor their existence can surface through the feed.
        const transferRows = await database
          .select({ id: schema.settlementTransfers.id })
          .from(schema.settlementTransfers)
          .where(
            and(
              isNull(schema.settlementTransfers.representationId),
              or(
                inArray(schema.settlementTransfers.fromParticipant, participantIds),
                inArray(schema.settlementTransfers.toParticipant, participantIds),
              ),
            ),
          );
        const viewerTransferIds = transferRows.map((row) => row.id);

        // The WHERE *is* the rule: a reachable event AND a target the viewer may see.
        const visible: (SQL<unknown> | undefined)[] = [];
        if (operatorEvents.length > 0) {
          visible.push(inArray(schema.activityLog.eventId, operatorEvents));
        }
        for (const { eventIds, kinds } of eventsByKindSet.values()) {
          visible.push(
            and(
              inArray(schema.activityLog.eventId, eventIds),
              inArray(schema.activityLog.targetKind, kinds),
            ),
          );
        }
        const partyScoped: Record<(typeof PARTY_SCOPED_KINDS)[number], string[]> = {
          deal: viewerDealIds,
          settlement: viewerSettlementIds,
          transfer: viewerTransferIds,
        };
        for (const kind of PARTY_SCOPED_KINDS) {
          const targetIds = partyScoped[kind];
          if (targetIds.length === 0) continue;
          visible.push(
            and(
              eq(schema.activityLog.targetKind, kind),
              inArray(schema.activityLog.targetId, targetIds),
            ),
          );
        }

        // Participant-scoped kinds (`rider`, `setlist`) carry the OWNING participant
        // id in `target_id`, so the viewer's own participant rows are the whole
        // filter — no extra query, and the same list the party scoping joins through.
        // A rider or setlist the viewer merely has REACH over (sponsored crew, an
        // explicit share) is deliberately absent: see `lib/activity.ts`.
        if (participantIds.length > 0) {
          visible.push(
            and(
              inArray(schema.activityLog.targetKind, [...ACTIVITY_PARTICIPANT_SCOPED_KINDS]),
              inArray(schema.activityLog.targetId, participantIds),
            ),
          );
        }
        if (visible.length === 0) return { items: [], nextCursor: null };

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
