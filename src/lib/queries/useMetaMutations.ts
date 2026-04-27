/**
 * Event-meta mutation hook with debounced Firestore write.
 *
 * Optimistically updates the eventEconomics cache entry, then flushes
 * the merged meta to Firestore after a 500 ms debounce.
 */

import { useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { upsertEventMeta, type EventMeta } from "@/lib/db";
import { queryKeys } from "./keys";
import type { EventEconomicsData } from "./useEventEconomics";

/**
 * Returns a function that updates event meta for any eventId (not bound at hook-call time).
 * Use this in pages that update meta for dynamically-determined eventIds (e.g. TasksPage).
 */
export function useUpdateAnyEventMeta(): (eventId: string, data: Partial<EventMeta>) => void {
  const queryClient = useQueryClient();
  return (eventId: string, data: Partial<EventMeta>) => {
    queryClient.setQueryData<EventEconomicsData>(
      queryKeys.eventEconomics(eventId),
      (old) => old ? { ...old, meta: { ...(old.meta ?? {}), ...data } } : old,
    );
    void upsertEventMeta(eventId, data);
  };
}

export function useUpdateEventMeta(eventId: string): (data: Partial<EventMeta>) => void {
  const queryClient = useQueryClient();
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  return (data: Partial<EventMeta>) => {
    // Optimistically merge into the economics cache
    queryClient.setQueryData<EventEconomicsData>(
      queryKeys.eventEconomics(eventId),
      (old) => {
        if (!old) return old;
        return { ...old, meta: { ...(old.meta ?? {}), ...data } };
      },
    );

    // Debounce the Firestore write
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const current = queryClient.getQueryData<EventEconomicsData>(
        queryKeys.eventEconomics(eventId),
      );
      const merged: EventMeta = { ...(current?.meta ?? {}), ...data };
      void upsertEventMeta(eventId, merged);
    }, 500);
  };
}
