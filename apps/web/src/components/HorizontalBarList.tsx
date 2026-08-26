import { Card } from "@showme/design-system";
import { Eyebrow } from "./primitives";

/** A labeled horizontal bar list for the analytics screens (§5, §7): a label +
 * right-aligned figure + a proportional brand-gradient bar. Zero-value rows
 * render an empty track. Presentational — the screen supplies computed values. */
export interface HorizontalBarItem {
  label: string;
  value: number;
  /** Denominator for this row's bar width. Falls back to the list max. */
  max?: number;
  sublabel?: string;
}

export interface HorizontalBarListProps {
  items: HorizontalBarItem[];
  /** Formats each value for the right-aligned figure. */
  format?: (value: number) => string;
  /** Optional mono eyebrow above the list (e.g. "Revenue by Event"). */
  eyebrow?: string;
}

export function HorizontalBarList({ items, format, eyebrow }: HorizontalBarListProps) {
  const listMax = items.reduce((max, item) => Math.max(max, item.value), 0) || 1;

  return (
    <Card padding="lg" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      {items.map((item) => {
        const denominator = item.max && item.max > 0 ? item.max : listMax;
        const percent = Math.max(0, Math.min(100, (item.value / denominator) * 100));
        return (
          <div key={item.label} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <div style={{ display: "flex", flexDirection: "column" }}>
                <span style={{ color: "var(--text)", fontSize: 14 }}>{item.label}</span>
                {item.sublabel && (
                  <span style={{ color: "var(--muted)", fontSize: 12 }}>{item.sublabel}</span>
                )}
              </div>
              <span style={{ fontFamily: "var(--font-mono)", color: "var(--text)", fontSize: 14 }}>
                {format ? format(item.value) : item.value}
              </span>
            </div>
            <div
              style={{
                height: 8,
                borderRadius: 999,
                background: "var(--shape-fill)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${percent}%`,
                  height: "100%",
                  borderRadius: 999,
                  background: "linear-gradient(90deg, var(--brand-amber), var(--brand-red))",
                }}
              />
            </div>
          </div>
        );
      })}
    </Card>
  );
}
