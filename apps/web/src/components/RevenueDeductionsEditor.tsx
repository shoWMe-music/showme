import { Card, Input, KeyValueRow } from "@showme/design-system";
import { Eyebrow } from "./primitives";

/** The live-recompute revenue & deductions editor (§6b, §15.G). Purely
 * presentational: each figure is an editable field; the screen recomputes and
 * passes the resolved `total` back down. The math lives in framework-agnostic TS
 * per CLAUDE.md — this component only renders and emits `onFigureChange`. */
export interface EditableFigure {
  key: string;
  label: string;
  /** Current value as a string (controlled input). */
  value: string;
  /** Deductions render in red with a leading minus. */
  negative?: boolean;
}

export interface RevenueDeductionsEditorProps {
  figures: EditableFigure[];
  /** The computed net line, formatted by the screen. */
  total?: { label: string; value: string };
  eyebrow?: string;
  helper?: string;
  /** Currency adornment inside each field. */
  currencySymbol?: string;
  onFigureChange?: (key: string, value: string) => void;
  readOnly?: boolean;
}

export function RevenueDeductionsEditor({
  figures,
  total,
  eyebrow = "Revenue & deductions",
  helper,
  currencySymbol = "€",
  onFigureChange,
  readOnly = false,
}: RevenueDeductionsEditorProps) {
  return (
    <Card padding="lg" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <Eyebrow>{eyebrow}</Eyebrow>
        {helper && <span style={{ color: "var(--muted)", fontSize: 13 }}>{helper}</span>}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {figures.map((figure) => (
          <div key={figure.key} style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span
              style={{
                flex: 1,
                color: figure.negative ? "var(--brand-red)" : "var(--text)",
                fontSize: 14,
              }}
            >
              {figure.label}
            </span>
            <div style={{ width: 160 }}>
              <Input
                value={figure.value}
                inputMode="decimal"
                disabled={readOnly}
                leftIcon={
                  <span style={{ color: figure.negative ? "var(--brand-red)" : "var(--muted)" }}>
                    {figure.negative ? `-${currencySymbol}` : currencySymbol}
                  </span>
                }
                onChange={(event) => onFigureChange?.(figure.key, event.target.value)}
              />
            </div>
          </div>
        ))}
      </div>

      {total && (
        <>
          <div style={{ height: 1, background: "var(--border)" }} />
          <KeyValueRow label={total.label} value={total.value} mono total />
        </>
      )}
    </Card>
  );
}
