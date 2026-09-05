import { StatCard } from "@showme/design-system";
import type { ReactNode } from "react";
import { Eyebrow } from "./primitives";

/** A row of KPI `StatCard`s with an optional mono eyebrow — the triptych's top
 * band (§15.F), reused on Dashboard, Reports, Projections, Budget. Thin wrapper:
 * lays the tiles out responsively and applies an optional tint to the figure. */
export type KpiTone = "green" | "red" | "amber" | "neutral";

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
}

const TONE_COLOR: Record<KpiTone, string | undefined> = {
  green: "#6FC97A",
  red: "#EE5746",
  amber: "#F4A046",
  neutral: undefined,
};

export function KpiRow({ items, eyebrow, minTileWidth = 200, columns }: KpiRowProps) {
  const gap = 14;
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
