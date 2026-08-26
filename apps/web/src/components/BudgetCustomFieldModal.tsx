import { Button, Input, Modal, Select } from "@showme/design-system";
import { useEffect, useState } from "react";
import type { CustomFieldType } from "./useBudgetEditor";

/** Which card the new row belongs to. `null` while the modal is closed. */
export type CustomFieldKind = "revenue" | "cost" | null;

export interface BudgetCustomFieldModalProps {
  kind: CustomFieldKind;
  onClose: () => void;
  onSubmit: (
    kind: "revenue" | "cost",
    label: string,
    amount: string,
    type: CustomFieldType,
  ) => void;
  currencySymbol?: string;
}

/**
 * "+ Add Field" — name a row the planner has no heading for, give it an amount,
 * and say what kind of amount it is.
 *
 * A MODAL and not an inline row, per the designer's handoff (§1: custom fields are
 * `{ name, type, amount }`, "added through a small modal, removable inline"). The
 * three fields are why: a row the operator must name, type AND price is a small
 * form, and a form inlined into a column of single-value rows reads as three
 * unrelated inputs. Once created the row IS inline — it renders beside the
 * standing rows with its type pill and an × — so the modal is the doorway, not
 * the home.
 */
export function BudgetCustomFieldModal({
  kind,
  onClose,
  onSubmit,
  currencySymbol = "€",
}: BudgetCustomFieldModalProps) {
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [type, setType] = useState<CustomFieldType>("manual");

  // Cleared on open rather than on close, so the fields are never seen resetting
  // as the dialog animates away.
  useEffect(() => {
    if (kind) {
      setLabel("");
      setAmount("");
      setType("manual");
    }
  }, [kind]);

  const canSubmit = label.trim() !== "";

  const submit = () => {
    if (!kind || !canSubmit) return;
    onSubmit(kind, label, amount, type);
    onClose();
  };

  return (
    <Modal
      open={kind !== null}
      onClose={onClose}
      title={kind === "cost" ? "Add custom cost field" : "Add custom revenue field"}
      width={460}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={!canSubmit}>
            Add field
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
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
          <span style={fieldLabelStyle}>Type</span>
          <Select
            value={type}
            onChange={(value) => setType(value as CustomFieldType)}
            options={[
              { value: "manual", label: "Manual amount" },
              { value: "per_guest", label: "Per guest" },
            ]}
            aria-label="Custom field type"
            searchable={false}
          />
        </div>
        <div>
          <span style={fieldLabelStyle}>
            {type === "per_guest" ? "Amount per guest" : "Amount"}
          </span>
          <Input
            value={amount}
            inputMode="decimal"
            placeholder="0"
            leftIcon={<span style={{ color: "var(--muted)" }}>{currencySymbol}</span>}
            onChange={(event) => setAmount(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && submit()}
          />
          {type === "per_guest" && (
            <span style={{ display: "block", marginTop: 6, fontSize: 12, color: "var(--muted)" }}>
              Multiplied by capacity, like the bar estimate above it.
            </span>
          )}
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
