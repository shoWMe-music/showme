import { Badge, Button, Card, Icon, Input, Select } from "@showme/design-system";
import { majorToMinor } from "@showme/shared";
import { useState } from "react";
import { formatMoney } from "../lib/format";
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
   * Whether recalculating is refused right now — today only ever because an
   * agreement is unsigned (decisions.md #21), which the API answers with a 409.
   *
   * A BOOLEAN, not the reason. This card used to take the sentence and print it,
   * and so did `SettlingHappensHereCard` directly above it on the same tab — the
   * identical paragraph twice on one screen. The reason is drawn once, at the top
   * of the tab, by `UnsignedAgreementsNotice`, which also carries the way out of
   * it; all this card needs to know is that the button would fail.
   */
  recalculateBlocked?: boolean;
}

export function SettlementActualsCard({
  editor,
  currency,
  isFinalized,
  onRecalculate,
  recalculateBlocked = false,
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
            {recalculateBlocked
              ? "Recalculating is on hold until every agreement is signed — the notice at the top of this tab says which, and takes you there."
              : "Changes here are not settled until you recalculate — the parties keep seeing the last figures you sent them until then."}
          </span>
          <Button
            variant="primary"
            disabled={editor.isBusy || recalculateBlocked}
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
      {!isFinalized && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <AddLine kind={kind} editor={editor} currency={currency} />
          {/* Only revenue is counted. A tier the plan never had is the ordinary
              case on the night — a walk-up price opened at the door — and it has
              to arrive counted, or it is the one row nobody can restate. */}
          {kind === "revenue" && <AddTicketTier editor={editor} currency={currency} />}
        </div>
      )}
    </div>
  );
}

/** "+ Add ticket type" — a counted revenue row: name, how many, at what price. */
function AddTicketTier({
  editor,
  currency,
}: {
  editor: SettlementLinesEditor;
  currency: string;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [quantity, setQuantity] = useState("");
  const [party, setParty] = useState("");

  if (!open) {
    return (
      <Button
        variant="secondary"
        leftIcon={<Icon name="plus" size={14} />}
        onClick={() => setOpen(true)}
      >
        Add ticket type
      </Button>
    );
  }

  const count = Number.parseInt(quantity, 10);
  const canAdd =
    name.trim() !== "" &&
    price.trim() !== "" &&
    Number.isFinite(count) &&
    count >= 0 &&
    party !== "" &&
    !editor.isBusy;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", width: "100%" }}>
      <div style={{ flex: "2 1 160px" }}>
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Walk-up"
          aria-label="Ticket type name"
        />
      </div>
      <div style={{ flex: "0 0 96px" }}>
        <Input
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
          placeholder="Sold"
          aria-label="Tickets sold"
        />
      </div>
      <span style={{ color: "var(--dim)", fontSize: 12.5 }}>×</span>
      <div style={{ flex: "0 0 110px" }}>
        <Input
          value={price}
          onChange={(event) => setPrice(event.target.value)}
          placeholder={currency}
          aria-label={`Ticket price in ${currency}`}
        />
      </div>
      <div style={{ flex: "1 1 150px" }}>
        <Select
          value={party}
          onChange={setParty}
          options={[
            { value: "", label: "Collected by…" },
            ...editor.participants.map((entry) => ({ value: entry.id, label: entry.name })),
          ]}
          aria-label="Collected by"
        />
      </div>
      <Button
        variant="primary"
        disabled={!canAdd}
        onClick={() => {
          editor.addTicketTier(name.trim(), price.trim(), count, party);
          setName("");
          setPrice("");
          setQuantity("");
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
  const [unitAmount, setUnitAmount] = useState(row.details?.unitAmount ?? "");
  const [quantity, setQuantity] = useState(row.details?.quantity?.toString() ?? "");
  const partyField = row.kind === "revenue" ? "collectedBy" : "paidBy";
  const partyId = row.kind === "revenue" ? row.collectedBy : row.paidBy;
  /*
   * A COUNTED ROW IS RESTATED BY ITS COUNT, not by its total.
   *
   * "Tickets info (name, quantity, price) missing from settlements" (ClickUp
   * 86cbcn1ue). The planner had already baked the breakdown into the LABEL —
   * "Advance ticket sales (260 @ 250 SEK)" — so the settlement displayed an
   * arithmetic it gave the operator no way to correct. The honest edit after a
   * show that sold 168 is to change the 260; the total follows, and the label
   * stops contradicting the figure beside it.
   *
   * A row with no `details` keeps the plain amount box. Most costs are a lump
   * sum and inventing a unit price for a broken window would be worse than the
   * single field it replaced.
   */
  const isCounted = row.details !== null;

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
      {isCounted ? (
        <>
          <div style={{ flex: "0 0 96px" }}>
            <Input
              value={quantity}
              disabled={isFinalized || editor.isBusy}
              onChange={(event) => setQuantity(event.target.value)}
              onBlur={() => {
                const next = Number.parseInt(quantity, 10);
                // A blank or unparseable count is a slip, not an instruction to
                // settle nothing — put the stored one back rather than writing 0.
                if (!Number.isFinite(next) || next < 0) {
                  setQuantity(row.details?.quantity?.toString() ?? "");
                  return;
                }
                if (next !== row.details?.quantity) editor.updateBreakdown(row, { quantity: next });
              }}
              aria-label={`${row.label} quantity`}
            />
          </div>
          <span style={{ color: "var(--dim)", fontSize: 12.5 }}>×</span>
          <div style={{ flex: "0 0 110px" }}>
            <Input
              value={unitAmount}
              disabled={isFinalized || editor.isBusy}
              onChange={(event) => setUnitAmount(event.target.value)}
              onBlur={() => {
                if (unitAmount !== row.details?.unitAmount) {
                  editor.updateBreakdown(row, { unitAmount });
                }
              }}
              aria-label={`${row.label} unit price in ${currency}`}
            />
          </div>
          {/* The product, shown not typed. It is `amount` — the figure the engine
              settles — and letting it be edited beside the two operands is how a
              row ends up saying 168 × 250 = 65 000.
              Through `formatMoney` like every other figure on the screen: the two
              boxes beside it are raw because they are being TYPED INTO, but this
              is a read-only total and a second money format here would be the one
              number on the card that looked like a database value. */}
          <span style={{ flex: "0 0 110px", fontSize: 13.5, fontWeight: 600 }}>
            {formatMoney(majorToMinor(row.amount, currency).toString(), currency)}
          </span>
        </>
      ) : (
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
      )}
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
