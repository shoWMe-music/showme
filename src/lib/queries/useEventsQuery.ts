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
import { queryKeys } from "./keys";

// ── Main query ─────────────────────────────────────────────────────────────────

export function useEventsQuery() {
  const { user, loading: authLoading } = useAuth();
  const uid = user?.uid ?? "";
  const { profiles } = useUser();
  const profileIds = Object.values(profiles).map(p => p.id).filter(Boolean) as string[];

  return useQuery<Event[]>({
    queryKey: queryKeys.events(uid),
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

  return useInfiniteQuery<EventPage, Error>({
    queryKey: queryKeys.eventPages(uid, filters as Record<string, unknown>),
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

// ── Auto-conclude hook ─────────────────────────────────────────────────────────

/**
 * Runs once after events have loaded and advances confirmed events whose
 * date has already passed to "concluded" status.
 */
export function useAutoConcludeEvents(): void {
  const eventsLoaded = useEventsLoaded();
  const events = useEvents();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const uid = user?.uid ?? "";

  useEffect(() => {
    if (!eventsLoaded || !uid) return;

    const today = new Date().toISOString().slice(0, 10);
    const toConclude = events.filter(
      (e) => e.eventStatus === "confirmed" && e.date < today && !e.archived,
    );

    if (toConclude.length === 0) return;

    queryClient.setQueryData<Event[]>(
      queryKeys.events(uid),
      (old) => {
        if (!old) return old;
        return old.map((e) =>
          toConclude.some((c) => c.id === e.id)
            ? { ...e, eventStatus: "concluded" as const }
            : e,
        );
      },
    );

    for (const ev of toConclude) {
      void upsertEvent({ ...ev, eventStatus: "concluded" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventsLoaded]);
}
