import { ApiError, getGetApiV1EventsIdQueryKey, usePatchApiV1EventsId } from "@showme/api-client";
import { useToast } from "@showme/design-system";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "../lib/errors";
import type { EventExtras } from "./EventDetailsTab";

/** The slice of the event this editor writes against. */
export interface EditableEventExtras {
  id: string;
  version: number;
  extras?: EventExtras | null;
}

export interface EventExtrasEditor {
  /** What the cards render: the local draft while editing, else the server value. */
  extras: EventExtras;
  /** Hold a change locally (a half-typed field) without writing it. */
  change: (next: EventExtras) => void;
  /** Hold a change locally AND persist the whole extras object. */
  save: (next: EventExtras) => void;
  /** Persist whatever the draft currently holds — the commit for on-blur fields. */
  commit: () => void;
}

/**
 * Draft state + persistence for every `events.extras` card on the Event Details
 * tab (amenities, guest list, ticket tiers).
 *
 * Two defects this exists to close, both seen live on 2026-08-26:
 *
 * 1. **A write per keystroke.** The cards were controlled straight off the
 *    server value and called the parent's save on every `onChange`, so typing
 *    "Bird Balcony" into a ticket tier fired thirteen PATCHes. Here the draft is
 *    local; the caller decides when a change is worth a request (`save` for a
 *    discrete add/remove, `commit` on blur for a typed field).
 *
 * 2. **A lost-update race on `expectedVersion`.** Each write carried the version
 *    from the last completed refetch, so a second write started before that
 *    refetch landed was rejected 409 — silently, since nothing handled the
 *    error, and the input then snapped back to the server value, eating
 *    characters. The version is tracked from each PATCH *response* instead
 *    (authoritative and immediate), and writes are queued so only one is ever in
 *    flight; a later edit supersedes an unsent one, because every write carries
 *    the whole extras object.
 *
 * A 409 now means what it should — a genuine outside writer — and is surfaced,
 * with the draft dropped so the card re-renders the truth rather than a stale
 * draft the user thinks was saved.
 */
export function useEventExtrasEditor(event: EditableEventExtras): EventExtrasEditor {
  const toast = useToast();
  const queryClient = useQueryClient();
  const patchEvent = usePatchApiV1EventsId();

  const serverExtras = event.extras ?? {};
  const [draft, setDraft] = useState<EventExtras | null>(null);
  /** The version our last settled write produced — the draft may go once the
   * event query has caught up to it (see the effect below). */
  const [settledVersion, setSettledVersion] = useState<number | null>(null);

  /** The version the NEXT write must claim. Seeded from the loaded event and
   * advanced by every PATCH response, so consecutive writes never re-use one. */
  const versionRef = useRef(event.version);
  /** One write at a time; `next` holds the newest draft waiting for its turn. */
  const queueRef = useRef<{ running: boolean; next: EventExtras | null }>({
    running: false,
    next: null,
  });

  // An outside write (another tab, another user) that our refetch picked up.
  if (event.version > versionRef.current) versionRef.current = event.version;

  // Our own write has come back around through the query cache, so the server
  // value now says what the draft says: drop the draft rather than let it shadow
  // everything that follows.
  useEffect(() => {
    if (settledVersion !== null && event.version >= settledVersion) {
      setDraft(null);
      setSettledVersion(null);
    }
  }, [event.version, settledVersion]);

  const invalidateEvent = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: getGetApiV1EventsIdQueryKey(event.id) });
  }, [queryClient, event.id]);

  const flush = useCallback(async () => {
    if (queueRef.current.running) return;
    queueRef.current.running = true;
    try {
      let next = queueRef.current.next;
      while (next !== null) {
        queueRef.current.next = null;
        const updated = await patchEvent.mutateAsync({
          id: event.id,
          data: { extras: next, expectedVersion: versionRef.current },
        });
        versionRef.current = updated.version;
        next = queueRef.current.next;
        // Nothing else waiting — let the cache catch up and retire the draft.
        if (next === null) {
          setSettledVersion(updated.version);
          invalidateEvent();
        }
      }
    } catch (error) {
      queueRef.current.next = null;
      if (error instanceof ApiError && error.status === 409) {
        setDraft(null);
        setSettledVersion(null);
        invalidateEvent();
        toast.error("Someone else changed this event — reloaded their version.");
      } else {
        toast.error(errorMessage(error, "Couldn't save this change."));
        setDraft(null);
        invalidateEvent();
      }
    } finally {
      queueRef.current.running = false;
    }
  }, [event.id, patchEvent, invalidateEvent, toast]);

  const change = useCallback((next: EventExtras) => {
    setDraft(next);
  }, []);

  const save = useCallback(
    (next: EventExtras) => {
      setDraft(next);
      queueRef.current.next = next;
      void flush();
    },
    [flush],
  );

  const extras = draft ?? serverExtras;
  const commit = useCallback(() => {
    if (draft === null) return;
    queueRef.current.next = draft;
    void flush();
  }, [draft, flush]);

  return { extras, change, save, commit };
}
