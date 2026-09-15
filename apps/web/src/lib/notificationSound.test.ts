import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  notificationSoundMuted,
  playNotificationSound,
  setNotificationSoundMuted,
} from "./notificationSound";

/**
 * The mute switch (ClickUp `123qy9rnk3k`).
 *
 * What is worth asserting is not the waveform — it is that the switch is obeyed
 * and that nothing here can ever throw into a render. Both fail quietly: a
 * notification arriving is not a moment anyone is watching a console, so a blip
 * that ignores the mute is just an annoyance nobody reports, and an exception on
 * an arriving frame takes the realtime handler down with it.
 */
describe("notificationSound", () => {
  /**
   * The suite runs under `node` (see `vitest.config.ts`: jsdom is deliberately not
   * paid for until a test needs to render, and this one does not). So the browser
   * platform is supplied here — which has the side benefit of making every
   * assertion below explicit about what it is standing on.
   */
  beforeEach(() => {
    const entries = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => void entries.set(key, value),
      removeItem: (key: string) => void entries.delete(key),
      clear: () => entries.clear(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults to audible, because the sound is the feature that was asked for", () => {
    expect(notificationSoundMuted()).toBe(false);
  });

  it("remembers the mute, and remembers turning it back on", () => {
    setNotificationSoundMuted(true);
    expect(notificationSoundMuted()).toBe(true);
    setNotificationSoundMuted(false);
    expect(notificationSoundMuted()).toBe(false);
  });

  it("plays nothing at all while muted — without touching the audio API", () => {
    const AudioContextSpy = vi.fn();
    vi.stubGlobal("AudioContext", AudioContextSpy);
    setNotificationSoundMuted(true);

    expect(playNotificationSound()).toBe(false);
    // The mute is checked BEFORE the context is opened. Constructing one and then
    // declining to play would leave a suspended context per muted tab.
    expect(AudioContextSpy).not.toHaveBeenCalled();
  });

  /**
   * jsdom has no Web Audio at all, which is the same shape as a browser that
   * blocks it — and exactly the case that must not throw, since this is called
   * from the realtime frame handler.
   */
  it("reports failure instead of throwing when there is no audio to play", () => {
    expect(() => playNotificationSound()).not.toThrow();
    expect(playNotificationSound()).toBe(false);
  });

  it("survives storage being unavailable entirely", () => {
    vi.stubGlobal("localStorage", {
      getItem() {
        throw new Error("storage disabled by policy");
      },
      setItem() {
        throw new Error("storage disabled by policy");
      },
    });
    // Unmuted is the honest answer when the preference cannot be read: the switch
    // failed, the feature did not.
    expect(notificationSoundMuted()).toBe(false);
    expect(() => setNotificationSoundMuted(true)).not.toThrow();
  });

  it("rings when it can, and says so", () => {
    const stop = vi.fn();
    const oscillator = {
      type: "",
      frequency: { value: 0 },
      connect: vi.fn(),
      start: vi.fn(),
      stop,
    };
    const gainNode = {
      gain: {
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      },
      connect: vi.fn(),
    };
    vi.stubGlobal(
      "AudioContext",
      vi.fn(() => ({
        state: "running",
        currentTime: 0,
        destination: {},
        createOscillator: () => oscillator,
        createGain: () => gainNode,
      })),
    );

    expect(playNotificationSound()).toBe(true);
    // Two tones — the rising interval, not a single beep.
    expect(oscillator.start).toHaveBeenCalledTimes(2);
    expect(stop).toHaveBeenCalledTimes(2);
  });
});
