import { Icon } from "@showme/design-system";

/** The settlement process stepper (§6b): Open ✓ → Pending review → Comments
 * received → Revised → Finalized → Partly paid → Paid. Richer than the DS
 * `Stepper` — each step carries its own done/active/pending state. Presentational. */
export type SettlementStepState = "done" | "active" | "pending";

export interface SettlementStep {
  label: string;
  state: SettlementStepState;
}

export interface SettlementStepperProps {
  steps: SettlementStep[];
}

export function SettlementStepper({ steps }: SettlementStepperProps) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", flexWrap: "wrap", gap: 4 }}>
      {steps.map((step, index) => {
        const dotBackground =
          step.state === "done"
            ? "var(--brand-gold)"
            : step.state === "active"
              ? "linear-gradient(135deg, var(--brand-red), var(--brand-amber))"
              : "var(--elevated)";
        const dotColor = step.state === "pending" ? "var(--dim)" : "#fff";
        return (
          <div
            key={step.label}
            style={{
              display: "flex",
              alignItems: "center",
              flex: index === steps.length - 1 ? "0 0 auto" : "1 1 120px",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
              <span
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: "50%",
                  background: dotBackground,
                  border: step.state === "pending" ? "1px solid var(--border)" : "none",
                  color: dotColor,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                {step.state === "done" ? <Icon name="check" size={14} /> : index + 1}
              </span>
              <span
                style={{
                  fontSize: 12,
                  textAlign: "center",
                  color: step.state === "active" ? "var(--text)" : "var(--muted)",
                  fontWeight: step.state === "active" ? 700 : 400,
                }}
              >
                {step.label}
              </span>
            </div>
            {index < steps.length - 1 && (
              <span
                style={{
                  flex: 1,
                  minWidth: 16,
                  height: 2,
                  margin: "13px 8px 0",
                  alignSelf: "flex-start",
                  background: step.state === "done" ? "var(--brand-gold)" : "var(--border)",
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
