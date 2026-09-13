import { Card } from "@showme/design-system";
import type { BreakdownDisplayRow } from "./budgetPlannerView";

export interface BudgetBreakdownCardProps {
  title: string;
  rows: BreakdownDisplayRow[];
  /** Shown when nothing has been budgeted yet — never a placeholder figure. */
  emptyLabel: string;
}

/**
 * Revenue Sources and Cost Breakdown — a donut and a legend.
 *
 * One component for both lists because they are the same object: named slices of
 * one total. Giving them separate implementations is how two lists that should
 * agree start rounding differently.
 *
 * A DONUT, not the bar list this used to draw. The bars were scaled so the
 * largest always filled its track, which answers "which is biggest?" and hides
 * the question the card is actually asked — how the night divides. A ring answers
 * that by construction: the slices close, so a reader can see that the performer
 * fee IS most of the cost rather than inferring it from a full-width bar.
 */
export function BudgetBreakdownCard({ title, rows, emptyLabel }: BudgetBreakdownCardProps) {
  return (
    <Card padding="lg" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <h4 style={headingStyle}>{title}</h4>
      {rows.length === 0 ? (
        <div style={{ color: "var(--dim)", fontSize: 13, textAlign: "center", padding: "24px 0" }}>
          {emptyLabel}
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
          <BreakdownDonut rows={rows} />
          <div style={{ display: "flex", flexDirection: "column", gap: 9, flex: "1 1 190px" }}>
            {rows.map((row) => (
              <div
                key={row.label}
                style={{ display: "flex", alignItems: "baseline", gap: 10, fontSize: 13 }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: 3,
                    background: row.color,
                    flexShrink: 0,
                    alignSelf: "center",
                  }}
                />
                <span style={{ color: "var(--text)", flex: 1, minWidth: 0 }}>{row.label}</span>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    color: "var(--text)",
                    fontVariantNumeric: "tabular-nums",
                    whiteSpace: "nowrap",
                  }}
                >
                  {row.amountLabel}
                </span>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    color: "var(--muted)",
                    width: 38,
                    textAlign: "right",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {row.percentLabel}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

/**
 * The ring, drawn with one `stroke-dasharray` arc per slice on a shared circle.
 *
 * SVG rather than a conic gradient: a gradient cannot carry the 1px gaps between
 * slices, and it gives nothing to hang a `<title>` on. The arcs run from a
 * rotated origin so the first slice starts at twelve o'clock, where a reader
 * expects a total to begin.
 */
function BreakdownDonut({ rows }: { rows: BreakdownDisplayRow[] }) {
  const RADIUS = 45;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
  let consumed = 0;

  return (
    <svg
      viewBox="0 0 120 120"
      width={112}
      height={112}
      role="img"
      aria-label={rows.map((row) => `${row.label} ${row.percentLabel}`).join(", ")}
      style={{ flexShrink: 0 }}
    >
      <circle cx="60" cy="60" r={RADIUS} fill="none" stroke="var(--border)" strokeWidth="13" />
      {rows.map((row) => {
        // Clamped, because a rounding residue must never let the ring overrun
        // itself — a slice lapping the circle would draw over the first one and
        // quietly misreport the split.
        const share = Math.max(0, Math.min(100 - consumed, row.sharePercent));
        const length = (share / 100) * CIRCUMFERENCE;
        const offset = -(consumed / 100) * CIRCUMFERENCE;
        consumed += share;
        return (
          <circle
            key={row.label}
            cx="60"
            cy="60"
            r={RADIUS}
            fill="none"
            stroke={row.color}
            strokeWidth="13"
            strokeDasharray={`${Math.max(0, length - 1)} ${CIRCUMFERENCE}`}
            strokeDashoffset={offset}
            transform="rotate(-90 60 60)"
          />
        );
      })}
      <text
        x="60"
        y="63"
        textAnchor="middle"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          fill: "var(--muted)",
          letterSpacing: "0.5px",
        }}
      >
        Total
      </text>
    </svg>
  );
}

const headingStyle = {
  fontFamily: "var(--font-display)",
  fontWeight: 600,
  fontSize: 17,
  color: "var(--text)",
  margin: 0,
} as const;
