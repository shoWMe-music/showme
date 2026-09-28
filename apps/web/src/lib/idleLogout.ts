/**
 * AUTO LOGOUT — the rule, without the listeners (ClickUp `123qy9rnk3m`).
 *
 * Ran, tagged `security`: *"Log out from the account If no activity for 1 hour
 * (default)"* and *"Add to security settings and allow changing the time or disabling
 * auto log out."*
 *
 * Pure and React-free, for the reason `unavailabilityRanges` and `eventRowMenu` are:
 * this is the half with a decision in it, and the decision is about time — which is
 * exactly the kind of thing a test can pin and a browser cannot be asked about twice.
 * The hook (`hooks/useIdleLogout.ts`) owns the listeners, the timer and the sign-out.
 *
 * ## It is a CLOCK COMPARISON, not a countdown
 *
 * `setTimeout` is not a clock. A laptop suspended for three hours fires a pending
 * timer late, or not at all, and a countdown of ticks would count none of that time —
 * so the one case this feature exists for, a machine left unattended, is the case a
 * naive implementation misses. Every decision here is therefore
 * `now − lastActivity ≥ limit`, re-asked whenever the tab is looked at again. A missed
 * timer then costs lateness and never a missed logout.
 *
 * ## The preference lives on the DEVICE
 *
 * `localStorage`, and the settings row says so out loud. An account-wide timeout is a
 * policy about every browser the user ever signs in on; `decisions.md` does not rule on
 * that, and inventing it would mean a migration and an API. What is being protected is
 * an unattended SCREEN, which is a property of the device in front of it.
 */

/** The stored minute counts, in the order the settings control offers them. */
export const IDLE_TIMEOUT_OPTIONS = [
  { minutes: 15, label: "After 15 minutes" },
  { minutes: 30, label: "After 30 minutes" },
  { minutes: 60, label: "After 1 hour" },
  { minutes: 240, label: "After 4 hours" },
  { minutes: 480, label: "After 8 hours" },
  /**
   * OFF is `null`, never `0`. Zero minutes is indistinguishable from "log me out
   * immediately", and a stored `0` read back by a future version could plausibly mean
   * either — so the off switch is the absence of a number.
   */
  { minutes: null, label: "Never — stay signed in" },
] as const;

/** Ran's default, in minutes. */
export const DEFAULT_IDLE_MINUTES = 60;

export const IDLE_TIMEOUT_STORAGE_KEY = "showme.security.idleLogoutMinutes";
export const IDLE_ACTIVITY_STORAGE_KEY = "showme.security.lastActivityAt";
/**
 * A ONE-SHOT NOTE THAT THE TIMEOUT IS WHY YOU ARE LOOKING AT A SIGN-IN SCREEN
 * (QA sweep run 5, QA5-6).
 *
 * `useIdleLogout` called `signOut()` and the reason died with the React tree, so
 * somebody returning to a laptop landed on *"Welcome back — Sign in to your shoWMe
 * account."* and could not tell a timeout from an expired token, a revoked session or
 * a bug. The setting they would need is on the other side of the sign-in they were
 * just asked for.
 *
 * `localStorage` rather than router state precisely BECAUSE the sign-out tears the tree
 * down — and the timeout it explains is already a per-device `localStorage` preference
 * (decisions #25.6), so the note belongs to the same device as the rule that fired it.
 * Read once and cleared, so it explains the sign-out that just happened and never the
 * next one.
 */
export const IDLE_REASON_STORAGE_KEY = "showme.security.signedOutByIdleAt";

/** The value stored for "never log me out". Spelled once so both ends agree. */
const OFF = "off";

const ALLOWED_MINUTES: ReadonlySet<number> = new Set(
  IDLE_TIMEOUT_OPTIONS.flatMap((option) => (option.minutes === null ? [] : [option.minutes])),
);

/**
 * What a stored string means, in minutes — or null for "never".
 *
 * **An unrecognised value falls back to the DEFAULT, not to off.** A hand-edited key, a
 * truncated write, a number a later version offered and this one does not: none of those
 * is a decision to switch the protection off, and reading them as one would let a typo
 * silently weaken an account's security. Only the exact word `off` means off.
 */
export function idleMinutesFromStored(stored: string | null | undefined): number | null {
  if (stored === OFF) return null;
  if (!stored) return DEFAULT_IDLE_MINUTES;
  const parsed = Number(stored);
  if (!Number.isInteger(parsed) || !ALLOWED_MINUTES.has(parsed)) return DEFAULT_IDLE_MINUTES;
  return parsed;
}

/** The string to store for a chosen setting. The inverse of the reader above. */
export function storedFromIdleMinutes(minutes: number | null): string {
  return minutes === null ? OFF : String(minutes);
}

/**
 * Has the session gone idle past its limit?
 *
 * `lastActivityAt` is a wall-clock millisecond stamp; `null` means nothing has been
 * recorded yet, which is not idleness — it is a session that has only just started, and
 * signing someone out for it would be the worst possible first impression.
 *
 * A stamp in the FUTURE (a clock correction, an NTP step, a device whose owner changed
 * the date) reads as activity now rather than as infinite idleness — being logged out
 * because a clock jumped is a fault, not security. **The subtraction already does that**,
 * which is why there is no guard for it here: a future stamp makes `now − last` negative,
 * and a negative number is never past the limit. An explicit `if` was written first and
 * removed when mutating it away turned nothing red — a line no test can fail on is a line
 * claiming to do something it does not. `millisecondsUntilIdle` below needs the check for
 * real, and there it is pinned.
 */
export function isIdlePastLimit(
  lastActivityAt: number | null,
  now: number,
  limitMinutes: number | null,
): boolean {
  if (limitMinutes === null) return false;
  if (lastActivityAt === null) return false;
  return now - lastActivityAt >= limitMinutes * 60_000;
}

/**
 * How long until the limit is reached, in milliseconds — for scheduling the fallback
 * timer, never for deciding.
 *
 * Clamped to at least a second so a stale or future stamp cannot produce a zero-delay
 * loop that spins the event loop, and to the limit itself when nothing is recorded yet.
 */
export function millisecondsUntilIdle(
  lastActivityAt: number | null,
  now: number,
  limitMinutes: number | null,
): number | null {
  if (limitMinutes === null) return null;
  const limit = limitMinutes * 60_000;
  if (lastActivityAt === null || lastActivityAt > now) return limit;
  return Math.max(1_000, limit - (now - lastActivityAt));
}

// ── The two keys, and the only code that touches them ───────────────────────────
//
// Wrapped, because `localStorage` does not merely return null in a private window with
// site data blocked — the accessor itself throws. A security feature must not take the
// app down with it, and a failed READ of the preference lands on the one-hour default,
// which is the safe end of the failure.

export function readIdleStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeIdleStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Nothing to do. The hook keeps an in-memory stamp for its own tab, which is the
    // honest degradation: one tab, still protected.
  }
}

/** The same, for taking a one-shot note away once it has been read. */
export function clearIdleStorage(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Same reasoning as the write: a storage failure must not take the app down. The
    // cost of a note that cannot be cleared is one extra sentence on one screen.
  }
}

/**
 * SIGNING IN IS ACTIVITY — stamp it at the source.
 *
 * Called by the explicit sign-in actions in `auth/AuthProvider.tsx`, and deliberately
 * NOT by the silent session restore beside them. The difference is the whole point: a
 * person pressing "Sign in" is present, while a token refreshing itself on a laptop
 * that has been closed for three hours is exactly the case the timeout must still catch.
 *
 * Without this, the stamp from the PREVIOUS session survives in storage and somebody who
 * signed out, came back two hours later and signed in again was thrown straight back out
 * by their own stale history — measured in the browser, on the first version of this.
 * The hook cannot do it instead: it lives in the shell, and the shell does not exist on
 * the sign-in screen.
 */
export function recordSignInActivity(): void {
  writeIdleStorage(IDLE_ACTIVITY_STORAGE_KEY, String(Date.now()));
}

/**
 * Take the "you were signed out by the timeout" note, if one is waiting.
 *
 * Reads and CLEARS in one step: a note left behind would explain the next sign-in
 * screen too, including one the user asked for. Returns the limit in minutes so the
 * sentence can name it.
 */
export function takeIdleLogoutNotice(): { minutes: number } | null {
  const stored = readIdleStorage(IDLE_REASON_STORAGE_KEY);
  if (stored === null) return null;
  clearIdleStorage(IDLE_REASON_STORAGE_KEY);
  const minutes = Number(stored);
  return Number.isFinite(minutes) && minutes > 0 ? { minutes } : null;
}
