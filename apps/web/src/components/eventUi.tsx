import { type TabItem, Tabs } from "@showme/design-system";
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
        background: "linear-gradient(135deg,var(--brand-red),var(--brand-amber))",
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
        background: "var(--shape-fill)",
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
        // The brand, not the beige. These pills carry a COUNT — "0 tickets",
        // "3 items" — which is the figure a reader scans a card for, and a
        // muted grey-on-beige chip is the one treatment guaranteed not to be
        // seen. A faint accent wash with accent text keeps it quiet enough to
        // sit beside a heading while still reading as the product's colour.
        background: "color-mix(in srgb, var(--accent) 12%, transparent)",
        color: "var(--accent)",
      }}
    >
      {children}
    </span>
  );
}

/** A bare bordered input matching the export's field styling. */
/**
 * A hand-rolled field, kept in step with the real ones BY TOKEN.
 *
 * This exists because a few event controls compose their own input — the venue
 * picker wraps a bare `<input>` in a combobox, the performer search the same —
 * so they cannot simply be a `TextField`. What they must not do is invent their
 * own surface: it used to paint `--elevated`, which in light mode is the warm
 * `#FFF9EF`, so these fields sat beige beside every real input's white and read
 * as a different control from the one two rows above them.
 *
 * `--control-surface` and `--control-border` are the same two tokens TextField,
 * NumberField, Select and Input use, so this follows the theme rather than
 * shadowing it. The proper fix is for these to compose a design-system input;
 * until then, the tokens are what keep them honest.
 */
export const fieldStyle: CSSProperties = {
  border: "1px solid var(--control-border)",
  background: "var(--control-surface)",
  borderRadius: 9,
  // Same box as every design-system control, so a hand-rolled field never sits
  // a pixel or two off the TextField beside it. Padding trimmed to 9px vertical
  // because these compose a bare input with its own line box; the min-height is
  // what actually decides the height.
  padding: "9px 12px",
  minHeight: "var(--control-height)",
  lineHeight: "var(--control-line-height)",
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

export function StageRail({
  currentIndex,
  status,
}: {
  currentIndex: number;
  /**
   * The event's actual status, so the rail can NAME the stage it is highlighting.
   *
   * Four stages carry seven statuses (`STATUS_STAGE_INDEX`), and one of those
   * collapses is a lie the operator can see: a hold sits at index 1 and the rail
   * therefore reported "Pending" for an event whose whole screen says "On hold".
   * Pending means waiting on a reply; on hold means the date is being kept warm
   * in a queue — different things, and the second is the one the holds panel
   * below is about. Optional so callers that have no status keep the old labels.
   */
  status?: string;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", margin: "24px 0 6px" }}>
      {STAGE_DEFS.map(([key, stageLabel, color], index) => {
        const label = key === "pending" && status === "on_hold" ? "On hold" : stageLabel;
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
                  background: index <= currentIndex ? "var(--brand-red)" : "var(--border)",
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
                background: reached ? color : "var(--shape-fill)",
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

/**
 * A tab on the event workspace. The design system's `TabItem` under a local
 * name, not a copy of it: this file used to declare its own `{ key, label,
 * badge }` shape next to its own tab bar, and the two drifted the moment the
 * design system grew a sliding indicator that this one never got.
 */
export type EventTab = TabItem;

/**
 * The event workspace's tab strip.
 *
 * This USED to be a second tab implementation — inline styles, a per-tab
 * `borderBottom` that snapped between tabs with no transition at all. The
 * design system's `Tabs` had already grown a GSAP-slid underline and
 * `TabPanels` a directional scoot, and `EventDetail` had adopted the scoot, so
 * on the live screen the panel slid while the bar underneath it jumped. Two
 * implementations of one control is how that happens.
 *
 * What is left is an adapter: the count badge and the horizontal scroll this
 * strip needed moved INTO `Tabs` (where the next nine-tab screen gets them for
 * free), and the only thing that stayed behind is the vertical rhythm around
 * the strip, which belongs to this screen rather than to the control.
 *
 * The wrapper exists solely because `EventDetail` calls `EventTabsBar`; when
 * that file is next open, it can render `Tabs` directly and this can go.
 */
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
    <div style={{ margin: "18px 0 26px" }}>
      <Tabs tabs={tabs} value={value} onChange={onChange} />
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
