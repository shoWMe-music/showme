import { schema } from "@showme/db";
import { type SQL, and, eq, inArray, or } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { badRequest, conflict, forbidden, notFound } from "../errors";
import { writeAudit } from "../lib/audit";
import { requireEventCapability } from "../lib/authorize";
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

const CreateLineBody = z.object({
  kind: z.enum(["revenue", "cost"]),
  /** Provenance of a revenue line (decisions #15) — `manual` unless synced. */
  source: ticketingSourceEnum.default("manual"),
  providerRef: z.string().optional(),
  label: z.string().min(1),
  amount: z.string().min(1),
  currency: z.string().min(1).optional(),
  collectedBy: z.string().uuid().optional(),
  paidBy: z.string().uuid().optional(),
  payeeParticipantId: z.string().uuid().optional(),
  dealId: z.string().uuid().optional(),
});

const UpdateLineBody = z.object({
  kind: z.enum(["revenue", "cost"]).optional(),
  label: z.string().min(1).optional(),
  amount: z.string().min(1).optional(),
  currency: z.string().min(1).nullable().optional(),
  collectedBy: z.string().uuid().nullable().optional(),
  paidBy: z.string().uuid().nullable().optional(),
  payeeParticipantId: z.string().uuid().nullable().optional(),
  dealId: z.string().uuid().nullable().optional(),
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
  dealId: z.string().nullable(),
  version: z.number(),
});

const BudgetResponse = z.object({
  id: z.string(),
  eventId: z.string(),
  scope: z.string(),
  ownerProfileId: z.string().nullable(),
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
        return serialized;
      });

      return reply.status(201).send(created);
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
      await loadVisibleBudget(request, id, bid);

      const body = request.body;
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
            dealId: body.dealId ?? null,
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
      await loadVisibleBudget(request, id, bid);

      const [before] = await database
        .select()
        .from(schema.budgetLines)
        .where(and(eq(schema.budgetLines.id, lid), eq(schema.budgetLines.budgetId, bid)));
      if (!before) throw notFound("Budget line not found");

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
      await loadVisibleBudget(request, id, bid);

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
      });

      return { deleted: true };
    },
  );
}
