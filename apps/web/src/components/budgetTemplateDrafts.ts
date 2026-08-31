import type { BudgetTemplatePayload } from "@showme/shared";
import { toBasisPoints, toMajorUnits, toMinorUnits, toPercentText } from "../lib/moneyUnits";
import type {
  BudgetEditor,
  CostDraft,
  CustomRevenueDraft,
  TicketTierDraft,
} from "./useBudgetEditor";
import { NEW_ROW_PREFIX, STANDARD_COST_HEADINGS } from "./useBudgetEditor";

/**
 * The two directions a Budget Planner and a saved template convert between.
 *
 * Pure functions beside the hook rather than steps inside it, for the same reason
 * `budgetInputsFrom` is: this is where a factor of a hundred or an orphaned line
 * id would hide, and both are much easier to see in a function that takes a draft
 * and returns a draft than in a callback wired to a button.
 */

/** The planner's current draft, captured as a template payload. */
export function templateFrom(editor: BudgetEditor): BudgetTemplatePayload {
  const percentBasisPoints = toBasisPoints(editor.processingPercent);
  const flatPerTicket = toMinorUnits(editor.processingFlatPerTicket);
  const named = (label: string, value: string) => ({ label, amount: toMinorUnits(value) });

  return {
    ticketTiers: editor.ticketTiers.map((tier) => ({
      name: tier.name,
      unitAmount: toMinorUnits(tier.price),
      quantity: Math.trunc(Number(tier.quantity)) || 0,
    })),
    averageBarSpend: toMinorUnits(editor.averageBarSpend),
    capacity: Math.trunc(Number(editor.capacity)) || 0,
    otherRevenue: toMinorUnits(editor.otherRevenue),
    customRevenue: editor.customRevenue
      .filter((row) => row.label.trim() !== "")
      .map((row) => named(row.label, row.value)),
    // Only headings that were actually budgeted. Saving the six standing rows at
    // zero would load as a template that "sets" every cost to nothing, which is a
    // claim about the next show rather than a starting point for it.
    //
    // And never a row READ FROM A DEAL. That figure belongs to this event's
    // agreement; carried into a template it would arrive on the next show as a
    // stored "Performer fee" line — one act's guarantee budgeted against another
    // act's night, and a real `budget_lines` row for money the deal already owns.
    costs: editor.costs
      .filter((cost) => !cost.readFromDeal)
      .filter((cost) => cost.value.trim() !== "" && cost.value.trim() !== "0")
      .map((cost) => named(cost.label, cost.value)),
    ...(percentBasisPoints > 0 || flatPerTicket !== "0"
      ? { paymentProcessing: { percentBasisPoints, flatPerTicket } }
      : {}),
  };
}

/** Every draft the planner holds, plus the lines that loading it makes obsolete. */
export interface TemplateDrafts {
  ticketTiers: TicketTierDraft[];
  costs: CostDraft[];
  customRevenue: CustomRevenueDraft[];
  capacity: string;
  averageBarSpend: string;
  otherRevenue: string;
  processingPercent: string;
  processingFlatPerTicket: string;
  /**
   * Ids of lines the loaded template has no row for. They must be DELETED rather
   * than merely dropped from the draft: a line left in the database would be read
   * straight back by the next refetch, so the template would appear to load and
   * then quietly un-load itself.
   */
  removedLineIds: string[];
}

/** Reuse a written line's id for the row that replaces it, so loading a template
 * updates the operator's lines instead of orphaning them and writing new ones. */
function writtenIds(ids: string[]): string[] {
  return ids.filter((id) => !id.startsWith(NEW_ROW_PREFIX));
}

/**
 * A saved template applied over the planner's current draft.
 *
 * Rows are matched POSITIONALLY for ticket tiers and custom revenue (there is no
 * stable identity to match on — the operator renames tiers freely) and BY LABEL
 * for costs, where the six standing headings are the identity.
 */
export function draftsFromTemplate(
  payload: BudgetTemplatePayload,
  editor: BudgetEditor,
): TemplateDrafts {
  const removedLineIds: string[] = [];

  const tierIds = writtenIds(editor.ticketTiers.map((tier) => tier.id));
  const ticketTiers = payload.ticketTiers.map((tier, index) => ({
    id: tierIds[index] ?? `${NEW_ROW_PREFIX}tier:${index}`,
    name: tier.name,
    price: toMajorUnits(tier.unitAmount),
    quantity: tier.quantity.toString(),
  }));
  removedLineIds.push(...tierIds.slice(payload.ticketTiers.length));

  const customIds = writtenIds(editor.customRevenue.map((row) => row.id));
  const customRevenue = payload.customRevenue.map((row, index) => ({
    id: customIds[index] ?? `${NEW_ROW_PREFIX}custom:${index}`,
    label: row.label,
    value: toMajorUnits(row.amount),
  }));
  removedLineIds.push(...customIds.slice(payload.customRevenue.length));

  const byLabel = new Map(payload.costs.map((cost) => [cost.label, cost.amount]));
  const standard: CostDraft[] = STANDARD_COST_HEADINGS.map((heading) => {
    const existing = editor.costs.find((cost) => cost.label === heading);
    const amount = byLabel.get(heading);
    return {
      key: existing?.key ?? `${NEW_ROW_PREFIX}${heading}`,
      label: heading,
      // A heading the template is silent about is cleared, not left holding the
      // last show's figure — loading a template that says nothing about staffing
      // must not carry a previous event's staffing cost into this one.
      value: amount === undefined ? "" : toMajorUnits(amount),
      isCustom: false,
    };
  });

  const customCosts: CostDraft[] = payload.costs
    .filter((cost) => !STANDARD_COST_HEADINGS.includes(cost.label as never))
    .map((cost, index) => {
      const existing = editor.costs.find((row) => row.isCustom && row.label === cost.label);
      return {
        key: existing?.key ?? `${NEW_ROW_PREFIX}custom-cost:${index}`,
        label: cost.label,
        value: toMajorUnits(cost.amount),
        isCustom: true,
      };
    });

  // A custom cost row the template does not mention has no heading to fall back
  // to, so its line goes rather than lingering under a budget it is not part of.
  for (const cost of editor.costs) {
    const stillThere = customCosts.some((row) => row.key === cost.key);
    if (cost.isCustom && !stillThere && !cost.key.startsWith(NEW_ROW_PREFIX)) {
      removedLineIds.push(cost.key);
    }
  }

  return {
    ticketTiers,
    costs: [...standard, ...customCosts],
    customRevenue,
    capacity: payload.capacity ? payload.capacity.toString() : "",
    averageBarSpend: toMajorUnits(payload.averageBarSpend),
    otherRevenue: toMajorUnits(payload.otherRevenue),
    processingPercent: payload.paymentProcessing
      ? toPercentText(payload.paymentProcessing.percentBasisPoints)
      : "",
    processingFlatPerTicket: payload.paymentProcessing
      ? toMajorUnits(payload.paymentProcessing.flatPerTicket)
      : "",
    removedLineIds,
  };
}
