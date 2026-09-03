import { schema } from "@showme/db";
import { type SQL, and, eq, inArray, or } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { badRequest, conflict, forbidden, notFound } from "../errors";
import { writeActivity } from "../lib/activity";
import { writeAudit } from "../lib/audit";
import { requireEventCapability } from "../lib/authorize";
import { ensureEventBudgets } from "../lib/budget-provisioning";
import {
  type SerializedBudget,
  type SerializedBudgetLine,
  serializeBudget,
  serializeBudgetLine,
} from "../serialize/budget";

const EventParams = z.object({ id: z.string().uuid() });
const BudgetParams = z.object({ id: z.string().uuid(), bid: z.string().uuid() });
const LineParams = z.object({
  id: z.string().uuid(),
  bid: z.string().uuid(),
  lid: z.string().uuid(),
});

const CreateBudgetBody = z.object({
  scope: z.enum(["shared", "private"]).default("shared"),
  ownerProfileId: z.string().uuid().optional(),
});

// `amount` arrives as a STRING and is parsed to bigint minor units (money.md) —
// never a JS number, which loses precision past 2^53.
const ticketingSourceEnum = z.enum(["manual", "ticketing_provider"]);

/**
 * Minor units as a decimal string — the only thing `BigInt()` can parse (audit A-14).
 * `BigInt("abc")` throws a SyntaxError, which used to escape the handler as an opaque
 * 500; the shape belongs in the schema so the parse downstream cannot fail at all.
 * Same expression as `deals.ts` uses for guarantees — one spelling of money everywhere.
 */
const MinorUnitsAmount = z
  .string()
  .regex(/^-?\d+$/, 'amount must be a whole number of minor units as a string, e.g. "150000"');

/**
 * The planner's arithmetic behind a line's `amount`: a ticket tier is a price
 * times a count, a bar take is an average spend times a head count. `amount`
 * remains the one figure settlement reads — this is only what the operator typed
 * to reach it, so reopening the planner shows the tiers back rather than a
 * collapsed total. Absent on a hand-entered line.
 */
const LineDetails = z.object({
  /**
   * Which of the planner's two multiplications produced this line. Carried in
   * the data rather than inferred from the label, so renaming a tier cannot
   * silently turn it into the bar estimate (or the reverse).
   */
  basis: z
    .enum([
      "ticket_tier",
      "bar_spend",
      "merch_spend",
      "other_revenue",
      "custom_revenue",
      "custom_cost",
    ])
    .default("ticket_tier"),
  unitAmount: MinorUnitsAmount,
  quantity: z.number().int().min(0),
});

/**
 * The cost-bearing rule on a line (2026-08 settlements meeting, 01:06:31):
 * participant id → basis points of the line that party bears. The generalisation
 * of `payeeParticipantId`, which is the same rule set to 100% for one party — so
 * the two are mutually exclusive and `assertCostRuleIsCoherent` refuses both at
 * once rather than letting the engine guess which the operator meant.
 *
 * The values are allowed to total LESS than 10 000: "the venue carries 60%, the
 * event carries the rest" is a real arrangement and the remainder stays a pool
 * cost. They may never total MORE — that would charge out more than the line.
 */
const CostSplit = z.record(z.string().uuid(), z.number().int().min(1).max(10_000));

const CreateLineBody = z.object({
  kind: z.enum(["revenue", "cost"]),
  /** Provenance of a revenue line (decisions #15) — `manual` unless synced. */
  source: ticketingSourceEnum.default("manual"),
  providerRef: z.string().optional(),
  label: z.string().min(1),
  amount: MinorUnitsAmount,
  currency: z.string().min(1).optional(),
  collectedBy: z.string().uuid().optional(),
  paidBy: z.string().uuid().optional(),
  payeeParticipantId: z.string().uuid().optional(),
  costSplit: CostSplit.nullable().optional(),
  dealId: z.string().uuid().optional(),
  attributedDealId: z.string().uuid().optional(),
  details: LineDetails.nullable().optional(),
});

const UpdateLineBody = z.object({
  kind: z.enum(["revenue", "cost"]).optional(),
  label: z.string().min(1).optional(),
  amount: MinorUnitsAmount.optional(),
  currency: z.string().min(1).nullable().optional(),
  collectedBy: z.string().uuid().nullable().optional(),
  paidBy: z.string().uuid().nullable().optional(),
  payeeParticipantId: z.string().uuid().nullable().optional(),
  costSplit: CostSplit.nullable().optional(),
  dealId: z.string().uuid().nullable().optional(),
  attributedDealId: z.string().uuid().nullable().optional(),
  details: LineDetails.nullable().optional(),
  /** Expected version for optimistic locking (decisions #8); mismatch → 409. */
  expectedVersion: z.number().int().optional(),
});

const DeleteLineBody = z.object({
  expectedVersion: z.number().int().optional(),
});

const BudgetLineResponse = z.object({
  id: z.string(),
  budgetId: z.string(),
  kind: z.string(),
  source: z.string(),
  providerRef: z.string().nullable(),
  label: z.string(),
  amount: z.string(),
  currency: z.string().nullable(),
  collectedBy: z.string().nullable(),
  paidBy: z.string().nullable(),
  payeeParticipantId: z.string().nullable(),
  costSplit: CostSplit.nullable(),
  dealId: z.string().nullable(),
  attributedDealId: z.string().nullable(),
  details: LineDetails.nullable(),
  version: z.number(),
});

/**
 * The planner's standing assumptions (migration 0015) — RATES, never amounts.
 *
 * Kept off `budget_lines` on purpose: a line is cash somebody moved, and
 * `reconcile()` lowers the settlement pool by every payee-less cost line. An
 * estimated provider fee posted as a line would balance the books around a guess.
 * The money is derived from these rates by `computeBudgetProjection()` when the
 * screen renders and is never stored.
 */
const PlanningAssumptions = z.object({
  paymentProcessing: z
    .object({
      /** Basis points of ticket revenue (money.md: percentages are integers). */
      percentBasisPoints: z.number().int().min(0).max(10_000),
      /** Minor units per ticket SOLD. */
      flatPerTicket: MinorUnitsAmount,
    })
    .nullable(),
});

const UpdateBudgetBody = z.object({
  planningAssumptions: PlanningAssumptions.nullable(),
  /** Expected version for optimistic locking (decisions #8); mismatch → 409. */
  expectedVersion: z.number().int().optional(),
});

const BudgetResponse = z.object({
  id: z.string(),
  eventId: z.string(),
  scope: z.string(),
  ownerProfileId: z.string().nullable(),
  planningAssumptions: PlanningAssumptions.nullable(),
  version: z.number(),
  lines: z.array(BudgetLineResponse),
});

/** The profile ids the caller acts for — the owners whose private budgets are theirs. */
function callerProfileIds(request: FastifyRequest): string[] {
  const principal = request.principal;
  if (!principal) throw new Error("principal missing after authentication");
  return principal.memberships.map((membership) => membership.profileId);
}

/**
 * The WHERE clause that IS the confidentiality rule (PLAN.md:207, PLAN.md:661):
 * a `shared` budget is the co-promoters' common ledger — visible to everyone
 * holding `budget.view` on the event; a `private` budget is one operator's own
 * margin line — visible ONLY to the profile that owns it. A `private` budget
 * with no `owner_profile_id` belongs to nobody and is therefore visible to
 * nobody (fail closed rather than leak an unattributed row).
 */
function visibleBudgetFilter(profileIds: string[]): SQL {
  const shared = eq(schema.budgets.scope, "shared");
  if (profileIds.length === 0) return shared;
  const ownPrivate = and(
    eq(schema.budgets.scope, "private"),
    inArray(schema.budgets.ownerProfileId, profileIds),
  );
  const filter = or(shared, ownPrivate);
  if (!filter) throw new Error("budget visibility filter failed to build");
  return filter;
}

/**
 * Fetch a budget that belongs to this event AND that the caller may see, or 404.
 * Scoping is folded into the same WHERE as the lookup, so another operator's
 * private budget is indistinguishable from one that does not exist — a 403 would
 * itself disclose that the co-promoter keeps a private budget. Every read AND
 * write path on a budget's lines goes through here.
 */
async function loadVisibleBudget(
  request: FastifyRequest,
  eventId: string,
  budgetId: string,
): Promise<typeof schema.budgets.$inferSelect> {
  const [budget] = await request.server.database
    .select()
    .from(schema.budgets)
    .where(
      and(
        eq(schema.budgets.id, budgetId),
        eq(schema.budgets.eventId, eventId),
        visibleBudgetFilter(callerProfileIds(request)),
      ),
    );
  if (!budget) throw notFound("Budget not found");
  return budget;
}

/**
 * The budget-line columns that name an `event_participants` row. Each one answers
 * "who physically handled this cash" for the reconciliation, so each one must name
 * a participant of THIS event.
 */
const PARTICIPANT_REFERENCE_FIELDS = ["collectedBy", "paidBy", "payeeParticipantId"] as const;

type ParticipantReferenceField = (typeof PARTICIPANT_REFERENCE_FIELDS)[number];

/** The reference-carrying half of a create/update line body. */
type LineReferences = Partial<Record<ParticipantReferenceField, string | null>> & {
  dealId?: string | null;
  attributedDealId?: string | null;
  /** Participant ids appear as the KEYS here, so they need the same event check. */
  costSplit?: Record<string, number> | null;
};

/**
 * Every reference on a line must point INSIDE this event (audit A-14).
 *
 * The columns are plain foreign keys to `event_participants` / `deals`, so Postgres
 * only ever asked "does this row exist" — never "does it belong here". A `collectedBy`
 * naming another event's participant was therefore accepted, and the settlement then
 * failed forever: `reconcile()` raises the pool by that revenue but attributes the cash
 * to nobody in this event's participant set, so `Σ net ≠ 0` and `assertBalanced` throws
 * on every subsequent compute. The cheapest id to send by mistake is a *profile* id,
 * which is a real uuid of the wrong kind entirely — hence the hint in the message.
 *
 * A dangling id and another event's id collapse into ONE message on purpose: the
 * caller holds `budget.edit` here and nowhere else, so telling them which foreign ids
 * exist would be an existence oracle over events they cannot see. Either way the fix
 * is the same — send a participant id from this event.
 *
 * Mirrors `assertPartiesAreEntitled` in `deals.ts`; both are 400, because the request
 * body is what is wrong.
 */
async function assertLineReferencesBelongToEvent(
  request: FastifyRequest,
  eventId: string,
  line: LineReferences,
): Promise<void> {
  const { database } = request.server;

  const referencedParticipantIds = [
    ...new Set([
      ...PARTICIPANT_REFERENCE_FIELDS.map((field) => line[field]).filter(
        (value): value is string => typeof value === "string",
      ),
      // A cost split names its bearers as object KEYS. They reach `reconcile()`
      // exactly as `payeeParticipantId` does — a foreign id there breaks the
      // conservation law by the same arithmetic, so it gets the same check.
      ...Object.keys(line.costSplit ?? {}),
    ]),
  ];
  if (referencedParticipantIds.length > 0) {
    const rows = await database
      .select({ id: schema.eventParticipants.id })
      .from(schema.eventParticipants)
      .where(
        and(
          eq(schema.eventParticipants.eventId, eventId),
          inArray(schema.eventParticipants.id, referencedParticipantIds),
        ),
      );
    const participantsOnThisEvent = new Set(rows.map((row) => row.id));
    for (const field of PARTICIPANT_REFERENCE_FIELDS) {
      const value = line[field];
      if (typeof value === "string" && !participantsOnThisEvent.has(value)) {
        throw badRequest(
          `${field} ${value} is not a participant on this event. Send a participant id from GET /events/${eventId}/participants — not a profile id.`,
        );
      }
    }
    for (const participantId of Object.keys(line.costSplit ?? {})) {
      if (!participantsOnThisEvent.has(participantId)) {
        throw badRequest(
          `costSplit names ${participantId}, which is not a participant on this event. Send a participant id from GET /events/${eventId}/participants — not a profile id.`,
        );
      }
    }
  }

  // Both ways a line can name a deal (see `budget_lines` in the schema): `dealId`
  // says the line IS that deal's own figure, `attributedDealId` says it is a real
  // cost reported under it. A deal from ANOTHER event is wrong either way — the
  // first would drop the line from a settlement that never sees the deal, the
  // second would file this event's cost under a night it has nothing to do with.
  for (const field of ["dealId", "attributedDealId"] as const) {
    const value = line[field];
    if (typeof value !== "string") continue;
    const [deal] = await database
      .select({ id: schema.deals.id })
      .from(schema.deals)
      .where(and(eq(schema.deals.id, value), eq(schema.deals.eventId, eventId)));
    if (!deal) {
      throw badRequest(`${field} ${value} is not a deal on this event`);
    }
  }
}

/**
 * Every line must say WHO HELD THE CASH (audit A-14, second half).
 *
 * `collected_by` / `paid_by` are nullable columns, so a line could simply omit the
 * field — and an omitted attribution produces the exact state a cross-event id
 * produced, by the same arithmetic. `reconcile()` moves the pool by the amount
 * either way (step 1 sums every revenue and every payee-less cost), but step 4 only
 * credits `held` to a NAMED participant. Unnamed, the cash is in the pool and in
 * nobody's hands, `Σ net ≠ 0`, and `assertBalanced` throws on every compute from
 * then on. A revenue line nobody collected is money from nowhere; a cost line
 * nobody paid is its mirror image.
 *
 * `payeeParticipantId` stays optional on purpose and is NOT checked here: NULL there
 * means the cost went to an off-platform supplier, which is the ordinary case (it is
 * what makes the line an external pool cost rather than a deductible) and it
 * reconciles correctly today.
 */
function assertCashIsAttributed(line: {
  kind: "revenue" | "cost";
  collectedBy?: string | null;
  paidBy?: string | null;
}): void {
  if (line.kind === "revenue" && !line.collectedBy) {
    throw badRequest(
      "A revenue line must name collectedBy — the participant who received the cash. Revenue nobody collected raises the pool while nobody holds it, and the settlement can never balance.",
    );
  }
  if (line.kind === "cost" && !line.paidBy) {
    throw badRequest(
      "A cost line must name paidBy — the participant who fronted the cash. A cost nobody paid lowers the pool while nobody is out of pocket, and the settlement can never balance.",
    );
  }
}

/**
 * A cost bears ONE rule (2026-08 settlements meeting, 01:06:31: *"the production
 * system requires a defined rule: either a cost split or a single payer"*).
 *
 * Three refusals, each protecting a different thing:
 *
 * 1. **A split and a payee together** — they are the same mechanism at two
 *    settings (`cost-bearing.ts`), so a line carrying both states the rule twice
 *    and the engine would have to guess which one the operator meant. It reads
 *    the split, silently; a 400 says so instead.
 * 2. **A split totalling over 100%** — charges out more than the line is worth.
 *    The pool would have to make up the difference out of nothing, and `Σ net = 0`
 *    would hold while the operator's residual quietly ate an amount nobody
 *    entered. (Under 100% is fine and deliberate: the remainder stays a pool cost.)
 * 3. **A split on a revenue line** — the rule says who BEARS a cost. Revenue has
 *    a collector, not bearers; `reconcile()` never reads the column on a revenue
 *    line, so accepting it would store a term that does nothing.
 * 4. **Both ways of naming a deal at once** — `dealId` means the line IS that
 *    deal's figure (settlement takes it from the deal and drops the line);
 *    `attributedDealId` means a real cost reported under the deal (settlement
 *    counts it). Together they ask for the amount to be both ignored and spent.
 *    The database refuses it too (`budget_lines_one_deal_sense`); this turns that
 *    into a sentence a client can act on rather than a constraint violation.
 */
function assertCostRuleIsCoherent(line: {
  kind: "revenue" | "cost";
  payeeParticipantId?: string | null;
  costSplit?: Record<string, number> | null;
  dealId?: string | null;
  attributedDealId?: string | null;
}): void {
  if (line.dealId && line.attributedDealId) {
    throw badRequest(
      "A cost either IS a deal's own figure (dealId) or is a real cost reported under one (attributedDealId) — never both. The first is taken from the deal and never counted as cash; the second lowers the settlement pool like any other cost.",
    );
  }

  const split = line.costSplit;
  if (!split || Object.keys(split).length === 0) return;

  if (line.kind !== "cost") {
    throw badRequest(
      "costSplit says who BEARS a cost, so it belongs only on a cost line. Revenue names a collector (collectedBy), not bearers.",
    );
  }
  if (line.payeeParticipantId) {
    throw badRequest(
      "A cost is borne either by a split or by a single payer, not both. Send costSplit on its own, or payeeParticipantId on its own (which is the same rule at 100% for one party).",
    );
  }
  const total = Object.values(split).reduce((running, points) => running + points, 0);
  if (total > 10_000) {
    throw badRequest(
      `The cost split adds up to ${(total / 100).toFixed(2)}%, which charges out more than the line is worth. It may total less than 100% — the remainder stays a shared cost — but never more.`,
    );
  }
}

/**
 * Does this budget belong in the event's history at all?
 *
 * Only a SHARED budget does. A `private` budget is one operator's own margin work,
 * readable by its owning profile alone (`visibleBudgetFilter`), and the feed has no
 * owner-scoped tier: kind `budget` is the OPERATOR tier, so a row about a private
 * budget would be handed to every co-promoter holding `budget.view` — precisely the
 * competitor the private scope exists to keep out. The change is still recorded, in
 * `audit_log`, which is admin-only and never rendered to a co-host.
 */
function belongsInEventHistory(budget: typeof schema.budgets.$inferSelect): boolean {
  return budget.scope === "shared";
}

/**
 * The fields a line PATCH actually moved. Names only, never values: kind `budget`
 * admits every `budget.view` holder, and `lib/activity.ts` keeps money out of a
 * summary as an absolute rule rather than a per-kind judgement call.
 */
function changedLineFieldNames(
  before: typeof schema.budgetLines.$inferSelect,
  after: typeof schema.budgetLines.$inferSelect,
): string[] {
  const tracked = [
    "kind",
    "source",
    "label",
    "amount",
    "currency",
    "collectedBy",
    "paidBy",
    "payeeParticipantId",
    "costSplit",
    "dealId",
    "attributedDealId",
    "details",
  ] as const;
  return tracked.filter((field) => String(before[field] ?? "") !== String(after[field] ?? ""));
}

export async function budgetRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // List the event's budgets with their lines. `budget.view` is operator-only
  // (ceiling in the auth engine), so arm's-length parties are already kept out.
  app.get(
    "/events/:id/budgets",
    { schema: { params: EventParams, response: { 200: z.array(BudgetResponse) } } },
    async (request) => {
      const { database } = request.server;
      const { id } = request.params;

      await requireEventCapability(request, id, "budget.view");

      // Give the caller's operating profile its budget if it has not got one.
      // `budget.view` above already established they operate this event, and
      // provisioning is idempotent, so this is a no-op on every read but the
      // first. Without it a newly created event has no budget row and the
      // planner has nothing to open.
      await ensureEventBudgets(database, id, callerProfileIds(request));

      // The access predicate lives in the WHERE: shared budgets for every
      // co-operator, private ones only for their owner.
      const budgets = await database
        .select()
        .from(schema.budgets)
        .where(and(eq(schema.budgets.eventId, id), visibleBudgetFilter(callerProfileIds(request))));

      if (budgets.length === 0) return [];

      const lines = await database
        .select()
        .from(schema.budgetLines)
        .where(
          inArray(
            schema.budgetLines.budgetId,
            budgets.map((budget) => budget.id),
          ),
        );
      const linesByBudget = new Map<string, (typeof lines)[number][]>();
      for (const line of lines) {
        const bucket = linesByBudget.get(line.budgetId);
        if (bucket) bucket.push(line);
        else linesByBudget.set(line.budgetId, [line]);
      }

      const result: SerializedBudget[] = budgets.map((budget) =>
        serializeBudget(budget, linesByBudget.get(budget.id) ?? []),
      );
      return result;
    },
  );

  // Create a budget (shared, or private to one operator).
  app.post(
    "/events/:id/budgets",
    { schema: { params: EventParams, body: CreateBudgetBody, response: { 201: BudgetResponse } } },
    async (request, reply) => {
      const { database } = request.server;
      const { id } = request.params;

      await requireEventCapability(request, id, "budget.edit");

      const { scope, ownerProfileId } = request.body;
      if (scope === "private" && !ownerProfileId) {
        throw badRequest("A private budget requires ownerProfileId");
      }
      if (scope === "shared" && ownerProfileId) {
        throw badRequest("A shared budget cannot have an ownerProfileId");
      }
      // A private budget is that operator's own — nobody may open one in a
      // profile they are not a member of (and then read it back).
      if (ownerProfileId && !callerProfileIds(request).includes(ownerProfileId)) {
        throw forbidden("You are not a member of that profile");
      }

      const created = await database.transaction(async (tx) => {
        const [budget] = await tx
          .insert(schema.budgets)
          .values({ eventId: id, scope, ownerProfileId: ownerProfileId ?? null })
          .returning();
        if (!budget) throw new Error("budget create failed");
        const serialized = serializeBudget(budget, []);
        await writeAudit(tx, request, {
          capability: "budget.edit",
          action: "budget.create",
          targetKind: "budget",
          targetId: budget.id,
          eventId: id,
          after: serialized,
        });
        if (belongsInEventHistory(budget)) {
          await writeActivity(tx, request, {
            eventId: id,
            type: "budget.created",
            targetKind: "budget",
            targetId: budget.id,
            summary: { scope: budget.scope },
          });
        }
        return serialized;
      });

      return reply.status(201).send(created);
    },
  );

  /**
   * Record the planner's standing assumptions on a budget.
   *
   * Separate from the line routes because this is not a line: no cash moved, so
   * nothing here reaches `reconcile()`. `budget.edit` all the same — the figure it
   * changes is the projected margin the operator makes decisions on.
   */
  app.patch(
    "/events/:id/budgets/:bid",
    { schema: { params: BudgetParams, body: UpdateBudgetBody, response: { 200: BudgetResponse } } },
    async (request) => {
      const { database } = request.server;
      const { id, bid } = request.params;

      await requireEventCapability(request, id, "budget.edit");
      const before = await loadVisibleBudget(request, id, bid);

      const { planningAssumptions, expectedVersion } = request.body;
      const where =
        expectedVersion != null
          ? and(eq(schema.budgets.id, bid), eq(schema.budgets.version, expectedVersion))
          : eq(schema.budgets.id, bid);

      return await database.transaction(async (tx) => {
        const [after] = await tx
          .update(schema.budgets)
          .set({ planningAssumptions, version: before.version + 1 })
          .where(where)
          .returning();
        if (!after) {
          // The row exists (loadVisibleBudget found it) but the version moved.
          throw conflict("Budget was changed by someone else; reload and retry");
        }

        // The response is the whole budget, lines included, so the planner can
        // reseed from one payload rather than re-reading the list behind it.
        const lines = await tx
          .select()
          .from(schema.budgetLines)
          .where(eq(schema.budgetLines.budgetId, bid));
        const serialized = serializeBudget(after, lines);
        await writeAudit(tx, request, {
          capability: "budget.edit",
          action: "budget.update",
          targetKind: "budget",
          targetId: bid,
          eventId: id,
          before: serializeBudget(before, []),
          after: serialized,
        });
        // The planner's standing assumptions moved — the projected margin the
        // co-promoters make decisions on. That it moved is the news; by how much
        // is a figure, and figures stay out of summaries.
        if (belongsInEventHistory(after)) {
          await writeActivity(tx, request, {
            eventId: id,
            type: "budget.assumptions_updated",
            targetKind: "budget",
            targetId: bid,
            summary: { scope: after.scope },
          });
        }
        return serialized;
      });
    },
  );

  // List one budget's lines.
  app.get(
    "/events/:id/budgets/:bid/lines",
    { schema: { params: BudgetParams, response: { 200: z.array(BudgetLineResponse) } } },
    async (request) => {
      const { database } = request.server;
      const { id, bid } = request.params;

      await requireEventCapability(request, id, "budget.view");
      await loadVisibleBudget(request, id, bid);

      const lines = await database
        .select()
        .from(schema.budgetLines)
        .where(eq(schema.budgetLines.budgetId, bid));
      return lines.map(serializeBudgetLine);
    },
  );

  // Add a revenue or cost line to a budget.
  app.post(
    "/events/:id/budgets/:bid/lines",
    {
      schema: { params: BudgetParams, body: CreateLineBody, response: { 201: BudgetLineResponse } },
    },
    async (request, reply) => {
      const { database } = request.server;
      const { id, bid } = request.params;

      await requireEventCapability(request, id, "budget.edit");
      const budget = await loadVisibleBudget(request, id, bid);

      const body = request.body;
      // Every participant/deal reference must point inside this event, and the cash
      // must be attributed to somebody (A-14) — both checked BEFORE the insert, so
      // neither a foreign id nor an unattributed amount becomes a stored row.
      await assertLineReferencesBelongToEvent(request, id, body);
      assertCashIsAttributed(body);
      assertCostRuleIsCoherent(body);

      const created = await database.transaction(async (tx) => {
        const [line] = await tx
          .insert(schema.budgetLines)
          .values({
            budgetId: bid,
            kind: body.kind,
            source: body.source,
            providerRef: body.providerRef ?? null,
            label: body.label,
            amount: BigInt(body.amount), // string → bigint minor units (money.md)
            currency: body.currency ?? null,
            collectedBy: body.collectedBy ?? null,
            paidBy: body.paidBy ?? null,
            payeeParticipantId: body.payeeParticipantId ?? null,
            costSplit: body.costSplit ?? null,
            dealId: body.dealId ?? null,
            attributedDealId: body.attributedDealId ?? null,
            details: body.details ?? null,
          })
          .returning();
        if (!line) throw new Error("budget line create failed");
        const serialized = serializeBudgetLine(line);
        await writeAudit(tx, request, {
          capability: "budget.edit",
          action: "budget_line.create",
          targetKind: "budget_line",
          targetId: line.id,
          eventId: id,
          after: serialized,
        });
        // Kind `budget`, not `budget_line`: the feed's visibility vocabulary is the
        // BUDGET (operator tier), and a line has no access rule of its own — it is
        // reachable exactly when its budget is. The line's id travels in the summary
        // so the history still names which line moved.
        if (belongsInEventHistory(budget)) {
          await writeActivity(tx, request, {
            eventId: id,
            type: "budget.line_added",
            targetKind: "budget",
            targetId: bid,
            summary: { lineId: line.id, lineKind: line.kind, label: line.label },
          });
        }
        return serialized;
      });

      return reply.status(201).send(created);
    },
  );

  // Edit a line — optimistic-locked on version.
  app.patch(
    "/events/:id/budgets/:bid/lines/:lid",
    { schema: { params: LineParams, body: UpdateLineBody, response: { 200: BudgetLineResponse } } },
    async (request) => {
      const { database } = request.server;
      const { id, bid, lid } = request.params;

      await requireEventCapability(request, id, "budget.edit");
      const budget = await loadVisibleBudget(request, id, bid);

      const [before] = await database
        .select()
        .from(schema.budgetLines)
        .where(and(eq(schema.budgetLines.id, lid), eq(schema.budgetLines.budgetId, bid)));
      if (!before) throw notFound("Budget line not found");

      // The same two rules the create path enforces (A-14) — an edit that repoints
      // `collectedBy` at a foreign participant, or that NULLs it, poisons the
      // settlement exactly as a create would.
      await assertLineReferencesBelongToEvent(request, id, request.body);
      // Validate the row the edit WOULD PRODUCE, not the patch: `kind` and the
      // attribution field move independently, so flipping a paid-for cost into a
      // revenue line has to leave a `collectedBy` behind it.
      assertCashIsAttributed({
        kind: request.body.kind ?? before.kind,
        collectedBy:
          request.body.collectedBy !== undefined ? request.body.collectedBy : before.collectedBy,
        paidBy: request.body.paidBy !== undefined ? request.body.paidBy : before.paidBy,
      });
      // Same reasoning as the attribution check above: validate the row the edit
      // WOULD PRODUCE. A patch that adds a split to a line that already carries a
      // payee states the bearing rule twice, however it got into that state.
      assertCostRuleIsCoherent({
        kind: request.body.kind ?? before.kind,
        payeeParticipantId:
          request.body.payeeParticipantId !== undefined
            ? request.body.payeeParticipantId
            : before.payeeParticipantId,
        costSplit:
          request.body.costSplit !== undefined
            ? request.body.costSplit
            : (before.costSplit as Record<string, number> | null),
        dealId: request.body.dealId !== undefined ? request.body.dealId : before.dealId,
        attributedDealId:
          request.body.attributedDealId !== undefined
            ? request.body.attributedDealId
            : before.attributedDealId,
      });

      const { expectedVersion, amount, ...rest } = request.body;
      const fields: Partial<typeof schema.budgetLines.$inferInsert> = { ...rest };
      if (amount !== undefined) {
        fields.amount = BigInt(amount); // string → bigint minor units (money.md)
      }

      const where =
        expectedVersion != null
          ? and(eq(schema.budgetLines.id, lid), eq(schema.budgetLines.version, expectedVersion))
          : eq(schema.budgetLines.id, lid);

      const updated = await database.transaction(async (tx) => {
        const [after] = await tx
          .update(schema.budgetLines)
          .set({ ...fields, version: before.version + 1 })
          .where(where)
          .returning();
        if (!after) {
          // The row exists (checked above) but the version moved → conflict.
          throw conflict("Budget line was changed by someone else; reload and retry");
        }
        const serialized: SerializedBudgetLine = serializeBudgetLine(after);
        await writeAudit(tx, request, {
          capability: "budget.edit",
          action: "budget_line.update",
          targetKind: "budget_line",
          targetId: lid,
          eventId: id,
          before: serializeBudgetLine(before),
          after: serialized,
        });
        const changed = changedLineFieldNames(before, after);
        if (belongsInEventHistory(budget) && changed.length > 0) {
          await writeActivity(tx, request, {
            eventId: id,
            type: "budget.line_updated",
            targetKind: "budget",
            targetId: bid,
            summary: { lineId: lid, label: after.label, fields: changed },
          });
        }
        return serialized;
      });

      return updated;
    },
  );

  // Delete a line — optimistic-locked on version.
  app.delete(
    "/events/:id/budgets/:bid/lines/:lid",
    {
      schema: {
        params: LineParams,
        body: DeleteLineBody,
        response: { 200: z.object({ deleted: z.boolean() }) },
      },
    },
    async (request) => {
      const { database } = request.server;
      const { id, bid, lid } = request.params;

      await requireEventCapability(request, id, "budget.edit");
      const budget = await loadVisibleBudget(request, id, bid);

      const [before] = await database
        .select()
        .from(schema.budgetLines)
        .where(and(eq(schema.budgetLines.id, lid), eq(schema.budgetLines.budgetId, bid)));
      if (!before) throw notFound("Budget line not found");

      const { expectedVersion } = request.body;
      const where =
        expectedVersion != null
          ? and(eq(schema.budgetLines.id, lid), eq(schema.budgetLines.version, expectedVersion))
          : eq(schema.budgetLines.id, lid);

      await database.transaction(async (tx) => {
        const [deleted] = await tx.delete(schema.budgetLines).where(where).returning();
        if (!deleted) {
          throw conflict("Budget line was changed by someone else; reload and retry");
        }
        await writeAudit(tx, request, {
          capability: "budget.edit",
          action: "budget_line.delete",
          targetKind: "budget_line",
          targetId: lid,
          eventId: id,
          before: serializeBudgetLine(before),
        });
        // The line is gone from the budget; the history row that says so is not,
        // and it names what was removed.
        if (belongsInEventHistory(budget)) {
          await writeActivity(tx, request, {
            eventId: id,
            type: "budget.line_removed",
            targetKind: "budget",
            targetId: bid,
            summary: { lineId: lid, lineKind: before.kind, label: before.label },
          });
        }
      });

      return { deleted: true };
    },
  );
}
