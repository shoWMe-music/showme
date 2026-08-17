import { Button, Card, Icon, Input, KeyValueRow } from "@showme/design-system";
import { type KpiItem, KpiRow } from "./KpiRow";
import { Eyebrow } from "./primitives";

/** The Budget Planner (§3b, shot 04): a KPI band over a two-column
 * revenue/costs live-recompute editor. Presentational — every figure is a
 * controlled field and totals are computed by the screen (math lives in
 * framework-agnostic TS per CLAUDE.md); this component only renders + emits. */
export interface TicketTypeRow {
  id: string;
  name: string;
  /** Controlled price (string). */
  price: string;
  /** Controlled quantity (string). */
  quantity: string;
}

export interface CostRow {
  key: string;
  label: string;
  value: string;
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
  costs: CostRow[];
  currencySymbol?: string;
  advisory?: string;
  onTicketChange?: (id: string, field: "name" | "price" | "quantity", value: string) => void;
  onAddTicketType?: () => void;
  onRemoveTicketType?: (id: string) => void;
  onCapacityChange?: (value: string) => void;
  onAvgBarSpendChange?: (value: string) => void;
  onCostChange?: (key: string, value: string) => void;
}

export function BudgetPlanner({
  kpis,
  ticketTypes,
  ticketRevenueTotal,
  capacity,
  avgBarSpend,
  barRevenue,
  costs,
  currencySymbol = "€",
  advisory = "This is an estimate only and should be reviewed before final decisions.",
  onTicketChange,
  onAddTicketType,
  onRemoveTicketType,
  onCapacityChange,
  onAvgBarSpendChange,
  onCostChange,
}: BudgetPlannerProps) {
  const money = (value: string, onChange?: (value: string) => void) => (
    <div style={{ width: 130 }}>
      <Input
        value={value}
        inputMode="decimal"
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
            <div key={ticket.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ flex: 1 }}>
                <Input
                  value={ticket.name}
                  placeholder="Ticket type"
                  onChange={(event) => onTicketChange?.(ticket.id, "name", event.target.value)}
                />
              </div>
              {money(ticket.price, (value) => onTicketChange?.(ticket.id, "price", value))}
              <div style={{ width: 80 }}>
                <Input
                  value={ticket.quantity}
                  inputMode="numeric"
                  placeholder="Qty"
                  onChange={(event) => onTicketChange?.(ticket.id, "quantity", event.target.value)}
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
              Avg bar spend / guest
            </span>
            {money(avgBarSpend, onAvgBarSpendChange)}
          </div>
          <KeyValueRow label="Bar revenue" value={barRevenue} mono valueColor="#6FC97A" />
        </Card>

        <Card padding="lg" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Eyebrow style={{ color: "#EE5746" }}>Costs</Eyebrow>
          {costs.map((cost) => (
            <div key={cost.key} style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ flex: 1, color: "var(--text)", fontSize: 14 }}>{cost.label}</span>
              {money(cost.value, (value) => onCostChange?.(cost.key, value))}
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}

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
