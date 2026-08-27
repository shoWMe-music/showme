/**
 * How a day the acting profile has blocked LOOKS on the calendar — the one place
 * the three views (month grid, week grid, day agenda) agree on it, so a day that
 * is struck out in one is struck out identically in the others.
 *
 * WHICH "unavailable" this is. Two different things in this product can make a
 * day busy, and only one of them is drawn here:
 *
 * 1. **A deliberate block** — a `profile_unavailability` row the profile wrote
 *    with "Mark unavailable", meaning "we cannot be booked". That is this mark.
 * 2. **An imported busy block** — a `calendar_items` row from a connected
 *    calendar with `blocks_availability` set. That one already draws itself, as
 *    a normal chip on the day, and is flipped from the Calendar's right rail.
 *
 * They are deliberately NOT merged: the first is a statement the profile makes
 * and can retract per day, the second is a fact imported from elsewhere.
 *
 * WHY NOT COLOUR. Three cues carry this state, and each survives alone:
 * a diagonal hatch over the cell (a PATTERN, so it reads in monochrome and for
 * anyone who cannot separate the hues), a line through the day number (the same
 * vocabulary the public availability page uses for a withdrawn date), and the
 * word "Unavailable" in text. Every colour used is a semantic token, so light
 * and dark both get a legible version rather than one theme's literal.
 */

/** Blocked-day fill: hairlines at 135°, spaced so a 104px cell shows several.
 * `--border-strong` is defined in BOTH themes (a warm light on dark, a cool dark
 * on light), which is what keeps the hatch visible either way. */
const HATCH = "repeating-linear-gradient(135deg, var(--border-strong) 0 1px, transparent 1px 8px)";

/**
 * The `background` shorthand for a day cell. Multiple layers are allowed but only
 * the LAST may be a colour, so the hatch goes on top of whatever tint the cell
 * already had (the today wash) rather than replacing it.
 */
export function dayCellBackground(isUnavailable: boolean, baseColor: string): string {
  return isUnavailable ? `${HATCH}, ${baseColor}` : baseColor;
}

/** Appended to a day's accessible name so a screen reader is told the same thing
 * the hatch tells the eye. */
export function unavailableSuffix(isUnavailable: boolean, reason: string | null): string {
  if (!isUnavailable) return "";
  return reason ? ` — unavailable: ${reason}` : " — unavailable";
}

/**
 * The in-cell label. `reason` is shown inline where there is room for it (the
 * week column, the day agenda) and folded into the tooltip where there is not
 * (a month cell, which is 104px tall and already holds the day's chips).
 */
export function CalendarUnavailableMark({
  reason,
  showReason = false,
}: {
  reason: string | null;
  showReason?: boolean;
}) {
  return (
    <span
      title={reason ?? "Unavailable"}
      style={{
        display: "inline-flex",
        alignItems: "baseline",
        gap: 5,
        alignSelf: "flex-start",
        maxWidth: "100%",
        marginBottom: 4,
        // Sized to the TIGHTEST container it has to live in. Measured in the
        // running app at the narrow end: a month cell leaves 73.4px inside its
        // padding, and the word needed 85px at 9.5px/0.08em (cut mid-glyph to
        // "UNAVAILABL") and 73.38px at 9px/0.02em — which fit by 0.05px, i.e.
        // ellipsised the moment rounding went the other way. Dropping the
        // tracking and two pixels of padding brings it to ~69px, leaving real
        // headroom. Narrower still and it ellipsises honestly; the tooltip and
        // the day's accessible name carry the whole word either way.
        padding: "2px 4px",
        borderRadius: 6,
        border: "1px solid var(--border-strong)",
        background: "var(--elevated)",
        fontFamily: "var(--font-mono)",
        fontSize: 9,
        letterSpacing: 0,
        textTransform: "uppercase",
        color: "var(--muted)",
        overflow: "hidden",
        whiteSpace: "nowrap",
      }}
    >
      {/* The ellipsis has to live on the flex ITEM, not the flex container:
          `text-overflow` never applies to a flex container's own text, which is
          why the clipped word showed no "…" at all. */}
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>Unavailable</span>
      {showReason && reason && (
        <span
          style={{
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            color: "var(--dim)",
            textTransform: "none",
            letterSpacing: 0,
          }}
        >
          {reason}
        </span>
      )}
    </span>
  );
}

/**
 * MARKING MODE — how the grid looks while the reader is picking nights.
 *
 * The cursor is the "X" Ran asks for: `crosshair` is the one the platform draws
 * as a cross, and it is the cursor every table-selection gesture on the web uses,
 * so it reads as "sweep me" rather than "click me".
 */
export const MARKING_CURSOR = "crosshair";

/** A picked-but-not-yet-committed day: a ring and a wash. Deliberately NOT the
 * hatch — the hatch means "blocked, and saved", and a night waiting on "Done
 * marking" has not earned that yet. The two stack legibly, which is what shows
 * you that clicking a hatched day is about to FREE it. */
export const PENDING_RING = "inset 0 0 0 2px var(--brand-red)";
export const PENDING_TINT = "color-mix(in srgb, var(--brand-red) 14%, transparent)";
