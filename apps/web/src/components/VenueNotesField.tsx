import { useId, useState } from "react";

export interface VenueNotesFieldProps {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  /** Sub-label explaining who will see this — used for the privacy split. */
  hint?: string;
  rows?: number;
}

/**
 * A multi-line field that looks exactly like the design system's `TextField`.
 *
 * It exists because the design system has an `Input`, a `TextField` and a
 * `Select` but no textarea, and the profile form genuinely needs one (catering,
 * accommodation, logistics are all prose). Rather than let every screen invent
 * its own — which is how `Profiles.tsx` ended up with a raw `<textarea>` carrying
 * eight inline style properties — the styling is copied ONCE from
 * `TextField.module.css` and reused.
 *
 * This is a stopgap, and the real fix is a `Textarea` atom in the design system.
 * Every value here (10px radius, 13.5px sans, the #EE5746 focus border) is taken
 * from that stylesheet, so a DS textarea can replace this component with no
 * visual change.
 */
export function VenueNotesField({
  label,
  value,
  onChange,
  placeholder,
  hint,
  rows = 3,
}: VenueNotesFieldProps) {
  const fieldId = useId();
  const [focused, setFocused] = useState(false);

  return (
    <div style={{ display: "block" }}>
      <label
        htmlFor={fieldId}
        style={{
          display: "block",
          fontFamily: "var(--font-mono)",
          fontSize: 10.5,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--muted)",
          marginBottom: 6,
        }}
      >
        {label}
      </label>
      <textarea
        id={fieldId}
        value={value}
        rows={rows}
        placeholder={placeholder}
        onChange={(changeEvent) => onChange(changeEvent.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          width: "100%",
          boxSizing: "border-box",
          padding: "10px 12px",
          borderRadius: 10,
          // Focus colour is TextField's, tracked in React because a style object
          // cannot express `:focus`.
          border: `1px solid ${focused ? "#EE5746" : "var(--border)"}`,
          background: "var(--control-surface)",
          color: "var(--text)",
          fontFamily: "var(--font-sans)",
          fontSize: 13.5,
          lineHeight: 1.55,
          outline: "none",
          resize: "vertical",
          transition: "border-color .2s",
        }}
      />
      {hint && <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--dim)" }}>{hint}</p>}
    </div>
  );
}
