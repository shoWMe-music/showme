/**
 * THE NOTIFICATION SOUND, AND THE SWITCH THAT SILENCES IT (ClickUp `123qy9rnk3k`:
 * *"Notifications should have a sound (with the option to mute notifications)"*).
 *
 * ## Synthesised, not a file
 *
 * Two short sine tones through the Web Audio API rather than an `.mp3` in the
 * bundle. A file would be a binary asset to license, host, cache-bust and ship on
 * every page load for something most sessions never play; this is a few lines,
 * weighs nothing, and cannot 404. It also sidesteps the format question — no
 * single audio file plays everywhere without a fallback encoding.
 *
 * A rising minor third at a low volume: enough to notice, short enough not to be
 * an event. It is deliberately not a "ding" with a long tail — the bell can ring
 * several times in a row when a sweep lands, and anything with sustain turns that
 * into a chord.
 *
 * ## The mute lives on the DEVICE, not on the account
 *
 * Every other notification preference is a row on the server, because "tell me
 * about deals" is a fact about the person. This one is not: it is about the room
 * you are sitting in. Somebody muting the blip in a shared office has said nothing
 * about whether they want it at home that evening, and syncing the choice to their
 * phone would be actively wrong. So it is `localStorage`, per browser, and it
 * needs no migration, no route and no round trip to answer "should I play this".
 *
 * ## Why it can legitimately do nothing
 *
 * Browsers refuse to start audio until the user has interacted with the page, so a
 * notification arriving before the first click is silent. That is the platform's
 * rule and not worth fighting — the bell badge is the durable signal and the sound
 * is the nudge on top of it. Everything here fails soft for the same reason: a
 * missing `AudioContext`, a blocked autoplay policy or a full storage quota must
 * cost a blip, never a render.
 *
 * Which is also why it reaches for `globalThis` rather than `window`: everything
 * below is already written to cope with the platform not being there, and naming
 * `window` would add the one failure mode it cannot cope with — a `ReferenceError`
 * thrown out of the realtime frame handler wherever there is no window at all.
 */

/** The storage, if there is any. Absent under a test runner, and in SSR. */
function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // Reading the property itself throws when storage is disabled by policy.
    return null;
  }
}

const MUTED_STORAGE_KEY = "showme.notificationSound.muted";

/** Is the blip silenced on THIS device? Defaults to audible. */
export function notificationSoundMuted(): boolean {
  try {
    return storage()?.getItem(MUTED_STORAGE_KEY) === "true";
  } catch {
    // Private mode, a full quota, storage disabled by policy. Unmuted is the
    // honest default: the feature was asked for, and the switch merely failed.
    return false;
  }
}

export function setNotificationSoundMuted(muted: boolean): void {
  try {
    storage()?.setItem(MUTED_STORAGE_KEY, muted ? "true" : "false");
  } catch {
    // The toggle will read back as unchanged, which is the truthful outcome:
    // nothing was stored, so nothing changed.
  }
}

/**
 * One `AudioContext` for the tab, created on first use.
 *
 * Browsers cap how many a page may open, and a leaked one per notification would
 * hit that ceiling on a busy afternoon and then fail for good. Created lazily so a
 * session that never rings never opens one at all.
 */
let audioContext: AudioContext | null = null;

function contextForPlayback(): AudioContext | null {
  try {
    const platform = globalThis as unknown as {
      AudioContext?: typeof AudioContext;
      webkitAudioContext?: typeof AudioContext;
    };
    const AudioContextConstructor = platform.AudioContext ?? platform.webkitAudioContext;
    if (!AudioContextConstructor) return null;
    if (!audioContext) audioContext = new AudioContextConstructor();
    // Suspended is the normal state before the first interaction, and also after a
    // tab has been backgrounded for a while. Resuming is a promise we do not wait
    // on: if it is refused the tones simply never sound.
    if (audioContext.state === "suspended") void audioContext.resume();
    return audioContext;
  } catch {
    return null;
  }
}

/** One tone, shaped so it starts and stops without a click. */
function playTone(context: AudioContext, frequency: number, startAt: number, duration: number) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = frequency;
  // The ramps ARE the point. A gain that jumps from 0 to full produces a step
  // discontinuity in the waveform, which is audible as a click on every note.
  gain.gain.setValueAtTime(0, startAt);
  gain.gain.linearRampToValueAtTime(0.06, startAt + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(startAt);
  oscillator.stop(startAt + duration + 0.02);
}

/**
 * Ring, unless this device is muted. Safe to call on every arriving frame.
 *
 * Returns whether it actually played, which is what makes the "test sound" button
 * in Settings able to say nothing happened instead of appearing to work.
 */
export function playNotificationSound(): boolean {
  if (notificationSoundMuted()) return false;
  const context = contextForPlayback();
  if (!context) return false;
  try {
    const now = context.currentTime;
    playTone(context, 880, now, 0.09); // A5
    playTone(context, 1046.5, now + 0.085, 0.13); // C6 — a rising minor third
    return true;
  } catch {
    return false;
  }
}
