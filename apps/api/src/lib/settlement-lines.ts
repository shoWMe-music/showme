import { type Database, schema } from "@showme/db";
import { and, eq } from "drizzle-orm";

/**
 * TAKING THE SETTLEMENT'S COPY OF THE BUDGET — once, and once only.
 *
 * The rule this exists to keep (the product owner, 2026-08-27): *"The settlement
 * has a copy of the budget. The budget is never changed from the settlement."*
 * A budget is a forecast and goes on being a planning document; a settlement is
 * the record of what actually happened. `reconcile()` reads the copy, the planner
 * keeps its own rows, and neither can overwrite the other.
 *
 * **Sealed.** The copy is taken the first time a settlement is run and never
 * consults the budget again — the owner's choice among the drift behaviours. A
 * budget edited afterwards is a forecast being revised after the fact and has no
 * standing over a night that already happened. Which is why this returns early on
 * the second call rather than reconciling the two sides: a "refresh" would throw
 * away the actuals somebody typed, and that is the whole feature.
 *
 * An event with no budget at all copies nothing and settles on its deals alone,
 * which is a legitimate night — a guarantee with no costs recorded anywhere.
 */
export async function ensureSettlementLines(
  // biome-ignore lint/suspicious/noExplicitAny: Drizzle db/tx handle.
  database: Database | any,
  eventId: string,
): Promise<{ copied: number; alreadyHad: boolean }> {
  const existing = await database
    .select({ id: schema.settlementLines.id })
    .from(schema.settlementLines)
    .where(eq(schema.settlementLines.eventId, eventId))
    .limit(1);
  if (existing.length > 0) return { copied: 0, alreadyHad: true };

  // ONLY THE SHARED BUDGET. With a co-host, the shared budget is the one that
  // becomes the settlement; a co-promoter's `private` budget is their own margin
  // — internal accounting, not part of the night's reconciliation — and never
  // enters it. That is also what keeps it unreadable: a line that was never
  // copied cannot leak through the settlement to the other party, and there is
  // no per-line privacy rule to get wrong later.
  const budgetLines = await database
    .select()
    .from(schema.budgetLines)
    .innerJoin(schema.budgets, eq(schema.budgets.id, schema.budgetLines.budgetId))
    .where(and(eq(schema.budgets.eventId, eventId), eq(schema.budgets.scope, "shared")));
  if (budgetLines.length === 0) return { copied: 0, alreadyHad: false };

  await database.insert(schema.settlementLines).values(
    budgetLines.map((row: { budget_lines: typeof schema.budgetLines.$inferSelect }) => {
      const line = row.budget_lines;
      return {
        eventId,
        // What this was budgeted at is a question about a specific forecast line,
        // so the copy remembers which one. Planned-vs-actual pairs on it.
        originBudgetLineId: line.id,
        kind: line.kind,
        source: line.source,
        providerRef: line.providerRef,
        label: line.label,
        amount: line.amount,
        currency: line.currency,
        collectedBy: line.collectedBy,
        paidBy: line.paidBy,
        payeeParticipantId: line.payeeParticipantId,
        costSplit: line.costSplit,
        details: line.details,
        dealId: line.dealId,
        attributedDealId: line.attributedDealId,
      };
    }),
  );
  return { copied: budgetLines.length, alreadyHad: false };
}
