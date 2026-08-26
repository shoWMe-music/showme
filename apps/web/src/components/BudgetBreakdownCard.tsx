import { Card } from "@showme/design-system";
import type { BreakdownDisplayRow } from "./budgetPlannerView";

export interface BudgetBreakdownCardProps {
  title: string;
  rows: BreakdownDisplayRow[];
  /** Shown when nothing has been budgeted yet — never a placeholder figure. */
  emptyLabel: string;
}

/**
 * Revenue Sources and Cost Breakdown (§3b, the design prototype's Budget screen):
 * one labelled bar per heading, with its amount and its share of the total.
 *
 * One component for both lists because they are the same object — a list of named
 * slices of a total — and giving them separate implementations is how two lists
 * that should agree start rounding differently.
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
        rows.map((row) => (
          <div key={row.label} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
              <span style={{ color: "var(--text)" }}>{row.label}</span>
              <span style={{ fontFamily: "var(--font-mono)", color: "var(--muted)" }}>
                {row.amountLabel} · {row.percentLabel}
              </span>
            </div>
            <div style={trackStyle}>
              <div
                style={{
                  height: "100%",
                  width: `${row.barPercent}%`,
                  borderRadius: 999,
                  background: row.color,
                }}
              />
            </div>
          </div>
        ))
      )}
    </Card>
  );
}

const headingStyle = {
  fontFamily: "var(--font-display)",
  fontWeight: 600,
  fontSize: 14,
  color: "var(--text)",
  margin: 0,
} as const;

const trackStyle = {
  height: 7,
  borderRadius: 999,
  background: "var(--shape-fill)",
  overflow: "hidden",
} as const;
