import { schema } from "@showme/db";
import {
  type SettlementBudgetLine,
  type SettlementDeal,
  type SettlementInput,
  type SettlementParticipant,
  assertBalanced,
  reconcile,
} from "@showme/settlement";
import { convertMinorUnits } from "@showme/shared";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { badRequest, conflict, notFound } from "../errors";
import { writeAudit } from "../lib/audit";
import { requireEventCapability } from "../lib/authorize";
import { syncCommissionSettlements } from "../lib/commission-settlement";
import { loadRatesToBase } from "../lib/exchange-rate";
import { notifyUsers, settlementRecipients } from "../lib/notify";
import { withIdempotency } from "../plugins/idempotency";
import {
  type SerializedSummary,
  serializeBreakdown,
  serializeCommission,
  serializeSettlement,
  serializeTransfer,
} from "../serialize/settlement";

const EventParams = z.object({ id: z.string().uuid() });
const SettlementParams = z.object({ id: z.string().uuid(), sid: z.string().uuid() });
const TransferParams = z.object({ id: z.string().uuid(), tid: z.string().uuid() });

const BreakdownResponse = z.object({
  participantId: z.string(),
  entitlement: z.string(),
  collected: z.string(),
  paid: z.string(),
  held: z.string(),
  net: z.string(),
});

const TransferResponse = z.object({
  id: z.string().optional(),
  fromParticipantId: z.string(),
  toParticipantId: z.string(),
  amount: z.string(),
  state: z.string().optional(),
  version: z.number().optional(),
  representationId: z.string().nullable().optional(),
});

const CommissionResponse = z.object({
  id: z.string(),
  representationId: z.string(),
  performerParticipantId: z.string(),
  agentParticipantId: z.string(),
  performerEntitlement: z.string(),
  commission: z.string(),
  agentCollects: z.boolean(),
  status: z.string(),
  version: z.number(),
});

const SummaryResponse = z.object({
  baseCurrency: z.string(),
  pool: z.string(),
  breakdowns: z.array(BreakdownResponse),
  transfers: z.array(TransferResponse),
});

const SettlementResponse = z.object({
  id: z.string(),
  participantId: z.string().nullable(),
  status: z.string(),
  computed: BreakdownResponse.nullable(),
  version: z.number(),
});

const SettlementsResponse = z.object({
  settlements: z.array(SettlementResponse),
  transfers: z.array(TransferResponse),
  // Private agent↔performer commissions (decisions #14) — empty for the operator.
  commissions: z.array(CommissionResponse),
});

const OverrideBody = z.object({
  manualOverrides: z.record(z.string(), z.unknown()),
  expectedVersion: z.number().int().optional(),
});

const TransferStateBody = z.object({
  state: z.enum(["owed", "paid", "handled"]),
  expectedVersion: z.number().int().optional(),
});

const OPERATOR_EVENT_ROLES = new Set(["host", "co_host"]);

/** Pull a weight (basis points) out of a deal party's `share` jsonb, if it carries one. */
function weightFromShare(share: unknown): number | null {
  if (typeof share === "number") return share;
  if (share && typeof share === "object") {
    const record = share as Record<string, unknown>;
    if (typeof record.basisPoints === "number") return record.basisPoints;
    if (typeof record.share === "number") return record.share;
  }
  return null;
}

export async function settlementRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // Compute: build the engine input from the DB spine, reconcile, persist one
  // settlement per participant + the transfers. Idempotent (money-adjacent).
  app.post(
    "/events/:id/settlement/compute",
    { schema: { params: EventParams, response: { 200: SummaryResponse } } },
    async (request, reply) => {
      const { database } = request.server;
      const { id } = request.params;

      await requireEventCapability(request, id, "settlement.edit");

      const participantRows = await database
        .select()
        .from(schema.eventParticipants)
        .where(eq(schema.eventParticipants.eventId, id));

      const participants: SettlementParticipant[] = participantRows.map((row) => ({
        participantId: row.id,
        isOperator: OPERATOR_EVENT_ROLES.has(row.role),
      }));

      const dealRows = await database
        .select()
        .from(schema.deals)
        .where(eq(schema.deals.eventId, id));
      const dealIds = dealRows.map((deal) => deal.id);
      const partyRows =
        dealIds.length > 0
          ? await database
              .select()
              .from(schema.dealParties)
              .where(inArray(schema.dealParties.dealId, dealIds))
          : [];

      const lineRows = await database
        .select({
          kind: schema.budgetLines.kind,
          amount: schema.budgetLines.amount,
          currency: schema.budgetLines.currency,
          collectedBy: schema.budgetLines.collectedBy,
          paidBy: schema.budgetLines.paidBy,
          payeeParticipantId: schema.budgetLines.payeeParticipantId,
        })
        .from(schema.budgetLines)
        .innerJoin(schema.budgets, eq(schema.budgets.id, schema.budgetLines.budgetId))
        .where(eq(schema.budgets.eventId, id));

      const [event] = await database
        .select({ baseCurrency: schema.events.baseCurrency })
        .from(schema.events)
        .where(eq(schema.events.id, id));
      if (!event) throw notFound("Event not found");
      const baseCurrency = event.baseCurrency;

      // Multi-currency: convert every non-base deal/line to base at the CURRENT cached
      // rate BEFORE reconciling — the engine's Σnet=0 runs purely in base (money.md).
      // Rates are live here and frozen into the snapshot at finalize.
      const rates = await loadRatesToBase(database, baseCurrency, [
        ...dealRows.map((deal) => deal.currency ?? baseCurrency),
        ...lineRows.map((line) => line.currency ?? baseCurrency),
      ]);
      const toBase = (amount: bigint, currency: string | null): bigint => {
        const from = currency ?? baseCurrency;
        if (from === baseCurrency) return amount;
        const rate = rates.get(from);
        if (!rate) throw badRequest(`No exchange rate cached for ${from}→${baseCurrency}`);
        return convertMinorUnits(amount, from, baseCurrency, rate);
      };

      const deals: SettlementDeal[] = dealRows.map((deal) => {
        const parties = partyRows.filter((party) => party.dealId === deal.id);
        const payees = parties.filter(
          (party) => party.roleInDeal === "payee" || party.roleInDeal === "split_member",
        );
        const partyShares: Record<string, number> = {};
        let hasShares = false;
        for (const payee of payees) {
          const weight = weightFromShare(payee.share);
          if (weight != null) {
            partyShares[payee.participantId] = weight;
            hasShares = true;
          }
        }
        return {
          dealId: deal.id,
          structure: deal.structure,
          payeeParticipantIds: payees.map((payee) => payee.participantId),
          guaranteeAmount:
            deal.guaranteeAmount != null ? toBase(deal.guaranteeAmount, deal.currency) : undefined,
          splitBasisPoints: deal.splitBasisPoints ?? undefined,
          partyShares: hasShares ? partyShares : undefined,
        };
      });

      const budgetLines: SettlementBudgetLine[] = lineRows.map((line) => ({
        kind: line.kind,
        amount: toBase(line.amount, line.currency),
        collectedBy: line.collectedBy ?? undefined,
        paidBy: line.paidBy ?? undefined,
        payeeParticipantId: line.payeeParticipantId ?? undefined,
      }));

      const input: SettlementInput = { baseCurrency, participants, deals, budgetLines };

      const result = reconcile(input);
      assertBalanced(result);

      const { statusCode, body } = await withIdempotency<SerializedSummary>(
        request,
        "POST /events/:id/settlement/compute",
        async () => {
          const summary = await database.transaction(async (tx) => {
            // Recompute is idempotent per participant: clear the prior derived rows.
            await tx
              .delete(schema.settlementTransfers)
              .where(eq(schema.settlementTransfers.eventId, id));
            await tx
              .delete(schema.settlements)
              .where(
                and(
                  eq(schema.settlements.eventId, id),
                  isNotNull(schema.settlements.participantId),
                ),
              );

            for (const breakdown of result.breakdowns) {
              await tx.insert(schema.settlements).values({
                eventId: id,
                participantId: breakdown.participantId,
                computed: serializeBreakdown(breakdown),
              });
            }
            if (result.transfers.length > 0) {
              await tx.insert(schema.settlementTransfers).values(
                result.transfers.map((transfer) => ({
                  eventId: id,
                  fromParticipant: transfer.fromParticipantId,
                  toParticipant: transfer.toParticipantId,
                  amount: transfer.amount,
                  currency: result.baseCurrency,
                })),
              );
            }

            // Private agent↔performer commission (decisions #14) — settles separately,
            // outside the event's Σnet=0, on every event the agent is present.
            await syncCommissionSettlements(tx, id, result.breakdowns, result.baseCurrency);

            await writeAudit(tx, request, {
              capability: "settlement.edit",
              action: "settlement.compute",
              targetKind: "event",
              targetId: id,
              eventId: id,
              after: { pool: result.pool.toString() },
            });

            return {
              baseCurrency: result.baseCurrency,
              pool: result.pool.toString(),
              breakdowns: result.breakdowns.map(serializeBreakdown),
              transfers: result.transfers.map((transfer) => ({
                fromParticipantId: transfer.fromParticipantId,
                toParticipantId: transfer.toParticipantId,
                amount: transfer.amount.toString(),
              })),
            } satisfies SerializedSummary;
          });
          return { statusCode: 200, body: summary };
        },
      );

      return reply.status(statusCode as 200).send(body);
    },
  );

  // Read: an operator (budget.view) sees every settlement/transfer; anyone else
  // sees only their own lines (participant-scoped, per decisions #4).
  app.get(
    "/events/:id/settlements",
    { schema: { params: EventParams, response: { 200: SettlementsResponse } } },
    async (request) => {
      const { database } = request.server;
      const { id } = request.params;
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");

      const capabilities = await requireEventCapability(request, id, "settlement.view.own");

      const settlementRows = await database
        .select()
        .from(schema.settlements)
        .where(eq(schema.settlements.eventId, id));
      const transferRows = await database
        .select()
        .from(schema.settlementTransfers)
        .where(eq(schema.settlementTransfers.eventId, id));

      // The operator sees the whole event settlement, but NEVER the private agent↔
      // performer commission (decisions #14): representation-scoped settlements and
      // their transfers are filtered out entirely.
      if (capabilities.has("budget.view")) {
        return {
          settlements: settlementRows
            .filter((row) => !row.representationId)
            .map(serializeSettlement),
          transfers: transferRows.filter((row) => !row.representationId).map(serializeTransfer),
          commissions: [],
        };
      }

      // Non-operator: narrow to the participant ids the caller's profiles hold.
      const profileIds = principal.memberships.map((membership) => membership.profileId);
      const mine =
        profileIds.length > 0
          ? await database
              .select({ id: schema.eventParticipants.id })
              .from(schema.eventParticipants)
              .where(
                and(
                  eq(schema.eventParticipants.eventId, id),
                  inArray(schema.eventParticipants.profileId, profileIds),
                ),
              )
          : [];
      const myParticipantIds = new Set(mine.map((row) => row.id));

      // A commission settlement is visible only to its two parties (performer/agent).
      const isMyCommission = (row: (typeof settlementRows)[number]) => {
        if (!row.representationId) return false;
        const computed = row.computed as {
          performerParticipantId?: string;
          agentParticipantId?: string;
        } | null;
        return (
          (computed?.performerParticipantId != null &&
            myParticipantIds.has(computed.performerParticipantId)) ||
          (computed?.agentParticipantId != null &&
            myParticipantIds.has(computed.agentParticipantId))
        );
      };

      return {
        settlements: settlementRows
          .filter((row) => row.participantId && myParticipantIds.has(row.participantId))
          .map(serializeSettlement),
        transfers: transferRows
          .filter(
            (row) =>
              myParticipantIds.has(row.fromParticipant) || myParticipantIds.has(row.toParticipant),
          )
          .map(serializeTransfer),
        commissions: settlementRows.filter(isMyCommission).map(serializeCommission),
      };
    },
  );

  // Manual override: operator corrections into `manual_overrides` jsonb, version-locked.
  app.patch(
    "/events/:id/settlements/:sid",
    {
      schema: {
        params: SettlementParams,
        body: OverrideBody,
        response: { 200: SettlementResponse },
      },
    },
    async (request) => {
      const { database } = request.server;
      const { id, sid } = request.params;

      await requireEventCapability(request, id, "settlement.edit");

      const [before] = await database
        .select()
        .from(schema.settlements)
        .where(and(eq(schema.settlements.id, sid), eq(schema.settlements.eventId, id)));
      if (!before) throw notFound("Settlement not found");

      const { expectedVersion, manualOverrides } = request.body;
      const where =
        expectedVersion != null
          ? and(eq(schema.settlements.id, sid), eq(schema.settlements.version, expectedVersion))
          : eq(schema.settlements.id, sid);

      const updated = await database.transaction(async (tx) => {
        const [after] = await tx
          .update(schema.settlements)
          .set({ manualOverrides, version: before.version + 1, updatedAt: new Date() })
          .where(where)
          .returning();
        if (!after) {
          throw conflict("Settlement was changed by someone else; reload and retry");
        }
        await writeAudit(tx, request, {
          capability: "settlement.edit",
          action: "settlement.override",
          targetKind: "settlement",
          targetId: sid,
          eventId: id,
          before,
          after,
        });
        return after;
      });

      return serializeSettlement(updated);
    },
  );

  // Confirm: record the party's approval of their settlement.
  app.post(
    "/events/:id/settlements/:sid/confirm",
    {
      schema: {
        params: SettlementParams,
        response: { 200: z.object({ id: z.string(), approved: z.boolean() }) },
      },
    },
    async (request) => {
      const { database } = request.server;
      const { id, sid } = request.params;

      await requireEventCapability(request, id, "settlement.confirm");

      const [settlement] = await database
        .select()
        .from(schema.settlements)
        .where(and(eq(schema.settlements.id, sid), eq(schema.settlements.eventId, id)));
      if (!settlement) throw notFound("Settlement not found");
      if (!settlement.participantId) {
        throw badRequest("Only a participant settlement can be confirmed");
      }

      const approval = await database.transaction(async (tx) => {
        const [row] = await tx
          .insert(schema.settlementApprovals)
          .values({
            eventId: id,
            partyParticipantId: settlement.participantId as string,
            approved: true,
            approvedAt: new Date(),
          })
          .returning();
        if (!row) throw new Error("approval insert failed");
        await writeAudit(tx, request, {
          capability: "settlement.confirm",
          action: "settlement.confirm",
          targetKind: "settlement",
          targetId: sid,
          eventId: id,
          after: row,
        });
        return row;
      });

      return { id: approval.id, approved: approval.approved };
    },
  );

  // Finalize: freeze an immutable snapshot of the full computed state. Idempotent.
  app.post(
    "/events/:id/settlement/finalize",
    {
      schema: {
        params: EventParams,
        response: { 200: z.object({ version: z.number(), finalizedAt: z.string() }) },
      },
    },
    async (request, reply) => {
      const { database } = request.server;
      const { id } = request.params;

      await requireEventCapability(request, id, "settlement.finalize");

      const { statusCode, body } = await withIdempotency<{ version: number; finalizedAt: string }>(
        request,
        "POST /events/:id/settlement/finalize",
        async () => {
          const snapshot = await database.transaction(async (tx) => {
            const settlementRows = await tx
              .select()
              .from(schema.settlements)
              .where(eq(schema.settlements.eventId, id));
            const transferRows = await tx
              .select()
              .from(schema.settlementTransfers)
              .where(eq(schema.settlementTransfers.eventId, id));

            // LOCK the FX (money.md): freeze the rate for every non-base currency in
            // play at finalize time into the snapshot, so the settlement is exactly
            // reproducible even after the live cache moves.
            const [event] = await tx
              .select({ baseCurrency: schema.events.baseCurrency })
              .from(schema.events)
              .where(eq(schema.events.id, id));
            const baseCurrency = event?.baseCurrency ?? "";
            const dealCurrencies = await tx
              .select({ currency: schema.deals.currency })
              .from(schema.deals)
              .where(eq(schema.deals.eventId, id));
            const lineCurrencies = await tx
              .select({ currency: schema.budgetLines.currency })
              .from(schema.budgetLines)
              .innerJoin(schema.budgets, eq(schema.budgets.id, schema.budgetLines.budgetId))
              .where(eq(schema.budgets.eventId, id));
            const lockedRatesMap = await loadRatesToBase(tx, baseCurrency, [
              ...dealCurrencies.map((row) => row.currency ?? baseCurrency),
              ...lineCurrencies.map((row) => row.currency ?? baseCurrency),
            ]);
            const lockedRates = {
              baseCurrency,
              lockedAt: new Date().toISOString(),
              source: "exchangerate-api",
              rates: Object.fromEntries(lockedRatesMap),
            };

            const [latest] = await tx
              .select({ version: schema.settlementSnapshots.version })
              .from(schema.settlementSnapshots)
              .where(eq(schema.settlementSnapshots.eventId, id))
              .orderBy(desc(schema.settlementSnapshots.version))
              .limit(1);
            const nextVersion = (latest?.version ?? 0) + 1;

            const [row] = await tx
              .insert(schema.settlementSnapshots)
              .values({
                eventId: id,
                version: nextVersion,
                data: {
                  settlements: settlementRows.map(serializeSettlement),
                  transfers: transferRows.map(serializeTransfer),
                  lockedRates,
                },
              })
              .returning();
            if (!row) throw new Error("snapshot insert failed");
            await writeAudit(tx, request, {
              capability: "settlement.finalize",
              action: "settlement.finalize",
              targetKind: "event",
              targetId: id,
              eventId: id,
              after: { version: nextVersion },
            });
            return row;
          });
          return {
            statusCode: 200,
            body: {
              version: snapshot.version,
              finalizedAt: snapshot.finalizedAt.toISOString(),
            },
          };
        },
      );

      // Realtime + feed: finalizing LOCKS the figures and the FX, so everyone with
      // money in this event needs to know their numbers are now fixed. Scoped to
      // settlement holders rather than every viewer. Best-effort, post-commit.
      try {
        const actorUserId = request.principal?.userId ?? null;
        const recipients = await settlementRecipients(database, id, actorUserId);
        await notifyUsers(database, recipients, actorUserId, {
          type: "settlement.finalized",
          title: "Settlement finalized",
          body: "The figures are locked and payouts are set.",
          eventId: id,
          actorDisplay: request.firebaseUser?.name ?? undefined,
          link: `/events/${id}`,
          metadata: { eventId: id },
        });
      } catch (error) {
        request.log.error({ error, eventId: id }, "settlement-finalize notification failed");
      }

      return reply.status(statusCode as 200).send(body);
    },
  );

  // Transfer state: mark a "who owes whom" line owed/paid/handled, version-locked.
  app.patch(
    "/events/:id/transfers/:tid",
    {
      schema: {
        params: TransferParams,
        body: TransferStateBody,
        response: { 200: TransferResponse },
      },
    },
    async (request) => {
      const { database } = request.server;
      const { id, tid } = request.params;

      await requireEventCapability(request, id, "settlement.edit");

      const [before] = await database
        .select()
        .from(schema.settlementTransfers)
        .where(
          and(eq(schema.settlementTransfers.id, tid), eq(schema.settlementTransfers.eventId, id)),
        );
      if (!before) throw notFound("Transfer not found");

      const { expectedVersion, state } = request.body;
      const where =
        expectedVersion != null
          ? and(
              eq(schema.settlementTransfers.id, tid),
              eq(schema.settlementTransfers.version, expectedVersion),
            )
          : eq(schema.settlementTransfers.id, tid);

      const updated = await database.transaction(async (tx) => {
        const [after] = await tx
          .update(schema.settlementTransfers)
          .set({ state, version: before.version + 1 })
          .where(where)
          .returning();
        if (!after) {
          throw conflict("Transfer was changed by someone else; reload and retry");
        }
        await writeAudit(tx, request, {
          capability: "settlement.edit",
          action: "transfer.update",
          targetKind: "transfer",
          targetId: tid,
          eventId: id,
          before: serializeTransfer(before),
          after: serializeTransfer(after),
        });
        return after;
      });

      return serializeTransfer(updated);
    },
  );
}
