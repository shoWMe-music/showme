import { Icon, Select } from "@showme/design-system";
import type { BudgetAttributionOption, BudgetDealOption, CostBearing } from "./useBudgetEditor";

/**
 * WHO HANDLED THIS MONEY — the strip under every line in the Budget Planner.
 *
 * The 2026-08 settlements meeting names this twice, as a decision and again as a
 * next step (01:27:49, 01:29:46): *"Every revenue stream carries a collected-by
 * designation… A multi-selector defines who pays a cost and who receives revenue;
 * both settle after the event."* The reason is stated plainly at 01:24:48 —
 * **the system cannot know who holds the cash.** Until this existed the planner
 * attributed every line to whoever typed it, so a settlement between a venue that
 * took the door and a promoter that paid the band was computed from a fiction.
 *
 * Presentational and deliberately dumb: it renders selects and emits ids. Which
 * parties exist, what the rules mean and what gets written are the hook's
 * (`useBudgetEditor`) and the engine's (`packages/settlement`).
 */

const SHARED_BEARING_VALUE = "__shared__";
const SPLIT_BEARING_VALUE = "__split__";
const NO_DEAL_VALUE = "__none__";

const stripStyle = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
  paddingLeft: 2,
} as const;

const captionStyle = {
  fontFamily: "var(--font-mono)",
  fontSize: 9.5,
  letterSpacing: ".08em",
  textTransform: "uppercase",
  color: "var(--dim)",
  whiteSpace: "nowrap",
} as const;

function Field({
  caption,
  width,
  children,
}: { caption: string; width: number; children: React.ReactNode }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={captionStyle}>{caption}</span>
      <span style={{ width }}>{children}</span>
    </span>
  );
}

export interface RevenueAttributionProps {
  participants: BudgetAttributionOption[];
  /** The chosen participant id, or "" for "whoever is planning" (the caller). */
  value: string;
  fallbackParticipantId: string | null;
  onChange: (participantId: string) => void;
  /** Names the row in the accessible label — "Collected by, for Advance tickets". */
  rowLabel: string;
}

/** One select: the party who RECEIVES a revenue line. */
export function RevenueAttribution({
  participants,
  value,
  fallbackParticipantId,
  onChange,
  rowLabel,
}: RevenueAttributionProps) {
  if (participants.length === 0) return null;
  return (
    <div style={stripStyle}>
      <Field caption="Collected by" width={190}>
        <Select
          value={value || fallbackParticipantId || ""}
          onChange={onChange}
          options={participants.map((party) => ({
            value: party.id,
            label: `${party.label} — ${party.roleLabel}`,
          }))}
          searchable={participants.length > 6}
          aria-label={`Collected by, for ${rowLabel}`}
        />
      </Field>
    </div>
  );
}

export interface CostAttributionProps {
  participants: BudgetAttributionOption[];
  deals: BudgetDealOption[];
  paidBy: string;
  fallbackParticipantId: string | null;
  bearing: CostBearing;
  dealId: string;
  onPaidByChange: (participantId: string) => void;
  onBearingChange: (bearing: CostBearing) => void;
  onEditSplit: () => void;
  onDealChange: (dealId: string) => void;
  rowLabel: string;
}

/**
 * Three selects: who FRONTED the cash, who ultimately BEARS it, and which
 * agreement it belongs to.
 *
 * Paid-by and borne-by are separate on purpose (see `CostBearing`): the operator
 * pays the marketing invoice, and the contract may still split it 50/50. Picking
 * "Split…" hands the question to `CostSplitModal` rather than trying to express
 * percentages in a dropdown.
 */
export function CostAttribution({
  participants,
  deals,
  paidBy,
  fallbackParticipantId,
  bearing,
  dealId,
  onPaidByChange,
  onBearingChange,
  onEditSplit,
  onDealChange,
  rowLabel,
}: CostAttributionProps) {
  if (participants.length === 0) return null;

  const bearingValue =
    bearing.kind === "participant"
      ? bearing.participantId
      : bearing.kind === "split"
        ? SPLIT_BEARING_VALUE
        : SHARED_BEARING_VALUE;

  const chooseBearing = (value: string) => {
    if (value === SHARED_BEARING_VALUE) return onBearingChange({ kind: "shared" });
    if (value === SPLIT_BEARING_VALUE) return onEditSplit();
    onBearingChange({ kind: "participant", participantId: value });
  };

  // A row that IS an agreement's own figure is a forecast, not cash: the
  // settlement takes it from the deal and never reads the line. Who fronted it and
  // who carries it are therefore questions with no answer, and leaving the two
  // selects on the row would offer settings nothing applies — the dead-affordance
  // problem that made the old "Cost split: 100% split" readout wrong in the first
  // place. The row keeps only the control that means something, plus the note.
  const isDealFigure = dealId !== "";

  return (
    <div style={stripStyle}>
      {!isDealFigure && (
        <Field caption="Paid by" width={170}>
          <Select
            value={paidBy || fallbackParticipantId || ""}
            onChange={onPaidByChange}
            options={participants.map((party) => ({
              value: party.id,
              label: `${party.label} — ${party.roleLabel}`,
            }))}
            searchable={participants.length > 6}
            aria-label={`Paid by, for ${rowLabel}`}
          />
        </Field>
      )}
      {!isDealFigure && (
        <Field caption="Borne by" width={182}>
          <Select
            value={bearingValue}
            onChange={chooseBearing}
            options={[
              { value: SHARED_BEARING_VALUE, label: "The event (shared)" },
              ...participants.map((party) => ({
                value: party.id,
                label: `${party.label} — deducted`,
              })),
              { value: SPLIT_BEARING_VALUE, label: "Split between parties…" },
            ]}
            searchable={participants.length > 6}
            aria-label={`Borne by, for ${rowLabel}`}
          />
        </Field>
      )}
      {!isDealFigure && bearing.kind === "split" && (
        <button type="button" onClick={onEditSplit} style={splitPillStyle}>
          <Icon name="chevron-right" size={11} />
          {splitSummary(bearing.shares, participants)}
        </button>
      )}
      {deals.length > 0 && (
        // Naming the options "a cost of its own" vs "the figure from <deal>" is
        // load-bearing, not phrasing. Assigning a row to a deal does not merely
        // TAG it — it declares the row to be that agreement's own figure written
        // down early, which the settlement then takes from the agreement instead
        // (see `DealAssignmentNote`). An operator who read the control as a label
        // would book a real third-party cost against a deal and watch it leave
        // the settlement, so the control has to say what it does.
        <Field caption="Deal" width={210}>
          <Select
            value={dealId || NO_DEAL_VALUE}
            onChange={(value) => onDealChange(value === NO_DEAL_VALUE ? "" : value)}
            options={[
              { value: NO_DEAL_VALUE, label: "A cost of its own" },
              ...deals.map((deal) => ({ value: deal.id, label: `The figure from “${deal.name}”` })),
            ]}
            searchable={deals.length > 6}
            aria-label={`Deal this cost belongs to, for ${rowLabel}`}
          />
        </Field>
      )}
    </div>
  );
}

/** "Venue 60% · Marlo Vance 40%" — the split, short enough to sit on the row. */
export function splitSummary(
  shares: Record<string, number>,
  participants: BudgetAttributionOption[],
): string {
  const named = Object.entries(shares).map(([participantId, basisPoints]) => {
    const party = participants.find((option) => option.id === participantId);
    return `${party?.label ?? "Participant"} ${(basisPoints / 100).toFixed(0)}%`;
  });
  return named.length > 0 ? named.join(" · ") : "No shares set";
}

const splitPillStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  fontSize: 11,
  padding: "3px 9px",
  borderRadius: 999,
  border: "1px solid var(--border)",
  background: "var(--elevated)",
  color: "var(--muted)",
  cursor: "pointer",
} as const;

/**
 * The message under a cost booked against a deal.
 *
 * A row that is really the agreement's own figure — the guarantee typed into
 * "Performer fee" — is a forecast, not cash that moved, and the settlement takes
 * it from the deal instead (see `CostDraft.dealId`). Saying so on the row is the
 * difference between a planner that quietly disagrees with the settlement and one
 * that explains why the two figures are the same money.
 */
export function DealAssignmentNote({ dealName }: { dealName: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        fontSize: 11.5,
        color: "var(--dim)",
        paddingLeft: 2,
      }}
    >
      <Icon name="link" size={12} />
      Forecast for “{dealName}”. The settlement takes this figure from the agreement, so it is never
      counted twice.
    </div>
  );
}
