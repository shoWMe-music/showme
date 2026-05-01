/**
 * Profile-scoped todo query hooks.
 *
 * Todos created from EventManager's TodoTab live in
 * `events/{eventId}/meta/todos_{scopeId}` — one doc per acting profile (or
 * per uid if the user has no profile on that event). Rules restrict each
 * doc to members of that profile, which gives us per-party privacy.
 *
 * `useAllProfileTodos` walks the user's profiles + each event's
 * accessProfileIds to figure out which scope docs they can read, then
 * fetches them in parallel with TanStack Query.
 *
 * NOTE: scopeId is encoded in the doc id (`todos_{scopeId}`), not in the
 * doc body. We carry it through alongside the loaded todos so callers can
 * route writes back to the correct doc.
 */

import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";

import { useAuth } from "@/lib/auth-context";
import { fetchProfileTodos, type Todo } from "@/lib/db";
import type { Event } from "@/lib/models";
import { queryKeys } from "./keys";
import { useAllProfiles } from "./useProfilesQuery";

export interface ProfileTodoGroup {
  scopeId: string;
  todos: Todo[];
}

/**
 * Compute (eventId, scopeId) pairs the current user can read for the given
 * events. Includes every profile of theirs that's in `accessProfileIds`,
 * plus the personal `user_{uid}` scope.
 */
function buildEventScopes(
  events: Pick<Event, "id" | "accessProfileIds">[],
  userProfileIds: string[],
  uid: string,
): { eventId: string; scopeIds: string[] }[] {
  return events.map((e) => {
    const eventProfileIds = (e.accessProfileIds || []).filter((pid) =>
      userProfileIds.includes(pid),
    );
    const scopeIds = uid ? [...eventProfileIds, `user_${uid}`] : eventProfileIds;
    return { eventId: e.id, scopeIds };
  });
}

export function useAllProfileTodos(
  events: Pick<Event, "id" | "accessProfileIds">[],
): Record<string, ProfileTodoGroup[]> {
  const { user } = useAuth();
  const uid = user?.uid ?? "";
  const allProfiles = useAllProfiles();
  const userProfileIds = useMemo(
    () => allProfiles.map((p) => p.id).filter(Boolean) as string[],
    [allProfiles],
  );

  const eventScopes = useMemo(
    () => buildEventScopes(events, userProfileIds, uid),
    [events, userProfileIds, uid],
  );

  const flatPairs = useMemo(
    () =>
      eventScopes.flatMap(({ eventId, scopeIds }) =>
        scopeIds.map((scopeId) => ({ eventId, scopeId })),
      ),
    [eventScopes],
  );

  const results = useQueries({
    queries: flatPairs.map(({ eventId, scopeId }) => ({
      queryKey: queryKeys.profileTodos(eventId, scopeId),
      queryFn: () => fetchProfileTodos(eventId, scopeId),
      enabled: !!eventId && !!scopeId,
      staleTime: 10 * 60 * 1000,
    })),
  });

  return useMemo(() => {
    const map: Record<string, ProfileTodoGroup[]> = {};
    flatPairs.forEach(({ eventId, scopeId }, i) => {
      const r = results[i];
      if (r.isSuccess && r.data && r.data.length > 0) {
        if (!map[eventId]) map[eventId] = [];
        map[eventId].push({ scopeId, todos: r.data });
      }
    });
    return map;
  }, [flatPairs, results]);
}

/**
 * Resolve the user's primary write-scope for a single event. Prefers a
 * matching profile (host first, then any access profile) before falling
 * back to the personal `user_{uid}` scope.
 */
export function resolveWriteScopeId(
  event: Pick<Event, "hostProfileId" | "accessProfileIds">,
  userProfileIds: string[],
  uid: string,
): string {
  if (event.hostProfileId && userProfileIds.includes(event.hostProfileId)) {
    return event.hostProfileId;
  }
  const accessMatch = (event.accessProfileIds || []).find((pid) =>
    userProfileIds.includes(pid),
  );
  if (accessMatch) return accessMatch;
  return `user_${uid}`;
}
