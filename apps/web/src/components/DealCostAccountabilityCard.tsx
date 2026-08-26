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
 * Two rules it keeps rather than re-implements:
 *
 * - **The budget is operator-only.** `budget.view` is a ceiling in the auth
 *   engine, so the query is not even issued without it and the card renders
 *   nothing. A performer on the Deals tab sees their agreement and no figures.
 * - **A cost booked to a deal is that deal's own money.** The settlement takes
 *   the figure from the agreement and drops the line at the engine boundary
 *   (`routes/settlement.ts`), so these totals are a forecast of what the deal
 *   pays — never a second cost on top of it. The caption says so.
 */
export interface DealCostAccountabilityCardProps {
  eventId: string;
  /** The caller's effective capabilities — `budget.view` gates the whole card. */
  capabilities: readonly string[];
  /** The agreements on this event, so an assigned cost can be named. */
  deals: { id: string; name: string }[];
  currency: string;
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

  const assigned = (budgets.data ?? [])
    .flatMap((budget) => budget.lines)
    .filter((line) => line.kind === "cost" && line.dealId);

  if (assigned.length === 0) return null;

  const totalsByDeal = new Map<string, bigint>();
  for (const line of assigned) {
    const dealId = line.dealId as string;
    totalsByDeal.set(dealId, (totalsByDeal.get(dealId) ?? 0n) + BigInt(line.amount));
  }

  return (
    <Card padding="lg" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Eyebrow>Costs booked against agreements</Eyebrow>
      {deals
        .filter((deal) => totalsByDeal.has(deal.id))
        .map((deal) => (
          <div key={deal.id} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <KeyValueRow
              label={deal.name}
              value={formatMoney((totalsByDeal.get(deal.id) ?? 0n).toString(), currency)}
              mono
              total
            />
            {assigned
              .filter((line) => line.dealId === deal.id)
              .map((line) => (
                <KeyValueRow
                  key={line.id}
                  label={line.label}
                  value={formatMoney(line.amount, currency)}
                  mono
                />
              ))}
          </div>
        ))}
      <span
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          color: "var(--dim)",
          fontSize: 12,
          lineHeight: 1.45,
        }}
      >
        <Icon name="link" size={13} />
        These are the planner's forecast of what each agreement pays. The settlement takes the
        figure from the agreement itself, so nothing here is counted twice.
      </span>
    </Card>
  );
}
