import { Card } from "@showme/design-system";
import type { PerformingRightsDisplay } from "./budgetPlannerView";

export interface PerformingRightsEstimateCardProps {
  performingRights: PerformingRightsDisplay;
}

/**
 * PRO fee estimate (§3b, the design prototype's Budget screen) — what the operator
 * should expect to owe the Performing Rights Organisation on the music played.
 *
 * The card states its assumptions in full, on purpose, and it says which of two
 * quite different things the figure above them is:
 *
 * - **A configured territory rate.** A platform admin has read STIM's or GEMA's
 *   published tariff and entered it against this show's country
 *   (`performing_rights_rates`, migration 0018). The pill names the society, and
 *   links out to the tariff when a source was recorded.
 * - **The flat planning default.** Nothing is configured for this territory — or
 *   shoWMe cannot tell where the show is. The pill reads "Estimate only" and the
 *   assumptions say plainly that no published tariff was consulted.
 *
 * The second state is not a placeholder waiting to be removed. Printing 6% bare,
 * or dressed as a tariff, puts a number that looks like a quote in front of
 * somebody about to commit to a show. Everything the card knows about which state
 * it is in comes from `budgetPlannerView`; this component renders and computes
 * nothing.
 */
export function PerformingRightsEstimateCard({
  performingRights,
}: PerformingRightsEstimateCardProps) {
  return (
    <Card padding="lg" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h4 style={headingStyle}>PRO fee estimate</h4>
        <span style={performingRights.isTerritoryTariff ? tariffBadgeStyle : badgeStyle}>
          {performingRights.sourceLabel}
        </span>
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
      {performingRights.sourceUrl && (
        // The tariff the rate was read off. A percentage with nothing behind it is
        // as unfounded as the flat 6%, so when an admin recorded the source the
        // operator gets to go and check it.
        <a
          href={performingRights.sourceUrl}
          target="_blank"
          rel="noreferrer"
          style={sourceLinkStyle}
        >
          View the published tariff
        </a>
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

const badgeStyle = {
  fontFamily: "var(--font-mono)",
  fontSize: 10,
  padding: "2px 8px",
  borderRadius: 999,
  background: "var(--shape-fill)",
  color: "var(--muted)",
} as const;

/**
 * The same pill, but it reads as a fact rather than a caveat: a rate somebody
 * looked up and entered is a different claim from a flat guess, and the card
 * should not make them look identical.
 */
const tariffBadgeStyle = {
  ...badgeStyle,
  background: "var(--surface)",
  color: "var(--text)",
  border: "1px solid var(--border)",
} as const;

/** Underlined and in the accent, because a muted un-underlined line reads as prose
 * and the whole point of this one is that it can be clicked and checked. */
const sourceLinkStyle = {
  marginTop: 8,
  fontSize: 11.5,
  color: "var(--accent)",
  textDecoration: "underline",
  alignSelf: "flex-start",
} as const;

const figureStyle = {
  background: "var(--card)",
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
