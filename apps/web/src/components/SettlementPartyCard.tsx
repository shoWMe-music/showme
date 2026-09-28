import { Card, Icon, type IconName } from "@showme/design-system";
import { negativeAmount } from "./settlementDocument";
import type { SettlementParty } from "./useEventSettlement";

/**
 * One party's payout, and the RULE behind it.
 *
 * Laid out from the Claude design's settlement screen (`shoWMe All View.dc.html`,
 * the party payout cards): a tinted icon tile, the name over its role, the amount
 * set in the display face at 24px on the right, then one muted rule row per line,
 * each separated by a hairline. Every value is a token from our own design system;
 * the prototype is drawn with the same ones, so following it costs us nothing.
 *
 * Shared by the event workspace's Settlement tab and the full settlement
 * workspace, because it is the same object saying the same thing in two places —
 * and a second copy would drift the moment either screen changed.
 *
 * Dumb by construction: every figure and every sentence arrives pre-formatted from
 * `useEventSettlement`. Nothing here does arithmetic, and nothing here decides what
 * a party may see — the API already redacted what it had to (`story.md:44`), so a
 * card with no rule lines is one whose rules were not this reader's to know.
 */

/**
 * The role's tile — a performer, the room, and whoever is promoting the night.
 *
 * **Keyed on the LABEL, normalised, not on the enum.** `party.role` arrives here
 * already written for the reader (`useEventSettlement`), so `tileFor` lowercases
 * it and folds spaces to underscores to get back to something table-shaped. That
 * is why the enum spellings and the label spellings both appear: `host` /
 * `co_host` are what the old label title-cased from, `operator` / `co-operator`
 * are what `eventParticipantRoleLabel` writes now (decisions.md #16.20). Both are
 * kept — the enum entries still serve any caller that passes a raw role, and
 * dropping them to "tidy up" would silently swap the operator's building tile for
 * the generic fallback.
 */
const ROLE_TILE: Record<string, { icon: IconName; color: string }> = {
  performer: { icon: "music", color: "var(--brand-gold)" },
  support: { icon: "music", color: "var(--brand-gold)" },
  host: { icon: "building", color: "var(--accent)" },
  co_host: { icon: "building", color: "var(--accent)" },
  operator: { icon: "building", color: "var(--accent)" },
  "co-operator": { icon: "building", color: "var(--accent)" },
  venue: { icon: "building", color: "var(--accent)" },
  agent: { icon: "user", color: "var(--muted)" },
  crew: { icon: "users", color: "var(--muted)" },
  crew_lead: { icon: "users", color: "var(--muted)" },
};

/**
 * Exported because the share bars colour their segments by the same role, and
 * two tables mapping roles to colours would drift the first time one gained a
 * role. `SettlementShares` reads only `.color`.
 */
export function roleTile(role: string) {
  return (
    ROLE_TILE[role.toLowerCase().replace(/\s+/g, "_")] ?? { icon: "user", color: "var(--muted)" }
  );
}

export function SettlementPartyCard({ party }: { party: SettlementParty }) {
  const tile = roleTile(party.role);
  return (
    <Card padding="lg" style={{ display: "flex", flexDirection: "column" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
          <span
            aria-hidden
            style={{
              width: 34,
              height: 34,
              borderRadius: 10,
              display: "grid",
              placeItems: "center",
              background: "var(--shape-fill)",
              color: tile.color,
              flex: "0 0 auto",
            }}
          >
            <Icon name={tile.icon} size={17} />
          </span>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>
              {party.isYours ? `${party.name} (you)` : party.name}
            </div>
            <div style={{ color: "var(--muted)", fontSize: 12 }}>{party.role}</div>
          </div>
        </div>
        <span
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: 500,
            fontSize: 24,
            letterSpacing: "-0.02em",
            color: tile.color,
          }}
        >
          {/* Null is a real "not yet" — the event has not been reconciled — so it
              says so rather than printing a zero somebody might act on. */}
          {party.entitlement ?? "Not reconciled yet"}
        </span>
      </div>
      {party.rules.map((rule) => (
        <div
          key={rule.key}
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            padding: "5px 0",
            fontSize: 12.5,
            color: "var(--muted)",
            borderTop: "1px solid var(--border)",
          }}
        >
          <span>{rule.label}</span>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              color: rule.negative ? "var(--brand-red)" : "var(--text)",
              whiteSpace: "nowrap",
            }}
          >
            {rule.negative ? negativeAmount(rule.value) : rule.value}
          </span>
        </div>
      ))}
      {/*
        WHAT SITS BETWEEN THE ENTITLEMENT AND THE PAYOUT — the rows under the divider
        (QA sweep run 7, QA7-10 for the advance; run 8, QA8-5 for the cash).

        The rules above SUM to the headline. These do not belong in that sum and each one
        moved the payout away from it with nothing on the tab to say so:

        - the ADVANCE. Measured: an act's card itemised its 70% door share and its SEK
          3,000 deduction beautifully, showed an entitlement of SEK 67,000 — and the Total
          Payouts card two inches away said SEK 62,000. The engine had it
          (`"prepaid":"500000"`), the label was built, and nothing rendered either.
        - the CASH. A `collected` row used to sit among the rules, on a belief about the
          engine that `reconcile.ts` does not share, so an operator read SEK 20,700 over
          rows of 20,700 and 78,000 — a format that states a sum, not keeping it. And the
          SEK 10,800 they had PAID appeared nowhere at all.

        One divider, one list, one renderer for the sign: `reducesPayout` decides it, so no
        label carries a minus of its own and the two halves cannot disagree about direction.
      */}
      {party.adjustments.length > 0 && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            padding: "7px 0 0",
            marginTop: 3,
            borderTop: "2px solid var(--border)",
          }}
        >
          {party.adjustments.map((adjustment) => (
            <div
              key={adjustment.key}
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                padding: "3px 0",
                fontSize: 12.5,
                color: "var(--muted)",
              }}
            >
              <span>{adjustment.label}</span>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  color: adjustment.reducesPayout ? "var(--brand-red)" : "var(--text)",
                  whiteSpace: "nowrap",
                }}
              >
                {adjustment.reducesPayout ? negativeAmount(adjustment.value) : adjustment.value}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
