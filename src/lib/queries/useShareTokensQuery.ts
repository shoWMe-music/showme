/**
 * Share tokens query hook.
 *
 * Fetches settlement/budget/event share tokens for the current user.
 */

import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/lib/auth-context";
import { fetchShareTokens } from "@/lib/db";
import { queryKeys } from "./keys";

// ── Public type ────────────────────────────────────────────────────────────────

export interface ShareToken {
  token: string;
  eventId: string;
  createdAt: string;
  parties: string[];
}

// ── Main query ─────────────────────────────────────────────────────────────────

export function useShareTokensQuery() {
  const { user, loading: authLoading } = useAuth();
  const uid = user?.uid ?? "";

  return useQuery<Record<string, ShareToken>>({
    queryKey: queryKeys.shareTokens(uid),
    enabled: !!uid && !authLoading,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const raw = await fetchShareTokens();
      return raw as Record<string, ShareToken>;
    },
  });
}

// ── Selectors ──────────────────────────────────────────────────────────────────

export function useShareTokens(): Record<string, ShareToken> {
  const { data } = useShareTokensQuery();
  return data ?? {};
}
