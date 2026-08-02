import type { schema } from "@showme/db";

type BudgetRow = typeof schema.budgets.$inferSelect;
type BudgetLineRow = typeof schema.budgetLines.$inferSelect;

/**
 * A budget line at the JSON boundary. `amount` is bigint minor units in the DB
 * (money.md) and MUST cross the wire as a STRING — a JS number silently loses
 * precision past 2^53. This serializer is the single place that conversion lives.
 */
export interface SerializedBudgetLine {
  id: string;
  budgetId: string;
  kind: string;
  source: string;
  providerRef: string | null;
  label: string;
  amount: string;
  currency: string | null;
  collectedBy: string | null;
  paidBy: string | null;
  payeeParticipantId: string | null;
  dealId: string | null;
  version: number;
}

export interface SerializedBudget {
  id: string;
  eventId: string;
  scope: string;
  ownerProfileId: string | null;
  version: number;
  lines: SerializedBudgetLine[];
}

/** Shape one budget line for JSON — bigint amount → string. */
export function serializeBudgetLine(line: BudgetLineRow): SerializedBudgetLine {
  return {
    id: line.id,
    budgetId: line.budgetId,
    kind: line.kind,
    source: line.source,
    providerRef: line.providerRef,
    label: line.label,
    amount: line.amount.toString(),
    currency: line.currency,
    collectedBy: line.collectedBy,
    paidBy: line.paidBy,
    payeeParticipantId: line.payeeParticipantId,
    dealId: line.dealId,
    version: line.version,
  };
}

/** Shape one budget with its lines for JSON. */
export function serializeBudget(budget: BudgetRow, lines: BudgetLineRow[]): SerializedBudget {
  return {
    id: budget.id,
    eventId: budget.eventId,
    scope: budget.scope,
    ownerProfileId: budget.ownerProfileId,
    version: budget.version,
    lines: lines.map(serializeBudgetLine),
  };
}
