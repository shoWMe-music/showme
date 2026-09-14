import { StatCard } from "@showme/design-system";
import type { ReactNode } from "react";
import { Eyebrow } from "./primitives";

/** A row of KPI `StatCard`s with an optional mono eyebrow — the triptych's top
 * band (§15.F), reused on Dashboard, Reports, Projections, Budget. Thin wrapper:
 * lays the tiles out responsively and applies an optional tint to the figure. */
export type KpiTone = "green" | "blue" | "red" | "amber" | "neutral";

export interface KpiItem {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: KpiTone;
}

export interface KpiRowProps {
  items: KpiItem[];
  eyebrow?: string;
  /** Minimum tile width before wrapping. */
  minTileWidth?: number;
  /**
   * Force a fixed number of columns, so a tile count that does not divide evenly
   * leaves a SHORT LAST ROW rather than redistributing (the Budget Planner's
   * Results block is "a 4-column grid of 7 tiles", last row short by design —
   * docs/design-handoff-budget-planner.md §3.5).
   *
   * Still responsive: each track is at least the width four would take, so
   * exactly that many fit, and below `minTileWidth` the grid drops to fewer
   * columns instead of crushing them.
   */
  columns?: number;
  /**
   * `cards` — separate tiles with their own border and radius. The dashboards.
   *
   * `slab` — one panel divided by hairlines, which is what the Budget Planner
   * prototype draws: tiles butted together with a 1px gap, the panel's own
   * background showing through as the rule. Nine figures that belong to ONE
   * calculation read as one object; nine floating cards read as nine unrelated
   * numbers, and that difference is the whole reason the design groups them.
   */
  variant?: "cards" | "slab";
  /** Compact only: the figure size in px, passed through to `StatCard`. */
  valueSize?: number;
}

const TONE_COLOR: Record<KpiTone, string | undefined> = {
  green: "#6FC97A",
  // The Budget Planner's Ticket revenue tile. Informational rather than good or
  // bad — the door is neither a win nor a loss, it is the base every percentage
  // deal is measured against (#23.1), so it must not borrow green's meaning.
  blue: "#6FA8E0",
  red: "#EE5746",
  amber: "#F4A046",
  neutral: undefined,
};

export function KpiRow({
  items,
  eyebrow,
  minTileWidth = 200,
  columns,
  variant = "cards",
  valueSize,
}: KpiRowProps) {
  const slab = variant === "slab";
  // The hairline IS the gap: the panel's border colour shows between tiles that
  // each paint their own surface. One rule between neighbours, never two.
  const gap = slab ? 1 : 14;
  const trackMinimum = columns
    ? `max(${minTileWidth}px, calc((100% - ${(columns - 1) * gap}px) / ${columns}))`
    : `${minTileWidth}px`;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(auto-fit, minmax(${trackMinimum}, 1fr))`,
          gap,
          ...(slab
            ? {
                background: "var(--border)",
                border: "1px solid var(--border)",
                borderRadius: 12,
                overflow: "hidden",
              }
            : null),
        }}
      >
        {items.map((item, index) => {
          // `valueFontSize` used to live here, forcing 24px on the four-across
          // Results block because "SEK 306,700" would not fit 34px. `StatCard`
          // now sizes the figure to its own tile, which does the same job for
          // every caller and adapts to figures this one could not — a fixed 24px
          // still overflowed a seven-figure total in a 180px tile.
          const color = item.tone ? TONE_COLOR[item.tone] : undefined;
          const figureStyle = color ? { color } : undefined;
          return (
            <StatCard
              // A KPI row is a fixed, order-stable set of tiles (no add/remove/reorder),
              // and `label` is a ReactNode, so the index is the stable identity here.
              // biome-ignore lint/suspicious/noArrayIndexKey: static, non-reordering tiles
              key={index}
              density={slab ? "compact" : "comfortable"}
              valueSize={valueSize}
              label={item.label}
              value={figureStyle ? <span style={figureStyle}>{item.value}</span> : item.value}
              hint={item.hint}
              icon={item.icon}
            />
          );
        })}
      </div>
    </div>
  );
}
