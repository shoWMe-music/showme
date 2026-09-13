import { Button, Card, Icon, type IconName, Input } from "@showme/design-system";
import { BudgetBreakEvenChart } from "./BudgetBreakEvenChart";
import { BudgetBreakdownCard } from "./BudgetBreakdownCard";
import {
  CostAttribution,
  CostAttributionLegend,
  CostBearingBadge,
  CostBearingNote,
  DealAssignmentNote,
  RevenueAttribution,
} from "./BudgetLineAttribution";
import tableStyles from "./BudgetTable.module.css";
import { type KpiItem, KpiRow } from "./KpiRow";
import { PerformingRightsEstimateCard } from "./PerformingRightsEstimateCard";
import type { TicketSplitDisplay } from "./budgetPlannerView";
import {
  type BreakEvenDisplay,
  type BreakdownDisplayRow,
  type DealFigureWarning,
  type PerformingRightsDisplay,
  splitCostRows,
} from "./budgetPlannerView";
import { Eyebrow } from "./primitives";
import type {
  BudgetAttributionOption,
  BudgetDealOption,
  CostBearing,
  CostDealLink,
  DerivedDeductionRule,
} from "./useBudgetEditor";
import { NEW_ROW_PREFIX, linkedDealId } from "./useBudgetEditor";

export interface TicketTypeRow {
  id: string;
  name: string;
  /** Controlled price (string). */
  price: string;
  /** Controlled quantity (string). */
  quantity: string;
  /** The participant who receives it; "" falls back to the planning operator. */
  collectedBy?: string;
}

export interface CostRow {
  key: string;
  label: string;
  value: string;
  /** Only a custom row carries a remove control — see `useBudgetEditor`. */
  isCustom?: boolean;
  /** Who fronted the cash; "" falls back to the planning operator. */
  paidBy?: string;
  /** Who ultimately carries it — shared, one bearer, or a split. */
  bearing?: CostBearing;
  /** Which deal this cost names, and in which sense. Absent reads as none. */
  dealLink?: CostDealLink;
  /**
   * Set on a row READ FROM A DEAL rather than stored — the performer fee taken
   * live from the guarantee. Such a row has no `budget_lines` row behind it, so
   * there is nothing to edit here, nothing to attribute and nothing to remove:
   * the operator changes the figure by changing the deal, which is where the
   * figure actually lives. It still counts in every total, because the forecast
   * would otherwise be short by the largest cost of the night.
   */
  readFromDeal?: { dealNames: string[] };
  /**
   * Set on a DERIVED row — a deduction stated as a share of another row rather
   * than as a figure. Read-only for the same reason `readFromDeal` is: the number
   * is an answer, and the rule is where the question lives.
   */
  derivedFrom?: DerivedDeductionRule;
}

/** A free-form revenue row the operator named ("+ Add Field"). */
export interface CustomRevenueRow {
  id: string;
  label: string;
  value: string;
  /** The participant who receives it; "" falls back to the planning operator. */
  collectedBy?: string;
}

/** One button on the toolbar between the advisory banner and the KPI band. */
export interface BudgetToolbarAction {
  label: string;
  icon?: IconName;
  onClick: () => void;
  disabled?: boolean;
}

export interface BudgetPlannerProps {
  /** The four tinted KPI tiles (Total revenue, Total costs, P/L, Break-even). */
  kpis: KpiItem[];
  ticketTypes: TicketTypeRow[];
  /** Computed "Total ticket revenue", formatted. */
  ticketRevenueTotal: string;
  /** Each tier's own price x quantity, formatted, keyed by row id. */
  ticketTierTotals: Record<string, string>;
  /** The totals band's subtitle — how many tickets the sheet expects to sell. */
  ticketsPlannedLabel: string;
  /** How the door divides — the bars under the totals band. */
  ticketSplit: TicketSplitDisplay;
  capacity: string;
  avgBarSpend: string;
  avgMerchSpend: string;
  /** Computed bar revenue, formatted. */
  barRevenue: string;
  /** Computed merch revenue, formatted. Its own row — the bar's is the venue's. */
  merchRevenue: string;
  /** Sponsorship, a grant, a fee — revenue that is neither ticketing nor bar. */
  otherRevenue: string;
  costs: CostRow[];
  /** The free-form revenue rows, drawn under "Other revenue". */
  customRevenue?: CustomRevenueRow[];
  /** Load Template / Save as Template / CSV / PDF. Empty renders no toolbar. */
  toolbar?: BudgetToolbarAction[];
  /** What the operator expects their payment/ticketing provider to keep. */
  processingPercent: string;
  processingFlatPerTicket: string;
  /** The seven Results tiles. */
  results: KpiItem[];
  breakEven: BreakEvenDisplay;
  revenueSources: BreakdownDisplayRow[];
  costBreakdown: BreakdownDisplayRow[];
  performingRights: PerformingRightsDisplay;
  /**
   * Cost rows that claim to be a deal's own figure and state a different one,
   * keyed by row key. Absent for every row that agrees with its deal — this is a
   * warning, so a row only carries one when something is actually wrong.
   */
  dealFigureWarnings?: Record<string, DealFigureWarning>;
  currencySymbol?: string;
  /**
   * A PEEK at another currency: format a major-unit draft string for READING.
   *
   * Set, every money field on the sheet stops being an `<Input>` and becomes a
   * derived readout — the same treatment a figure owned by a deal already gets.
   * That is not a limitation being worked around, it is the point. A money input
   * showing a converted number has no answer to "which currency did you just
   * type?", and saving one means converting back at a rate that can have moved
   * since it was rendered. Relabelling the inputs without converting them was the
   * original bug (ClickUp 123qy9rnjb8): a fee typed under a € and settled as SEK.
   *
   * So a peek is a READ, exactly like the eye on a password field reveals without
   * letting you edit what it revealed. Dropping back to the event's own currency
   * is one click and returns every field to being editable.
   *
   * Absent, every field is an ordinary editable input in `currencySymbol` — which
   * is the default and the state the planner is in unless somebody asked to look
   * at something else.
   */
  readMoneyAs?: (majorUnitDraft: string) => string;
  advisory?: string;
  /**
   * Everyone on the event, for the collected-by / paid-by / borne-by selectors
   * the 2026-08 settlements meeting made mandatory. Empty (or absent) draws no
   * attribution strip at all — a planner on an event with no roster has nobody
   * to attribute anything to, and one empty select per row would be noise.
   */
  participants?: BudgetAttributionOption[];
  /** The event's agreements, so a cost can be booked against one. */
  deals?: BudgetDealOption[];
  /** Whose name an unattributed row carries — the operator doing the planning. */
  defaultParticipantId?: string | null;
  /** Who receives the bar take / the merch take / "Other revenue". */
  barCollectedBy?: string;
  merchCollectedBy?: string;
  otherRevenueCollectedBy?: string;
  onBarCollectedByChange?: (participantId: string) => void;
  onMerchCollectedByChange?: (participantId: string) => void;
  onOtherRevenueCollectedByChange?: (participantId: string) => void;
  onCustomRevenueCollectedByChange?: (id: string, participantId: string) => void;
  onCostPaidByChange?: (key: string, participantId: string) => void;
  onCostBearingChange?: (key: string, bearing: CostBearing) => void;
  onCostDealLinkChange?: (key: string, link: CostDealLink) => void;
  /** Opens the split dialog for one cost row. */
  onEditCostSplit?: (key: string) => void;
  onTicketChange?: (
    id: string,
    field: "name" | "price" | "quantity" | "collectedBy",
    value: string,
  ) => void;
  onAddTicketType?: () => void;
  onRemoveTicketType?: (id: string) => void;
  onCapacityChange?: (value: string) => void;
  onAvgBarSpendChange?: (value: string) => void;
  onAvgMerchSpendChange?: (value: string) => void;
  onOtherRevenueChange?: (value: string) => void;
  onCostChange?: (key: string, value: string) => void;
  onRemoveCost?: (key: string) => void;
  /**
   * The standing cost headings the operator has asked back onto the sheet this
   * session, BY LABEL (see `splitCostRows`). Absent `onRevealCost` nothing
   * collapses at all — the component still renders every row it is given, so a
   * caller that does not want the affordance does not get a half-built one.
   */
  revealedCostHeadings?: readonly string[];
  onRevealCost?: (heading: string) => void;
  onCustomRevenueChange?: (id: string, value: string) => void;
  onRemoveCustomRevenue?: (id: string) => void;
  /** Opens the "+ Add Field" modal for one of the two cards. */
  onAddCustomField?: (kind: "revenue" | "cost") => void;
  onProcessingPercentChange?: (value: string) => void;
  onProcessingFlatPerTicketChange?: (value: string) => void;
}

/** The Budget Planner (§3b, shot 04). The design prototype's Budget screen has
 * eight sections and this renders all of them, in its order: the KPI band, the
 * two-column revenue/costs editor, Results, Break-even Analysis, Revenue Sources
 * and Cost Breakdown side by side, and the PRO fee estimate.
 *
 * Presentational — every figure is a controlled field and nothing here is
 * computed (math lives in framework-agnostic TS per CLAUDE.md, reached through
 * `budgetPlannerView`); this component only renders + emits. */
export function BudgetPlanner({
  kpis,
  ticketTypes,
  ticketRevenueTotal,
  ticketTierTotals,
  ticketsPlannedLabel,
  ticketSplit,
  capacity,
  avgBarSpend,
  avgMerchSpend,
  barRevenue,
  merchRevenue,
  otherRevenue,
  costs,
  customRevenue = [],
  toolbar = [],
  processingPercent,
  processingFlatPerTicket,
  results,
  breakEven,
  revenueSources,
  costBreakdown,
  performingRights,
  dealFigureWarnings = {},
  currencySymbol = "€",
  readMoneyAs,
  advisory = "This is an estimate only and should be reviewed before final decisions.",
  participants = [],
  deals = [],
  defaultParticipantId = null,
  barCollectedBy = "",
  merchCollectedBy = "",
  otherRevenueCollectedBy = "",
  onBarCollectedByChange,
  onMerchCollectedByChange,
  onOtherRevenueCollectedByChange,
  onCustomRevenueCollectedByChange,
  onCostPaidByChange,
  onCostBearingChange,
  onCostDealLinkChange,
  onEditCostSplit,
  onTicketChange,
  onAddTicketType,
  onRemoveTicketType,
  onCapacityChange,
  onAvgBarSpendChange,
  onAvgMerchSpendChange,
  onOtherRevenueChange,
  onCostChange,
  onRemoveCost,
  revealedCostHeadings = [],
  onRevealCost,
  onCustomRevenueChange,
  onRemoveCustomRevenue,
  onAddCustomField,
  onProcessingPercentChange,
  onProcessingFlatPerTicketChange,
}: BudgetPlannerProps) {
  // An unused standing heading is not a row yet — see `splitCostRows`. Without a
  // reveal handler nothing collapses, so the component keeps working standalone.
  const { budgeted: budgetedCosts, unused: unusedCostHeadings } = onRevealCost
    ? splitCostRows(costs, revealedCostHeadings)
    : { budgeted: costs, unused: [] };

  // `label` names the field for assistive technology (and for a test that has to
  // pick one row of ten). The rows print their heading as plain text beside the
  // input, which the browser does not connect to it — and now that each row also
  // carries three attribution selects, an unnamed money field is the only control
  // on the row with nothing to call it.
  /**
   * A figure this sheet SHOWS but does not own — a deal's own number, a derived
   * one, or any field at all while a currency peek is on. One helper so a peeked
   * row cannot end up half converted: before this, the deal-owned figure below
   * kept rendering in the event's symbol beside neighbours that had converted.
   */
  const readOnlyFigure = (value: string, label?: string) =>
    readMoneyAs
      ? readOnlyMoneyText(value === "" ? "—" : readMoneyAs(value), label)
      : readOnlyMoney(value, currencySymbol, label);

  const money = (value: string, onChange?: (value: string) => void, label?: string) =>
    readMoneyAs ? (
      readOnlyFigure(value, label)
    ) : (
      <div style={{ width: 120, flexShrink: 0 }}>
        <Input
          value={value}
          inputMode="decimal"
          aria-label={label}
          leftIcon={<span style={{ color: "var(--muted)" }}>{currencySymbol}</span>}
          onChange={(event) => onChange?.(event.target.value)}
        />
      </div>
    );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* The screen names itself. The workspace header above says which EVENT is
          open; it never said which of its ten tabs you are looking at, so the
          planner began at an advisory banner with no title of its own. */}
      <h3
        style={{
          fontFamily: "var(--font-display)",
          fontWeight: 600,
          fontSize: 24,
          letterSpacing: "-0.02em",
          color: "var(--text)",
          margin: 0,
        }}
      >
        Budget Planner
      </h3>
      <Card
        padding="sm"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 9,
          background: "color-mix(in srgb, var(--brand-amber) 12%, transparent)",
        }}
      >
        <span style={{ color: "#F4A046", display: "inline-flex", flexShrink: 0 }}>
          <Icon name="alert" size={16} />
        </span>
        <span style={{ color: "var(--text)", fontSize: 12.5, lineHeight: 1.45 }}>{advisory}</span>
      </Card>

      {toolbar.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {toolbar.map((action) => (
            <Button
              key={action.label}
              variant="secondary"
              disabled={action.disabled}
              leftIcon={action.icon ? <Icon name={action.icon} size={14} /> : undefined}
              onClick={action.onClick}
            >
              {action.label}
            </Button>
          ))}
        </div>
      )}

      <KpiRow items={kpis} />

      {/*
       * FULL WIDTH, STACKED — not the two columns the old handoff specified
       * (design-spec-budget-planner-2026-09-13.md).
       *
       * Side by side, each card had roughly half the width to lay a row out in,
       * which is why both were built as label-and-field stacks: there was no
       * room for a row of real columns. The new design gives each card the whole
       * width and spends it on a TABLE — the meeting's headline request, "a
       * simplified table structure, remove excessive spacing". The spacing goes
       * away because the columns take it, not because anything was squeezed.
       *
       * `alignItems: start` is gone with the grid: a stacked card is already as
       * tall as its own content, which is what that note was working around.
       */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Card padding="md" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <CardHeading
            title="Revenue"
            subtitle="What the event brings in, and who collects the cash."
          />
          <Eyebrow>Ticket types (box office)</Eyebrow>
          {/* THE TABLE. Column headers once, at the top, instead of a label
              beside every field — the meeting's "simplified table structure,
              remove excessive spacing". Below 860px `BudgetTable.module.css`
              turns each row back into a labelled stack, because six columns do
              not fit a phone and a crushed table is worse than an honest list. */}
          <div className={tableStyles.table}>
            <div className={tableStyles.head}>
              <span>Ticket type</span>
              <span className={tableStyles.numeric}>Price</span>
              <span className={tableStyles.numeric}>Qty</span>
              <span>Collected by</span>
              <span className={tableStyles.numeric}>Total</span>
              <span />
            </div>
            {ticketTypes.map((ticket) => (
              <div key={ticket.id} className={tableStyles.row}>
                <div style={{ minWidth: 0 }}>
                  <span className={tableStyles.cellLabel}>Ticket type</span>
                  <Input
                    value={ticket.name}
                    placeholder="Ticket type"
                    onChange={(event) => onTicketChange?.(ticket.id, "name", event.target.value)}
                  />
                </div>
                <div style={{ minWidth: 0 }}>
                  <span className={tableStyles.cellLabel}>Price</span>
                  {money(
                    ticket.price,
                    (value) => onTicketChange?.(ticket.id, "price", value),
                    `${ticket.name || "Ticket type"} price`,
                  )}
                </div>
                <div style={{ minWidth: 0 }}>
                  <span className={tableStyles.cellLabel}>Qty</span>
                  <Input
                    value={ticket.quantity}
                    inputMode="numeric"
                    placeholder="Qty"
                    aria-label={`${ticket.name || "Ticket type"} quantity`}
                    onChange={(event) =>
                      onTicketChange?.(ticket.id, "quantity", event.target.value)
                    }
                  />
                </div>
                <div style={{ minWidth: 0 }}>
                  <span className={tableStyles.cellLabel}>Collected by</span>
                  <RevenueAttribution
                    participants={participants}
                    value={ticket.collectedBy ?? ""}
                    fallbackParticipantId={defaultParticipantId}
                    onChange={(participantId) =>
                      onTicketChange?.(ticket.id, "collectedBy", participantId)
                    }
                    rowLabel={ticket.name || "this ticket type"}
                    hideLabel
                  />
                </div>
                {/* Price times quantity, derived in the view model so this column
                    and the band below it are one figure, not two opinions. */}
                <span className={tableStyles.total}>{ticketTierTotals[ticket.id] ?? "—"}</span>
                {onRemoveTicketType ? (
                  <button
                    type="button"
                    aria-label={`Remove ${ticket.name || "ticket type"}`}
                    onClick={() => onRemoveTicketType(ticket.id)}
                    style={iconButtonStyle}
                  >
                    <Icon name="trash" size={15} />
                  </button>
                ) : (
                  <span />
                )}
              </div>
            ))}
          </div>
          {/* THE TOTALS BAND. A tinted full-width strip, not a thin key-value
              row: it closes the ticket table and is the figure every percentage
              deal is a share of (#23.1), so it carries the weight of a result
              rather than of another line. */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
              padding: "10px 14px",
              borderRadius: 11,
              background: "color-mix(in srgb, #6FC97A 9%, transparent)",
              border: "1px solid color-mix(in srgb, #6FC97A 22%, transparent)",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <Eyebrow>Total tickets revenue</Eyebrow>
              <span style={{ color: "var(--muted)", fontSize: 12 }}>{ticketsPlannedLabel}</span>
            </div>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 19,
                color: "#6FC97A",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {ticketRevenueTotal}
            </span>
          </div>
          {!ticketSplit.isEmpty && <TicketSplitBars split={ticketSplit} />}
          {onAddTicketType && (
            <Button
              variant="ghost"
              leftIcon={<Icon name="plus" size={14} />}
              onClick={onAddTicketType}
            >
              Add ticket type
            </Button>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ flex: 1, minWidth: 0, color: "var(--text)", fontSize: 14 }}>
              Venue capacity
              <span style={{ color: "var(--muted)", fontSize: 12.5, marginLeft: 8 }}>
                Used for break-even and per-guest revenue.
              </span>
            </span>
            <div style={{ width: 120, flexShrink: 0 }}>
              <Input
                value={capacity}
                inputMode="numeric"
                aria-label="Venue capacity"
                onChange={(event) => onCapacityChange?.(event.target.value)}
              />
            </div>
          </div>

          {/* OTHER REVENUE, as a table. Bar, merch and the standing other-revenue
              row were three stacks of three lines each — a rate, a computed total
              and a collector, every one of them labelled. They are rows now, and
              the labels live in the header once. */}
          <Eyebrow>Other revenue</Eyebrow>
          <div className={tableStyles.table}>
            <div className={tableStyles.headRevenue}>
              <span>Source</span>
              <span>Basis</span>
              <span className={tableStyles.numeric}>Amount</span>
              <span>Collected by</span>
              <span className={tableStyles.numeric}>Total</span>
              <span />
            </div>

            <div className={tableStyles.rowRevenue}>
              <span style={{ color: "var(--text)", fontSize: 14 }}>Bar</span>
              <span className={tableStyles.basis}>Per guest</span>
              <div style={{ minWidth: 0 }}>
                <span className={tableStyles.cellLabel}>Amount per guest</span>
                {money(avgBarSpend, onAvgBarSpendChange, "Average bar spend per guest")}
              </div>
              <div style={{ minWidth: 0 }}>
                <span className={tableStyles.cellLabel}>Collected by</span>
                <RevenueAttribution
                  participants={participants}
                  value={barCollectedBy}
                  fallbackParticipantId={defaultParticipantId}
                  onChange={(participantId) => onBarCollectedByChange?.(participantId)}
                  rowLabel="bar revenue"
                  hideLabel
                />
              </div>
              <span className={tableStyles.total}>{barRevenue}</span>
              <span />
            </div>

            {/*
             * MERCH IS ITS OWN ROW, with its own collector — ClickUp `86cbcn1ue`,
             * 2026-09-03: *"Bar and merchandise can not be together."* One row of
             * the same shape as the bar above it, because the two ARE the same
             * arithmetic on the same head count; what differs is who collects it,
             * and under #23.1 that is now what decides whose money it is.
             */}
            <div className={tableStyles.rowRevenue}>
              <span style={{ color: "var(--text)", fontSize: 14 }}>Merch</span>
              <span className={tableStyles.basis}>Per guest</span>
              <div style={{ minWidth: 0 }}>
                <span className={tableStyles.cellLabel}>Amount per guest</span>
                {money(avgMerchSpend, onAvgMerchSpendChange, "Average merch spend per guest")}
              </div>
              <div style={{ minWidth: 0 }}>
                <span className={tableStyles.cellLabel}>Collected by</span>
                <RevenueAttribution
                  participants={participants}
                  value={merchCollectedBy}
                  fallbackParticipantId={defaultParticipantId}
                  onChange={(participantId) => onMerchCollectedByChange?.(participantId)}
                  rowLabel="merch revenue"
                  hideLabel
                />
              </div>
              <span className={tableStyles.total}>{merchRevenue}</span>
              <span />
            </div>

            <div className={tableStyles.rowRevenue}>
              <span style={{ color: "var(--text)", fontSize: 14 }}>Other revenue</span>
              <span className={tableStyles.basis}>Flat</span>
              <div style={{ minWidth: 0 }}>
                <span className={tableStyles.cellLabel}>Amount</span>
                {money(otherRevenue, onOtherRevenueChange, "Other revenue")}
              </div>
              <div style={{ minWidth: 0 }}>
                <span className={tableStyles.cellLabel}>Collected by</span>
                <RevenueAttribution
                  participants={participants}
                  value={otherRevenueCollectedBy}
                  fallbackParticipantId={defaultParticipantId}
                  onChange={(participantId) => onOtherRevenueCollectedByChange?.(participantId)}
                  rowLabel="other revenue"
                  hideLabel
                />
              </div>
              <span className={tableStyles.total} />
              <span />
            </div>

            {customRevenue.map((row) => (
              <div key={row.id} className={tableStyles.rowRevenue}>
                <span style={{ color: "var(--text)", fontSize: 14, minWidth: 0 }}>{row.label}</span>
                <span className={tableStyles.basis}>Flat</span>
                <div style={{ minWidth: 0 }}>
                  <span className={tableStyles.cellLabel}>Amount</span>
                  {money(
                    row.value,
                    (value) => onCustomRevenueChange?.(row.id, value),
                    `${row.label} amount`,
                  )}
                </div>
                <div style={{ minWidth: 0 }}>
                  <span className={tableStyles.cellLabel}>Collected by</span>
                  <RevenueAttribution
                    participants={participants}
                    value={row.collectedBy ?? ""}
                    fallbackParticipantId={defaultParticipantId}
                    onChange={(participantId) =>
                      onCustomRevenueCollectedByChange?.(row.id, participantId)
                    }
                    rowLabel={row.label}
                    hideLabel
                  />
                </div>
                <span className={tableStyles.total} />
                {onRemoveCustomRevenue ? (
                  <button
                    type="button"
                    aria-label={`Remove ${row.label}`}
                    onClick={() => onRemoveCustomRevenue(row.id)}
                    style={iconButtonStyle}
                  >
                    <Icon name="x" size={14} />
                  </button>
                ) : (
                  <span />
                )}
              </div>
            ))}
          </div>
          {onAddCustomField && (
            <Button
              variant="ghost"
              leftIcon={<Icon name="plus" size={14} />}
              onClick={() => onAddCustomField("revenue")}
            >
              Add field
            </Button>
          )}
        </Card>

        <Card padding="md" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <CardHeading
            title="Costs"
            subtitle="Each cost says who paid it, and who carries it at settlement."
          />
          <CostAttributionLegend />
          {/* THE COST TABLE. Every caption — Paid by, To be deducted from, Deal —
              used to sit beside its own control on every row. They are column
              headers now, written once. The prototype has three columns to our
              five because its cost model is simpler; what is being ported is the
              treatment, which is what "too spacious" was about. */}
          <div className={tableStyles.table}>
            <div className={tableStyles.headCost}>
              <span>Cost</span>
              <span className={tableStyles.numeric}>Amount</span>
              <span>Paid by</span>
              <span>To be deducted from</span>
              <span>Deal</span>
              <span />
            </div>
            {budgetedCosts.map((cost) => (
              <div key={cost.key} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div className={tableStyles.rowCost}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      minWidth: 0,
                      flexWrap: "wrap",
                    }}
                  >
                    <span style={{ color: "var(--text)", fontSize: 14, minWidth: 0 }}>
                      {cost.label}
                    </span>
                    {/* The one-glance cost-vs-deduction answer, kept beside the
                        LABEL: the complaint was about scanning the column, and
                        the column is the labels. */}
                    {!cost.readFromDeal && (
                      <CostBearingBadge
                        bearing={cost.bearing ?? { kind: "shared" }}
                        participants={participants}
                      />
                    )}
                  </div>

                  {/* A derived figure is READ-ONLY for the same reason a deal's
                      figure is: it is an answer, not an entry. An editable box
                      over a computed number invites somebody to type into it and
                      lose the typing at the next recompute. */}
                  <div style={{ minWidth: 0 }}>
                    <span className={tableStyles.cellLabel}>Amount</span>
                    {cost.readFromDeal || cost.derivedFrom
                      ? readOnlyFigure(cost.value, `${cost.label} amount`)
                      : money(
                          cost.value,
                          (value) => onCostChange?.(cost.key, value),
                          `${cost.label} amount`,
                        )}
                  </div>

                  {cost.readFromDeal ? (
                    <>
                      <span />
                      <span />
                      <span />
                    </>
                  ) : (
                    <CostAttribution
                      participants={participants}
                      deals={deals}
                      paidBy={cost.paidBy ?? ""}
                      fallbackParticipantId={defaultParticipantId}
                      bearing={cost.bearing ?? { kind: "shared" }}
                      dealLink={cost.dealLink ?? { kind: "none" }}
                      onPaidByChange={(participantId) =>
                        onCostPaidByChange?.(cost.key, participantId)
                      }
                      onBearingChange={(bearing) => onCostBearingChange?.(cost.key, bearing)}
                      onEditSplit={() => onEditCostSplit?.(cost.key)}
                      onDealLinkChange={(link) => onCostDealLinkChange?.(cost.key, link)}
                      rowLabel={cost.label}
                      asCells
                    />
                  )}

                  {/*
                   * EVERY COST ROW CAN BE CLEARED — the reported gap ("no delete
                   * buttons") was that three of the five row kinds had one.
                   *
                   * The two verbs stay different because the two rows are. A
                   * CUSTOM row is the operator's own invention: removing it
                   * deletes it outright. A STANDING heading is one the sheet
                   * always offers: clearing it drops the heading back into "Not
                   * budgeted" below, one click from returning.
                   *
                   * Offered only for a heading that HAS a stored line — a figure
                   * read from a deal owns nothing to delete, and the note under
                   * the row says where to change it.
                   */}
                  {!cost.readFromDeal && onRemoveCost && !cost.key.startsWith(NEW_ROW_PREFIX) ? (
                    <button
                      type="button"
                      aria-label={cost.isCustom ? `Remove ${cost.label}` : `Clear ${cost.label}`}
                      title={cost.isCustom ? "Remove this row" : "Clear this heading"}
                      onClick={() => onRemoveCost(cost.key)}
                      style={iconButtonStyle}
                    >
                      <Icon name={cost.isCustom ? "x" : "trash"} size={14} />
                    </button>
                  ) : (
                    <span />
                  )}
                </div>

                {/* The sentences BELOW the row. A table has columns for controls
                    and nowhere to put a sentence about one particular line, so
                    these keep their own space under it. */}
                {cost.derivedFrom && <DerivedDeductionNote rule={cost.derivedFrom} />}
                {cost.readFromDeal ? (
                  <ReadFromDealNote dealNames={cost.readFromDeal.dealNames} />
                ) : (
                  <>
                    <CostBearingNote
                      bearing={cost.bearing ?? { kind: "shared" }}
                      participants={participants}
                      paidBy={cost.paidBy ?? ""}
                    />
                    <DealAssignmentNote
                      link={cost.dealLink ?? { kind: "none" }}
                      dealName={
                        deals.find((deal) => deal.id === linkedDealId(cost.dealLink))?.name ??
                        "this deal"
                      }
                    />
                    <DealFigureDriftWarning warning={dealFigureWarnings[cost.key]} />
                  </>
                )}
              </div>
            ))}
          </div>
          {unusedCostHeadings.length > 0 && onRevealCost && (
            <UnusedCostHeadings rows={unusedCostHeadings} onReveal={onRevealCost} />
          )}
          <div style={{ height: 1, background: "var(--border)", margin: "2px 0" }} />
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={{ color: "var(--text)", fontSize: 13 }}>Payment processing fees</span>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 96 }}>
                <Input
                  value={processingPercent}
                  inputMode="decimal"
                  aria-label="Payment processing percentage"
                  trailing={<span style={{ color: "var(--muted)" }}>%</span>}
                  onChange={(event) => onProcessingPercentChange?.(event.target.value)}
                />
              </div>
              <span style={{ color: "var(--muted)", fontSize: 12 }}>+</span>
              <div style={{ width: 110 }}>
                {readMoneyAs ? (
                  readOnlyFigure(processingFlatPerTicket, "Payment processing amount per ticket")
                ) : (
                  <Input
                    value={processingFlatPerTicket}
                    inputMode="decimal"
                    aria-label="Payment processing amount per ticket"
                    leftIcon={<span style={{ color: "var(--muted)" }}>{currencySymbol}</span>}
                    onChange={(event) => onProcessingFlatPerTicketChange?.(event.target.value)}
                  />
                )}
              </div>
              <span style={{ color: "var(--muted)", fontSize: 12 }}>/ ticket</span>
            </div>
          </div>
          {onAddCustomField && (
            <div style={{ alignSelf: "flex-start" }}>
              <Button
                variant="ghost"
                leftIcon={<Icon name="plus" size={14} />}
                onClick={() => onAddCustomField("cost")}
              >
                Add field
              </Button>
            </div>
          )}
        </Card>
      </div>

      <Card padding="md" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <CardHeading title="Results" subtitle="Live estimate. Review before final decisions." />
        {/* Three across, nine tiles, three full rows — the new prototype's grid.
            The old 4×7 left a short last row BY DESIGN; this one divides evenly,
            so a gap would now read as a missing figure rather than as intent.
            180px is the floor before the grid drops to fewer columns rather than
            crushing them. */}
        <KpiRow items={results} minTileWidth={180} columns={3} />
      </Card>

      <BudgetBreakEvenChart breakEven={breakEven} />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: 14,
          alignItems: "start",
        }}
      >
        <BudgetBreakdownCard
          title="Revenue Sources"
          rows={revenueSources}
          emptyLabel="No revenue data yet"
        />
        <BudgetBreakdownCard
          title="Cost Breakdown"
          rows={costBreakdown}
          emptyLabel="No cost data yet"
        />
      </div>

      {/* FULL WIDTH. It was half a row beside a deliberately empty column
          (handoff §3.8); the new prototype gives it the whole width like every
          other card, and the empty column it was paired with went with it — an
          invisible spacer is a thing to explain rather than a thing to keep. */}
      <PerformingRightsEstimateCard performingRights={performingRights} />
    </div>
  );
}

/**
 * THE STANDING HEADINGS THIS SHOW DOES NOT USE.
 *
 * Reported 2026-08-31: the planner is "too big, too much space". Six headings the
 * sheet always drew, each with a money field, three attribution selects and a
 * note, is most of that — on a show with two real costs, four fifths of the Costs
 * card was scaffolding.
 *
 * They are not deleted and they are not hidden away: they sit here as one wrapped
 * line of chips, and one click puts a heading back as a full row. The reason that
 * is safe is stated where the partition lives (`splitCostRows`) — a heading with
 * no figure has no `budget_lines` row, so there is nothing here for the settlement
 * to read whether it is drawn or not.
 */
/**
 * HOW THE DOOR DIVIDES — one bar per party, and what the operators keep.
 *
 * The only place on the planner that says what a percentage deal actually comes
 * to. Before it, an operator could see a Performer fee of 53 760 and nothing on
 * the screen said it was 70% of the door, what the other 30% was, or who had it.
 *
 * The figures are the settlement engine's own (`useBudgetSeed`), so the bar is a
 * forecast of what will settle rather than a second opinion about it — which is
 * the whole of decision #23 in one block.
 */
function TicketSplitBars({ split }: { split: TicketSplitDisplay }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "12px 14px",
        borderRadius: 11,
        border: "1px solid var(--border)",
        background: "var(--elevated)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <Eyebrow>How ticket revenue splits</Eyebrow>
        {split.badge && (
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 9.5,
              letterSpacing: "1px",
              textTransform: "uppercase",
              color: "#EE5746",
              background: "color-mix(in srgb, #EE5746 12%, transparent)",
              borderRadius: 999,
              padding: "3px 9px",
            }}
          >
            {split.badge}
          </span>
        )}
      </div>

      {split.rows.map((row) => (
        <div key={row.key} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: 10,
            }}
          >
            <span style={{ color: "var(--text)", fontSize: 13, minWidth: 0 }}>
              {row.name}
              <span style={{ color: "var(--muted)", fontSize: 11.5, marginLeft: 7 }}>
                {row.isRemainder ? "what no deal claims" : row.percentLabel}
              </span>
            </span>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 12.5,
                color: "var(--text)",
                fontVariantNumeric: "tabular-nums",
                whiteSpace: "nowrap",
              }}
            >
              <span style={{ color: "var(--muted)", marginRight: 8 }}>{row.percentLabel}</span>
              {row.amount}
            </span>
          </div>
          {/* The track is the whole door, so every bar is read against the same
              width and the shares can be compared by eye. Scaling each to the
              largest would make a 10% line look like a third of the night. */}
          <div style={{ height: 5, borderRadius: 999, background: "var(--border)" }}>
            <div
              style={{
                height: "100%",
                width: `${Math.max(0, Math.min(100, row.widthPercent))}%`,
                borderRadius: 999,
                background: row.color,
              }}
            />
          </div>
        </div>
      ))}

      {split.summary && (
        <span style={{ color: "var(--muted)", fontSize: 12, lineHeight: 1.45 }}>
          {split.summary}
        </span>
      )}
    </div>
  );
}

function UnusedCostHeadings({
  rows,
  onReveal,
}: { rows: { key: string; label: string }[]; onReveal: (key: string) => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      <span style={{ color: "var(--dim)", fontSize: 11.5, lineHeight: 1.45 }}>
        Not budgeted. Nothing is stored for {rows.length === 1 ? "it" : "these"} and the settlement
        never sees {rows.length === 1 ? "it" : "them"} — add {rows.length === 1 ? "it" : "one"} back
        whenever the show needs {rows.length === 1 ? "it" : "one"}.
      </span>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {rows.map((row) => (
          <button
            key={row.key}
            type="button"
            onClick={() => onReveal(row.label)}
            style={headingChipStyle}
          >
            <Icon name="plus" size={11} />
            {row.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * THE ROW SAYS ONE FIGURE, THE DEAL SAYS ANOTHER.
 *
 * A row marked "this IS the deal's figure" is dropped at the settlement boundary
 * — the deal is the authority on what the deal pays — so a row that disagrees
 * with its deal is an operator planning against a number they will not be settled
 * on. The `DealAssignmentNote` above explains that MECHANISM on every such row;
 * this appears only when the two have actually drifted, and names both figures so
 * the operator knows which one wins and what to do about it.
 *
 * A WARNING, NEVER A BLOCK. Nothing here refuses a keystroke or a save: modelling
 * a fee you have not agreed yet is ordinary mid-negotiation work, and a planner
 * that would not let you type it would be worse than one that tells you the deal
 * still says something else.
 *
 * On the row rather than in a banner, and in the house treatment the rest of the
 * app already uses for an inline warning (`EventPublishPanel`'s BlockedNotice):
 * amber tint, amber hairline, the `alert` glyph.
 */
function DealFigureDriftWarning({ warning }: { warning?: DealFigureWarning }) {
  // Absent is the ordinary case — a row that agrees with its deal, or one that
  // names no deal at all — so the nothing-to-say branch lives here rather than as
  // a condition repeated at the call site.
  if (!warning) return null;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 9,
        background: "color-mix(in srgb,var(--brand-amber) 12%,transparent)",
        border: "1px solid color-mix(in srgb,var(--brand-amber) 30%,transparent)",
        borderRadius: 11,
        padding: "10px 13px",
        color: "#c8842f",
        fontSize: 12.5,
        lineHeight: 1.5,
      }}
    >
      <Icon name="alert" size={16} />
      <span>
        This row forecasts <strong>{warning.plannedLabel}</strong>, but “{warning.dealName}” says{" "}
        <strong>{warning.dealLabel}</strong> — and the settlement uses the deal. Change the deal if
        the fee moved, or change this row if it did not.
      </span>
    </div>
  );
}

/**
 * A figure the planner shows but does not own — right-aligned mono, no box.
 *
 * Deliberately NOT a disabled `<Input>`: a greyed-out field says "you may not
 * edit this", and the truth is different — this figure is editable, on the deal.
 * A plain readout carries no promise of a cursor, and the note under it says
 * where to go.
 */
/**
 * Thousands separators for a MAJOR-unit draft string, done on the string.
 *
 * Every other figure on this screen goes through `formatMoney`, which groups —
 * so an ungrouped one beside them reads as a different kind of number. It cannot
 * just call `formatMoney`: that takes MINOR units, and converting a draft string
 * to minor units is exactly the multiply-by-100-through-a-float that was losing
 * money here until this session (`Math.round(Number("4.015") * 100)` is 401).
 * Grouping the integer part textually needs no arithmetic at all, so there is
 * nothing to get wrong.
 */
function groupDigits(value: string): string {
  const [whole = "", fraction] = value.split(".");
  const sign = whole.startsWith("-") ? "-" : "";
  const digits = sign ? whole.slice(1) : whole;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction === undefined ? `${sign}${grouped}` : `${sign}${grouped}.${fraction}`;
}

function readOnlyMoney(value: string, currencySymbol: string, label?: string) {
  return readOnlyMoneyText(value === "" ? "—" : `${currencySymbol} ${groupDigits(value)}`, label);
}

/**
 * The same readout, given text that is already formatted.
 *
 * A currency peek arrives here with a string from `formatMoney` — grouped,
 * symbol placed, in a currency this component never has to know about — so it has
 * nothing left to compose. Sharing the presentation is the point: a peeked figure
 * has to look like the figures it sits beside, and a second hand-rolled money
 * style is exactly the divergence that drifts.
 *
 * `label` names it for assistive technology, because during a peek this replaces
 * an `<Input>` that had an `aria-label`, and a row of six unnamed numbers is
 * worse than a row of six named fields.
 */
function readOnlyMoneyText(text: string, label?: string) {
  return (
    <span
      aria-label={label}
      style={{
        width: 120,
        flexShrink: 0,
        textAlign: "right",
        fontFamily: "var(--font-mono)",
        fontSize: 13,
        color: "var(--text)",
        paddingRight: 2,
      }}
    >
      {text}
    </span>
  );
}

/**
 * Where a read-only cost figure comes from, and how to change it.
 *
 * Named in full, and named per deal: a bill with a headliner and a support act
 * shows one "Performer fee" row, and the operator has to be able to see which
 * agreements it adds up.
 */
/**
 * WHAT A DERIVED ROW IS A SHARE OF — said on the row, in the rule's own terms.
 *
 * Without it the sheet shows a figure nobody typed, in a box nobody can edit, and
 * the only way to find out where it came from is to delete it. Naming the rule is
 * also what makes it checkable: *"10% of Merchandise"* beside SEK 1 000 is a
 * statement a reader can disagree with.
 *
 * `ofLabel` is the rule's own stored copy of the name rather than a lookup, so a
 * row whose base has since been deleted still says what it was a share of.
 */
function DerivedDeductionNote({ rule }: { rule: DerivedDeductionRule }) {
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
      {/* `link`, not a percent glyph — the design system has no percent icon, and
          this note means the same thing `DealAssignmentNote` does with the same
          icon: this row's figure is tied to something else on the page. Adding an
          icon to the system to say "percent" when the sentence already says it
          would be a token invented at a call site. */}
      <Icon name="link" size={12} />
      {formatBasisPoints(rule.basisPoints)} of {rule.ofLabel}, kept in step with it.
    </div>
  );
}

/** "10%", "12.5%" — trailing zeros trimmed, because 10.00% reads as a setting. */
function formatBasisPoints(basisPoints: number): string {
  const percent = basisPoints / 100;
  return `${Number.isInteger(percent) ? percent : Number(percent.toFixed(2))}%`;
}

function ReadFromDealNote({ dealNames }: { dealNames: string[] }) {
  const quoted = dealNames.map((name) => `“${name}”`);
  const named =
    quoted.length > 1
      ? `${quoted.slice(0, -1).join(", ")} and ${quoted[quoted.length - 1]}`
      : (quoted[0] ?? "the deal");
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
      Read from {dealNames.length > 1 ? "the deals" : "the deal"} {named}. Nothing is stored on the
      budget, so the settlement takes {dealNames.length > 1 ? "these figures" : "this figure"} from
      the {dealNames.length > 1 ? "deals" : "deal"} — change it there.
    </div>
  );
}

const sectionHeadingStyle = {
  fontFamily: "var(--font-display)",
  fontWeight: 600,
  // 17px, up from 14. Measured off the prototype
  // (design-spec-budget-planner-2026-09-13.md): its cards ANNOUNCE themselves in
  // Clash Display, where ours whispered in a small mono eyebrow. Of everything
  // that separated the two screens side by side, this was the largest.
  fontSize: 17,
  color: "var(--text)",
  margin: 0,
} as const;

/**
 * A card's heading and the sentence that says what the card is for.
 *
 * The subtitle is not decoration: each one answers the question an operator opens
 * the card with — "what does this card want from me?" — in the designer's own
 * words. `Costs` saying *"Each cost says who paid it, and who carries it at
 * settlement"* is the whole cost/deduction distinction in one line, which is what
 * the meeting asked for after the old UI made it confusing.
 */
function CardHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
      <h4 style={sectionHeadingStyle}>{title}</h4>
      {subtitle && (
        <span style={{ color: "var(--muted)", fontSize: 12.5, lineHeight: 1.4 }}>{subtitle}</span>
      )}
    </div>
  );
}

const headingChipStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  fontSize: 12,
  padding: "5px 10px",
  borderRadius: 999,
  border: "1px dashed var(--border)",
  background: "transparent",
  color: "var(--muted)",
  cursor: "pointer",
} as const;

const iconButtonStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 30,
  height: 30,
  border: "none",
  borderRadius: 8,
  background: "transparent",
  color: "var(--muted)",
  cursor: "pointer",
} as const;
