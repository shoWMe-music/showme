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
 *
 * NO CARD OF ITS OWN, and no heading. It sits inside the Results card under an
 * eyebrow, because the chart is not a separate panel — it is the nine figures
 * above it, plotted. The prototype draws it exactly this way, bare, while the
 * two donuts beside it keep their borders.
 */
export function BudgetBreakEvenChart({ breakEven }: BudgetBreakEvenChartProps) {
  const { chart } = breakEven;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <p style={{ color: "var(--muted)", fontSize: 12, margin: "0 0 8px" }}>
        Revenue vs. total cost across ticket sales up to capacity.
      </p>
      {/* NO `preserveAspectRatio="none"`. It stretched a 460x180 box to whatever
          width the card had, which distorts every stroke with it — a 2px line
          drawn thinner horizontally than vertically. The viewBox now carries the
          prototype's own proportions, so the chart can scale honestly. */}
      <svg
        viewBox={`0 0 ${chart.width} ${chart.height}`}
        style={{ width: "100%", height: "auto", display: "block", overflow: "visible" }}
        role="img"
        aria-label={`Revenue passes total cost at ${breakEven.breakEvenLabel} of ${breakEven.capacityLabel} capacity`}
      >
        {/* The money scale. Without it the lines showed a shape and no figures —
            a reader could see that revenue overtakes cost and not what either is
            worth at the crossing. */}
        {/* Keyed by POSITION. An empty budget collapses the scale to a single
            minor unit, so all three rules land on the same amount and the same y
            — and a key built from those is the same key three times. React
            reported it; the chart also drew one rule where it meant three. */}
        {breakEven.gridLabels.map((line, index) => (
          // Three fixed rules that never reorder; position IS the identity.
          // biome-ignore lint/suspicious/noArrayIndexKey: static, non-reordering rules
          <g key={index}>
            <line
              x1={0}
              y1={line.y}
              x2={chart.width}
              y2={line.y}
              stroke="var(--border)"
              strokeWidth={1}
            />
            <text
              x={4}
              y={line.y - 4}
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 9,
                fill: "var(--muted)",
              }}
            >
              {line.label}
            </text>
          </g>
        ))}
        {/* THE GAP BETWEEN THE LINES, which is the loss or the profit. This used
            to shade the area UNDER revenue, in green, all the way to the
            baseline — so the part of the chart where the show loses money was
            coloured like the part where it makes money. */}
        {chart.lossAreaPoints && (
          <polygon points={chart.lossAreaPoints} fill="rgba(238, 87, 70, 0.11)" />
        )}
        {chart.profitAreaPoints && (
          <polygon points={chart.profitAreaPoints} fill="rgba(111, 201, 122, 0.14)" />
        )}
        <polyline
          points={chart.costPoints}
          fill="none"
          stroke="#EE5746"
          strokeWidth={2}
          strokeDasharray="5 4"
        />
        <polyline points={chart.revenuePoints} fill="none" stroke="#6FC97A" strokeWidth={2.5} />
        {/* WHAT THE OPERATOR ACTUALLY EXPECTS TO SELL. The chart runs to capacity,
            so without this the forecast the whole sheet is built on had no place
            on the picture of it. */}
        {chart.plannedX !== null && (
          <line
            x1={chart.plannedX}
            y1={chart.guideTop}
            x2={chart.plannedX}
            y2={chart.guideBottom}
            stroke="var(--muted)"
            strokeWidth={1}
            strokeDasharray="2 4"
            opacity={0.6}
          />
        )}
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
        {/* THE SENTENCE THE DESIGN WRITES, not a bare figure: "Break-even ≈ 364
            tickets" names the number without saying what happens there.
            "REVENUE", not the design's "ticket revenue": our line carries bar and
            merch per head as well as the door (#23.1), so naming it after the
            door alone would describe a line we are not drawing. Off-chart
            break-even is still stated rather than pinned to an edge it does not
            sit on. */}
        <span style={{ color: "#F4A046" }}>
          {chart.hasBreakEven
            ? `Revenue passes total cost at ${breakEven.breakEvenLabel} of ${breakEven.capacityLabel} capacity.`
            : `Revenue never passes total cost inside ${breakEven.capacityLabel} capacity.`}
        </span>
        <span>{breakEven.capacityLabel} cap</span>
      </div>
      <div style={{ display: "flex", gap: 18, marginTop: 12, flexWrap: "wrap" }}>
        <LegendKey color="#6FC97A" label="Revenue" />
        <LegendKey color="#EE5746" label="Total cost" />
        {chart.plannedX !== null && <LegendKey color="var(--muted)" label="Tickets planned" />}
      </div>
    </div>
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

const axisRowStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  marginTop: 10,
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  color: "var(--muted)",
} as const;
