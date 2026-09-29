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
  /**
   * Whether the draft holds something the server has NOT been told about yet
   * (QA sweep run 5, QA5-13).
   *
   * These cards save on blur, which is an ordinary pattern — what made it worth a
   * finding is that a summary band computed from the draft read like a saved figure.
   * Measured: *"50 max · 40 est."* on screen with `events.extras.ticketTiers` holding
   * `est: 0`, and a reload took the screen back to zero.
   *
   * Reference identity is the test, the same one the retire effect uses: `change`
   * builds a new object per keystroke, so a draft that is still the object the last
   * write carried has had nothing typed into it since.
   */
  hasUnwrittenChanges: boolean;
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
  /**
   * The draft object the last write actually carried — the guard on retiring it.
   *
   * Reference identity is the whole test: `change` builds a NEW object for every
   * keystroke, so a draft that is still the same object as the one written has had
   * nothing typed into it since.
   */
  const writtenRef = useRef<EventExtras | null>(null);

  // An outside write (another tab, another user) that our refetch picked up.
  if (event.version > versionRef.current) versionRef.current = event.version;

  // Our own write has come back around through the query cache, so the server
  // value now says what the draft says: drop the draft rather than let it shadow
  // everything that follows.
  useEffect(() => {
    if (settledVersion !== null && event.version >= settledVersion) {
      /*
       * ONLY IF THE DRAFT IS STILL THE ONE THAT WAS WRITTEN.
       *
       * It used to clear unconditionally, which threw away every edit made while the
       * write was in flight: type a price, blur (the PATCH goes out), type a
       * maximum, the PATCH settles — and the draft holding that maximum was
       * discarded. `commit` then returned early on a null draft, so the figure was
       * never saved, while the number stayed on screen because the input held its
       * own text. Measured 2026-09-26 entering ticket tiers: across three tiers the
       * Max persisted not once, and on a fourth it was Est. sales that vanished
       * instead — whichever field was being typed when the previous write landed.
       *
       * A draft that has moved on is kept and goes out with the next commit.
       */
      if (draft === null || draft === writtenRef.current) setDraft(null);
      setSettledVersion(null);
    }
  }, [draft, event.version, settledVersion]);

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
        writtenRef.current = next;
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
        toast.error("Someone else changed this event, so their version is now loaded.");
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

  return {
    extras,
    change,
    save,
    commit,
    hasUnwrittenChanges: draft !== null && draft !== writtenRef.current,
  };
}
