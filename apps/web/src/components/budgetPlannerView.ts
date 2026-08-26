import {
  type BreakEvenChart,
  type BreakdownRow,
  computeBreakEvenChart,
  computeBreakdown,
  computeBudgetProjection,
  estimatePerformingRightsFee,
} from "@showme/shared";
import { formatMoney } from "../lib/format";
import type { KpiItem } from "./KpiRow";
import { type BudgetEditor, budgetInputsFrom, toMinorUnits } from "./useBudgetEditor";

/**
 * Everything the Budget Planner draws, derived once from the editor's draft.
 *
 * The screen renders this and computes none of it (CLAUDE.md): the arithmetic is
 * `@showme/shared`'s, and the only work done here is the unit boundary — minor
 * units as bigint on one side, formatted strings on the other. Keeping it in a
 * plain function rather than inside the component means the eight sections cannot
 * drift apart: they are all reading the same projection, and there is one place
 * to look when a figure disagrees with the one above it.
 */

/** The palette the design prototype uses for the two breakdown lists. */
const REVENUE_COLORS = { tickets: "#EE5746", bar: "#F4A046", other: "#6FA8E0" } as const;
const COST_COLORS = ["#EE5746", "#F4A046", "#6FA8E0", "#B58BE0", "#6FC97A", "#8C7A6C"] as const;
const PROCESSING_COLOR = "#E6D9CB";

export interface BreakdownDisplayRow {
  label: string;
  /** The share this row prints — a fact about the money. */
  percentLabel: string;
  amountLabel: string;
  /** How wide to draw the bar: this row against the biggest one. */
  barPercent: number;
  color: string;
}

export interface BreakEvenDisplay {
  chart: BreakEvenChart;
  breakEvenLabel: string;
  capacityLabel: string;
}

export interface PerformingRightsDisplay {
  feeLabel: string;
  rateLabel: string;
  /** Stated in full on the card — this figure is nobody's published tariff. */
  assumptions: string[];
}

export interface BudgetPlannerView {
  kpis: KpiItem[];
  results: KpiItem[];
  ticketRevenueTotal: string;
  barRevenue: string;
  breakEven: BreakEvenDisplay;
  revenueSources: BreakdownDisplayRow[];
  costBreakdown: BreakdownDisplayRow[];
  performingRights: PerformingRightsDisplay;
}

export function budgetPlannerViewFrom(editor: BudgetEditor, currency: string): BudgetPlannerView {
  const inputs = budgetInputsFrom(editor);
  const projection = computeBudgetProjection(inputs);
  const money = (minor: bigint) => formatMoney(minor.toString(), currency);

  const chart = computeBreakEvenChart({
    projection,
    capacity: inputs.capacity,
    // Before any tier has a quantity there is no weighted average to slope the
    // line with, so the first price typed stands in for it.
    fallbackTicketPrice: inputs.ticketTiers[0]?.unitAmount ?? 0n,
  });

  const otherRevenue = BigInt(toMinorUnits(editor.otherRevenue));
  const revenueSources = computeBreakdown(
    [
      { label: "Ticket sales", amount: projection.ticketRevenue, color: REVENUE_COLORS.tickets },
      { label: "Bar / F&B", amount: projection.barRevenue, color: REVENUE_COLORS.bar },
      { label: "Other", amount: otherRevenue, color: REVENUE_COLORS.other },
    ],
    projection.totalRevenue,
  );

  const costBreakdown = computeBreakdown(
    [
      ...editor.costs.map((cost, index) => ({
        label: cost.label,
        amount: BigInt(toMinorUnits(cost.value)),
        // The headings cycle through the palette so a budget with custom rows of
        // its own keeps getting colours rather than running out.
        color: COST_COLORS[index % COST_COLORS.length] ?? PROCESSING_COLOR,
      })),
      {
        label: "Payment processing",
        amount: projection.paymentProcessingFees,
        color: PROCESSING_COLOR,
      },
    ],
    projection.totalCosts,
  );

  const performingRights = estimatePerformingRightsFee(projection.ticketRevenue);
  const ratePercent = performingRights.rateBasisPoints / 100;

  return {
    kpis: [
      { label: "Total revenue", value: money(projection.totalRevenue), tone: "green" },
      { label: "Total costs", value: money(projection.totalCosts), tone: "red" },
      {
        label: "Profit / loss",
        value: money(projection.profit),
        tone: projection.profit < 0n ? "red" : "green",
      },
      { label: "Break-even tickets", value: projection.breakEvenTickets, tone: "amber" },
    ],
    results: [
      { label: "Total revenue", value: money(projection.totalRevenue) },
      { label: "Total costs", value: money(projection.totalCosts) },
      { label: "Profit / Loss", value: money(projection.profit) },
      { label: "Break-even ticket count", value: projection.breakEvenTickets.toLocaleString() },
      { label: "Profit margin %", value: `${projection.marginPercent.toFixed(1)}%` },
      { label: "Revenue per guest", value: money(projection.revenuePerGuest) },
      { label: "Cost per guest", value: money(projection.costPerGuest) },
    ],
    ticketRevenueTotal: money(projection.ticketRevenue),
    barRevenue: money(projection.barRevenue),
    breakEven: {
      chart,
      breakEvenLabel: `${chart.breakEvenTickets.toLocaleString()} tickets`,
      capacityLabel: chart.capacity.toLocaleString(),
    },
    revenueSources: revenueSources.map(displayRow(money)),
    costBreakdown: costBreakdown.map(displayRow(money)),
    performingRights: {
      feeLabel: money(performingRights.fee),
      rateLabel: `≈ ${ratePercent}% of ticket revenue`,
      // Said out loud, because the number above them is a planning placeholder and
      // an operator who mistakes it for a quote will under-budget a real invoice.
      assumptions: [
        `Flat ${ratePercent}% planning rate — no territory tariff is configured in shoWMe.`,
        "Charged on ticket revenue only; bar and other revenue are outside it.",
        "No PRO is set for this event, so no published tariff was consulted.",
      ],
    },
  };
}

const displayRow =
  (money: (minor: bigint) => string) =>
  (row: BreakdownRow): BreakdownDisplayRow => ({
    label: row.label,
    amountLabel: money(row.amount),
    percentLabel: `${row.percentOfTotal}%`,
    barPercent: row.percentOfLargest,
    color: row.color,
  });
