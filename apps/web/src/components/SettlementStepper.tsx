import { STATUS_COLOR } from "@showme/design-system";

/**
 * The settlement's progress rail, laid out from the Claude design.
 *
 * Its proportions are the prototype's own, and they are what make it read as one
 * rail rather than a row of badges: a **26px** dot, a **fixed 26px** connector
 * (not a flexible one — the stops sit close together and the rail is as wide as it
 * needs to be, rather than stretched across the page), and the label set **inline
 * beside** the dot rather than stacked beneath it. Stacking is what made ours
 * twice the height of the design's and gave the whole screen a different rhythm.
 *
 * The numbering rule is the design's too, and it is a nice touch worth keeping:
 * a done step shows a check, a future step shows its number, and the CURRENT step
 * shows nothing at all — it is the one you are looking at, so it does not need to
 * count itself.
 *
 * Colours come from `STATUS_COLOR` in the design system rather than the hex the
 * prototype inlines — they are the same values, and taking them from the token
 * source means the rail follows the palette if it ever moves.
 */
export type SettlementStepState = "done" | "active" | "pending";

export interface SettlementStep {
  label: string;
  state: SettlementStepState;
}

export interface SettlementStepperProps {
  steps: SettlementStep[];
}

const DONE = STATUS_COLOR.confirmed;
const ACTIVE = STATUS_COLOR.pending;

export function SettlementStepper({ steps }: SettlementStepperProps) {
  return (
    // Seven stops on one line is the design's shape. The rail scrolls sideways
    // rather than wrapping if the viewport really cannot hold it — a rail broken
    // across two lines stops reading as a sequence.
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 0,
        overflowX: "auto",
        paddingBottom: 2,
      }}
    >
      {steps.map((step, index) => {
        const isLast = index === steps.length - 1;
        const dot =
          step.state === "active"
            ? {
                background: ACTIVE.fg,
                color: "var(--ink-1000)",
                border: "none",
                boxShadow: `0 0 14px ${ACTIVE.tint}`,
              }
            : step.state === "done"
              ? { background: DONE.tint, color: DONE.fg, border: "none", boxShadow: "none" }
              : {
                  background: "var(--elevated)",
                  color: "var(--dim)",
                  border: "1px solid var(--border)",
                  boxShadow: "none",
                };
        return (
          <div key={step.label} style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
            <span
              style={{
                width: 26,
                height: 26,
                borderRadius: "50%",
                flexShrink: 0,
                display: "grid",
                placeItems: "center",
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                fontWeight: 500,
                ...dot,
              }}
            >
              {/* The step you are on does not number itself. */}
              {step.state === "active" ? "" : step.state === "done" ? "✓" : index + 1}
            </span>
            <span
              style={{
                marginLeft: 7,
                fontSize: 12,
                whiteSpace: "nowrap",
                color:
                  step.state === "active"
                    ? "var(--text)"
                    : step.state === "done"
                      ? "var(--muted)"
                      : "var(--dim)",
                fontWeight: step.state === "active" ? 600 : 400,
              }}
            >
              {step.label}
            </span>
            {!isLast && (
              <span
                aria-hidden
                style={{
                  width: 20,
                  height: 2,
                  margin: "0 6px",
                  flexShrink: 0,
                  background: step.state === "done" ? DONE.fg : "var(--border)",
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
