import {
  getGetApiV1EventsIdMessagesQueryKey,
  getGetApiV1NotificationsQueryKey,
} from "@showme/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { auth } from "../auth/firebase";

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

    const abortController = new AbortController();
    let retryMilliseconds = INITIAL_RETRY_MILLISECONDS;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const handleEvent = (event: StreamEvent) => {
      const client = queryClientRef.current;
      // Every event this service emits is either a notification or implies one, so
      // the feed is always refetched; the badge updates without a poll.
      void client.invalidateQueries({ queryKey: getGetApiV1NotificationsQueryKey() });
      if (event.type === "event.message_posted" && event.eventId) {
        // Refetch through the authorized endpoint — the frame deliberately carries
        // no message body, so the server re-applies visibility on the way out.
        void client.invalidateQueries({
          queryKey: getGetApiV1EventsIdMessagesQueryKey(event.eventId),
        });
      }
    };

    const connect = async () => {
      if (stopped) return;
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

        while (!stopped) {
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
      // here on schedule. Reconnecting is the normal path, not just error recovery.
      if (stopped) return;
      retryTimer = setTimeout(connect, retryMilliseconds);
      retryMilliseconds = Math.min(retryMilliseconds * 2, MAX_RETRY_MILLISECONDS);
    };

    void connect();

    return () => {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      abortController.abort();
    };
  }, [streamUrl]);
}
