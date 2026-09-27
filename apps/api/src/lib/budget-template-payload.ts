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
 * `budget` and `schedule` are validated here. The other six categories keep passing
 * through unchecked — writing schemas for surfaces that have no reader yet would
 * be guessing at shapes nothing produces. `schedule` joined the moment it got a
 * writer (ClickUp `123qy9rpvfq`), which is the rule: a category gets a schema when
 * a screen starts reading it back.
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

/**
 * A row is a label and a figure. It used to accept `type: 'manual' | 'per_guest'`
 * too; the per-guest reading was struck out (a row's value is the value), and a
 * zod object strips unknown keys, so a payload written under the old shape still
 * validates — it simply stores without the word. Old rows already in `templates`
 * are converted where they are read, in `readBudgetTemplatePayload`.
 */
const TemplateNamedAmount = z.object({
  label: z.string().min(1),
  amount: MinorUnitsAmount,
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
 * A SAVED RUN OF SHOW (ClickUp `123qy9rpvfq`).
 *
 * Clock times, not instants and not offsets — the reasoning is in
 * `apps/web/src/lib/scheduleTemplate.ts`, which is the only writer. What matters here
 * is that every field a loader will apply is checked, because the loader turns this
 * into `schedule_items` rows with no second chance to notice a bad shape.
 *
 * `dayOffset` is capped at 1 rather than left open. A run of show spills past midnight
 * — a 01:00 curfew is the day after the show — and it does not spill past the night
 * after that; an unbounded offset would let a template quietly place an item a week
 * away, which no screen would explain.
 */
const ScheduleTemplateItem = z.object({
  label: z.string().min(1).max(120),
  category: z.enum(["production", "crew"]),
  /** Offset-free wall clock (decisions #10), `HH:MM` on a 24-hour clock. */
  time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'time must be a 24-hour wall clock, e.g. "19:30"'),
  /** 0 = the show day, 1 = after midnight. */
  dayOffset: z.number().int().min(0).max(1),
});

export const ScheduleTemplatePayloadSchema = z.object({
  // Capped because this becomes one INSERT per item on load, and a run of show with
  // more rows than this is not a run of show.
  items: z.array(ScheduleTemplateItem).max(60),
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
  const schema =
    category === "budget"
      ? BudgetTemplatePayloadSchema
      : category === "schedule"
        ? ScheduleTemplatePayloadSchema
        : null;
  if (!schema) return { ok: true, payload };

  const parsed = schema.safeParse(payload);
  if (parsed.success) return { ok: true, payload: parsed.data };

  const [issue] = parsed.error.issues;
  const path = issue?.path.join(".") || "payload";
  return { ok: false, message: `${category} template payload: ${path} — ${issue?.message}` };
}
