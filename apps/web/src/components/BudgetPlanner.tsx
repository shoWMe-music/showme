import { Button, Card, Icon, type IconName, Input, KeyValueRow } from "@showme/design-system";
import { BudgetBreakEvenChart } from "./BudgetBreakEvenChart";
import { BudgetBreakdownCard } from "./BudgetBreakdownCard";
import { CostAttribution, DealAssignmentNote, RevenueAttribution } from "./BudgetLineAttribution";
import { type KpiItem, KpiRow } from "./KpiRow";
import { PerformingRightsEstimateCard } from "./PerformingRightsEstimateCard";
import type {
  BreakEvenDisplay,
  BreakdownDisplayRow,
  PerformingRightsDisplay,
} from "./budgetPlannerView";
import { Eyebrow } from "./primitives";
import type { BudgetAttributionOption, BudgetDealOption, CostBearing } from "./useBudgetEditor";

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
  /** Printed as the row's pill. Custom rows only. */
  type?: "manual" | "per_guest";
  /** Who fronted the cash; "" falls back to the planning operator. */
  paidBy?: string;
  /** Who ultimately carries it — shared, one bearer, or a split. */
  bearing?: CostBearing;
  /** The agreement this cost is booked against, or "". */
  dealId?: string;
}

/** A free-form revenue row the operator named ("+ Add Field"). */
export interface CustomRevenueRow {
  id: string;
  label: string;
  value: string;
  type?: "manual" | "per_guest";
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
  onCostDealChange?: (key: string, dealId: string) => void;
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
  onCostDealChange,
  onEditCostSplit,
  onTicketChange,
  onAddTicketType,
  onRemoveTicketType,
  onCapacityChange,
  onAvgBarSpendChange,
  onOtherRevenueChange,
  onCostChange,
  onRemoveCost,
  onCustomRevenueChange,
  onRemoveCustomRevenue,
  onAddCustomField,
  onProcessingPercentChange,
  onProcessingFlatPerTicketChange,
}: BudgetPlannerProps) {
  // `label` names the field for assistive technology (and for a test that has to
  // pick one row of ten). The rows print their heading as plain text beside the
  // input, which the browser does not connect to it — and now that each row also
  // carries three attribution selects, an unnamed money field is the only control
  // on the row with nothing to call it.
  const money = (value: string, onChange?: (value: string) => void, label?: string) => (
    <div style={{ width: 130 }}>
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
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Card
        padding="md"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          background: "rgba(244,160,70,.12)",
        }}
      >
        <span style={{ color: "#F4A046", display: "inline-flex" }}>
          <Icon name="alert" size={18} />
        </span>
        <span style={{ color: "var(--text)", fontSize: 13 }}>{advisory}</span>
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
          gap: 16,
        }}
      >
        <Card padding="lg" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Eyebrow style={{ color: "#6FC97A" }}>Revenue</Eyebrow>
          <Eyebrow>Ticket revenue</Eyebrow>
          {ticketTypes.map((ticket) => (
            <div key={ticket.id} style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ flex: 1 }}>
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
                <div style={{ width: 80 }}>
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
            <span style={{ flex: 1, color: "var(--text)", fontSize: 14 }}>Capacity</span>
            <div style={{ width: 130 }}>
              <Input
                value={capacity}
                inputMode="numeric"
                onChange={(event) => onCapacityChange?.(event.target.value)}
              />
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ flex: 1, color: "var(--text)", fontSize: 14 }}>
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
            <span style={{ flex: 1, color: "var(--text)", fontSize: 14 }}>Other revenue</span>
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
            <div key={row.id} style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ flex: 1, color: "var(--text)", fontSize: 14 }}>{row.label}</span>
                <span style={typePillStyle}>{typeLabel(row.type)}</span>
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

        <Card padding="lg" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Eyebrow style={{ color: "#EE5746" }}>Costs</Eyebrow>
          {costs.map((cost) => (
            <div key={cost.key} style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ flex: 1, color: "var(--text)", fontSize: 14 }}>{cost.label}</span>
                {/* Only a custom row is typed and removable — the six standing
                  headings are fixed, because the screen promises to show them. */}
                {cost.isCustom && <span style={typePillStyle}>{typeLabel(cost.type)}</span>}
                {money(
                  cost.value,
                  (value) => onCostChange?.(cost.key, value),
                  `${cost.label} amount`,
                )}
                {cost.isCustom && onRemoveCost && (
                  <button
                    type="button"
                    aria-label={`Remove ${cost.label}`}
                    onClick={() => onRemoveCost(cost.key)}
                    style={iconButtonStyle}
                  >
                    <Icon name="x" size={14} />
                  </button>
                )}
              </div>
              <CostAttribution
                participants={participants}
                deals={deals}
                paidBy={cost.paidBy ?? ""}
                fallbackParticipantId={defaultParticipantId}
                bearing={cost.bearing ?? { kind: "shared" }}
                dealId={cost.dealId ?? ""}
                onPaidByChange={(participantId) => onCostPaidByChange?.(cost.key, participantId)}
                onBearingChange={(bearing) => onCostBearingChange?.(cost.key, bearing)}
                onEditSplit={() => onEditCostSplit?.(cost.key)}
                onDealChange={(dealId) => onCostDealChange?.(cost.key, dealId)}
                rowLabel={cost.label}
              />
              {cost.dealId && (
                <DealAssignmentNote
                  dealName={deals.find((deal) => deal.id === cost.dealId)?.name ?? "this agreement"}
                />
              )}
            </div>
          ))}
          <div style={{ height: 1, background: "var(--border)", margin: "4px 0" }} />
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

      <Card padding="lg" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
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
          gap: 16,
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
          gap: 16,
          alignItems: "start",
        }}
      >
        <PerformingRightsEstimateCard performingRights={performingRights} />
        <div aria-hidden />
      </div>
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

/** What a custom row's pill prints — the `type` of the handoff's `{name, type, amount}`. */
function typeLabel(type: "manual" | "per_guest" | undefined): string {
  return type === "per_guest" ? "Per guest" : "Manual";
}

/** The prototype's small uppercase pill on a custom row. */
const typePillStyle = {
  fontFamily: "var(--font-mono)",
  fontSize: 9,
  padding: "2px 7px",
  borderRadius: 999,
  background: "var(--elevated)",
  color: "var(--muted)",
  textTransform: "uppercase",
  letterSpacing: ".08em",
  whiteSpace: "nowrap",
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
