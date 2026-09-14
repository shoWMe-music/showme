import { Button, Card, Icon, Input, Select } from "@showme/design-system";
import { useEffect, useState } from "react";
import tableStyles from "./BudgetTable.module.css";
import { Eyebrow } from "./primitives";
import type { BudgetAttributionOption, RevenueShareRow } from "./useBudgetEditor";

export interface BudgetRevenueSharesCardProps {
  rows: RevenueShareRow[];
  /** The revenue lines a slice can be taken from — anything carrying money. */
  sources: { id: string; label: string }[];
  participants: BudgetAttributionOption[];
  onAdd: (lineId: string, toParticipantId: string) => void;
  onChange: (
    lineId: string,
    index: number,
    patch: { toParticipantId?: string; basisPoints?: number },
  ) => void;
  onRemove: (lineId: string, index: number) => void;
  readOnly?: boolean;
}

/**
 * REVENUE SHARES — a slice of one revenue line that belongs to somebody other
 * than its collector. "10% of the bar to the act."
 *
 * CALLED "Revenue shares", not "Revenue shares & deductions" as the prototype
 * titles it. decisions.md #23.2 settles why: those are two different mechanisms,
 * and the conflation is what made the cost/deduction UI confusing in the first
 * place. A DEDUCTION is a cost somebody bears — it changes the totals and already
 * lives in the Costs card as its "To be deducted from" column. A SHARE moves
 * money between parties and changes nobody's total. Putting both under one
 * heading is what the meeting asked us to stop doing.
 *
 * A share is NOT where a door split goes, even though it is the same shape. The
 * act's percentage of the ticket line is written on the DEAL, with the guarantee
 * and the escalator tiers, and the settlement reads it from there. Offering it a
 * second, editable home here is the drift this rebuild exists to delete.
 */
export function BudgetRevenueSharesCard({
  rows,
  sources,
  participants,
  onAdd,
  onChange,
  onRemove,
  readOnly = false,
}: BudgetRevenueSharesCardProps) {
  const canAdd = !readOnly && sources.length > 0 && participants.length > 0;

  return (
    <Card
      padding="md"
      className="density-compact"
      style={{ display: "flex", flexDirection: "column", gap: 10 }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <h4
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: 600,
            fontSize: 17,
            color: "var(--text)",
            margin: 0,
          }}
        >
          Revenue shares
        </h4>
        <span style={{ color: "var(--muted)", fontSize: 12.5, lineHeight: 1.4 }}>
          Move a slice of any revenue from the party that collects it to another party.
        </span>
      </div>

      {rows.length > 0 && (
        <div className={tableStyles.table}>
          <div className={tableStyles.headRevenue}>
            <span>Take from</span>
            <span>Basis</span>
            <span className={tableStyles.numeric}>Share</span>
            <span>Moves to</span>
            <span />
            <span />
          </div>
          {rows.map((row) => (
            <div key={`${row.lineId}:${row.index}`} className={tableStyles.rowRevenue}>
              <span style={{ color: "var(--text)", fontSize: 14, minWidth: 0 }}>
                {row.lineLabel}
              </span>
              <span className={tableStyles.basis}>Percentage</span>
              <div style={{ minWidth: 0 }}>
                <span className={tableStyles.cellLabel}>Share</span>
                <PercentField
                  basisPoints={row.basisPoints}
                  disabled={readOnly}
                  label={`Share of ${row.lineLabel}`}
                  onCommit={(basisPoints) => onChange(row.lineId, row.index, { basisPoints })}
                />
              </div>
              <div style={{ minWidth: 0 }}>
                <span className={tableStyles.cellLabel}>Moves to</span>
                <Select
                  value={row.toParticipantId}
                  disabled={readOnly}
                  onChange={(toParticipantId) =>
                    onChange(row.lineId, row.index, { toParticipantId })
                  }
                  options={participants.map((party) => ({ value: party.id, label: party.label }))}
                  searchable={participants.length > 6}
                  aria-label={`Who the slice of ${row.lineLabel} moves to`}
                />
              </div>
              <span />
              {readOnly ? (
                <span />
              ) : (
                <button
                  type="button"
                  aria-label={`Remove the share of ${row.lineLabel}`}
                  onClick={() => onRemove(row.lineId, row.index)}
                  style={{
                    background: "none",
                    border: 0,
                    color: "var(--muted)",
                    cursor: "pointer",
                    padding: 4,
                  }}
                >
                  <Icon name="x" size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {canAdd ? (
        <AddShare sources={sources} participants={participants} onAdd={onAdd} />
      ) : (
        // An honest reason, never a disabled button with no explanation: a share
        // needs a line to come out of and somebody to go to, and saying which is
        // missing is the difference between a dead control and an instruction.
        <Eyebrow>
          {sources.length === 0
            ? "Add a revenue line first — a share is a slice of one"
            : "Invite a collaborator to move a share to"}
        </Eyebrow>
      )}

      <span style={{ color: "var(--muted)", fontSize: 12, lineHeight: 1.45 }}>
        These move money between parties at settlement. They do not change the event&rsquo;s total
        revenue or costs.
      </span>
    </Card>
  );
}

/** Source and recipient, then one click — the two things a share cannot guess. */
function AddShare({
  sources,
  participants,
  onAdd,
}: {
  sources: { id: string; label: string }[];
  participants: BudgetAttributionOption[];
  onAdd: (lineId: string, toParticipantId: string) => void;
}) {
  const [lineId, setLineId] = useState(sources[0]?.id ?? "");
  const [toParticipantId, setToParticipantId] = useState(participants[0]?.id ?? "");

  // A source can disappear while the card is open — a revenue line cleared to
  // zero stops being one. Falling back keeps the control pointed at something
  // that exists rather than writing to a line that is no longer offered.
  useEffect(() => {
    if (!sources.some((source) => source.id === lineId)) setLineId(sources[0]?.id ?? "");
  }, [sources, lineId]);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <div style={{ flex: "1 1 200px", minWidth: 0 }}>
        <Select
          value={lineId}
          onChange={setLineId}
          options={sources.map((source) => ({ value: source.id, label: source.label }))}
          searchable={sources.length > 6}
          aria-label="Take the share from"
        />
      </div>
      <span style={{ color: "var(--muted)", fontSize: 12.5 }}>moves to</span>
      <div style={{ flex: "1 1 200px", minWidth: 0 }}>
        <Select
          value={toParticipantId}
          onChange={setToParticipantId}
          options={participants.map((party) => ({ value: party.id, label: party.label }))}
          searchable={participants.length > 6}
          aria-label="Who the share moves to"
        />
      </div>
      <Button
        variant="ghost"
        leftIcon={<Icon name="plus" size={14} />}
        disabled={!lineId || !toParticipantId}
        onClick={() => onAdd(lineId, toParticipantId)}
      >
        Add share
      </Button>
    </div>
  );
}

/**
 * A percentage, held locally and committed on blur or Enter.
 *
 * Every keystroke would be a write of the whole share array, and the array is
 * rewritten wholesale (`writeShares`) — so "10" on the way to "100" would each
 * land as a saved figure. Committing on blur keeps one write per decision.
 */
/** Module scope, so the effect below has a stable dependency rather than a new
 *  closure on every render. */
const asPercent = (points: number) => String(Math.round(points / 100));

function PercentField({
  basisPoints,
  disabled,
  label,
  onCommit,
}: {
  basisPoints: number;
  disabled: boolean;
  label: string;
  onCommit: (basisPoints: number) => void;
}) {
  const [draft, setDraft] = useState(asPercent(basisPoints));

  // Follow the server when it moves under us — another tab, or a rejected write
  // rolling back — but never while the field is being typed into.
  useEffect(() => setDraft(asPercent(basisPoints)), [basisPoints]);

  const commit = () => {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed)) return setDraft(asPercent(basisPoints));
    const clamped = Math.max(0, Math.min(100, Math.round(parsed)));
    setDraft(String(clamped));
    if (clamped * 100 !== basisPoints) onCommit(clamped * 100);
  };

  return (
    <Input
      value={draft}
      inputMode="numeric"
      disabled={disabled}
      aria-label={label}
      leftIcon={<span style={{ color: "var(--muted)" }}>%</span>}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
      }}
    />
  );
}
