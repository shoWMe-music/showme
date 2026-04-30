import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import { fetchProfiles } from "@/lib/db";
import type { SharedProfile } from "@/lib/user-context";
import { queryKeys } from "./keys";

const STALE_TIME = 5 * 60_000;

/**
 * Flat list of every profile the user owns or is a member of, no slot dedupe.
 *
 * Source of truth for access matching: event accessProfileIds, performer
 * detection (`userIsEventPerformer`), pendingDateChange.confirmations key
 * matching, RSVP attribution, etc.
 *
 * Reads from the same TanStack Query cache as `useUser().profiles` (shared
 * `queryKeys.profiles(uid)`), so no extra fetch.
 */
export function useAllProfiles(): SharedProfile[] {
  const { user } = useAuth();
  const uid = user?.uid ?? "";
  const { data } = useQuery({
    queryKey: queryKeys.profiles(uid),
    queryFn: fetchProfiles,
    enabled: !!uid,
    staleTime: STALE_TIME,
  });
  return useMemo(
    () =>
      (data?.all ?? []).map((p) =>
        (p as SharedProfile & { role: string }).role === "artist"
          ? ({ ...p, role: "performer" } as SharedProfile)
          : p,
      ),
    [data?.all],
  );
}
