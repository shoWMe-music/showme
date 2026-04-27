import { useQuery } from "@tanstack/react-query";
import { fetchEventActivity, fetchSettlementActivity } from "@/lib/db";
import type { EventActivity } from "@/lib/models";
import type { SettlementActivity } from "@/lib/models";
import { queryKeys } from "./keys";

export type ActivityEntry =
  | (EventActivity & { source: "event" })
  | (SettlementActivity & { source: "settlement" });

export function useEventActivityLog(eventId: string) {
  const eventQ = useQuery<EventActivity[]>({
    queryKey: queryKeys.eventActivity(eventId),
    queryFn: () => fetchEventActivity(eventId),
    enabled: !!eventId,
    staleTime: 30 * 1000,
  });

  const settlementQ = useQuery<SettlementActivity[]>({
    queryKey: queryKeys.settlementActivity(eventId),
    queryFn: () => fetchSettlementActivity(eventId),
    enabled: !!eventId,
    staleTime: 30 * 1000,
  });

  const isLoading = eventQ.isLoading || settlementQ.isLoading;

  const entries: ActivityEntry[] = [
    ...(eventQ.data ?? []).map((e) => ({ ...e, source: "event" as const })),
    ...(settlementQ.data ?? []).map((e) => ({ ...e, source: "settlement" as const })),
  ].sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  return { entries, isLoading };
}
