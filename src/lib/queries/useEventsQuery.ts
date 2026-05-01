/**
 * Events query hook and selector helpers.
 *
 * Fetches all events accessible to the current user as a standalone
 * TanStack Query — split from the former monolithic primaryData query.
 */

import { useEffect } from "react";
import { useQuery, useInfiniteQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import type { QueryDocumentSnapshot } from "firebase/firestore";

import { useAuth } from "@/lib/auth-context";
import { useUser } from "@/lib/user-context";
import { fetchEvents, fetchEventPage, fetchEventsInRange, upsertEvent, type EventPageFilters } from "@/lib/db";
import type { Event } from "@/lib/models";
import { todayLocalIso, UNCONFIRMED_STATUSES } from "@/lib/eventLifecycle";
import { queryKeys } from "./keys";

// ── Main query ─────────────────────────────────────────────────────────────────

export function useEventsQuery() {
  const { user, loading: authLoading } = useAuth();
  const uid = user?.uid ?? "";
  const { profiles } = useUser();
  const profileIds = Object.values(profiles).map(p => p.id).filter(Boolean) as string[];
  const profileKey = profileIds.slice().sort().join(",");

  return useQuery<Event[]>({
    queryKey: [...queryKeys.events(uid), profileKey],
    enabled: !!uid && !authLoading,
    staleTime: 5 * 60 * 1000,
    queryFn: () => fetchEvents(profileIds),
  });
}

// ── Selectors ──────────────────────────────────────────────────────────────────

export function useEvents(): Event[] {
  const { data } = useEventsQuery();
  return data ?? [];
}

export function useEventsLoaded(): boolean {
  const { isSuccess } = useEventsQuery();
  return isSuccess;
}

export function useEvent(id: string): Event | undefined {
  const events = useEvents();
  return events.find((e) => e.id === id);
}

export function useChildEvents(parentId: string): Event[] {
  const events = useEvents();
  const parent = events.find((e) => e.id === parentId);
  if (!parent?.childEventIds) return [];
  return events.filter((e) => parent.childEventIds!.includes(e.id) && !e.archived);
}

// ── Paginated query (for EventsPage) ───────────────────────────────────────────

interface EventPage {
  events: Event[];
  lastDoc: QueryDocumentSnapshot | null;
  hasMore: boolean;
}

/**
 * Firestore cursor-based pagination for the events list page.
 * Fetches events in batches of `pageSize`, ordered by date descending.
 * Other pages should keep using `useEvents()` which loads all events.
 */
export function usePaginatedEvents(pageSize: number, filters?: EventPageFilters) {
  const { user, loading: authLoading } = useAuth();
  const uid = user?.uid ?? "";
  const { profiles } = useUser();
  const profileIds = Object.values(profiles).map(p => p.id).filter(Boolean) as string[];
  const profileKey = profileIds.slice().sort().join(",");

  return useInfiniteQuery<EventPage, Error>({
    queryKey: [...queryKeys.eventPages(uid, filters as Record<string, unknown>), profileKey],
    enabled: !!uid && !authLoading,
    staleTime: 5 * 60 * 1000,
    initialPageParam: null as QueryDocumentSnapshot | null,
    queryFn: ({ pageParam }) => fetchEventPage(pageSize, pageParam, filters, profileIds),
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.lastDoc : undefined),
  });
}

// ── Calendar date-range query ─────────────────────────────────────────────────

/**
 * Fetch all events within a date range from Firestore.
 * Used by the calendar to avoid loading the entire event set.
 */
export function useCalendarEvents(dateFrom: string, dateTo: string) {
  const { user, loading: authLoading } = useAuth();
  const uid = user?.uid ?? "";

  return useQuery<Event[]>({
    queryKey: queryKeys.calendarEvents(uid, dateFrom, dateTo),
    enabled: !!uid && !authLoading && !!dateFrom && !!dateTo,
    staleTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
    queryFn: () => fetchEventsInRange(dateFrom, dateTo),
  });
}

// ── Auto-status hook ───────────────────────────────────────────────────────────

/**
 * Runs once after events have loaded and advances expired events:
 *   • confirmed + past date → concluded
 *   • draft/suggested/pending/on_hold + past date → cancelled
 *     (with autoCancelledReason so the UI can warn and a notification fires)
 */
export function useAutoConcludeEvents(): void {
  const eventsLoaded = useEventsLoaded();
  const events = useEvents();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const uid = user?.uid ?? "";

  useEffect(() => {
    if (!eventsLoaded || !uid) return;

    const today = todayLocalIso();
    const toConclude = events.filter(
      (e) => e.eventStatus === "confirmed" && e.date < today && !e.archived,
    );
    const toAutoCancel = events.filter(
      (e) =>
        UNCONFIRMED_STATUSES.includes(e.eventStatus) &&
        e.date < today &&
        !e.archived &&
        e.autoCancelledReason !== "expired_unconfirmed",
    );

    if (toConclude.length === 0 && toAutoCancel.length === 0) return;

    queryClient.setQueriesData<Event[]>(
      { queryKey: queryKeys.events(uid) },
      (old) => {
        if (!old) return old;
        return old.map((e) => {
          if (toConclude.some((c) => c.id === e.id)) {
            return { ...e, eventStatus: "concluded" as const };
          }
          if (toAutoCancel.some((c) => c.id === e.id)) {
            return {
              ...e,
              eventStatus: "cancelled" as const,
              autoCancelledReason: "expired_unconfirmed" as const,
            };
          }
          return e;
        });
      },
    );

    for (const ev of toConclude) {
      void upsertEvent({ ...ev, eventStatus: "concluded" });
    }
    for (const ev of toAutoCancel) {
      void upsertEvent({
        ...ev,
        eventStatus: "cancelled",
        autoCancelledReason: "expired_unconfirmed",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventsLoaded]);
}
