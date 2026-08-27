import { useGetApiV1EventsIdBudgets } from "@showme/api-client";
import { Card, Icon, KeyValueRow } from "@showme/design-system";
import { formatMoney } from "../lib/format";
import { Eyebrow } from "./primitives";

/**
 * WHAT EACH AGREEMENT COSTS — the accountability half of the 2026-08 settlements
 * meeting's *"all project costs to be assigned to specific deals, creating
 * accountability for each agreement."*
 *
 * The assignment itself is made in the Budget Planner (a "Deal" selector on every
 * cost row); this is where it is read back, on the tab that owns agreements. One
 * card for the whole event rather than a strip inside each agreement card,
 * because the question an operator actually asks is comparative — *which* of
 * these deals is carrying the production cost.
 *
 * IT SHOWS BOTH SENSES, SEPARATELY, BECAUSE THEY ARE OPPOSITE FACTS ABOUT THE
 * MONEY. The card used to read `deal_id` only — the forecast column — while
 * calling itself accountability and quoting the meeting at the top. So the one
 * thing the meeting asked for, real costs booked under an agreement
 * (`attributed_deal_id`), was writable in the planner and readable nowhere, and
 * the figure that WAS shown was a forecast dressed as a cost. Read the two-column
 * note on `budget_lines` (`packages/db/src/schema/settlement.ts`): the difference
 * is the operator's residual moving by the whole line, so a card that adds them
 * into one total is worse than one that shows neither.
 *
 * Two rules it keeps rather than re-implements:
 *
 * - **The budget is operator-only.** `budget.view` is a ceiling in the auth
 *   engine, so the query is not even issued without it and the card renders
 *   nothing. A performer on the Deals tab sees their agreement and no figures.
 * - **The settlement decides what counts, not this card.** A `deal_id` line is
 *   dropped at the engine boundary (`routes/settlement.ts`) and an
 *   `attributed_deal_id` line is ordinary external cash the engine never looks at
 *   twice. Each group says which it is, in the words that describe the money.
 */
export interface DealCostAccountabilityCardProps {
  eventId: string;
  /** The caller's effective capabilities — `budget.view` gates the whole card. */
  capabilities: readonly string[];
  /** The agreements on this event, so an assigned cost can be named. */
  deals: { id: string; name: string }[];
  currency: string;
}

/** One cost line, reduced to what this card prints. */
interface AssignedLine {
  id: string;
  label: string;
  amount: string;
}

/**
 * What one agreement carries, split by which sense of "names a deal" it is.
 *
 * There is deliberately NO combined total. Adding a real cost to a forecast
 * produces a figure that is true of nothing: one is money the night spends, the
 * other is money the settlement takes from the deal instead of from the budget.
 * Each group totals itself, and the reader is never handed a sum of the two.
 */
interface DealCosts {
  /** Real third-party costs reported under the deal — they lower the pool. */
  reported: AssignedLine[];
  reportedTotal: bigint;
  /** Rows the planner marks as the deal's OWN figure — a forecast, never cash. */
  planned: AssignedLine[];
  plannedTotal: bigint;
}

/**
 * Group the event's cost lines by the deal they name and the sense they name it
 * in. A plain function so the component below renders and derives nothing
 * (CLAUDE.md).
 */
function costsByDeal(
  lines: {
    id: string;
    kind: string;
    label: string;
    amount: string;
    dealId?: string | null;
    attributedDealId?: string | null;
  }[],
): Map<string, DealCosts> {
  const grouped = new Map<string, DealCosts>();
  const entryFor = (dealId: string) => {
    const existing = grouped.get(dealId);
    if (existing) return existing;
    const fresh: DealCosts = {
      reported: [],
      reportedTotal: 0n,
      planned: [],
      plannedTotal: 0n,
    };
    grouped.set(dealId, fresh);
    return fresh;
  };

  for (const line of lines) {
    if (line.kind !== "cost") continue;
    const entry = { id: line.id, label: line.label, amount: line.amount };
    if (line.attributedDealId) {
      const target = entryFor(line.attributedDealId);
      target.reported.push(entry);
      target.reportedTotal += BigInt(line.amount);
    } else if (line.dealId) {
      const target = entryFor(line.dealId);
      target.planned.push(entry);
      target.plannedTotal += BigInt(line.amount);
    }
  }
  return grouped;
}

export function DealCostAccountabilityCard({
  eventId,
  capabilities,
  deals,
  currency,
}: DealCostAccountabilityCardProps) {
  const canSeeBudget = capabilities.includes("budget.view");
  const budgets = useGetApiV1EventsIdBudgets(eventId, { query: { enabled: canSeeBudget } });

  if (!canSeeBudget || deals.length === 0) return null;

  const grouped = costsByDeal((budgets.data ?? []).flatMap((budget) => budget.lines));
  const shown = deals.filter((deal) => grouped.has(deal.id));
  if (shown.length === 0) return null;

  return (
    <Card padding="lg" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Eyebrow>Costs booked against agreements</Eyebrow>
      {shown.map((deal) => {
        const costs = grouped.get(deal.id) as DealCosts;
        return (
          <div key={deal.id} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={{ color: "var(--text)", fontSize: 14 }}>{deal.name}</span>
            <AssignedGroup
              caption="Real costs reported under it — these lower the settlement pool"
              lines={costs.reported}
              total={costs.reportedTotal}
              currency={currency}
            />
            <AssignedGroup
              caption="The agreement's own figure, as planned — the settlement takes it from the deal"
              lines={costs.planned}
              total={costs.plannedTotal}
              currency={currency}
            />
          </div>
        );
      })}
      <span
        style={{
          display: "flex",
          gap: 6,
          color: "var(--dim)",
          fontSize: 12,
          lineHeight: 1.45,
        }}
      >
        <Icon name="link" size={13} />
        Assigned on each cost row in the Budget Planner. A cost reported under an agreement is real
        money the night spends; the agreement's own figure is a forecast the settlement replaces
        with what the deal actually pays, so it is never counted twice.
      </span>
    </Card>
  );
}

/** One labelled group of assigned lines and its own total, or nothing when empty. */
function AssignedGroup({
  caption,
  lines,
  total,
  currency,
}: { caption: string; lines: AssignedLine[]; total: bigint; currency: string }) {
  if (lines.length === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 9.5,
          letterSpacing: ".08em",
          textTransform: "uppercase",
          color: "var(--dim)",
        }}
      >
        {caption}
      </span>
      {lines.map((line) => (
        <KeyValueRow
          key={line.id}
          label={line.label}
          value={formatMoney(line.amount, currency)}
          mono
        />
      ))}
      <KeyValueRow label="Total" value={formatMoney(total.toString(), currency)} mono total />
    </div>
  );
}
