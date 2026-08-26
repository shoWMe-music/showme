import { Checkbox, Icon, type IconName } from "@showme/design-system";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * A toolbar filter chip that opens a checklist of what to show.
 *
 * The chip carries the count of what is hidden, because a filter you cannot see
 * is how a calendar ends up "missing" a show. Selection is held by the caller —
 * this component only draws it.
 */

export interface CalendarFilterOption {
  /** Stable key AND the value matched against entries. */
  key: string;
  label: string;
  /** Legend swatch, so the list reads against the grid. */
  color?: string;
}

export interface CalendarFilterChipProps {
  label: string;
  icon: IconName;
  options: CalendarFilterOption[];
  /** The keys currently shown. */
  selected: string[];
  onToggle: (key: string) => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
  style?: React.CSSProperties;
}

export function CalendarFilterChip({
  label,
  icon,
  options,
  selected,
  onToggle,
  onSelectAll,
  onSelectNone,
  style,
}: CalendarFilterChipProps) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const shown = new Set(selected);
  const hiddenCount = options.filter((option) => !shown.has(option.key)).length;

  const openPanel = () => {
    setAnchor(buttonRef.current?.getBoundingClientRect() ?? null);
    setOpen(true);
  };

  const width = 214;
  const left = anchor ? Math.min(anchor.left, window.innerWidth - width - 12) : 0;
  const top = anchor ? anchor.bottom + 6 : 0;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => (open ? setOpen(false) : openPanel())}
        style={{
          ...style,
          // A filter that is doing something must not look like one that is not.
          borderColor: hiddenCount > 0 ? "#EE5746" : "var(--border)",
          color: hiddenCount > 0 ? "#EE5746" : "var(--text)",
        }}
      >
        <Icon name={icon} size={14} />
        {label}
        {hiddenCount > 0 && (
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>−{hiddenCount}</span>
        )}
      </button>

      {open &&
        anchor &&
        createPortal(
          <>
            <button
              type="button"
              aria-label={`Close ${label} filter`}
              onClick={() => setOpen(false)}
              style={{ all: "unset", position: "fixed", inset: 0, zIndex: 1000, cursor: "default" }}
            />
            <div
              style={{
                position: "fixed",
                left,
                top,
                width,
                zIndex: 1001,
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 12,
                boxShadow: "0 18px 44px rgba(0,0,0,.28)",
                padding: 12,
                display: "flex",
                flexDirection: "column",
                gap: 9,
                maxHeight: "min(60vh, 420px)",
                overflowY: "auto",
              }}
            >
              <div style={{ display: "flex", gap: 8, justifyContent: "space-between" }}>
                <button
                  type="button"
                  onClick={onSelectAll}
                  style={{
                    all: "unset",
                    cursor: "pointer",
                    fontSize: 11.5,
                    color: "var(--muted)",
                  }}
                >
                  Show all
                </button>
                <button
                  type="button"
                  onClick={onSelectNone}
                  style={{
                    all: "unset",
                    cursor: "pointer",
                    fontSize: 11.5,
                    color: "var(--muted)",
                  }}
                >
                  Hide all
                </button>
              </div>
              {options.map((option) => (
                // The swatch sits OUTSIDE the Checkbox on purpose: `Checkbox`
                // only derives an `aria-label` when its label is a plain string,
                // so wrapping the text in a coloured span would leave every box
                // in this list nameless to a screen reader.
                <span
                  key={option.key}
                  style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}
                >
                  {option.color && (
                    <span
                      aria-hidden="true"
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 3,
                        background: option.color,
                        flexShrink: 0,
                      }}
                    />
                  )}
                  <Checkbox
                    checked={shown.has(option.key)}
                    onChange={() => onToggle(option.key)}
                    label={option.label}
                  />
                </span>
              ))}
            </div>
          </>,
          document.body,
        )}
    </>
  );
}
