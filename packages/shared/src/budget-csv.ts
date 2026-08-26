/**
 * The Budget Planner as a spreadsheet — the "CSV" button on the design
 * prototype's Budget toolbar.
 *
 * Pure and framework-agnostic (CLAUDE.md): rows in, one RFC-4180 string out, no
 * DOM and no fetch. The browser half — turning this string into a file the
 * operator can save — is `apps/web/src/lib/budgetExport.ts`, which follows the
 * Blob pattern `proFilingExport.ts` already established.
 *
 * WHY THE BREAKDOWN AND NOT JUST THE TOTALS: a budget exported as four KPI
 * figures is a screenshot with extra steps. What makes the file worth having is
 * that a ticket tier keeps its PRICE and its COUNT in their own columns, so the
 * operator can change 1 280 to 1 400 in the spreadsheet and see what happens
 * without retyping the show. Amounts are therefore emitted twice over: the unit
 * and the quantity that produced a line, and the line's own total.
 *
 * Money is rendered as a plain decimal string in MAJOR units
 * (`minorToDecimalString`) with no thousands separators and no currency symbol —
 * a spreadsheet parses "50000.00" as a number and "€50,000.00" as text, and a
 * budget whose amounts land as text is a budget nobody can sum. The currency is
 * carried in its own column instead, once per row, so the file stays unambiguous.
 */

import type { BudgetProjection } from "./budget-planning";
import { type CsvColumn, toCsv } from "./csv";
import { minorToDecimalString } from "./money";

/** A named amount as the planner holds it — a cost heading, or a custom row. */
export interface BudgetCsvNamedAmount {
  readonly label: string;
  readonly amount: bigint;
}

export interface BudgetCsvTicketTier {
  readonly name: string;
  readonly unitAmount: bigint;
  readonly quantity: number;
}

export interface BudgetCsvInputs {
  readonly eventTitle: string;
  readonly currency: string;
  readonly ticketTiers: readonly BudgetCsvTicketTier[];
  readonly averageBarSpend: bigint;
  readonly capacity: number;
  readonly otherRevenue: bigint;
  readonly customRevenue: readonly BudgetCsvNamedAmount[];
  readonly costs: readonly BudgetCsvNamedAmount[];
  /** The figures the screen shows, so the file and the screen cannot disagree. */
  readonly projection: BudgetProjection;
}

/** One line of the exported file, before it is quoted. */
interface BudgetCsvRow {
  readonly section: string;
  readonly line: string;
  readonly unitAmount: bigint | null;
  readonly quantity: number | null;
  readonly amount: bigint | null;
  /** Already-formatted cells (a percentage, a ticket count) that are not money. */
  readonly plainValue: string | null;
}

function moneyRow(
  section: string,
  line: string,
  amount: bigint,
  unitAmount: bigint | null = null,
  quantity: number | null = null,
): BudgetCsvRow {
  return { section, line, unitAmount, quantity, amount, plainValue: null };
}

function plainRow(section: string, line: string, plainValue: string): BudgetCsvRow {
  return { section, line, unitAmount: null, quantity: null, amount: null, plainValue };
}

/**
 * Every row of the export, in the order the screen reads top to bottom. Separate
 * from the stringifying below so the ordering is testable without parsing CSV.
 */
export function budgetCsvRows(inputs: BudgetCsvInputs): BudgetCsvRow[] {
  const { projection } = inputs;
  const rows: BudgetCsvRow[] = [];

  for (const tier of inputs.ticketTiers) {
    // A tier the operator has not named yet still carries a price and a count,
    // and dropping it would make the file's ticket revenue disagree with the
    // screen's. It is exported under a placeholder instead.
    const name = tier.name.trim() || "(unnamed ticket type)";
    rows.push(
      moneyRow(
        "Revenue",
        name,
        tier.unitAmount * BigInt(Math.trunc(tier.quantity)),
        tier.unitAmount,
        Math.trunc(tier.quantity),
      ),
    );
  }
  rows.push(
    moneyRow(
      "Revenue",
      "Bar and merchandise",
      projection.barRevenue,
      inputs.averageBarSpend,
      Math.trunc(inputs.capacity),
    ),
  );
  rows.push(moneyRow("Revenue", "Other revenue", inputs.otherRevenue));
  for (const row of inputs.customRevenue) {
    rows.push(moneyRow("Revenue", row.label, row.amount));
  }
  rows.push(moneyRow("Revenue", "Total revenue", projection.totalRevenue));

  for (const cost of inputs.costs) {
    rows.push(moneyRow("Costs", cost.label, cost.amount));
  }
  // An ASSUMPTION, not a line anybody paid (see `budget-planning.ts`), so it is
  // labelled as one rather than sitting anonymously among the real cost rows.
  rows.push(
    moneyRow("Costs", "Payment processing fees (estimate)", projection.paymentProcessingFees),
  );
  rows.push(moneyRow("Costs", "Total costs", projection.totalCosts));

  rows.push(moneyRow("Results", "Profit / Loss", projection.profit));
  rows.push(plainRow("Results", "Profit margin %", `${projection.marginPercent.toFixed(1)}%`));
  rows.push(plainRow("Results", "Tickets sold", projection.ticketsSold.toString()));
  rows.push(moneyRow("Results", "Average ticket price", projection.averageTicketPrice));
  rows.push(plainRow("Results", "Break-even ticket count", projection.breakEvenTickets.toString()));
  rows.push(moneyRow("Results", "Revenue per guest", projection.revenuePerGuest));
  rows.push(moneyRow("Results", "Cost per guest", projection.costPerGuest));

  return rows;
}

/** The Budget Planner rendered as one RFC-4180 CSV string. */
export function budgetToCsv(inputs: BudgetCsvInputs): string {
  const decimal = (amount: bigint) => minorToDecimalString({ amount, currency: inputs.currency });

  const columns: CsvColumn<BudgetCsvRow>[] = [
    { header: "Event", value: () => inputs.eventTitle },
    { header: "Section", key: "section" },
    { header: "Line", key: "line" },
    {
      header: "Unit amount",
      value: (row) => (row.unitAmount == null ? "" : decimal(row.unitAmount)),
    },
    { header: "Quantity", value: (row) => row.quantity ?? "" },
    {
      header: "Amount",
      value: (row) => (row.amount == null ? (row.plainValue ?? "") : decimal(row.amount)),
    },
    // Blank on a row whose value is not money, so nothing reads a percentage as
    // an amount in the export's own currency.
    { header: "Currency", value: (row) => (row.amount == null ? "" : inputs.currency) },
  ];

  return toCsv(columns, budgetCsvRows(inputs));
}
