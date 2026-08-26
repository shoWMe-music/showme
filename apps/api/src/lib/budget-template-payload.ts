import { z } from "zod";

/**
 * The Zod half of PLAN.md §K — "One table; `payload` validated per-category by a
 * Zod schema in the API".
 *
 * `templates.payload` is `jsonb` and the route has always taken it as
 * `z.unknown()`, so every category was stored unchecked. `budget` is the first
 * one that is read back into a screen that does ARITHMETIC on it, and an
 * unchecked payload there is not a cosmetic problem: a `"1,5"` where a minor-unit
 * string belongs reaches `BigInt()` and throws inside the planner the operator
 * has already opened. Validating on the way IN means the stored row is always
 * loadable.
 *
 * The shape mirrors `BudgetTemplatePayload` in `@showme/shared`
 * (`budget-template.ts`), which is the type half and is dependency-free because
 * `packages/shared` carries no zod. The two must be changed together.
 *
 * Only `budget` is validated here. The other seven categories keep passing
 * through unchecked — writing schemas for surfaces that have no reader yet would
 * be guessing at shapes nothing produces.
 */

/** Minor units as a whole-number string (money.md) — the same spelling of money
 * `routes/budget.ts` and `routes/deals.ts` use, and the only thing `BigInt()` parses. */
const MinorUnitsAmount = z
  .string()
  .regex(/^-?\d+$/, 'amount must be a whole number of minor units as a string, e.g. "150000"');

const TemplateTicketTier = z.object({
  name: z.string(),
  unitAmount: MinorUnitsAmount,
  quantity: z.number().int().min(0),
});

const TemplateNamedAmount = z.object({
  label: z.string().min(1),
  amount: MinorUnitsAmount,
  /** How the amount is struck; absent on a flat standing heading. */
  type: z.enum(["manual", "per_guest"]).optional(),
});

export const BudgetTemplatePayloadSchema = z.object({
  ticketTiers: z.array(TemplateTicketTier),
  averageBarSpend: MinorUnitsAmount,
  capacity: z.number().int().min(0),
  otherRevenue: MinorUnitsAmount,
  customRevenue: z.array(TemplateNamedAmount),
  costs: z.array(TemplateNamedAmount),
  paymentProcessing: z
    .object({
      /** Basis points (money.md) — 150 = 1.50%, never a float. */
      percentBasisPoints: z.number().int(),
      flatPerTicket: MinorUnitsAmount,
    })
    .optional(),
});

/**
 * Validate a template payload for its category, or return the reason it is
 * unusable. A category with no schema is passed through — see the note above.
 *
 * Returns a discriminated result rather than throwing so the route can answer
 * with a 400 naming the offending field, which is what a client can act on.
 */
export function validateTemplatePayload(
  category: string,
  payload: unknown,
): { ok: true; payload: unknown } | { ok: false; message: string } {
  if (category !== "budget") return { ok: true, payload };

  const parsed = BudgetTemplatePayloadSchema.safeParse(payload);
  if (parsed.success) return { ok: true, payload: parsed.data };

  const [issue] = parsed.error.issues;
  const path = issue?.path.join(".") || "payload";
  return { ok: false, message: `budget template payload: ${path} — ${issue?.message}` };
}
