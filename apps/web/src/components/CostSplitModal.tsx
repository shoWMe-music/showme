import { Button, Input, Modal } from "@showme/design-system";
import { useEffect, useState } from "react";
import type { BudgetAttributionOption, CostBearing } from "./useBudgetEditor";

/**
 * The COST SPLIT — "who bears marketing, staff, etc. is set by the contract, not
 * a system default" (2026-08 settlements meeting, 01:02:58–01:06:31).
 *
 * The meeting is explicit that the platform must allow a flexible split *even
 * when individual expenses are paid by different parties*, and that the rule is
 * set once in the planner so costs entered against it settle automatically. This
 * dialog is where the rule is stated; `packages/settlement` is where it is applied.
 *
 * Two things it deliberately does NOT do:
 *
 * - **It never pre-fills a split.** decisions #16.3 — *"Creating a deal must not
 *   pre-fill a `cost_split`; it starts empty/zero and the operator opts in"* —
 *   which is the fix for the Lovable-era auto-split bug the meeting raises again
 *   at 01:00:17. Every row opens blank.
 * - **It does not force 100%.** Under is a real arrangement ("the venue carries
 *   60%, the event carries the rest") and the remainder stays a shared cost. Over
 *   is refused, because it charges out more than the line is worth.
 */

export interface CostSplitTarget {
  /** The cost row's key in the planner's draft. */
  key: string;
  label: string;
  /** The rule as it stands, so reopening shows what was already agreed. */
  bearing: CostBearing;
}

export interface CostSplitModalProps {
  target: CostSplitTarget | null;
  participants: BudgetAttributionOption[];
  onClose: () => void;
  onSubmit: (key: string, bearing: CostBearing) => void;
}

/** Percent as typed ("50", "33.5") → basis points, or null when unreadable. */
function percentToBasisPoints(percent: string): number | null {
  const text = percent.trim();
  if (text === "") return null;
  const value = Number(text.replace(",", "."));
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100);
}

function percentTextOf(basisPoints: number | undefined): string {
  return basisPoints == null ? "" : String(Math.round(basisPoints) / 100);
}

export function CostSplitModal({ target, participants, onClose, onSubmit }: CostSplitModalProps) {
  const [percents, setPercents] = useState<Record<string, string>>({});

  // Seeded on open, so reopening a row shows the split that is already on it and
  // a row with no split opens genuinely empty (decisions #16.3).
  useEffect(() => {
    if (!target) return;
    const shares = target.bearing.kind === "split" ? target.bearing.shares : {};
    const seeded: Record<string, string> = {};
    for (const party of participants) {
      seeded[party.id] = percentTextOf(shares[party.id]);
    }
    setPercents(seeded);
  }, [target, participants]);

  const stated = Object.entries(percents)
    .map(([participantId, percent]) => [participantId, percentToBasisPoints(percent)] as const)
    .filter((entry): entry is readonly [string, number] => entry[1] != null);
  const total = stated.reduce((running, [, basisPoints]) => running + basisPoints, 0);

  const problem =
    stated.length === 0
      ? "Give at least one party a share, or close this and pick a single bearer instead."
      : total > 10_000
        ? `These shares add up to ${(total / 100).toFixed(2)}%, which charges out more than the cost. They may total less than 100% — the rest stays a shared cost — but never more.`
        : null;

  const submit = () => {
    if (!target || problem) return;
    onSubmit(target.key, { kind: "split", shares: Object.fromEntries(stated) });
    onClose();
  };

  return (
    <Modal
      open={target !== null}
      onClose={onClose}
      title={target ? `Split “${target.label}”` : "Split cost"}
      width={520}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={problem !== null}>
            Set the split
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <p style={{ margin: 0, color: "var(--muted)", fontSize: 13, lineHeight: 1.5 }}>
          What share of this cost each party carries at settlement. Whoever fronts the cash is a
          separate question — that is the row's “Paid by”.
        </p>
        {participants.map((party) => (
          <div
            key={party.id}
            style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}
          >
            <span style={{ flex: 1, minWidth: 140, color: "var(--text)", fontSize: 14 }}>
              {party.label}
              <span style={{ color: "var(--dim)", fontSize: 12 }}> — {party.roleLabel}</span>
            </span>
            <div style={{ width: 110 }}>
              <Input
                value={percents[party.id] ?? ""}
                inputMode="decimal"
                placeholder="0"
                aria-label={`${party.label} share of this cost, percent`}
                trailing={<span style={{ color: "var(--muted)" }}>%</span>}
                onChange={(event) =>
                  setPercents((current) => ({ ...current, [party.id]: event.target.value }))
                }
              />
            </div>
          </div>
        ))}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            borderTop: "1px solid var(--border)",
            paddingTop: 10,
            fontFamily: "var(--font-mono)",
            fontSize: 13,
            color: total > 10_000 ? "var(--brand-red)" : "var(--text)",
          }}
        >
          <span>Allocated</span>
          <span>{(total / 100).toFixed(2)}%</span>
        </div>
        {total < 10_000 && total > 0 && (
          <span style={{ color: "var(--dim)", fontSize: 12 }}>
            The remaining {((10_000 - total) / 100).toFixed(2)}% stays a shared cost the event
            carries.
          </span>
        )}
        {problem && <span style={{ color: "var(--brand-red)", fontSize: 12.5 }}>{problem}</span>}
      </div>
    </Modal>
  );
}
