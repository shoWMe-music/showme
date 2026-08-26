import type { CSSProperties, ReactNode } from "react";

/**
 * Shared building blocks for the event-detail screen, styled to mirror the
 * Claude design export (`shoWMe All View`) 1:1 using design tokens so both
 * themes render correctly. These are the bespoke card / header / grid / chip /
 * button shapes the export uses that the generic design-system atoms don't
 * cover. Kept presentational — data + handlers arrive via props.
 */

/** A section card: `--card` surface, 1px border, radius 16, padding 24, shadow. */
export function SectionCard({
  children,
  style,
}: {
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 16,
        padding: 24,
        boxShadow: "var(--shadow)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** Card header: colored glyph + display title, with an optional right-side action. */
export function CardHeader({
  icon,
  iconColor,
  title,
  action,
  size = 16,
}: {
  icon?: ReactNode;
  iconColor?: string;
  title: ReactNode;
  action?: ReactNode;
  size?: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
        marginBottom: 16,
        flexWrap: "wrap",
      }}
    >
      <h3
        style={{
          fontFamily: "var(--font-display)",
          fontWeight: 600,
          fontSize: size,
          margin: 0,
          color: "var(--text)",
          display: "flex",
          alignItems: "center",
          gap: 9,
        }}
      >
        {icon && (
          <span style={{ color: iconColor ?? "var(--accent)", display: "inline-flex" }}>
            {icon}
          </span>
        )}
        {title}
      </h3>
      {action}
    </div>
  );
}

/** Mono uppercase micro-label used as an in-card section eyebrow. */
export function Eyebrow({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        letterSpacing: ".1em",
        textTransform: "uppercase",
        color: "var(--dim)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export interface InfoPair {
  label: string;
  value: ReactNode;
}

/** Two-column label→value grid (right-aligned values) — the info-card body. */
export function InfoPairGrid({ pairs, columns = 2 }: { pairs: InfoPair[]; columns?: 1 | 2 }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: columns === 2 ? "1fr 1fr" : "1fr",
        gap: "2px 40px",
      }}
    >
      {pairs.map((pair) => (
        <div
          key={pair.label}
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 16,
            padding: "11px 0",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <span style={{ color: "var(--muted)", fontSize: 13 }}>{pair.label}</span>
          <span
            style={{
              color: "var(--text)",
              fontSize: 13.5,
              fontWeight: 500,
              textAlign: "right",
            }}
          >
            {pair.value}
          </span>
        </div>
      ))}
    </div>
  );
}

/** The coral→amber gradient primary button the export uses for the key action. */
export function GradientButton({
  children,
  onClick,
  type = "button",
  disabled,
  style,
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
  style?: CSSProperties;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "9px 15px",
        borderRadius: 10,
        border: 0,
        background: "linear-gradient(135deg,#EE5746,#F4A046)",
        color: "#fff",
        fontSize: 13,
        fontWeight: 600,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
        ...style,
      }}
    >
      {children}
    </button>
  );
}

/** Bordered `--surface` secondary button (Edit / Upload / From Team …). */
export function OutlineButton({
  children,
  onClick,
  style,
}: {
  children: ReactNode;
  onClick?: () => void;
  style?: CSSProperties;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "7px 13px",
        borderRadius: 9,
        border: "1px solid var(--border)",
        background: "var(--surface)",
        color: "var(--text)",
        fontSize: 12.5,
        fontWeight: 500,
        cursor: "pointer",
        ...style,
      }}
    >
      {children}
    </button>
  );
}

/** Small square icon-only button (remove ×, etc.) — transparent, muted glyph. */
export function GlyphButton({
  children,
  onClick,
  ariaLabel,
  style,
}: {
  children: ReactNode;
  onClick?: () => void;
  ariaLabel: string;
  style?: CSSProperties;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      style={{
        background: "transparent",
        border: 0,
        color: "var(--dim)",
        cursor: "pointer",
        padding: 2,
        display: "grid",
        placeItems: "center",
        ...style,
      }}
    >
      {children}
    </button>
  );
}

/** A removable pill (amenities, etc.). */
export function RemovableChip({
  label,
  onRemove,
}: {
  label: string;
  onRemove?: () => void;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        padding: onRemove ? "6px 9px 6px 13px" : "5px 12px",
        borderRadius: 999,
        background: "var(--elevated)",
        border: "1px solid var(--border)",
        color: "var(--text)",
        fontSize: 12.5,
      }}
    >
      {label}
      {onRemove && (
        <GlyphButton ariaLabel={`Remove ${label}`} onClick={onRemove} style={{ padding: 0 }}>
          <XIcon size={13} />
        </GlyphButton>
      )}
    </span>
  );
}

/** A mono pill used for counts / codes (e.g. "0 tickets", capacity). */
export function MonoPill({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        padding: "3px 10px",
        borderRadius: 999,
        background: "var(--elevated)",
        color: "var(--muted)",
      }}
    >
      {children}
    </span>
  );
}

/** A bare bordered input matching the export's field styling. */
export const fieldStyle: CSSProperties = {
  border: "1px solid var(--border)",
  background: "var(--elevated)",
  borderRadius: 9,
  padding: "9px 12px",
  color: "var(--text)",
  fontSize: 13,
  outline: "none",
  boxSizing: "border-box",
};

// ── Stage progression rail ────────────────────────────────────────────────
// Four solid colored dots (per stage) joined by a coral connector, ring on the
// current stage — the export's exact `stepDefs` palette and geometry.

const STAGE_DEFS: [key: string, label: string, color: string][] = [
  ["suggested", "Suggested", "#B58BE0"],
  ["pending", "Pending", "#F4A046"],
  ["confirmed", "Confirmed", "#6FC97A"],
  ["concluded", "Concluded", "#B8A99B"],
];

/** Map an API event status onto the 0..3 rail index (matches the export). */
export const STATUS_STAGE_INDEX: Record<string, number> = {
  draft: 0,
  suggested: 0,
  pending: 1,
  on_hold: 1,
  confirmed: 2,
  concluded: 3,
  cancelled: 3,
};

function hexAlpha(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function StageRail({ currentIndex }: { currentIndex: number }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", margin: "24px 0 6px" }}>
      {STAGE_DEFS.map(([key, label, color], index) => {
        const reached = index <= currentIndex;
        const current = index === currentIndex;
        return (
          <div
            key={key}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              position: "relative",
            }}
          >
            {index > 0 && (
              <div
                style={{
                  position: "absolute",
                  top: 6,
                  right: "50%",
                  width: "100%",
                  height: 2,
                  background: index <= currentIndex ? "#EE5746" : "var(--border)",
                  zIndex: 0,
                }}
              />
            )}
            <div
              style={{
                position: "relative",
                zIndex: 1,
                width: 15,
                height: 15,
                borderRadius: "50%",
                background: reached ? color : "var(--elevated)",
                border: reached ? "none" : "1.5px solid var(--border)",
                boxShadow: current ? `0 0 0 4px ${hexAlpha(color, 0.22)}` : "none",
              }}
            />
            <span
              style={{
                marginTop: 9,
                fontSize: 11.5,
                fontWeight: 500,
                color: current ? "var(--text)" : reached ? "var(--muted)" : "var(--dim)",
              }}
            >
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Underline tab bar ─────────────────────────────────────────────────────

export interface EventTab {
  key: string;
  label: string;
  badge?: number;
}

/** Flat underline tab bar with an active coral underline + optional count badge. */
export function EventTabsBar({
  tabs,
  value,
  onChange,
}: {
  tabs: EventTab[];
  value: string;
  onChange: (key: string) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        // The rule under the strip is drawn INSIDE the box rather than as a
        // border, so the active tab's 2px underline can sit on top of it without
        // a negative margin. A negative margin made each tab's border box hang
        // 1px below the container's content box, and since `overflow-x: auto`
        // promotes a `visible` overflow-y to `auto`, that 1px produced a real
        // vertical scrollbar on a single-line tab strip.
        boxShadow: "inset 0 -1px 0 var(--border)",
        margin: "18px 0 26px",
        overflowX: "auto",
        // Pinned, so the promotion above can never bring the vertical bar back.
        overflowY: "hidden",
      }}
    >
      {tabs.map((tab) => {
        const active = tab.key === value;
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => onChange(tab.key)}
            style={{
              appearance: "none",
              background: "transparent",
              border: 0,
              borderBottom: active ? "2px solid #EE5746" : "2px solid transparent",
              color: active ? "#EE5746" : "var(--muted)",
              fontSize: 13.5,
              fontWeight: active ? 600 : 500,
              padding: "12px 14px",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
              {tab.label}
              {tab.badge ? (
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 10,
                    minWidth: 16,
                    height: 16,
                    padding: "0 4px",
                    borderRadius: 999,
                    background: "#EE5746",
                    color: "#fff",
                    display: "inline-grid",
                    placeItems: "center",
                  }}
                >
                  {tab.badge}
                </span>
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ── A tiny inline X glyph (used by chips/rows without pulling the DS Icon) ──
export function XIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      aria-hidden="true"
    >
      <title>Remove</title>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}
