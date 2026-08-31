import { Badge, Button, Card, Icon, Input, Select } from "@showme/design-system";
import { useState } from "react";
import { CardTitle } from "./primitives";
import { ErrorState, LoadingState } from "./states";
import type { SettlementLineRow, SettlementLinesEditor } from "./useSettlementLines";

/**
 * WHERE THE REAL NUMBERS ARE TYPED.
 *
 * The old app put this in the settlement's own Financials tab
 * (`../showme-settle-fast` `src/components/settlements/FinancialsTab.tsx`), and it
 * was right to: you notice a figure is wrong while looking at the settlement, and
 * that is where you should be able to correct it. Ours sent the operator to the
 * Budget Planner on another screen — which also meant correcting an actual
 * overwrote the estimate it was supposed to be compared against.
 *
 * So these rows are the SETTLEMENT's copy of the budget, never the budget itself
 * (migration 0025). Editing here restates what happened; the forecast stands
 * untouched next door, which is what makes the comparison above it mean anything.
 *
 * **Nothing recalculates on its own.** A settlement may already be out for
 * review, and silently restating figures somebody is in the middle of checking is
 * how a signature ends up against numbers nobody saw. The card says a recalculate
 * is needed and the operator presses the button.
 *
 * Read-only once finalized — the API refuses the write, and offering an input
 * that always fails is worse than not offering one.
 */
export interface SettlementActualsCardProps {
  editor: SettlementLinesEditor;
  currency: string;
  /** Frozen figures: show the lines, offer no way to change them. */
  isFinalized: boolean;
  /** Has anything moved since the last compute? Drives the nudge. */
  onRecalculate?: () => void;
  /**
   * Why recalculating is unavailable right now, or null when it is available.
   *
   * Today this is only ever an unsigned agreement (decisions.md #21) — the API
   * refuses the compute with a 409, so the button would fail every time it was
   * pressed. It is a REASON rather than a boolean because a control that is
   * greyed out without saying why leaves the operator with no next move, and the
   * next move here is to go and get a particular signature. It replaces the
   * ordinary nudge rather than sitting beside it: only one of the two can be
   * true at a time.
   */
  recalculateBlockedReason?: string | null;
}

export function SettlementActualsCard({
  editor,
  currency,
  isFinalized,
  onRecalculate,
  recalculateBlockedReason = null,
}: SettlementActualsCardProps) {
  if (editor.isPending) return <LoadingState label="Loading the settlement's lines" />;
  if (editor.isError) {
    return <ErrorState error={editor.error} title="Couldn't load the settlement's lines" />;
  }

  return (
    <Card padding="lg" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}
      >
        <CardTitle subtitle="What the night actually took and cost. This is the settlement's own copy — your budget is left as the forecast it was.">
          The real numbers
        </CardTitle>
        {isFinalized && <Badge status="confirmed">Locked</Badge>}
      </div>

      <LineGroup
        title="Revenue"
        emptyNote="Nothing taken has been recorded."
        rows={editor.revenue}
        editor={editor}
        currency={currency}
        isFinalized={isFinalized}
      />
      <LineGroup
        title="Costs"
        emptyNote="No costs recorded."
        rows={editor.costs}
        editor={editor}
        currency={currency}
        isFinalized={isFinalized}
      />

      {!isFinalized && onRecalculate && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
            paddingTop: 12,
            borderTop: "1px solid var(--border)",
          }}
        >
          <span style={{ color: "var(--muted)", fontSize: 12.5, flex: 1 }}>
            {recalculateBlockedReason ??
              "Changes here are not settled until you recalculate — the parties keep seeing the last figures you sent them until then."}
          </span>
          <Button
            variant="primary"
            disabled={editor.isBusy || recalculateBlockedReason != null}
            leftIcon={<Icon name="receipt" size={14} />}
            onClick={onRecalculate}
          >
            Recalculate
          </Button>
        </div>
      )}
    </Card>
  );
}

function LineGroup({
  title,
  emptyNote,
  rows,
  editor,
  currency,
  isFinalized,
}: {
  title: string;
  emptyNote: string;
  rows: SettlementLineRow[];
  editor: SettlementLinesEditor;
  currency: string;
  isFinalized: boolean;
}) {
  const kind = title === "Revenue" ? ("revenue" as const) : ("cost" as const);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--muted)",
        }}
      >
        {title}
      </div>
      {rows.length === 0 && (
        <span style={{ color: "var(--dim)", fontSize: 12.5 }}>{emptyNote}</span>
      )}
      {rows.map((row) => (
        <LineRow
          key={row.id}
          row={row}
          editor={editor}
          currency={currency}
          isFinalized={isFinalized}
        />
      ))}
      {!isFinalized && <AddLine kind={kind} editor={editor} currency={currency} />}
    </div>
  );
}

function LineRow({
  row,
  editor,
  currency,
  isFinalized,
}: {
  row: SettlementLineRow;
  editor: SettlementLinesEditor;
  currency: string;
  isFinalized: boolean;
}) {
  // Local while typing, committed on blur — a keystroke is not a decision, and a
  // PATCH per character would race its own responses.
  const [amount, setAmount] = useState(row.amount);
  const partyField = row.kind === "revenue" ? "collectedBy" : "paidBy";
  const partyId = row.kind === "revenue" ? row.collectedBy : row.paidBy;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <span style={{ flex: "2 1 160px", fontSize: 13.5, display: "flex", gap: 6 }}>
        {row.label}
        {/* Never budgeted — worth saying, because it is the answer to "why is
            this not in my plan?" rather than an error. */}
        {row.originBudgetLineId === null && (
          <span style={{ color: "var(--dim)", fontSize: 11.5 }}>· unplanned</span>
        )}
      </span>
      <div style={{ flex: "0 0 130px" }}>
        <Input
          value={amount}
          disabled={isFinalized || editor.isBusy}
          onChange={(event) => setAmount(event.target.value)}
          onBlur={() => {
            if (amount !== row.amount) editor.updateLine(row, { amount });
          }}
          aria-label={`${row.label} amount in ${currency}`}
        />
      </div>
      <div style={{ flex: "1 1 150px" }}>
        <Select
          value={partyId ?? ""}
          disabled={isFinalized || editor.isBusy}
          onChange={(value) => editor.updateLine(row, { [partyField]: value })}
          options={editor.participants.map((party) => ({ value: party.id, label: party.name }))}
          aria-label={row.kind === "revenue" ? "Collected by" : "Paid by"}
        />
      </div>
      {!isFinalized && (
        <Button
          variant="ghost"
          disabled={editor.isBusy}
          onClick={() => editor.removeLine(row)}
          aria-label={`Remove ${row.label}`}
        >
          <Icon name="x" size={14} />
        </Button>
      )}
    </div>
  );
}

/**
 * "+ Add field" — the old app's affordance, and the reason it could record a
 * night that did not go to plan. A cost nobody forecast is the ordinary case, not
 * the exception.
 */
function AddLine({
  kind,
  editor,
  currency,
}: {
  kind: "revenue" | "cost";
  editor: SettlementLinesEditor;
  currency: string;
}) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [party, setParty] = useState("");

  if (!open) {
    return (
      <Button
        variant="secondary"
        leftIcon={<Icon name="plus" size={14} />}
        onClick={() => setOpen(true)}
      >
        Add {kind === "revenue" ? "revenue" : "cost"}
      </Button>
    );
  }

  // The engine refuses a line that names nobody (audit A-14), so all three are
  // required here rather than failing at compute with a 409 much later.
  const canAdd = label.trim() !== "" && amount.trim() !== "" && party !== "" && !editor.isBusy;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <div style={{ flex: "2 1 160px" }}>
        <Input
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder={kind === "revenue" ? "Bar take" : "Broken window"}
          aria-label="Line name"
        />
      </div>
      <div style={{ flex: "0 0 130px" }}>
        <Input
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          placeholder={currency}
          aria-label="Amount"
        />
      </div>
      <div style={{ flex: "1 1 150px" }}>
        <Select
          value={party}
          onChange={setParty}
          options={[
            { value: "", label: kind === "revenue" ? "Collected by…" : "Paid by…" },
            ...editor.participants.map((entry) => ({ value: entry.id, label: entry.name })),
          ]}
          aria-label={kind === "revenue" ? "Collected by" : "Paid by"}
        />
      </div>
      <Button
        variant="primary"
        disabled={!canAdd}
        onClick={() => {
          editor.addLine(kind, label.trim(), amount.trim(), party);
          setLabel("");
          setAmount("");
          setParty("");
          setOpen(false);
        }}
      >
        Add
      </Button>
      <Button variant="ghost" onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </div>
  );
}
