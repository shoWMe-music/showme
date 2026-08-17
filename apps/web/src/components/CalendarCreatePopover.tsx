import { Icon, type IconName } from "@showme/design-system";
import { useEffect } from "react";
import { createPortal } from "react-dom";

export interface CreateOption {
  key: string;
  label: string;
  icon: IconName;
  onSelect: () => void;
}

/**
 * The day "CREATE" menu — a small popover anchored to a calendar cell, matching
 * the prototype's "JUL 15 — CREATE" list. Dumb + presentational: the parent
 * supplies the date label and the option handlers. Dismisses on outside click
 * or Escape.
 */
export function CalendarCreatePopover({
  anchor,
  title,
  options,
  onClose,
}: {
  anchor: DOMRect;
  title: string;
  options: CreateOption[];
  onClose: () => void;
}) {
  // Anchor near the cell's top-left, clamped so the panel stays on screen.
  const width = 232;
  const estimatedHeight = 52 + options.length * 40;
  const left = Math.min(anchor.left + 6, window.innerWidth - width - 12);
  const top =
    anchor.top + 34 + estimatedHeight > window.innerHeight
      ? Math.max(12, window.innerHeight - estimatedHeight - 12)
      : anchor.top + 34;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <>
      {/* Click-catcher backdrop (transparent). */}
      <button
        type="button"
        aria-label="Close create menu"
        onClick={onClose}
        style={{
          all: "unset",
          position: "fixed",
          inset: 0,
          zIndex: 1000,
          cursor: "default",
        }}
      />
      <div
        role="menu"
        style={{
          position: "fixed",
          left,
          top,
          width,
          zIndex: 1001,
          padding: 6,
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 14,
          boxShadow: "var(--shadow-lg)",
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10.5,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "var(--muted)",
            padding: "8px 10px 6px",
          }}
        >
          {title} — Create
        </div>
        {options.map((option) => (
          <button
            key={option.key}
            type="button"
            role="menuitem"
            onClick={() => {
              option.onSelect();
              onClose();
            }}
            style={{
              all: "unset",
              display: "flex",
              alignItems: "center",
              gap: 10,
              width: "100%",
              boxSizing: "border-box",
              padding: "9px 10px",
              borderRadius: 9,
              cursor: "pointer",
              color: "var(--text)",
              fontSize: 13.5,
            }}
            onMouseEnter={(mouseEvent) => {
              mouseEvent.currentTarget.style.background = "var(--elevated)";
            }}
            onMouseLeave={(mouseEvent) => {
              mouseEvent.currentTarget.style.background = "transparent";
            }}
          >
            <Icon name={option.icon} size={17} />
            {option.label}
          </button>
        ))}
      </div>
    </>,
    document.body,
  );
}
