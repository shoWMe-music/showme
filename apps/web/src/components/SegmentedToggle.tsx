/** A segmented pill toggle (§2, §7 and many screens): Month/Week/Day,
 * All/Confirmed/Upcoming, Performer/EventName/Both. Active segment fills with
 * the brand red. Controlled — the screen owns `value`. */
export interface SegmentedOption<Value extends string> {
  value: Value;
  label: string;
}

export interface SegmentedToggleProps<Value extends string> {
  options: SegmentedOption<Value>[];
  value: Value;
  onChange?: (value: Value) => void;
  "aria-label"?: string;
}

export function SegmentedToggle<Value extends string>({
  options,
  value,
  onChange,
  "aria-label": ariaLabel,
}: SegmentedToggleProps<Value>) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      style={{
        display: "inline-flex",
        padding: 3,
        gap: 2,
        borderRadius: 999,
        background: "var(--shape-fill)",
        border: "1px solid var(--border)",
      }}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            // Touch: 28px tall from 6px of padding, and the segments sit 2px
            // apart — far too close for an overlay, which would put a 44px hit
            // area 8px inside its neighbour and switch the wrong view. Growth
            // is the honest fix here and the harmonious one: the Inputs and
            // Selects these share a toolbar row with are already 44px on a
            // coarse pointer (tokens.css raises `--control-height`), so a 28px
            // pill beside them was the odd one out. The utility works through
            // the inline `style` below because `min-height` clamps a computed
            // height whatever its specificity. See styles/touch.css.
            className="touch-target"
            onClick={() => onChange?.(option.value)}
            style={{
              padding: "6px 14px",
              borderRadius: 999,
              border: "none",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: active ? 600 : 400,
              background: active ? "var(--brand-red)" : "transparent",
              // Solid colours on both sides, so a plain transition interpolates
              // — unlike Chip, whose active state is a gradient and needed a
              // separate opacity layer.
              transition:
                "background var(--duration-quick) var(--ease-out), color var(--duration-quick) var(--ease-out)",
              color: active ? "#fff" : "var(--muted)",
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
