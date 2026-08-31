import {
  type BreakEvenChart,
  type BreakdownRow,
  type PerformingRightsFeeEstimate,
  type PerformingRightsTerritory,
  computeBreakEvenChart,
  computeBreakdown,
  computeBudgetProjection,
  dealFigureDisagreement,
  estimatePerformingRightsFee,
} from "@showme/shared";
import { formatMoney, formatMoneyExact } from "../lib/format";
import { toMinorUnits } from "../lib/moneyUnits";
import type { KpiItem } from "./KpiRow";
import { type BudgetEditor, budgetInputsFrom, minorUnitsOf } from "./useBudgetEditor";

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
/** Custom revenue rows cycle their own colours, so a budget with several of them
 * keeps getting distinguishable bars rather than three identical blues. */
const CUSTOM_REVENUE_COLORS = ["#B58BE0", "#6FC97A", "#8C7A6C", "#E0A9C6"] as const;
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
  /**
   * Whether a rate configured for this event's territory produced the figure, or
   * the flat planning default did. The card leans on this for everything it says
   * about confidence — see `PerformingRightsEstimateCard`.
   */
  isTerritoryTariff: boolean;
  /** The pill: the society and territory when there is one, "Estimate only" when not. */
  sourceLabel: string;
  /** The published tariff the rate was read off, when an admin recorded one. */
  sourceUrl: string | null;
  /** Stated in full on the card — even a real tariff produces only an estimate here. */
  assumptions: string[];
}

/**
 * A cost row that claims to be a deal's own figure while stating a different one.
 *
 * Carried as finished TEXT because the component that draws it renders and does
 * not compute (CLAUDE.md): the integer comparison is `@showme/shared`'s
 * `dealFigureDisagreement`, the money formatting is this module's unit boundary,
 * and the row is handed the two figures it prints.
 */
export interface DealFigureWarning {
  /** The deal whose figure the row claims to be. */
  dealName: string;
  /** What the planner is forecasting, formatted. */
  plannedLabel: string;
  /** What the settlement will use, formatted. */
  dealLabel: string;
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
  /** Keyed by cost row key — only rows that actually disagree appear here. */
  dealFigureWarnings: Record<string, DealFigureWarning>;
}

/**
 * @param territory Where the show happens and what PRO rate is configured there,
 *   from `GET /events/:id/performing-rights-rate`. Omitted (or still loading) the
 *   planner falls back to the flat planning estimate and SAYS SO on the card,
 *   which is the same thing it did before any tariff table existed.
 */
export function budgetPlannerViewFrom(
  editor: BudgetEditor,
  currency: string,
  territory?: PerformingRightsTerritory,
): BudgetPlannerView {
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
      // Each custom row under ITS OWN NAME, not folded into "Other". The whole
      // point of naming a field "Sponsorship" is to see the sponsorship in the
      // breakdown; a lump labelled "Other" answers a question nobody asked.
      ...editor.customRevenue.map((row, index) => ({
        label: row.label,
        amount: minorUnitsOf(row.value),
        color: CUSTOM_REVENUE_COLORS[index % CUSTOM_REVENUE_COLORS.length] ?? REVENUE_COLORS.other,
      })),
    ],
    projection.totalRevenue,
  );

  const costBreakdown = computeBreakdown(
    [
      ...editor.costs.map((cost, index) => ({
        label: cost.label,
        amount: minorUnitsOf(cost.value),
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

  // Rows that say "this IS the deal's figure" and then state a different one.
  // Only a REAL disagreement lands here — same-value rows produce no entry — so
  // the screen renders whatever it is given and decides nothing.
  const dealFigureWarnings: Record<string, DealFigureWarning> = {};
  for (const cost of editor.costs) {
    const link = cost.dealLink;
    if (link?.kind !== "deal_figure") continue;
    const deal = editor.deals.find((option) => option.id === link.dealId);
    if (!deal) continue;
    const drift = dealFigureDisagreement(
      minorUnitsOf(cost.value),
      deal.guaranteeAmount == null ? null : BigInt(deal.guaranteeAmount),
    );
    if (!drift) continue;
    // Two amounts that differ by less than a whole unit round to the SAME text
    // under the screen's house format, and a warning reading "says SEK 3,000, but
    // says SEK 3,000" reads as a bug rather than as the sub-unit drift it is. When
    // the rounded labels collide, both figures are printed to the minor unit.
    const planned = money(drift.planned);
    const authoritative = money(drift.deal);
    const roundsToTheSameText = planned === authoritative;
    dealFigureWarnings[cost.key] = {
      dealName: deal.name,
      plannedLabel: roundsToTheSameText
        ? formatMoneyExact(drift.planned.toString(), currency)
        : planned,
      dealLabel: roundsToTheSameText
        ? formatMoneyExact(drift.deal.toString(), currency)
        : authoritative,
    };
  }

  const performingRights = estimatePerformingRightsFee(projection.ticketRevenue, territory);

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
    performingRights: performingRightsDisplay(performingRights, money),
    dealFigureWarnings,
  };
}

/**
 * What the PRO card says, and the one place that decides how confident it sounds.
 *
 * The rule the whole feature turns on: a figure produced by the flat planning rate
 * must never be dressed as a tariff. So the two branches below differ in their
 * FIRST assumption line — the one that names where the rate came from — and the
 * shared lines are the ones that are true either way. An operator mistaking the
 * placeholder for a quote will under-budget a real invoice, which is the failure
 * this card exists to prevent.
 */
function performingRightsDisplay(
  estimate: PerformingRightsFeeEstimate,
  money: (minor: bigint) => string,
): PerformingRightsDisplay {
  const ratePercent = estimate.rateBasisPoints / 100;
  const shared = [
    "Charged on ticket revenue only; bar and other revenue are outside it.",
    "Applies the rate to PROJECTED ticket revenue — the fee moves with what actually sells.",
  ];

  if (estimate.tariffSource === "territory_tariff") {
    const society = estimate.proName ?? "the local PRO";
    return {
      feeLabel: money(estimate.fee),
      rateLabel: `${ratePercent}% of ticket revenue`,
      isTerritoryTariff: true,
      sourceLabel: estimate.country ? `${society} · ${estimate.country}` : society,
      sourceUrl: estimate.sourceUrl,
      assumptions: [
        estimate.sourceNote
          ? `${ratePercent}% is the rate configured for ${estimate.country} — ${estimate.sourceNote}.`
          : `${ratePercent}% is the rate configured for ${estimate.country}. No tariff reference was recorded against it.`,
        ...shared,
        // Even a real, sourced rate is not a quote. shoWMe files nothing with any
        // society (`performance_reports` is unwritten), tariffs are negotiated per
        // venue, and they change yearly.
        `Still an estimate: shoWMe files nothing with ${society}, and the invoice follows their published tariff for this venue.`,
      ],
    };
  }

  return {
    feeLabel: money(estimate.fee),
    rateLabel: `≈ ${ratePercent}% of ticket revenue`,
    isTerritoryTariff: false,
    sourceLabel: "Estimate only",
    sourceUrl: null,
    assumptions: [
      estimate.country
        ? `Flat ${ratePercent}% planning rate — shoWMe has no tariff configured for ${estimate.country}.`
        : `Flat ${ratePercent}% planning rate — no territory tariff is configured in shoWMe.`,
      ...shared,
      estimate.country
        ? "No PRO is set for this event, so no published tariff was consulted."
        : "shoWMe could not tell where this show happens — set the venue's country and its PRO rate can be applied.",
    ],
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
