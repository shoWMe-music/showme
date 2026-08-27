import { Card, KeyValueRow } from "@showme/design-system";
import type { SettlementParty } from "./useEventSettlement";

/**
 * One party's payout, and the RULE behind it.
 *
 * Shared by the event workspace's Settlement tab and the full settlement
 * workspace, because it is the same object saying the same thing in two places —
 * and a second copy of it would be free to drift the moment either screen changed.
 * Two call sites is below this repo's extract-at-three bar; what tips it is that
 * the thing being duplicated is how a settlement EXPLAINS ITSELF, which is the
 * whole point of the engine work behind it.
 *
 * Dumb by construction: every figure and every sentence arrives pre-formatted from
 * `useEventSettlement`. Nothing here does arithmetic, and nothing here decides what
 * a party may see — the API already redacted what it had to (`story.md:44`), so a
 * card with no rule lines is a card whose rules were not this reader's to know.
 */
export function SettlementPartyCard({ party }: { party: SettlementParty }) {
  return (
    <Card padding="lg" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <span style={{ fontWeight: 600 }}>
            {party.isYours ? `${party.name} (you)` : party.name}
          </span>
          <div style={{ color: "var(--muted)", fontSize: 12 }}>{party.role}</div>
        </div>
        <span style={{ fontSize: 24, fontWeight: 500, color: "var(--brand-gold)" }}>
          {/* Null is a real "not yet" — the event has not been reconciled — so it
              says so rather than printing a zero somebody might act on. */}
          {party.entitlement ?? "Not reconciled yet"}
        </span>
      </div>
      {party.rules.map((rule) => (
        <KeyValueRow
          key={rule.key}
          label={rule.label}
          value={rule.negative ? `− ${rule.value}` : rule.value}
          mono
          valueColor={rule.negative ? "var(--brand-red)" : undefined}
        />
      ))}
    </Card>
  );
}
