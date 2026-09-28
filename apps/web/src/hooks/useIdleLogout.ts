import { useCallback, useEffect, useRef } from "react";
import { useAuth } from "../auth/AuthProvider";
import {
  IDLE_ACTIVITY_STORAGE_KEY,
  IDLE_REASON_STORAGE_KEY,
  IDLE_TIMEOUT_STORAGE_KEY,
  idleMinutesFromStored,
  isIdlePastLimit,
  millisecondsUntilIdle,
  readIdleStorage,
  writeIdleStorage,
} from "../lib/idleLogout";

/**
 * SIGN OUT AN UNATTENDED SCREEN (ClickUp `123qy9rnk3m`).
 *
 * The listeners, the timer and the sign-out. The rule itself is in
 * `lib/idleLogout.ts`, tested there — this file is deliberately the part with no
 * decisions in it, because everything it touches (storage, timers, document events) is
 * the part a unit test can only pretend to have.
 *
 * ## Why the timer is not the mechanism
 *
 * The decision is always `isIdlePastLimit(lastActivity, Date.now(), limit)`. The timer
 * exists to ASK that question at a plausible moment; `visibilitychange` and `focus` ask
 * it again whenever somebody comes back to the tab. So a suspended laptop — the case
 * this feature is for — is caught on wake even though its pending timer was never
 * delivered on time, and the worst a missed timer can cost is lateness.
 *
 * ## Why last activity is in `localStorage`
 *
 * Two tabs. Typing in one must keep the other alive, or a background tab signs the user
 * out from under the tab they are working in. Storage is the only thing two tabs of the
 * same origin both see, and the write is throttled to once a minute so a mouse moving
 * across the screen is not a write per frame.
 *
 * Every read and write is wrapped: `localStorage` throws outright in a private window
 * with site data blocked, and a security feature must not take the app down with it. A
 * failure to read the preference lands on the one-hour default, which is the safe end.
 */

/** The events that count as somebody being there. */
const ACTIVITY_EVENTS = [
  "pointerdown",
  "keydown",
  "wheel",
  "touchstart",
  // Not `mousemove`: a sleeping cat on a keyboard aside, a moving pointer with no
  // click is presence, and `pointerdown` alone would miss somebody reading a long
  // settlement. `scroll` is the cheap proxy for reading.
  "scroll",
] as const;

/** One write a minute at most, whatever the user is doing. */
const WRITE_THROTTLE_MS = 60_000;

export function useIdleLogout(): void {
  const { status, signOut } = useAuth();
  // `authed` is the only status with a session to protect: `onboarding` has an account
  // half-made and signing it out mid-flow would lose the form, and `anon`/`loading`
  // have nothing to sign out of.
  const signedIn = status === "authed";

  /**
   * This tab's own view of the last activity, so the feature still works when storage
   * is unavailable. Storage wins when it is readable and NEWER — that is another tab's
   * activity arriving.
   *
   * **It starts as null, and MOUNTING IS NOT ACTIVITY.** Seeding it with `Date.now()`
   * was the first version and it had a hole big enough to drive through: a laptop that
   * slept for three hours and restored its tabs — or any reload after an idle spell —
   * came back with a fresh in-memory stamp that won the `Math.max` against the real one
   * in storage, and the session survived exactly the situation this feature exists to
   * end. Found by trying to prove it in a browser rather than by reading it.
   *
   * Null means "nothing recorded", which `isIdlePastLimit` treats as not-idle, so a
   * genuinely new session is never thrown out for having no history.
   */
  const lastActivityRef = useRef<number | null>(null);
  const lastWriteRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const lastActivityAt = useCallback((): number | null => {
    const stored = Number(readIdleStorage(IDLE_ACTIVITY_STORAGE_KEY));
    const fromStorage = Number.isFinite(stored) && stored > 0 ? stored : null;
    if (lastActivityRef.current === null) return fromStorage;
    if (fromStorage === null) return lastActivityRef.current;
    return Math.max(lastActivityRef.current, fromStorage);
  }, []);

  /**
   * Recorded for as long as this hook is mounted, which is as long as the shell is —
   * i.e. the whole signed-in session, whatever the auth status does in between.
   *
   * It does NOT cover the sign-in screen: the shell is not rendered there, so the click
   * on "Sign in" is stamped by `recordSignInActivity` inside `AuthProvider` instead.
   * That was measured rather than reasoned — without it, a stale stamp from a previous
   * session signed the user straight back out after a fresh login.
   */
  const noteActivity = useCallback(() => {
    const now = Date.now();
    lastActivityRef.current = now;
    // Throttled: the stamp only has to be accurate to the minute for a limit measured
    // in tens of them, and this runs on scroll.
    if (now - lastWriteRef.current >= WRITE_THROTTLE_MS) {
      lastWriteRef.current = now;
      writeIdleStorage(IDLE_ACTIVITY_STORAGE_KEY, String(now));
    }
  }, []);

  useEffect(() => {
    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, noteActivity, { passive: true });
    }
    return () => {
      for (const event of ACTIVITY_EVENTS) window.removeEventListener(event, noteActivity);
    };
  }, [noteActivity]);

  useEffect(() => {
    if (!signedIn) return;

    const limit = () => idleMinutesFromStored(readIdleStorage(IDLE_TIMEOUT_STORAGE_KEY));

    /** Ask the question. Called by the timer, by coming back to the tab, and on mount. */
    const check = () => {
      const limitMinutes = limit();
      if (isIdlePastLimit(lastActivityAt(), Date.now(), limitMinutes)) {
        // LEAVE A NOTE FIRST (QA sweep run 5, QA5-6). The sign-out tears this tree
        // down, so the reason cannot travel in state — `AuthScreen` reads and clears
        // it. Written before `signOut` because after it this code is gone.
        if (limitMinutes !== null) {
          writeIdleStorage(IDLE_REASON_STORAGE_KEY, String(limitMinutes));
        }
        void signOut();
        return;
      }
      schedule();
    };

    const schedule = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      const delay = millisecondsUntilIdle(lastActivityAt(), Date.now(), limit());
      // Null is "never" — no timer at all rather than one that fires and does nothing.
      if (delay === null) {
        timerRef.current = null;
        return;
      }
      timerRef.current = setTimeout(check, delay);
    };

    // Activity is recorded by the always-on effect above; this only has to re-arm the
    // countdown against the newer stamp.
    const onActivity = () => schedule();

    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };

    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, onActivity, { passive: true });
    }
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", check);

    // On mount, and after every settings change: a tab that was open while the limit
    // was shortened must honour the new one immediately.
    check();

    return () => {
      for (const event of ACTIVITY_EVENTS) window.removeEventListener(event, onActivity);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", check);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [signedIn, signOut, lastActivityAt]);
}
