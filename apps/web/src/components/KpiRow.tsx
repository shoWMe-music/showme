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
}

const TONE_COLOR: Record<KpiTone, string | undefined> = {
  green: "#6FC97A",
  red: "#EE5746",
  amber: "#F4A046",
  neutral: undefined,
};

export function KpiRow({ items, eyebrow, minTileWidth = 200 }: KpiRowProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(auto-fit, minmax(${minTileWidth}px, 1fr))`,
          gap: 14,
        }}
      >
        {items.map((item, index) => {
          const color = item.tone ? TONE_COLOR[item.tone] : undefined;
          return (
            <StatCard
              // A KPI row is a fixed, order-stable set of tiles (no add/remove/reorder),
              // and `label` is a ReactNode, so the index is the stable identity here.
              // biome-ignore lint/suspicious/noArrayIndexKey: static, non-reordering tiles
              key={index}
              label={item.label}
              value={color ? <span style={{ color }}>{item.value}</span> : item.value}
              hint={item.hint}
              icon={item.icon}
            />
          );
        })}
      </div>
    </div>
  );
}
