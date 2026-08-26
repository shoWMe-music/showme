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
  /**
   * Override the tile figure's size. Four-across tiles are narrower than the
   * three the default 34px was drawn for, and a six-figure total in a currency
   * whose code is spelled out ("SEK 306,700") does not fit one at that size.
   */
  valueFontSize?: number;
}

const TONE_COLOR: Record<KpiTone, string | undefined> = {
  green: "#6FC97A",
  red: "#EE5746",
  amber: "#F4A046",
  neutral: undefined,
};

export function KpiRow({
  items,
  eyebrow,
  minTileWidth = 200,
  columns,
  valueFontSize,
}: KpiRowProps) {
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
          const color = item.tone ? TONE_COLOR[item.tone] : undefined;
          const figureStyle =
            color || valueFontSize ? { color, fontSize: valueFontSize } : undefined;
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
