import { Button, Card, Icon, type IconName, Input, KeyValueRow } from "@showme/design-system";
import { BudgetBreakEvenChart } from "./BudgetBreakEvenChart";
import { BudgetBreakdownCard } from "./BudgetBreakdownCard";
import {
  CostAttribution,
  CostAttributionLegend,
  DealAssignmentNote,
  RevenueAttribution,
} from "./BudgetLineAttribution";
import { type KpiItem, KpiRow } from "./KpiRow";
import { PerformingRightsEstimateCard } from "./PerformingRightsEstimateCard";
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
  capacity: string;
  avgBarSpend: string;
  /** Computed bar revenue, formatted. */
  barRevenue: string;
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
  /** Who receives the bar take / "Other revenue". */
  barCollectedBy?: string;
  otherRevenueCollectedBy?: string;
  onBarCollectedByChange?: (participantId: string) => void;
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
  capacity,
  avgBarSpend,
  barRevenue,
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
  advisory = "This is an estimate only and should be reviewed before final decisions.",
  participants = [],
  deals = [],
  defaultParticipantId = null,
  barCollectedBy = "",
  otherRevenueCollectedBy = "",
  onBarCollectedByChange,
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
  const money = (value: string, onChange?: (value: string) => void, label?: string) => (
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

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: 14,
          /*
           * EACH COLUMN IS AS TALL AS ITS OWN CONTENT.
           *
           * A grid item stretches to the row's height by default, so the shorter
           * card — Revenue, which has four headings to Costs' six plus three
           * selects apiece — was padded out to match. Measured on the seeded
           * event: ~400px of empty card under "Add field", which is most of
           * *"budget planner: too big / too much whitespace"* (ClickUp
           * 86cbcn1ue) on its own.
           *
           * The Results grid below already does this (`alignItems: "start"`);
           * this one was the outlier, not the precedent.
           */
          alignItems: "start",
        }}
      >
        <Card padding="md" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Eyebrow style={{ color: "#6FC97A" }}>Revenue</Eyebrow>
          <Eyebrow>Ticket revenue</Eyebrow>
          {ticketTypes.map((ticket) => (
            <div key={ticket.id} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {/* Wraps rather than crushing: at 390px a fixed price field, a
                  quantity field and a delete button leave the NAME about 60px,
                  which is not a field. `flex: 1 1 140px` lets the name take the
                  first line on its own and the figures drop under it. */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <div style={{ flex: "1 1 140px", minWidth: 0 }}>
                  <Input
                    value={ticket.name}
                    placeholder="Ticket type"
                    onChange={(event) => onTicketChange?.(ticket.id, "name", event.target.value)}
                  />
                </div>
                {money(
                  ticket.price,
                  (value) => onTicketChange?.(ticket.id, "price", value),
                  `${ticket.name || "Ticket type"} price`,
                )}
                <div style={{ width: 76, flexShrink: 0 }}>
                  <Input
                    value={ticket.quantity}
                    inputMode="numeric"
                    placeholder="Qty"
                    onChange={(event) =>
                      onTicketChange?.(ticket.id, "quantity", event.target.value)
                    }
                  />
                </div>
                {onRemoveTicketType && (
                  <button
                    type="button"
                    aria-label="Remove ticket type"
                    onClick={() => onRemoveTicketType(ticket.id)}
                    style={iconButtonStyle}
                  >
                    <Icon name="trash" size={15} />
                  </button>
                )}
              </div>
              <RevenueAttribution
                participants={participants}
                value={ticket.collectedBy ?? ""}
                fallbackParticipantId={defaultParticipantId}
                onChange={(participantId) =>
                  onTicketChange?.(ticket.id, "collectedBy", participantId)
                }
                rowLabel={ticket.name || "this ticket type"}
              />
            </div>
          ))}
          <KeyValueRow
            label="Total ticket revenue"
            value={ticketRevenueTotal}
            mono
            valueColor="#6FC97A"
          />
          {onAddTicketType && (
            <Button
              variant="ghost"
              leftIcon={<Icon name="plus" size={14} />}
              onClick={onAddTicketType}
            >
              Add ticket type
            </Button>
          )}
          <div style={{ height: 1, background: "var(--border)", margin: "4px 0" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ flex: 1, minWidth: 0, color: "var(--text)", fontSize: 14 }}>
              Capacity
            </span>
            <div style={{ width: 120, flexShrink: 0 }}>
              <Input
                value={capacity}
                inputMode="numeric"
                onChange={(event) => onCapacityChange?.(event.target.value)}
              />
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ flex: 1, minWidth: 0, color: "var(--text)", fontSize: 14 }}>
              Average bar spend per guest
            </span>
            {money(avgBarSpend, onAvgBarSpendChange, "Average bar spend per guest")}
          </div>
          <KeyValueRow label="Bar revenue" value={barRevenue} mono valueColor="#6FC97A" />
          <RevenueAttribution
            participants={participants}
            value={barCollectedBy}
            fallbackParticipantId={defaultParticipantId}
            onChange={(participantId) => onBarCollectedByChange?.(participantId)}
            rowLabel="bar revenue"
          />
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ flex: 1, minWidth: 0, color: "var(--text)", fontSize: 14 }}>
              Other revenue
            </span>
            {money(otherRevenue, onOtherRevenueChange, "Other revenue")}
          </div>
          <RevenueAttribution
            participants={participants}
            value={otherRevenueCollectedBy}
            fallbackParticipantId={defaultParticipantId}
            onChange={(participantId) => onOtherRevenueCollectedByChange?.(participantId)}
            rowLabel="other revenue"
          />
          {customRevenue.map((row) => (
            <div key={row.id} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ flex: 1, minWidth: 0, color: "var(--text)", fontSize: 14 }}>
                  {row.label}
                </span>
                {money(
                  row.value,
                  (value) => onCustomRevenueChange?.(row.id, value),
                  `${row.label} amount`,
                )}
                {onRemoveCustomRevenue && (
                  <button
                    type="button"
                    aria-label={`Remove ${row.label}`}
                    onClick={() => onRemoveCustomRevenue(row.id)}
                    style={iconButtonStyle}
                  >
                    <Icon name="x" size={14} />
                  </button>
                )}
              </div>
              <RevenueAttribution
                participants={participants}
                value={row.collectedBy ?? ""}
                fallbackParticipantId={defaultParticipantId}
                onChange={(participantId) =>
                  onCustomRevenueCollectedByChange?.(row.id, participantId)
                }
                rowLabel={row.label}
              />
            </div>
          ))}
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
          <Eyebrow style={{ color: "#EE5746" }}>Costs</Eyebrow>
          <CostAttributionLegend />
          {budgetedCosts.map((cost) => (
            <div key={cost.key} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ flex: 1, minWidth: 0, color: "var(--text)", fontSize: 14 }}>
                  {cost.label}
                </span>
                {cost.readFromDeal
                  ? readOnlyMoney(cost.value, currencySymbol)
                  : money(
                      cost.value,
                      (value) => onCostChange?.(cost.key, value),
                      `${cost.label} amount`,
                    )}
                {/*
                 * EVERY COST ROW CAN NOW BE CLEARED — the reported gap ("no
                 * delete buttons") was that three of the five row kinds had one.
                 *
                 * The two verbs stay different because the two rows are. A
                 * CUSTOM row is the operator's own invention: removing it deletes
                 * it outright, and nothing brings it back but typing it again. A
                 * STANDING heading is one of the six the sheet always offers:
                 * clearing it deletes the `budget_lines` row behind it and the
                 * heading drops back into "Not budgeted" below, one click from
                 * returning. That is why the old comment's objection — "the
                 * operator would have no way to get it back" — no longer applies.
                 *
                 * Offered only for a heading that HAS a stored line. A heading
                 * showing a figure it read from a deal (the rental seeded into
                 * "Venue cost", the guarantee in "Performer fee") owns nothing to
                 * delete; that figure is changed on the deal, which the note under
                 * the row already says.
                 */}
                {!cost.readFromDeal && onRemoveCost && !cost.key.startsWith(NEW_ROW_PREFIX) && (
                  <button
                    type="button"
                    aria-label={cost.isCustom ? `Remove ${cost.label}` : `Clear ${cost.label}`}
                    title={cost.isCustom ? "Remove this row" : "Clear this heading"}
                    onClick={() => onRemoveCost(cost.key)}
                    style={iconButtonStyle}
                  >
                    <Icon name={cost.isCustom ? "x" : "trash"} size={14} />
                  </button>
                )}
              </div>
              {cost.readFromDeal ? (
                <ReadFromDealNote dealNames={cost.readFromDeal.dealNames} />
              ) : (
                <>
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
                <Input
                  value={processingFlatPerTicket}
                  inputMode="decimal"
                  aria-label="Payment processing amount per ticket"
                  leftIcon={<span style={{ color: "var(--muted)" }}>{currencySymbol}</span>}
                  onChange={(event) => onProcessingFlatPerTicketChange?.(event.target.value)}
                />
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
        <h4 style={sectionHeadingStyle}>Results</h4>
        {/* Four across, so the seven tiles leave a short last row — that is the
            design, not an accident (handoff §3.5). 180px is the floor before the
            grid drops to fewer columns rather than crushing them. */}
        <KpiRow items={results} minTileWidth={180} columns={4} valueFontSize={24} />
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

      {/* Half-width, paired with a deliberately EMPTY column (handoff §3.8) — the
          estimate is advisory and the design gives it the weight of half a row,
          not the full width a card with no neighbour would otherwise take. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))",
          gap: 14,
          alignItems: "start",
        }}
      >
        <PerformingRightsEstimateCard performingRights={performingRights} />
        <div aria-hidden />
      </div>
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

function readOnlyMoney(value: string, currencySymbol: string) {
  return (
    <span
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
      {value === "" ? "—" : `${currencySymbol} ${groupDigits(value)}`}
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
  fontSize: 14,
  color: "var(--text)",
  margin: 0,
} as const;

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
