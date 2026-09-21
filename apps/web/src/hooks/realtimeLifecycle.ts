/**
 * WHEN THE REALTIME STREAM SHOULD BE OPEN — the policy, as a plain state machine.
 *
 * An SSE connection is ONE long-lived request, so Cloud Run bills CPU and memory
 * for as long as a browser holds it open. The expensive mistake is not a bug in
 * the reading loop, it is a tab left open overnight keeping an instance busy
 * until morning, reconnecting every hour on schedule, delivering nothing to a
 * screen nobody is looking at.
 *
 * Kept out of the hook, and out of React, for the reason CLAUDE.md gives for the
 * settlement math: the decision is the part worth testing, and it is testable
 * only while nothing around it needs a DOM. `useRealtimeStream` supplies the
 * effects (open a fetch, abort it, refetch) and this decides when they happen.
 */

/** What the machine is doing. `idle` is NOT `stopped` — see `stop`. */
export type RealtimeState = "open" | "idle" | "stopped";

export type RealtimeSignal =
  | { kind: "mount"; visible: boolean }
  | { kind: "visibility"; visible: boolean }
  | { kind: "graceElapsed" }
  /** The connection ended on its own — an error, or Cloud Run's 60-minute cap. */
  | { kind: "connectionEnded" }
  | { kind: "stop" };

export type RealtimeAction =
  /** Start a connection. */
  | { do: "open" }
  /** Abort the current connection, releasing the server's Postgres LISTEN. */
  | { do: "close" }
  /** Start the hidden-tab countdown. */
  | { do: "armGrace" }
  /** Cancel it — they came back before it fired. */
  | { do: "cancelGrace" }
  /** Reconnect after a delay (backoff), rather than immediately. */
  | { do: "scheduleReconnect" }
  /**
   * Refetch what was missed. SSE HAS NO BACKLOG (docs/deploy-stream.md): anything
   * published while disconnected is gone, so returning must read rather than wait
   * for a frame that will never come.
   */
  | { do: "resync" };

export interface RealtimeTransition {
  state: RealtimeState;
  actions: RealtimeAction[];
}

/**
 * The transition. Total and pure: every state/signal pair has an answer, so a
 * signal arriving in an unexpected order cannot leave a connection dangling.
 */
export function nextRealtime(state: RealtimeState, signal: RealtimeSignal): RealtimeTransition {
  // Unmounted is final. A late timer or a visibility event firing during teardown
  // must never resurrect a connection.
  if (state === "stopped") return { state: "stopped", actions: [] };

  switch (signal.kind) {
    case "stop":
      return { state: "stopped", actions: [{ do: "close" }, { do: "cancelGrace" }] };

    case "mount":
      // A tab that is already hidden at mount opens NOTHING. Restoring a session
      // into a background tab is exactly the case that should cost zero.
      return signal.visible
        ? { state: "open", actions: [{ do: "open" }] }
        : { state: "idle", actions: [] };

    case "visibility":
      if (!signal.visible) {
        // Hidden: start the countdown, keep the stream for now. Dropping it on
        // every glance away would cost MORE — each reconnect is a fresh request,
        // token fetch and LISTEN.
        return state === "open"
          ? { state: "open", actions: [{ do: "armGrace" }] }
          : { state: "idle", actions: [] };
      }
      // Back. Cancel a pending countdown either way; reconnect only if we let go.
      return state === "idle"
        ? { state: "open", actions: [{ do: "cancelGrace" }, { do: "resync" }, { do: "open" }] }
        : { state: "open", actions: [{ do: "cancelGrace" }] };

    case "graceElapsed":
      // The countdown only means anything while still open.
      return state === "open"
        ? { state: "idle", actions: [{ do: "close" }] }
        : { state: "idle", actions: [] };

    case "connectionEnded":
      // An idle tab does NOT rearm — that is the whole saving. A visible one
      // reconnects, because Cloud Run's 60-minute cap ends healthy streams too.
      return state === "open"
        ? { state: "open", actions: [{ do: "scheduleReconnect" }] }
        : { state: "idle", actions: [] };

    default:
      return { state, actions: [] };
  }
}

/**
 * How long a hidden tab keeps its connection.
 *
 * Sixty seconds rather than zero because tab-switching is constant: a minute is
 * long enough that ordinary switching never drops the stream, and short enough
 * that a walked-away-from laptop stops billing almost immediately.
 */
export const HIDDEN_GRACE_MILLISECONDS = 60_000;
