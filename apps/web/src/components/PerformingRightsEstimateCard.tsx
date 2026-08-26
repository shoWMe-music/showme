import { Card } from "@showme/design-system";
import type { PerformingRightsDisplay } from "./budgetPlannerView";

export interface PerformingRightsEstimateCardProps {
  performingRights: PerformingRightsDisplay;
}

/**
 * PRO fee estimate (§3b, the design prototype's Budget screen) — what the operator
 * should expect to owe the Performing Rights Organisation on the music played.
 *
 * The card states its assumptions in full, on purpose. shoWMe holds no PRO tariff
 * data (they are per-country and negotiated; see `packages/shared/performing-rights.ts`)
 * and no PRO is set for this event, so the figure is a planning placeholder at a
 * flat rate. Printing it bare would put a number that looks like a quote in front
 * of somebody about to commit to a show.
 */
export function PerformingRightsEstimateCard({
  performingRights,
}: PerformingRightsEstimateCardProps) {
  return (
    <Card padding="lg" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h4 style={headingStyle}>PRO fee estimate</h4>
        <span style={badgeStyle}>Estimate only</span>
      </div>
      <p style={{ color: "var(--muted)", fontSize: 12.5, margin: "0 0 10px" }}>
        Approximate performing-rights costs for planning. Final fees follow official tariffs.
      </p>
      <div style={figureStyle}>
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>
          Estimated PRO fee
        </div>
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: 600,
            fontSize: 28,
            color: "var(--text)",
          }}
        >
          {performingRights.feeLabel}
        </div>
        <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 6 }}>
          {performingRights.rateLabel}
        </div>
      </div>
      <ul style={assumptionListStyle}>
        {performingRights.assumptions.map((assumption) => (
          <li key={assumption} style={{ marginTop: 4 }}>
            {assumption}
          </li>
        ))}
      </ul>
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

const badgeStyle = {
  fontFamily: "var(--font-mono)",
  fontSize: 10,
  padding: "2px 8px",
  borderRadius: 999,
  background: "var(--elevated)",
  color: "var(--muted)",
} as const;

const figureStyle = {
  background: "var(--elevated)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: 18,
} as const;

const assumptionListStyle = {
  margin: "10px 0 0",
  paddingLeft: 18,
  color: "var(--dim)",
  fontSize: 11.5,
  lineHeight: 1.45,
} as const;
