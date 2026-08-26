import type { schema } from "@showme/db";

type BudgetRow = typeof schema.budgets.$inferSelect;
type BudgetLineRow = typeof schema.budgetLines.$inferSelect;

/**
 * Which of the planner's fields produced a line. Carried in the data rather than
 * inferred from the label, so renaming a tier cannot silently turn it into the bar
 * estimate (or the sponsorship into a ticket type).
 */
export type BudgetLineBasis = "ticket_tier" | "bar_spend" | "other_revenue";

const LINE_BASES: BudgetLineBasis[] = ["ticket_tier", "bar_spend", "other_revenue"];

/**
 * The unit x quantity breakdown the planner used to arrive at a line's `amount`.
 * Stored as `jsonb`, so it is `unknown` coming out of the driver and narrowed
 * here — the one place the shape is asserted.
 */
export interface BudgetLineDetails {
  basis: BudgetLineBasis;
  unitAmount: string;
  quantity: number;
}

function budgetLineDetails(value: unknown): BudgetLineDetails | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.unitAmount !== "string" || typeof candidate.quantity !== "number") {
    return null;
  }
  // A row written before `basis` existed is a ticket tier — that was the only
  // breakdown the planner could produce at the time.
  const basis = LINE_BASES.find((known) => known === candidate.basis) ?? "ticket_tier";
  return { basis, unitAmount: candidate.unitAmount, quantity: candidate.quantity };
}

/**
 * The planner's standing assumptions (migration 0015). Rates, never amounts: the
 * money is derived at render time by `computeBudgetProjection()` and never stored,
 * so nothing downstream can read a stored guess as a settled figure.
 *
 * `jsonb`, so it arrives as `unknown` from the driver and is narrowed here — the
 * one place the shape is asserted, and the reason a hand-edited row cannot crash
 * the planner: anything that does not fit comes back as `null`.
 */
export interface BudgetPlanningAssumptions {
  paymentProcessing: {
    /** Basis points of ticket revenue (money.md) — 150 = 1.50%. */
    percentBasisPoints: number;
    /** Minor units per ticket SOLD, as a string (money.md's JSON boundary). */
    flatPerTicket: string;
  } | null;
}

function budgetPlanningAssumptions(value: unknown): BudgetPlanningAssumptions | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = (value as Record<string, unknown>).paymentProcessing;
  if (typeof candidate !== "object" || candidate === null) return null;
  const { percentBasisPoints, flatPerTicket } = candidate as Record<string, unknown>;
  if (typeof percentBasisPoints !== "number" || typeof flatPerTicket !== "string") return null;
  return { paymentProcessing: { percentBasisPoints, flatPerTicket } };
}

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
  details: BudgetLineDetails | null;
  version: number;
}

export interface SerializedBudget {
  id: string;
  eventId: string;
  scope: string;
  ownerProfileId: string | null;
  planningAssumptions: BudgetPlanningAssumptions | null;
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
    details: budgetLineDetails(line.details),
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
    planningAssumptions: budgetPlanningAssumptions(budget.planningAssumptions),
    version: budget.version,
    lines: lines.map(serializeBudgetLine),
  };
}
