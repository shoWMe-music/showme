import { getGetApiV1NotificationsQueryKey } from "@showme/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { auth } from "../auth/firebase";
import { messagesKey, threadsKey } from "../components/useEventMessageThreads";
import { playNotificationSound } from "../lib/notificationSound";
import { isEventQueryKey } from "./realtimeInvalidation";
import { HIDDEN_GRACE_MILLISECONDS, type RealtimeState, nextRealtime } from "./realtimeLifecycle";

/**
 * The client half of the realtime backbone: one SSE connection to the stream
 * service (`apps/stream`), whose frames invalidate the TanStack Query caches the
 * event touches. Live updates and a cold page load therefore share ONE read path —
 * the frame never carries renderable state, it only says "this got stale".
 *
 * Not `EventSource`: the browser API cannot set an `Authorization` header, and the
 * stream service authenticates with a Firebase bearer token. Putting the token in
 * the query string would leak it into proxy and server logs, so this reads the
 * response body as a stream instead. The cost is that reconnection is ours to
 * implement rather than free — handled below with capped backoff.
 */

/** A frame's payload. `type` is the only field every event carries. */
interface StreamEvent {
  type: string;
  eventId?: string;
  messageId?: string;
  link?: string;
  title?: string;
  /**
   * "THIS GOT STALE", not "look at this" — no bell, no sound, just the refetch.
   *
   * Every other frame is a notification or implies one, which is why the two are
   * fused below. A settlement recompute is neither: the figures on an open screen
   * moved and the party owed the money should see it, but an operator iterating on
   * a cost split would otherwise ring the co-host's speaker once per attempt
   * (QA sweep run 10, QA10-8). The settlement moments that ARE news — pending
   * review, finalized, paid — still write real notifications with a preference gate.
   *
   * Said in the payload rather than read off `type`: the type vocabulary is 65
   * strings in another package, and the comment below is about why this hook does
   * not branch on it.
   */
  quiet?: boolean;
}

const INITIAL_RETRY_MILLISECONDS = 1_000;
const MAX_RETRY_MILLISECONDS = 30_000;

/**
 * Split an SSE buffer into complete frames. Frames are separated by a blank line;
 * a trailing partial frame stays in the buffer until its terminator arrives, which
 * is why the remainder is returned rather than dropped.
 */
function takeCompleteFrames(buffer: string): { frames: string[]; remainder: string } {
  const parts = buffer.split("\n\n");
  const remainder = parts.pop() ?? "";
  return { frames: parts, remainder };
}

/** The JSON payload of one frame, or null for a comment/keep-alive (`:ok`). */
function parseFrame(frame: string): StreamEvent | null {
  const dataLines = frame
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim());
  if (dataLines.length === 0) return null;
  try {
    return JSON.parse(dataLines.join("\n")) as StreamEvent;
  } catch {
    // A malformed frame must not kill the connection — skip it.
    return null;
  }
}

/**
 * Subscribe for as long as the component is mounted and a user is signed in.
 * `streamUrl` empty (no VITE_STREAM_URL configured) disables it entirely, so local
 * development without the stream service running is silent rather than a retry loop.
 */
export function useRealtimeStream(streamUrl: string | undefined): void {
  const queryClient = useQueryClient();
  // Held in a ref so the effect below never re-subscribes when React re-renders:
  // a new connection per render would thrash the server's LISTEN registrations.
  const queryClientRef = useRef(queryClient);
  queryClientRef.current = queryClient;

  useEffect(() => {
    if (!streamUrl) return;

    // Recreated on every (re)connect: an AbortController is single-use, and going
    // idle aborts one without ending the subscription for good.
    let abortController = new AbortController();
    let retryMilliseconds = INITIAL_RETRY_MILLISECONDS;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let hiddenTimer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    // Idle is NOT stopped. `stopped` means the hook is unmounting and must never
    // reconnect; `idle` means the tab is hidden and should reconnect the moment
    // somebody looks at it again.
    let idle = false;
    // Assigned once `apply` exists; `connect` closes over it.
    let ended: () => void = () => {};

    const handleEvent = (event: StreamEvent) => {
      const client = queryClientRef.current;
      // Every event this service emits is either a notification or implies one, so
      // the feed is always refetched; the badge updates without a poll. Except a
      // `quiet` frame, which is the one kind that is neither — see the field.
      if (!event.quiet) {
        void client.invalidateQueries({ queryKey: getGetApiV1NotificationsQueryKey() });
        // …and for the same reason, every frame rings (ClickUp `123qy9rnk3k`).
        // Rung HERE rather than off the refetched feed because the frame is the
        // moment something arrived; watching the query result would also ring on a
        // window refocus, a cache eviction and every other reason a list refetches.
        // The module answers "is this device muted" itself and is silent if so.
        playNotificationSound();
      }
      /**
       * …AND THE SCREENS THE FRAME MAKES WRONG.
       *
       * Refetching the bell and nothing else meant a frame could arrive, be acted
       * on, and leave the page beneath it ASSERTING the opposite of what had just
       * happened. Measured 2026-09-26 with a live observer: `performerB` confirms a
       * deal, the watching operator's bell moves from 2 unread to 3 — on the same
       * page whose Budget Planner one scroll below still read "still an offer,
       * nobody has confirmed it" with a `PROPOSED` chip, indefinitely. And a
       * co-operator accepted an invitation while the host's Collaborators tab went
       * on saying "Invite pending … nothing is granted until they accept", with the
       * row already `accepted` in Postgres.
       *
       * Stale is not the same as absent: an empty screen invites a reload, a
       * confident wrong sentence does not.
       *
       * INVALIDATED BY THE EVENT, NOT BY THE TYPE. Every frame this service sends
       * about an event means something about that event moved, and the type
       * vocabulary is the notification catalogue — 65 types and growing, in a
       * different package from this map. Keying on the type would need a new line
       * here for every new notification, and the line that is forgotten is exactly
       * the stale screen this exists to prevent. So an event-scoped frame refetches
       * that event's workspace queries; TanStack only actually fetches the ones
       * currently mounted, so a Calendar page pays nothing for a deal frame.
       *
       * AND THE LIST ITSELF WAS THE FORGOTTEN LINE (QA sweep run 6, QA6-3). It named
       * seven keys of the twenty-four the generated client exposes for an event, and
       * the one missing that mattered was the change request: a crew member sat in
       * front of *"Waiting on 2 people to answer. Nothing moves until everyone
       * agrees."* minutes after the night had moved. `isEventQueryKey` replaces the
       * list with the rule the comment above already states — see
       * `realtimeInvalidation.ts`.
       */
      if (event.eventId) {
        const eventId = event.eventId;
        void client.invalidateQueries({
          predicate: (query) => isEventQueryKey(query.queryKey, eventId),
        });
      }
      if (event.type === "event.message_posted" && event.eventId) {
        // Refetch through the authorized endpoint — the frame deliberately carries
        // no message body, so the server re-applies visibility on the way out.
        // `messagesKey`, not the generated key: the Messages tab keys its own
        // queries (see `useEventMessageThreads`), so the generated one matched
        // nothing and this invalidation had never actually refreshed a thread —
        // a message arriving over SSE sat unseen until something else refetched.
        // Found while fixing the same mistake in the change-request hook.
        void client.invalidateQueries({ queryKey: messagesKey(event.eventId) });
        void client.invalidateQueries({ queryKey: threadsKey(event.eventId) });
      }
    };

    const connect = async () => {
      if (stopped || idle) return;
      const token = await auth.currentUser?.getIdToken();
      if (!token) {
        // Signed out mid-session: stop rather than hammer the service with 401s.
        return;
      }

      try {
        const response = await fetch(`${streamUrl.replace(/\/$/, "")}/stream`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: abortController.signal,
        });
        if (!response.ok || !response.body) {
          throw new Error(`stream responded ${response.status}`);
        }

        // Connected: reset backoff so a later blip retries promptly again.
        retryMilliseconds = INITIAL_RETRY_MILLISECONDS;

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (!stopped && !idle) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const { frames, remainder } = takeCompleteFrames(buffer);
          buffer = remainder;
          for (const frame of frames) {
            const parsed = parseFrame(frame);
            if (parsed) handleEvent(parsed);
          }
        }
      } catch (error) {
        // An aborted fetch is our own teardown, not a failure.
        if (abortController.signal.aborted) return;
        if (import.meta.env.DEV) console.warn("realtime stream dropped", error);
      }

      // Cloud Run caps a request at 60 minutes, so a healthy connection ALSO ends
      // here on schedule. Whether that means "reconnect" or "stay quiet" is the
      // machine's call — an idle tab must NOT rearm, which is the whole saving.
      ended();
    };

    // WHEN to be connected is `realtimeLifecycle`'s decision, tested without a
    // DOM; this only carries it out. `idle` above mirrors that state so the read
    // loop and the reconnect path can both see it.
    let machine: RealtimeState = "idle";

    const apply = (signal: Parameters<typeof nextRealtime>[1]) => {
      const next = nextRealtime(machine, signal);
      machine = next.state;
      idle = machine === "idle";
      stopped = machine === "stopped";
      for (const action of next.actions) {
        switch (action.do) {
          case "open":
            abortController = new AbortController();
            retryMilliseconds = INITIAL_RETRY_MILLISECONDS;
            void connect();
            break;
          case "close":
            // Aborting closes the socket, which fires `close` on the server and
            // releases that user's Postgres LISTEN — so the instance really does
            // go idle and can scale to zero, rather than merely being ignored.
            if (retryTimer) clearTimeout(retryTimer);
            abortController.abort();
            break;
          case "armGrace":
            if (hiddenTimer) clearTimeout(hiddenTimer);
            hiddenTimer = setTimeout(
              () => apply({ kind: "graceElapsed" }),
              HIDDEN_GRACE_MILLISECONDS,
            );
            break;
          case "cancelGrace":
            if (hiddenTimer) clearTimeout(hiddenTimer);
            hiddenTimer = undefined;
            break;
          case "scheduleReconnect":
            retryTimer = setTimeout(connect, retryMilliseconds);
            retryMilliseconds = Math.min(retryMilliseconds * 2, MAX_RETRY_MILLISECONDS);
            break;
          case "resync":
            void queryClientRef.current.invalidateQueries({
              queryKey: getGetApiV1NotificationsQueryKey(),
            });
            break;
        }
      }
    };

    ended = () => apply({ kind: "connectionEnded" });

    const onVisibilityChange = () =>
      apply({ kind: "visibility", visible: document.visibilityState !== "hidden" });
    const onPageHide = () => apply({ kind: "graceElapsed" });

    document.addEventListener("visibilitychange", onVisibilityChange);
    // Closing the tab or navigating away: end it now rather than leaving the
    // socket to time out server-side.
    window.addEventListener("pagehide", onPageHide);
    // A tab restored from the back/forward cache fires `pageshow`, not
    // `visibilitychange`, and would otherwise sit there permanently idle.
    window.addEventListener("pageshow", onVisibilityChange);

    apply({ kind: "mount", visible: document.visibilityState !== "hidden" });

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onVisibilityChange);
      apply({ kind: "stop" });
    };
  }, [streamUrl]);
}
