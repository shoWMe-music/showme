import { useCallback, useEffect, useRef } from "react";

export const IDLE_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour
export const IDLE_WARNING_MS = 59 * 60 * 1000; // warning at 59 min

const WARNING_DURATION_SECONDS = Math.round((IDLE_TIMEOUT_MS - IDLE_WARNING_MS) / 1000);
const BROADCAST_THROTTLE_MS = 30 * 1000;
const BROADCAST_CHANNEL_NAME = "showme-idle-activity";

const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "scroll", "touchstart"] as const;

interface ActivityMessage {
  type: "activity";
  ts: number;
}

export interface UseIdleLogoutOptions {
  /** false when user is signed out — hook becomes a no-op */
  enabled: boolean;
  /** parent shows the warning modal */
  onWarningShow: () => void;
  /** parent hides the modal */
  onWarningHide: () => void;
  /** parent calls signOut + redirects */
  onForceLogout: () => void;
  /** Live seconds-remaining. Parent re-renders the modal countdown. */
  onSecondsRemainingChange: (seconds: number) => void;
}

export interface UseIdleLogoutResult {
  /** Call when user clicks "Stay signed in" or any meaningful manual interaction. */
  resetIdleTimer: () => void;
}

/**
 * Tracks user activity, fires a warning at IDLE_WARNING_MS (59 min idle)
 * and forces a logout at IDLE_TIMEOUT_MS (60 min idle). Activity is shared
 * across browser tabs via BroadcastChannel so a busy tab keeps the rest alive.
 */
export function useIdleLogout(opts: UseIdleLogoutOptions): UseIdleLogoutResult {
  // Stash callbacks in refs so the main effect doesn't re-run on every render.
  const onWarningShowRef = useRef(opts.onWarningShow);
  const onWarningHideRef = useRef(opts.onWarningHide);
  const onForceLogoutRef = useRef(opts.onForceLogout);
  const onSecondsRemainingChangeRef = useRef(opts.onSecondsRemainingChange);

  useEffect(() => {
    onWarningShowRef.current = opts.onWarningShow;
    onWarningHideRef.current = opts.onWarningHide;
    onForceLogoutRef.current = opts.onForceLogout;
    onSecondsRemainingChangeRef.current = opts.onSecondsRemainingChange;
  }, [opts.onWarningShow, opts.onWarningHide, opts.onForceLogout, opts.onSecondsRemainingChange]);

  // Imperative state lives in refs (cleared on each enable cycle by the effect).
  const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const logoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastActivityTsRef = useRef<number>(Date.now());
  const lastBroadcastTsRef = useRef<number>(0);
  const warningShownRef = useRef<boolean>(false);
  const channelRef = useRef<BroadcastChannel | null>(null);

  // Stable handle so resetIdleTimer (returned to caller) can drive the same
  // state machine the effect manages internally.
  const handleResetRef = useRef<(broadcast: boolean) => void>(() => {});

  const resetIdleTimer = useCallback(() => {
    handleResetRef.current(true);
  }, []);

  useEffect(() => {
    if (!opts.enabled) {
      return;
    }
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    const clearWarningState = () => {
      if (countdownIntervalRef.current !== null) {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }
      if (warningShownRef.current) {
        warningShownRef.current = false;
        onWarningHideRef.current();
      }
    };

    const clearAllTimers = () => {
      if (warningTimerRef.current !== null) {
        clearTimeout(warningTimerRef.current);
        warningTimerRef.current = null;
      }
      if (logoutTimerRef.current !== null) {
        clearTimeout(logoutTimerRef.current);
        logoutTimerRef.current = null;
      }
      if (countdownIntervalRef.current !== null) {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }
    };

    const showWarning = () => {
      warningShownRef.current = true;
      let secondsRemaining = WARNING_DURATION_SECONDS;
      onWarningShowRef.current();
      onSecondsRemainingChangeRef.current(secondsRemaining);
      countdownIntervalRef.current = setInterval(() => {
        secondsRemaining -= 1;
        if (secondsRemaining <= 0) {
          if (countdownIntervalRef.current !== null) {
            clearInterval(countdownIntervalRef.current);
            countdownIntervalRef.current = null;
          }
          onSecondsRemainingChangeRef.current(0);
          return;
        }
        onSecondsRemainingChangeRef.current(secondsRemaining);
      }, 1000);
    };

    const forceLogout = () => {
      clearAllTimers();
      warningShownRef.current = false;
      onForceLogoutRef.current();
    };

    const scheduleTimers = (lastActivityTs: number) => {
      // Clear any pending timers; we're about to schedule fresh ones based on
      // the most recent activity timestamp.
      if (warningTimerRef.current !== null) {
        clearTimeout(warningTimerRef.current);
        warningTimerRef.current = null;
      }
      if (logoutTimerRef.current !== null) {
        clearTimeout(logoutTimerRef.current);
        logoutTimerRef.current = null;
      }

      const now = Date.now();
      const elapsed = now - lastActivityTs;
      const warningDelay = IDLE_WARNING_MS - elapsed;
      const logoutDelay = IDLE_TIMEOUT_MS - elapsed;

      if (logoutDelay <= 0) {
        forceLogout();
        return;
      }

      if (warningDelay <= 0) {
        if (!warningShownRef.current) {
          showWarning();
        }
      } else {
        warningTimerRef.current = setTimeout(() => {
          warningTimerRef.current = null;
          showWarning();
        }, warningDelay);
      }

      logoutTimerRef.current = setTimeout(() => {
        logoutTimerRef.current = null;
        forceLogout();
      }, logoutDelay);
    };

    const handleReset = (broadcast: boolean) => {
      const now = Date.now();
      lastActivityTsRef.current = now;
      clearWarningState();
      scheduleTimers(now);

      if (broadcast && channelRef.current !== null) {
        if (now - lastBroadcastTsRef.current >= BROADCAST_THROTTLE_MS) {
          lastBroadcastTsRef.current = now;
          const message: ActivityMessage = { type: "activity", ts: now };
          try {
            channelRef.current.postMessage(message);
          } catch {
            // Channel may be closed mid-flight; safe to ignore.
          }
        }
      }
    };
    handleResetRef.current = handleReset;

    // Cross-tab sync — degrade gracefully if BroadcastChannel is missing.
    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
      channel.onmessage = (event: MessageEvent<ActivityMessage>) => {
        if (event.data && event.data.type === "activity") {
          // Treat as activity but DO NOT re-broadcast (avoid feedback loop).
          handleReset(false);
        }
      };
      channelRef.current = channel;
    }

    const handleActivity = () => {
      handleReset(true);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        // Don't auto-reset — the user may have been idle on this tab. But the
        // background tab's setTimeout may have been throttled, so reconcile
        // timers against the last known activity timestamp.
        scheduleTimers(lastActivityTsRef.current);
      }
    };

    for (const evt of ACTIVITY_EVENTS) {
      window.addEventListener(evt, handleActivity, { passive: true, capture: true });
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);

    // Initial schedule from "now".
    const startTs = Date.now();
    lastActivityTsRef.current = startTs;
    lastBroadcastTsRef.current = 0;
    warningShownRef.current = false;
    scheduleTimers(startTs);

    return () => {
      for (const evt of ACTIVITY_EVENTS) {
        window.removeEventListener(evt, handleActivity, { capture: true } as EventListenerOptions);
      }
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      clearAllTimers();
      warningShownRef.current = false;
      if (channelRef.current !== null) {
        channelRef.current.onmessage = null;
        try {
          channelRef.current.close();
        } catch {
          // Safe to ignore close errors.
        }
        channelRef.current = null;
      }
      handleResetRef.current = () => {};
    };
  }, [opts.enabled]);

  return { resetIdleTimer };
}
