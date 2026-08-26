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
            onClick={() => onChange?.(option.value)}
            style={{
              padding: "6px 14px",
              borderRadius: 999,
              border: "none",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: active ? 600 : 400,
              background: active ? "var(--brand-red)" : "transparent",
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
