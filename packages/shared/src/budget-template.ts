/**
 * A saved Budget Planner, reusable on the next event ("Save as Template" /
 * "Load Template" on the design prototype's Budget screen).
 *
 * It rides in `templates.payload` under `category = 'budget'` — the table and the
 * category both already exist (PLAN.md §K: "One table; `payload` validated
 * per-category by a Zod schema in the API"), so nothing here needed a migration.
 * This module is the shape half of that promise; the Zod validator that enforces
 * it at the route lives in `apps/api/src/lib/budget-template-payload.ts` and must
 * mirror it. `packages/shared` is deliberately dependency-free, which is why the
 * two are not one file.
 *
 * WHAT A TEMPLATE IS NOT: it is not a budget. It holds no event, no participant
 * and no line id, so loading one cannot overwrite the attribution
 * (`collected_by` / `paid_by`) that settlement reads — it fills the planner's
 * FIELDS and the operator saves them onto their own event as new lines.
 *
 * Money is minor units in a STRING (money.md's JSON boundary), because `payload`
 * is `jsonb` and a JS number loses precision past 2^53. Percentages are integer
 * basis points for the same reason a float is never used for a rate.
 */

/** A ticket tier as a template remembers it: a name, a price, an expected count. */
export interface BudgetTemplateTicketTier {
  readonly name: string;
  /** Minor units as a decimal string. */
  readonly unitAmount: string;
  readonly quantity: number;
}

/** A named amount — a cost heading, or a custom revenue row. */
export interface BudgetTemplateNamedAmount {
  readonly label: string;
  /** Minor units as a decimal string. For a per-guest row, the amount PER HEAD. */
  readonly amount: string;
  /**
   * How the amount is struck. Absent on a standing cost heading, which is always
   * a flat figure, and on a template written before custom rows had a type.
   */
  readonly type?: "manual" | "per_guest";
}

export interface BudgetTemplatePayload {
  readonly ticketTiers: readonly BudgetTemplateTicketTier[];
  /** Minor units as a decimal string. */
  readonly averageBarSpend: string;
  readonly capacity: number;
  /** Minor units as a decimal string. */
  readonly otherRevenue: string;
  readonly customRevenue: readonly BudgetTemplateNamedAmount[];
  readonly costs: readonly BudgetTemplateNamedAmount[];
  /** Absent when the saved budget named no payment/ticketing provider. */
  readonly paymentProcessing?: {
    readonly percentBasisPoints: number;
    /** Minor units as a decimal string. */
    readonly flatPerTicket: string;
  };
}

/** Minor units as a whole-number string — the only thing `BigInt()` can parse. */
function minorUnits(value: unknown): string {
  return typeof value === "string" && /^-?\d+$/.test(value) ? value : "0";
}

function wholeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : 0;
}

function label(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function namedAmounts(value: unknown): BudgetTemplateNamedAmount[] {
  return (
    array(value)
      .map((entry) => {
        const row = entry as Record<string, unknown>;
        return {
          label: label(row?.label),
          amount: minorUnits(row?.amount),
          // Anything but the one known alternative reads as a flat figure —
          // a template must never load a row whose type nothing implements.
          ...(row?.type === "per_guest" ? { type: "per_guest" as const } : {}),
        };
      })
      // A row with no name is not a row — it would load as a blank line the
      // operator cannot identify and would have to hunt down to delete.
      .filter((row) => row.label !== "")
  );
}

/**
 * Read a `templates.payload` back into the planner's shape.
 *
 * Deliberately TOLERANT, exactly as the budget serializer's `details` reader is:
 * `payload` is `jsonb` typed `unknown`, and a template written by an older build
 * (or edited by hand in the database) must degrade to a usable budget rather than
 * throw inside a screen the operator has already opened. Anything unreadable
 * becomes an empty field, never a made-up figure.
 */
export function readBudgetTemplatePayload(value: unknown): BudgetTemplatePayload {
  const source = (typeof value === "object" && value !== null ? value : {}) as Record<
    string,
    unknown
  >;
  const processing = source.paymentProcessing as Record<string, unknown> | undefined;
  const hasProcessing =
    typeof processing === "object" && processing !== null && "percentBasisPoints" in processing;

  return {
    ticketTiers: array(source.ticketTiers).map((entry) => {
      const tier = entry as Record<string, unknown>;
      return {
        name: label(tier?.name),
        unitAmount: minorUnits(tier?.unitAmount),
        quantity: wholeNumber(tier?.quantity),
      };
    }),
    averageBarSpend: minorUnits(source.averageBarSpend),
    capacity: wholeNumber(source.capacity),
    otherRevenue: minorUnits(source.otherRevenue),
    customRevenue: namedAmounts(source.customRevenue),
    costs: namedAmounts(source.costs),
    ...(hasProcessing
      ? {
          paymentProcessing: {
            percentBasisPoints: wholeNumber(processing.percentBasisPoints),
            flatPerTicket: minorUnits(processing.flatPerTicket),
          },
        }
      : {}),
  };
}
