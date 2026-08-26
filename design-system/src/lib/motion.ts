/**
 * The motion vocabulary, for the half of the system that animates from JS.
 *
 * These are the SAME four durations as the `--duration-*` tokens in
 * `styles/tokens.css`, expressed in seconds because that is GSAP's unit. The
 * tokens are the source of truth and the intent is documented there in full;
 * this file exists so a GSAP tween never has to write `0.34` and quietly invent
 * a fifth speed.
 *
 * Reduced motion is NOT handled here. CSS collapses the tokens to zero in one
 * media query; JS asks `useReducedMotion()` and passes `0`, exactly as the
 * existing hooks already do.
 */
export const DURATION = {
  /** The press — feedback under a finger already down. */
  instant: 0.09,
  /** A paint-only change: color, border, background, a menu under its trigger. */
  quick: 0.14,
  /** Something moves. The default, and the interaction ceiling. */
  base: 0.2,
  /** A surface arriving or leaving on its own: modal, toast, whole view. */
  slow: 0.28,
} as const;

/**
 * The easings, named for what they are FOR rather than for their curve, so a
 * call site picks by intent. `out` and `soft` both decelerate into place — `out`
 * is the stronger curve for anything that travels a visible distance, `soft` the
 * gentler one for a nudge of a few pixels.
 */
export const EASE = {
  /** Arrivals: a thing coming to rest where it belongs. */
  out: "power3.out",
  /** Departures: a thing leaving, accelerating away. */
  in: "power2.in",
  /** Small nudges that travel only a few pixels. */
  soft: "power2.out",
  /** The single playful curve in the system — an icon acknowledging a hover. */
  pop: "back.out(2.4)",
} as const;
