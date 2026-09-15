import { Avatar, Badge, Card, Icon } from "@showme/design-system";
import { roleTile } from "./SettlementPartyCard";
import { CardTitle, Eyebrow } from "./primitives";
import type { EntitlementShare, EventSettlement } from "./useEventSettlement";

/**
 * WHO TOOK WHAT, drawn as proportions — the design's "Total settlement" card and
 * the Collaborators tab's "Each party's position"
 * (`claude-prototype/ran-2026-09-10/renders/`).
 *
 * The two are the same fact laid out twice, which is why they are one file: the
 * Overview draws a single stacked bar with the list under it, the Collaborators
 * tab draws a bar per party. A second copy of the arithmetic in either place is
 * the drift this module exists to prevent — and there is no arithmetic here at
 * all. `useEventSettlement` serves `shares` already proportioned and already
 * formatted; these components choose colours and widths and nothing else.
 */

const CARD_COLUMN = { display: "flex", flexDirection: "column", gap: 14 } as const;

/**
 * The stacked bar. One segment per party, coloured by role, in the order the
 * shares arrive (largest first).
 *
 * `minmax`-free and deliberately: a segment narrower than a pixel is a segment
 * the reader cannot see, and rounding it up to a visible sliver would make the
 * bar disagree with the percentages printed beside it. A party with almost
 * nothing shows almost nothing, and the list underneath says how much.
 */
function StackedShareBar({ shares }: { shares: EntitlementShare[] }) {
  const drawn = shares.filter((share) => share.fraction > 0);
  if (drawn.length === 0) return null;
  return (
    <div
      style={{
        display: "flex",
        height: 6,
        borderRadius: 999,
        overflow: "hidden",
        background: "var(--border)",
      }}
    >
      {drawn.map((share) => (
        <div
          key={share.key}
          style={{
            width: `${share.fraction * 100}%`,
            background: roleTile(share.role).color,
          }}
        />
      ))}
    </div>
  );
}

/**
 * THE OVERVIEW'S "Total settlement" — the adjusted net, whether the books
 * balance, and every party's slice of it.
 *
 * The `balances ✓` chip is drawn ONLY when the reader can see the whole board.
 * `Σ net = 0` is a property the engine guarantees and `assertBalanced` refuses to
 * persist without, so on the operator's view the chip is a fact. On a
 * party-scoped view the visible lines are a redaction rather than the whole
 * ledger, and a tick claiming they add up would be asserting something the reader
 * has not been shown — which is worse than saying nothing.
 */
export function TotalSettlementCard({ settlement }: { settlement: EventSettlement }) {
  if (settlement.shares.length === 0) return null;
  return (
    <Card padding="lg" style={CARD_COLUMN}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <CardTitle>Total settlement</CardTitle>
        {settlement.isWholeBoard && (
          <Badge status="confirmed">
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              balances
              <Icon name="check" size={12} />
            </span>
          </Badge>
        )}
      </div>

      {/* The design's tinted band: the figure every percentage below is a share
          of, named as the waterfall names it. Withheld from a reader who may not
          see the night's money, whose own slice is still listed below. */}
      {settlement.adjustedNet != null && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
            padding: "12px 14px",
            borderRadius: 12,
            background: "var(--elevated, var(--surface))",
          }}
        >
          <Eyebrow>Adjusted net divided</Eyebrow>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 20, fontWeight: 700 }}>
            {settlement.adjustedNet}
          </span>
        </div>
      )}

      <StackedShareBar shares={settlement.shares} />

      <Eyebrow>Entitlement by party</Eyebrow>
      {settlement.shares.map((share) => (
        <div
          key={share.key}
          style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}
        >
          <Avatar initials={share.initials} size={28} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontWeight: 600 }}>{share.name}</span>
              <Badge>{share.role}</Badge>
            </div>
            {share.rule && (
              <span className="muted" style={{ fontSize: 12.5 }}>
                {share.rule}
              </span>
            )}
          </div>
          <div style={{ textAlign: "right" }}>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontWeight: 600,
                color: roleTile(share.role).color,
              }}
            >
              {share.amount}
            </div>
            {share.percent && (
              <span className="muted" style={{ fontSize: 12 }}>
                {share.percent}%
              </span>
            )}
          </div>
        </div>
      ))}
    </Card>
  );
}

/**
 * THE COLLABORATORS TAB'S "Each party's position" — the same slices, one bar per
 * party, with the total underneath.
 *
 * The design puts the `balances ✓` chip on this card's total rather than at the
 * top, and it means the same thing in both places: the visible lines are the
 * whole ledger, not a slice of one.
 */
export function PartyPositionsCard({ settlement }: { settlement: EventSettlement }) {
  if (settlement.shares.length === 0) return null;
  return (
    <Card padding="lg" style={CARD_COLUMN}>
      <CardTitle subtitle="Who is owed what, and how it splits out of the adjusted net.">
        Each party's position
      </CardTitle>
      {settlement.shares.map((share) => (
        <div key={share.key} style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Avatar initials={share.initials} size={28} />
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontWeight: 600 }}>{share.name}</span>
              <Badge>{share.role}</Badge>
            </div>
            {share.rule && (
              <span className="muted" style={{ fontSize: 12.5 }}>
                {share.rule}
              </span>
            )}
            <StackedShareBar shares={[share]} />
          </div>
          <div style={{ textAlign: "right" }}>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontWeight: 600,
                color: roleTile(share.role).color,
              }}
            >
              {share.amount}
            </div>
            {share.percent && (
              <span className="muted" style={{ fontSize: 12 }}>
                {share.percent}%
              </span>
            )}
          </div>
        </div>
      ))}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          borderTop: "1px solid var(--border)",
          paddingTop: 12,
        }}
      >
        <span className="muted">Total entitlements</span>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {settlement.isWholeBoard && (
            <Badge status="confirmed">
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                balances
                <Icon name="check" size={12} />
              </span>
            </Badge>
          )}
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 18, fontWeight: 700 }}>
            {settlement.totalEntitlement}
          </span>
        </div>
      </div>
    </Card>
  );
}
