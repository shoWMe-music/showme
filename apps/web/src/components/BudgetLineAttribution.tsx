import { Icon, Select } from "@showme/design-system";
import type {
  BudgetAttributionOption,
  BudgetDealOption,
  CostBearing,
  CostDealLink,
} from "./useBudgetEditor";
import { NO_DEAL_LINK } from "./useBudgetEditor";

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

/**
 * The deal selector offers each deal TWICE, once per sense, so the two are picked
 * apart rather than set by a second control the operator might never touch.
 * These prefixes are how one flat `<Select>` carries a two-part answer.
 */
const DEAL_FIGURE_PREFIX = "figure:";
const ATTRIBUTED_PREFIX = "under:";

function dealLinkFromOption(value: string): CostDealLink {
  if (value.startsWith(DEAL_FIGURE_PREFIX)) {
    return { kind: "deal_figure", dealId: value.slice(DEAL_FIGURE_PREFIX.length) };
  }
  if (value.startsWith(ATTRIBUTED_PREFIX)) {
    return { kind: "attributed", dealId: value.slice(ATTRIBUTED_PREFIX.length) };
  }
  return NO_DEAL_LINK;
}

function dealOptionValue(link: CostDealLink): string {
  if (link.kind === "deal_figure") return `${DEAL_FIGURE_PREFIX}${link.dealId}`;
  if (link.kind === "attributed") return `${ATTRIBUTED_PREFIX}${link.dealId}`;
  return NO_DEAL_VALUE;
}

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
  dealLink: CostDealLink;
  onPaidByChange: (participantId: string) => void;
  onBearingChange: (bearing: CostBearing) => void;
  onEditSplit: () => void;
  onDealLinkChange: (link: CostDealLink) => void;
  rowLabel: string;
}

/**
 * Three selects: who FRONTED the cash, who ultimately BEARS it, and how the row
 * relates to a deal.
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
  dealLink,
  onPaidByChange,
  onBearingChange,
  onEditSplit,
  onDealLinkChange,
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

  // A row that IS a deal's own figure is a forecast, not cash: the settlement
  // takes it from the deal and never reads the line. Who fronted it and who
  // carries it are therefore questions with no answer, and leaving the two selects
  // on the row would offer settings nothing applies — the dead-affordance problem
  // that made the old "Cost split: 100% split" readout wrong in the first place.
  //
  // A cost merely REPORTED UNDER a deal keeps both, because it is real money
  // somebody fronted and somebody carries. That difference is the whole reason the
  // two senses are separate.
  const isDealFigure = dealLink.kind === "deal_figure";

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
        // EACH DEAL APPEARS TWICE, and the two entries are the two things naming a
        // deal can mean. One says the row IS that deal's figure written down early
        // — the settlement takes it from the deal and never counts the line. The
        // other says a real cost is being reported under the deal — the settlement
        // counts it like any other. Offering one entry per deal would force the
        // planner to guess, and either guess is somebody's residual out by the
        // whole amount; the sentence under the row then says which was chosen.
        <Field caption="Deal" width={280}>
          <Select
            value={dealOptionValue(dealLink)}
            onChange={(value) => onDealLinkChange(dealLinkFromOption(value))}
            options={[
              { value: NO_DEAL_VALUE, label: "Not tied to a deal" },
              ...deals.flatMap((deal) => [
                {
                  value: `${DEAL_FIGURE_PREFIX}${deal.id}`,
                  label: `“${deal.name}” — this IS the deal's figure`,
                },
                {
                  value: `${ATTRIBUTED_PREFIX}${deal.id}`,
                  label: `“${deal.name}” — a cost reported under it`,
                },
              ]),
            ]}
            searchable={deals.length > 3}
            aria-label={`How this cost relates to a deal, for ${rowLabel}`}
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
  background: "var(--shape-fill)",
  color: "var(--muted)",
  cursor: "pointer",
} as const;

/**
 * The sentence under a cost that names a deal — what the choice above it DID.
 *
 * Two selector entries that differ by six words are not enough on their own; what
 * makes the difference legible is spelling out the consequence, on the row, at the
 * moment it is chosen. One of these says the money is taken from the deal, the
 * other says the money still comes out of the night. An operator who read the
 * control as a mere label would otherwise book real catering against a deal and
 * watch 500 leave the settlement without a word.
 */
export function DealAssignmentNote({ link, dealName }: { link: CostDealLink; dealName: string }) {
  if (link.kind === "none") return null;
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
      {link.kind === "deal_figure"
        ? `Forecast only — this IS the figure in “${dealName}”. The settlement takes it from the deal, so it is never counted twice and never charged to the event.`
        : `A real cost of the event, reported under “${dealName}”. It still lowers the settlement pool, exactly like an untagged cost.`}
    </div>
  );
}
