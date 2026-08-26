import { Card } from "@showme/design-system";
import type { BreakEvenDisplay } from "./budgetPlannerView";

export interface BudgetBreakEvenChartProps {
  breakEven: BreakEvenDisplay;
}

/**
 * Break-even Analysis (§3b, the design prototype's Budget screen).
 *
 * Revenue rising with ticket sales against a total cost that does not move, and
 * the point where they cross. Presentational to the last coordinate: every number
 * in the SVG comes from `computeBreakEvenChart()` in `@showme/shared`, so this
 * component cannot disagree with the KPI band above it.
 */
export function BudgetBreakEvenChart({ breakEven }: BudgetBreakEvenChartProps) {
  const { chart } = breakEven;
  return (
    <Card padding="lg" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <h4 style={headingStyle}>Break-even Analysis</h4>
      <p style={{ color: "var(--muted)", fontSize: 12, margin: "0 0 12px" }}>
        Revenue vs. fixed costs across ticket sales up to capacity.
      </p>
      <svg
        viewBox={`0 0 ${chart.width} ${chart.height}`}
        preserveAspectRatio="none"
        style={{ width: "100%", height: 190, display: "block", overflow: "visible" }}
        role="img"
        aria-label={`Revenue passes total cost at ${breakEven.breakEvenLabel} of ${breakEven.capacityLabel} capacity`}
      >
        <polygon points={chart.shadedAreaPoints} fill="rgba(111, 201, 122, 0.12)" />
        <polyline
          points={chart.costPoints}
          fill="none"
          stroke="#EE5746"
          strokeWidth={2}
          strokeDasharray="5 4"
        />
        <polyline points={chart.revenuePoints} fill="none" stroke="#6FC97A" strokeWidth={2.5} />
        {chart.hasBreakEven && (
          <>
            <line
              x1={chart.breakEvenX}
              y1={chart.guideTop}
              x2={chart.breakEvenX}
              y2={chart.guideBottom}
              stroke="var(--border-strong)"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            <circle
              cx={chart.breakEvenX}
              cy={chart.breakEvenY}
              r={4.5}
              fill="#F4A046"
              stroke="var(--card)"
              strokeWidth={2}
            />
          </>
        )}
      </svg>
      <div style={axisRowStyle}>
        <span>0</span>
        {/* Off-chart break-even is stated, not drawn at an edge it does not sit on. */}
        <span style={{ color: "#F4A046" }}>
          {chart.hasBreakEven
            ? `Break-even ≈ ${breakEven.breakEvenLabel}`
            : "No break-even inside this capacity"}
        </span>
        <span>{breakEven.capacityLabel} cap</span>
      </div>
      <div style={{ display: "flex", gap: 18, marginTop: 12 }}>
        <LegendKey color="#6FC97A" label="Revenue" />
        <LegendKey color="#EE5746" label="Total cost" />
      </div>
    </Card>
  );
}

function LegendKey({ color, label }: { color: string; label: string }) {
  return (
    <span
      style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: "var(--muted)" }}
    >
      <span style={{ width: 14, height: 3, borderRadius: 2, background: color }} />
      {label}
    </span>
  );
}

const headingStyle = {
  fontFamily: "var(--font-display)",
  fontWeight: 600,
  fontSize: 14,
  color: "var(--text)",
  margin: 0,
} as const;

const axisRowStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  marginTop: 10,
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  color: "var(--muted)",
} as const;
