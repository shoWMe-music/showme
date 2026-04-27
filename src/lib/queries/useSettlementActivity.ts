import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { appendSettlementActivity, fetchSettlementActivity } from "@/lib/db";
import { getAuthClient } from "@/lib/firebaseAuth";
import type { SettlementActivity, SettlementActivityType } from "@/lib/models";
import { queryKeys } from "./keys";

export function useSettlementActivity(eventId: string) {
  return useQuery<SettlementActivity[]>({
    queryKey: queryKeys.settlementActivity(eventId),
    queryFn: () => fetchSettlementActivity(eventId),
    enabled: !!eventId,
    staleTime: 30 * 1000,
  });
}

export function useLogSettlementActivity() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (vars: {
      eventId: string;
      type: SettlementActivityType;
      details?: Record<string, string>;
    }): Promise<void> => {
      const auth = getAuthClient();
      const by = auth.currentUser?.displayName || auth.currentUser?.email || "Unknown";
      await appendSettlementActivity(vars.eventId, vars.type, by, vars.details);
    },
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.settlementActivity(vars.eventId),
      });
    },
  });
}
