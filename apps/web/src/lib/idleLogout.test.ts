/**
 * The auto-logout rule (ClickUp `123qy9rnk3m`).
 *
 * Worth a suite because every interesting case is a clock the browser will not
 * reproduce on demand: a laptop that slept past the limit, a session that has only
 * just started, a stored value nobody recognises, a clock that stepped backwards.
 * Each is one line here and an afternoon of waiting in a browser.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_IDLE_MINUTES,
  IDLE_TIMEOUT_OPTIONS,
  IDLE_TIMEOUT_STORAGE_KEY,
  idleMinutesFromStored,
  isIdlePastLimit,
  millisecondsUntilIdle,
  readIdleStorage,
  storedFromIdleMinutes,
} from "./idleLogout";

const MINUTE = 60_000;
const NOW = 1_700_000_000_000;

describe("idleMinutesFromStored — a bad value must not weaken the protection", () => {
  it("defaults to Ran's one hour when nothing is stored", () => {
    expect(idleMinutesFromStored(null)).toBe(60);
    expect(idleMinutesFromStored(undefined)).toBe(DEFAULT_IDLE_MINUTES);
    expect(idleMinutesFromStored("")).toBe(DEFAULT_IDLE_MINUTES);
  });

  it("reads back every option the settings control offers", () => {
    for (const option of IDLE_TIMEOUT_OPTIONS) {
      expect(idleMinutesFromStored(storedFromIdleMinutes(option.minutes))).toBe(option.minutes);
    }
  });

  it("means never ONLY for the exact word", () => {
    expect(idleMinutesFromStored("off")).toBeNull();
    // Everything in this list is somebody's idea of "off" and none of them is the
    // stored value, so each must fall back to the default rather than to never.
    for (const nearly of ["OFF", "never", "0", "-1", "false", "null"]) {
      expect(idleMinutesFromStored(nearly)).toBe(DEFAULT_IDLE_MINUTES);
    }
  });

  it("refuses a minute count the app does not offer", () => {
    // A hand-edited key, or a value a later version offered. Not a decision to turn
    // the protection off, and not a timeout this version will honour either.
    for (const odd of ["7", "1440", "3.5", "1e3", " 60 "]) {
      expect(idleMinutesFromStored(odd)).toBe(DEFAULT_IDLE_MINUTES);
    }
  });
});

describe("isIdlePastLimit — a clock comparison, not a countdown", () => {
  it("signs out a laptop that slept past the limit", () => {
    // The case the feature exists for, and the one a tick-counting timer misses.
    expect(isIdlePastLimit(NOW - 3 * 60 * MINUTE, NOW, 60)).toBe(true);
  });

  it("holds at the boundary and releases on it", () => {
    expect(isIdlePastLimit(NOW - 59 * MINUTE, NOW, 60)).toBe(false);
    expect(isIdlePastLimit(NOW - 60 * MINUTE, NOW, 60)).toBe(true);
  });

  it("never signs out when the setting is off, however long the idle", () => {
    expect(isIdlePastLimit(NOW - 100 * 24 * 60 * MINUTE, NOW, null)).toBe(false);
  });

  it("does not treat a session that has just started as idle", () => {
    // `null` is "nothing recorded yet". Reading it as infinite idleness would sign
    // somebody out the moment they arrive.
    expect(isIdlePastLimit(null, NOW, 15)).toBe(false);
  });

  it("does not sign out on a clock that stepped backwards", () => {
    // An NTP correction or a device whose owner changed the date. Being logged out by
    // a clock jump is a fault, not security.
    expect(isIdlePastLimit(NOW + 10 * MINUTE, NOW, 15)).toBe(false);
  });
});

describe("millisecondsUntilIdle — for the fallback timer only", () => {
  it("counts down the remaining time", () => {
    expect(millisecondsUntilIdle(NOW - 10 * MINUTE, NOW, 60)).toBe(50 * MINUTE);
  });

  it("is null when the setting is off — nothing to schedule", () => {
    expect(millisecondsUntilIdle(NOW - MINUTE, NOW, null)).toBeNull();
  });

  it("gives the whole limit when nothing has been recorded", () => {
    expect(millisecondsUntilIdle(null, NOW, 30)).toBe(30 * MINUTE);
  });

  it("never returns a zero delay, however stale the stamp", () => {
    // A zero-delay timer that re-arms itself is a spin, and a past-due stamp is the
    // normal state on the first check after waking up.
    expect(millisecondsUntilIdle(NOW - 5 * 60 * MINUTE, NOW, 60)).toBe(1_000);
    expect(millisecondsUntilIdle(NOW + 60 * MINUTE, NOW, 60)).toBe(60 * MINUTE);
  });
});

/**
 * The storage accessors, under the one condition that actually breaks them.
 *
 * This suite runs under `node`, where `window` does not exist — which is the same shape
 * as the failure that matters in a browser: `localStorage` in a private window with site
 * data blocked does not return null, the accessor THROWS. A security feature that takes
 * the app down when it cannot read its own preference is worse than no feature, and the
 * fallback has to land on the protected side.
 */
describe("readIdleStorage — a storage that throws must not take the app with it", () => {
  it("answers null instead of throwing when there is no storage at all", () => {
    expect(() => readIdleStorage("anything")).not.toThrow();
    expect(readIdleStorage("anything")).toBeNull();
  });

  it("…and null then means the one-hour default, never off", () => {
    // The whole chain, which is the part worth asserting: unreadable preference →
    // default protection.
    expect(idleMinutesFromStored(readIdleStorage(IDLE_TIMEOUT_STORAGE_KEY))).toBe(
      DEFAULT_IDLE_MINUTES,
    );
  });
});
