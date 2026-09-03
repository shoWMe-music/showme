import { Button, Input, Modal, Select } from "@showme/design-system";
import { useEffect, useState } from "react";
import { SegmentedToggle } from "./SegmentedToggle";
import type {
  BudgetAttributionOption,
  CostBearing,
  DeductionBaseOption,
  DerivedDeductionRule,
} from "./useBudgetEditor";

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

/**
 * A deduction is either a FIGURE or a SHARE of another row.
 *
 * ClickUp `86cbcn1ue`, 2026-09-02: *"there should be the option to create
 * deductible with either fixed amount or a percentage from X. As it was in V2."*
 * His example is *"10% of merch deducted from performer's share paid to venue"* —
 * a number nobody types, because nobody knows on the day what the merch will do.
 */
type DeductionShape = "amount" | "percentage";

export interface BudgetCustomFieldModalProps {
  kind: CustomFieldKind;
  onClose: () => void;
  onSubmit: (
    kind: "revenue" | "cost",
    label: string,
    amount: string,
    /** Who carries a cost. Absent on a revenue row, and on a plain shared cost. */
    bearing?: CostBearing,
    /** Who FRONTED the cash. Absent means "whoever is planning" — the row default. */
    paidBy?: string,
    /** Set when the amount is a share of another row rather than a figure. */
    derivedFrom?: DerivedDeductionRule,
  ) => void;
  /** Everyone on the event — a deduction has to name the party it is for. */
  participants?: BudgetAttributionOption[];
  /** Every row a percentage deduction may be taken of. Empty disables the option. */
  deductionBases?: DeductionBaseOption[];
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
  deductionBases = [],
  currencySymbol = "€",
}: BudgetCustomFieldModalProps) {
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [purpose, setPurpose] = useState<CostPurpose>("cost");
  const [deductedFrom, setDeductedFrom] = useState("");
  const [paidBy, setPaidBy] = useState("");
  const [shape, setShape] = useState<DeductionShape>("amount");
  const [percent, setPercent] = useState("");
  const [ofKey, setOfKey] = useState("");

  // Cleared on open rather than on close, so the fields are never seen resetting
  // as the dialog animates away.
  useEffect(() => {
    if (kind) {
      setLabel("");
      setAmount("");
      setPurpose("cost");
      setDeductedFrom("");
      setPaidBy("");
      setShape("amount");
      setPercent("");
      setOfKey("");
    }
  }, [kind]);

  const isDeduction = kind === "cost" && purpose === "deduction";
  const isPercentage = isDeduction && shape === "percentage" && deductionBases.length > 0;
  const base = deductionBases.find((option) => option.key === ofKey) ?? null;

  /**
   * Basis points, never a float (money.md). Typed as a percentage because that is
   * how the deal is written down; stored as an integer because that is the only
   * way the same 10% comes out the same twice.
   */
  const basisPoints = Math.round((Number(percent.replace(",", ".")) || 0) * 100);
  const percentIsUsable = basisPoints > 0 && basisPoints <= 10_000;

  const canSubmit =
    label.trim() !== "" &&
    (!isDeduction || deductedFrom !== "") &&
    (!isPercentage || (percentIsUsable && base !== null));

  const submit = () => {
    if (!kind || !canSubmit) return;
    onSubmit(
      kind,
      label,
      // A percentage row's figure is worked out from its base, so nothing typed
      // here is carried: the amount is an ANSWER, and the rule is the question.
      isPercentage ? "" : amount,
      isDeduction ? { kind: "participant", participantId: deductedFrom } : undefined,
      kind === "cost" ? paidBy || undefined : undefined,
      isPercentage && base ? { ofKey: base.key, ofLabel: base.label, basisPoints } : undefined,
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
        {/*
         * PAID BY, on the modal and not only on the row.
         *
         * ClickUp `86cbcn1ue`, 2026-09-03: *"'add deduction' with a fixed
         * ammount or percentage, including paid by and deducted from dropdown
         * menu of the collaborators."* Both halves of his own worked example
         * need it — *"marketing costs paid by venue to be deducted from
         * promoter's share"* names two different parties, and the modal could
         * only ever ask about one of them.
         *
         * The column has always existed (`budget_lines.paid_by`) and the row
         * strip has always offered it. What was missing is that the deduction is
         * DEFINED here, and a definition that omits half the sentence sends the
         * operator to a second control to finish a thought they had already had.
         *
         * Left blank means the row default — whoever is planning — the same
         * answer the row strip's placeholder gives, and stated the same way so
         * the two never look like different questions.
         */}
        {kind === "cost" && participants.length > 0 && (
          <div>
            <span style={fieldLabelStyle}>Paid by</span>
            <Select
              value={paidBy}
              onChange={setPaidBy}
              options={participants.map((party) => ({
                value: party.id,
                label: party.label,
                description: party.roleLabel,
              }))}
              placeholder="Defaults to you"
              aria-label="Paid by — who the invoice goes out from"
              searchable={participants.length > 6}
            />
          </div>
        )}
        {isDeduction && (
          <div>
            <span style={fieldLabelStyle}>To be deducted from</span>
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
        {/*
         * A FIGURE, OR A SHARE OF ANOTHER ROW.
         *
         * Offered only for a deduction, and only when there is something to take
         * a share OF. A percentage cost of the event as a whole is not a thing
         * anybody has asked for, and an empty base list would be an option that
         * cannot be completed.
         */}
        {isDeduction && deductionBases.length > 0 && (
          <div>
            <span style={fieldLabelStyle}>How much?</span>
            <SegmentedToggle
              value={shape}
              onChange={setShape}
              options={[
                { value: "amount", label: "A fixed amount" },
                { value: "percentage", label: "A percentage of…" },
              ]}
              aria-label="A fixed amount or a percentage"
            />
          </div>
        )}
        {isPercentage ? (
          <>
            <div>
              <span style={fieldLabelStyle}>Percentage</span>
              <Input
                value={percent}
                inputMode="decimal"
                placeholder="10"
                leftIcon={<span style={{ color: "var(--muted)" }}>%</span>}
                onChange={(event) => setPercent(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && submit()}
                aria-label="Percentage"
              />
            </div>
            <div>
              <span style={fieldLabelStyle}>Of</span>
              <Select
                value={ofKey}
                onChange={setOfKey}
                options={deductionBases.map((option) => ({
                  value: option.key,
                  label: option.label,
                }))}
                placeholder="Choose the row this is a share of…"
                aria-label="The row this percentage is taken of"
                searchable={deductionBases.length > 6}
              />
              <span style={{ display: "block", marginTop: 6, fontSize: 12, color: "var(--muted)" }}>
                Worked out from that row and kept in step with it — change the row and this follows.
              </span>
            </div>
          </>
        ) : (
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
        )}
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
