/**
 * Per-event lazy economics query hooks.
 *
 * Economics (deal / revenue / settlement / meta) are loaded on demand rather
 * than up-front with the primary data. This keeps the initial load fast.
 */

import { useQuery, useQueries, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/lib/auth-context";
import {
  fetchDeal,
  fetchRevenue,
  fetchSettlement,
  fetchEventMeta,
  upsertSettlement,
  type EventMeta,
} from "@/lib/db";
import type { DealStructure, TicketRevenue, Settlement, Event } from "@/lib/models";
import { buildSettlementUpdate, emptyRevenue } from "@/lib/settlementUtils";
import { queryKeys } from "./keys";
import { useEventsLoaded } from "./useEventsQuery";

// ── Public type ────────────────────────────────────────────────────────────────

export interface EventEconomicsData {
  deal: DealStructure | undefined;
  revenue: TicketRevenue | undefined;
  settlement: Settlement | undefined;
  meta: EventMeta;
}

// ── Main per-event query ───────────────────────────────────────────────────────

export function useEventEconomics(
  eventId: string,
  enabled?: boolean,
): EventEconomicsData & { isLoaded: boolean; isLoading: boolean } {
  const { user } = useAuth();
  const uid = user?.uid ?? "";
  const eventsLoaded = useEventsLoaded();
  const queryClient = useQueryClient();

  const query = useQuery<EventEconomicsData>({
    queryKey: queryKeys.eventEconomics(eventId),
    enabled: !!eventId && eventsLoaded && (enabled ?? true),
    staleTime: 10 * 60 * 1000,
    queryFn: async (): Promise<EventEconomicsData> => {
      const [deal, revenue, settlement, meta] = await Promise.all([
        fetchDeal(eventId),
        fetchRevenue(eventId),
        fetchSettlement(eventId),
        fetchEventMeta(eventId),
      ]);

      let resolvedSettlement: Settlement | undefined = settlement ?? undefined;

      // Auto-create settlement for concluded events that don't have one yet
      if (!resolvedSettlement && deal) {
        const events = queryClient.getQueriesData<Event[]>({ queryKey: queryKeys.events(uid) })[0]?.[1];
        const event = events?.find((e) => e.id === eventId);
        if (event?.eventStatus === "concluded") {
          const rev = revenue ?? emptyRevenue(eventId);
          resolvedSettlement = buildSettlementUpdate(deal, rev, undefined);
          void upsertSettlement(eventId, resolvedSettlement);
        }
      }

      return {
        deal: deal ?? undefined,
        revenue: revenue ?? undefined,
        settlement: resolvedSettlement,
        meta: meta ?? {},
      };
    },
  });

  return {
    deal: query.data?.deal,
    revenue: query.data?.revenue,
    settlement: query.data?.settlement,
    meta: query.data?.meta ?? {},
    isLoaded: query.isSuccess,
    isLoading: query.isLoading,
  };
}

// ── Batch query for multiple events ───────────────────────────────────────────

/**
 * Load economics for multiple events in parallel.
 * Returns a map of eventId → EventEconomicsData for all successfully loaded events.
 */
export function useAllEventEconomics(
  eventIds: string[],
): Record<string, EventEconomicsData> {
  const { user } = useAuth();
  const uid = user?.uid ?? "";
  const eventsLoaded = useEventsLoaded();
  const queryClient = useQueryClient();

  const results = useQueries({
    queries: eventIds.map((eventId) => ({
      queryKey: queryKeys.eventEconomics(eventId),
      enabled: !!eventId && eventsLoaded,
      staleTime: 10 * 60 * 1000,
      queryFn: async (): Promise<EventEconomicsData> => {
        const [deal, revenue, settlement, meta] = await Promise.all([
          fetchDeal(eventId),
          fetchRevenue(eventId),
          fetchSettlement(eventId),
          fetchEventMeta(eventId),
        ]);

        let resolvedSettlement: Settlement | undefined = settlement ?? undefined;

        if (!resolvedSettlement && deal) {
          const events = queryClient.getQueriesData<Event[]>({ queryKey: queryKeys.events(uid) })[0]?.[1];
          const event = events?.find((e) => e.id === eventId);
          if (event?.eventStatus === "concluded") {
            const rev = revenue ?? emptyRevenue(eventId);
            resolvedSettlement = buildSettlementUpdate(deal, rev, undefined);
            void upsertSettlement(eventId, resolvedSettlement);
          }
        }

        return {
          deal: deal ?? undefined,
          revenue: revenue ?? undefined,
          settlement: resolvedSettlement,
          meta: meta ?? {},
        };
      },
    })),
  });

  const map: Record<string, EventEconomicsData> = {};
  results.forEach((result, index) => {
    if (result.isSuccess && result.data) {
      map[eventIds[index]] = result.data;
    }
  });
  return map;
}
