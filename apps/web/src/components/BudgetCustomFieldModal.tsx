import { Button, Input, Modal, Select } from "@showme/design-system";
import { useEffect, useState } from "react";
import { SegmentedToggle } from "./SegmentedToggle";
import type { BudgetAttributionOption, CostBearing } from "./useBudgetEditor";

/** Which card the new row belongs to. `null` while the modal is closed. */
export type CustomFieldKind = "revenue" | "cost" | null;

/**
 * A cost and a DEDUCTION are different things (2026-08 settlements meeting,
 * 01:08:30–01:10:41): a cost is money the event spends; a **deductible** is one
 * party paying an expense *on behalf of another* — the venue booking the band's
 * hotel — recovered later out of that party's cut. They differ only in who bears
 * them, but that difference decides who is out of pocket at settlement, so the
 * two are asked as two questions rather than left to a selector nobody notices.
 */
type CostPurpose = "cost" | "deduction";

export interface BudgetCustomFieldModalProps {
  kind: CustomFieldKind;
  onClose: () => void;
  onSubmit: (
    kind: "revenue" | "cost",
    label: string,
    amount: string,
    /** Who carries a cost. Absent on a revenue row, and on a plain shared cost. */
    bearing?: CostBearing,
  ) => void;
  /** Everyone on the event — a deduction has to name the party it is for. */
  participants?: BudgetAttributionOption[];
  currencySymbol?: string;
}

/**
 * "+ Add Field" — name a row the planner has no heading for, and give it an
 * amount.
 *
 * A MODAL and not an inline row, per the designer's handoff (§1: custom fields are
 * "added through a small modal, removable inline"). A row the operator must name
 * AND price is a small form, and a form inlined into a column of single-value rows
 * reads as unrelated inputs. Once created the row IS inline — it renders beside
 * the standing rows with an × — so the modal is the doorway, not the home.
 *
 * THERE IS NO "TYPE" FIELD. It used to offer Manual / Per guest, and a per-guest
 * row was then multiplied by capacity behind the operator's back. The product
 * owner's rule is that the value typed IS the value, so the question is gone
 * rather than answered — the amount below means what it says.
 */
export function BudgetCustomFieldModal({
  kind,
  onClose,
  onSubmit,
  participants = [],
  currencySymbol = "€",
}: BudgetCustomFieldModalProps) {
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [purpose, setPurpose] = useState<CostPurpose>("cost");
  const [deductedFrom, setDeductedFrom] = useState("");

  // Cleared on open rather than on close, so the fields are never seen resetting
  // as the dialog animates away.
  useEffect(() => {
    if (kind) {
      setLabel("");
      setAmount("");
      setPurpose("cost");
      setDeductedFrom("");
    }
  }, [kind]);

  const isDeduction = kind === "cost" && purpose === "deduction";
  const canSubmit = label.trim() !== "" && (!isDeduction || deductedFrom !== "");

  const submit = () => {
    if (!kind || !canSubmit) return;
    onSubmit(
      kind,
      label,
      amount,
      isDeduction ? { kind: "participant", participantId: deductedFrom } : undefined,
    );
    onClose();
  };

  return (
    <Modal
      open={kind !== null}
      onClose={onClose}
      title={
        kind === "cost"
          ? isDeduction
            ? "Add a deduction"
            : "Add a cost"
          : "Add custom revenue field"
      }
      width={460}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={!canSubmit}>
            {isDeduction ? "Add deduction" : "Add field"}
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {kind === "cost" && participants.length > 0 && (
          <div>
            <span style={fieldLabelStyle}>What is this?</span>
            <SegmentedToggle
              value={purpose}
              onChange={setPurpose}
              options={[
                { value: "cost", label: "A cost" },
                { value: "deduction", label: "A deduction" },
              ]}
              aria-label="Cost or deduction"
            />
            <span style={{ display: "block", marginTop: 6, fontSize: 12, color: "var(--muted)" }}>
              {purpose === "deduction"
                ? "Something one party paid on another's behalf, taken back out of that party's cut at settlement."
                : "Money the event spends. Who ultimately carries it is set on the row itself."}
            </span>
          </div>
        )}
        {isDeduction && (
          <div>
            <span style={fieldLabelStyle}>Deducted from</span>
            <Select
              value={deductedFrom}
              onChange={setDeductedFrom}
              options={participants.map((party) => ({
                value: party.id,
                label: `${party.label} — ${party.roleLabel}`,
              }))}
              placeholder="Choose the party this is for…"
              aria-label="The party this deduction comes out of"
              searchable={participants.length > 6}
            />
          </div>
        )}
        {/* Plain divs, not labels: the design system's `Input` already renders its
            own <label> wrapper and nesting one inside another is invalid. */}
        <div>
          <span style={fieldLabelStyle}>Field name</span>
          <Input
            value={label}
            placeholder="e.g. Sponsor income, Security cost…"
            onChange={(event) => setLabel(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && submit()}
          />
        </div>
        <div>
          <span style={fieldLabelStyle}>Amount</span>
          <Input
            value={amount}
            inputMode="decimal"
            placeholder="0"
            leftIcon={<span style={{ color: "var(--muted)" }}>{currencySymbol}</span>}
            onChange={(event) => setAmount(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && submit()}
          />
          <span style={{ display: "block", marginTop: 6, fontSize: 12, color: "var(--muted)" }}>
            The figure the budget counts, exactly as you type it.
          </span>
        </div>
      </div>
    </Modal>
  );
}

const fieldLabelStyle = {
  display: "block",
  fontSize: 13,
  fontWeight: 600,
  color: "var(--text)",
  marginBottom: 8,
} as const;
