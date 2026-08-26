import { isDeepStrictEqual } from "node:util";
import type { Database } from "@showme/db";
import { schema } from "@showme/db";
import {
  type SettlementBudgetLine,
  type SettlementDeal,
  type SettlementInput,
  type SettlementParticipant,
  type SettlementResult,
  assertBalanced,
  reconcile,
} from "@showme/settlement";
import { convertMinorUnits } from "@showme/shared";
import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { type HttpError, badRequest, conflict, forbidden, notFound } from "../errors";
import { writeActivity } from "../lib/activity";
import type { Transaction } from "../lib/audit";
import { writeAudit } from "../lib/audit";
import { requireEventCapability } from "../lib/authorize";
import { syncCommissionSettlements } from "../lib/commission-settlement";
import { loadRatesToBase } from "../lib/exchange-rate";
import { notifyUsers, settlementRecipients } from "../lib/notify";
import { type DesiredTransfer, reconcileTransfers } from "../lib/settlement-transfers";
import { withIdempotency } from "../plugins/idempotency";
import {
  type SerializedBreakdown,
  type SerializedSummary,
  type StoredBreakdown,
  ladderOf,
  serializeBreakdown,
  serializeCommission,
  serializeSettlement,
  serializeTransfer,
  storeBreakdown,
} from "../serialize/settlement";

const EventParams = z.object({ id: z.string().uuid() });
const SettlementParams = z.object({ id: z.string().uuid(), sid: z.string().uuid() });
const TransferParams = z.object({ id: z.string().uuid(), tid: z.string().uuid() });

/**
 * WHY a party's entitlement is the figure it is — one arm per arm of
 * `dealEntitlement()`, carrying the operands the engine actually compared.
 *
 * Structured rather than a sentence, deliberately. The engine decides which rule
 * fired; how "70% of the adjusted net" reads in a given language and currency is
 * the browser's job, and a string assembled here would be a second money
 * formatter living on the server.
 */
const BasisResponse = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("guarantee"), guarantee: z.string() }),
  z.object({ kind: z.literal("rental"), rental: z.string() }),
  // `pool` and `door` are OPTIONAL because they are the pool, and a party row is
  // redacted of it unless the route has checked the caller may read the pool
  // (`redactPool` in `../serialize/settlement`). The party's own terms — the
  // percentage, the guarantee, which side won — are never redacted, so the line
  // still states its rule even when it cannot state the base.
  z.object({
    kind: z.literal("door_split"),
    basisPoints: z.number(),
    pool: z.string().optional(),
  }),
  z.object({
    kind: z.literal("guarantee_vs_door"),
    won: z.enum(["guarantee", "door"]),
    guarantee: z.string(),
    door: z.string().optional(),
    basisPoints: z.number(),
    pool: z.string().optional(),
  }),
  z.object({ kind: z.literal("paper") }),
]);

/** One deal's contribution to one party's entitlement. */
const EntitlementLineResponse = z.object({
  dealId: z.string(),
  /** What the whole agreement pays; `amount` is this party's portion of it. */
  dealTotal: z.string(),
  amount: z.string(),
  basis: BasisResponse,
  bonus: z.string().optional(),
  escalatorApplied: z.boolean().optional(),
  commissionCharged: z.string().optional(),
});

/**
 * The gross → adjusted-net ladder. Event-level and OPERATOR-ONLY: it is the whole
 * night's takings and costs, which the ceiling in `packages/auth`
 * (`POOL_CAPABILITIES`) keeps away from every arm's-length party.
 */
const LadderResponse = z.object({
  revenue: z.string(),
  costs: z.string(),
  pool: z.string(),
  /** Σ of the rentals settled before the percentage deals divide what is left. */
  offTheTop: z.string(),
  /** `pool − offTheTop` — the adjusted net every percentage is a share of. */
  splitPool: z.string(),
});

const BreakdownResponse = z.object({
  participantId: z.string(),
  entitlement: z.string(),
  collected: z.string(),
  paid: z.string(),
  held: z.string(),
  net: z.string(),
  /**
   * What the entitlement is MADE OF. Optional because a settlement snapshotted
   * before this existed carries none, and a finalized settlement is a legal
   * record that is never rewritten to add it.
   */
  lines: z.array(EntitlementLineResponse).optional(),
  commissionEarned: z.string().optional(),
  deductibles: z.string().optional(),
  residual: z.string().optional(),
});

/** One party's sign-off, as the roster shows it. */
const ApprovalResponse = z.object({
  participantId: z.string(),
  approved: z.boolean(),
  approvedAt: z.string().nullable(),
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
  ladder: LadderResponse,
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

/** One of the caller's own settlements, with just enough event context to list it. */
const MySettlementsResponse = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      status: z.string(),
      version: z.number(),
      participantId: z.string().nullable(),
      /** The viewer's own figures; null until the event has been computed. */
      entitlement: z.string().nullable(),
      net: z.string().nullable(),
      currency: z.string(),
      event: z.object({
        id: z.string(),
        title: z.string(),
        eventDate: z.string().nullable(),
        status: z.string(),
      }),
    }),
  ),
});

/**
 * A settlement line as the caller receives it ON AN EVENT, where the two extra
 * fields are the ones an action hangs off.
 *
 * `isYours` because approval is a signature: *"You can only confirm your own
 * settlement"* is enforced below, and a caller that can see several lines (an
 * operator is a party on the deals it funds) cannot otherwise tell which single
 * line that sentence is about. `approvedByYou` because without it the confirm
 * control has no OFF state — it would invite the same signature again, every
 * visit, with no way to see it had already been given.
 */
const EventSettlementResponse = SettlementResponse.extend({
  isYours: z.boolean(),
  approvedByYou: z.boolean(),
});

const SettlementsResponse = z.object({
  settlements: z.array(EventSettlementResponse),
  transfers: z.array(TransferResponse),
  // Private agent↔performer commissions (decisions #14) — empty for the operator.
  commissions: z.array(CommissionResponse),
  /**
   * The pool ladder, or NULL for a caller who may not see the whole night's money.
   * Gated on `budget.view`, which is the capability the auth ceiling already uses
   * to mean "may read the pool" — reusing it is what keeps one answer to that
   * question instead of two that can drift apart.
   */
  ladder: LadderResponse.nullable(),
  /**
   * WHO HAS SIGNED OFF — every visible party, not just the caller.
   *
   * `settlement_approvals` has always been written and was read back only for the
   * caller's own participant, so the operator could not answer "who still owes me
   * a signature" — the one question the whole review step exists to answer
   * (`docs/old-app-analysis-flows-invite-settle.md` §3.2 step 5). Scoped to the
   * same visible set as the settlements themselves, so it widens nothing.
   */
  approvals: z.array(ApprovalResponse),
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

/**
 * Settlement statuses at which the figures are FROZEN (audit A-09). `finalized`
 * writes an immutable snapshot — the legal record — so from there on the figures
 * behind it may not move: no recompute, no manual override. Only the *payment*
 * state of the individual transfers keeps moving (owed → paid → handled), which is
 * what `partly_paid` / `paid` record, and those are downstream of `finalized`.
 */
const LOCKED_SETTLEMENT_STATUSES: ReadonlySet<string> = new Set([
  "finalized",
  "partly_paid",
  "paid",
]);

/**
 * A payee's basis points out of a deal party's `share` jsonb.
 *
 * The key is `splitBasisPoints`, matching `deals.split_basis_points` and
 * `SettlementDeal.splitBasisPoints` — one name for the concept across the column, the
 * engine and the stored jsonb.
 *
 * Three outcomes, and the difference between the last two is the whole point:
 *   - no share at all      → null, meaning "no stated weight", and the engine splits equally
 *   - a usable share       → the basis points
 *   - a share we can't read → THROWS
 *
 * That last case used to return null too, which silently equal-split a deal whose parties
 * had agreed something else. It hid a live mis-payment: the writer stored
 * `splitBasisPoints` while this function read `basisPoints`, so a signed 60/40 deal paid
 * 50/50 and `Σ net = 0` still held, because balancing validates the total and never the
 * distribution. Refusing to guess is what makes that class of bug loud instead of silent.
 */
function weightFromShare(share: unknown, participantId: string): number | null {
  if (share == null) return null;
  if (typeof share === "number") return share;
  if (typeof share === "object") {
    const record = share as Record<string, unknown>;
    if (typeof record.splitBasisPoints === "number" && Number.isFinite(record.splitBasisPoints)) {
      return record.splitBasisPoints;
    }
    // A share may legitimately state terms without a split weight (a flat guarantee, say).
    // What must never pass silently is a share carrying ONLY keys we do not understand —
    // that is the drift that produced the equal-split bug.
    // `guaranteeAmount` is the pre-A-36 name for `illustrativeAmount` and is still
    // listed so a share written before the 0007 rename reads as "no stated weight"
    // rather than throwing. Neither key is a floor; neither is read here.
    const known = [
      "splitBasisPoints",
      "illustrativeAmount",
      "guaranteeAmount",
      "currency",
      "terms",
    ];
    if (Object.keys(record).some((key) => known.includes(key))) return null;
  }
  throw badRequest(
    `Deal party ${participantId} has a share that carries no readable splitBasisPoints; refusing to settle rather than split equally.`,
  );
}

/**
 * The RATE on a `role_in_deal = 'commission'` party, in basis points of each payee's
 * line on that deal.
 *
 * The role existed in the enum and was inert: `reconcileEvent` mapped payees only, so
 * a commission line was a row two parties had signed that no code ever paid. This is
 * the mapping that makes it pay (`packages/settlement/src/commissions.ts` does the
 * arithmetic). It reuses `share.splitBasisPoints` — the share's one basis-points
 * carrier, already written by every client and validated by `DealPartyShare` — rather
 * than inventing a second key the writers would have to learn; on a commission line it
 * means "of the payee's line", not "of the pool", which is the only place the two
 * readings differ and is documented on the schema in `routes/deals.ts`.
 *
 * A commission party with no readable rate THROWS, for the A-01 reason: a commission
 * that quietly resolves to zero is a party being paid nothing on an agreement they
 * signed, and `Σ net = 0` holds perfectly either way.
 */
function commissionBasisPointsFromShare(share: unknown, participantId: string): number {
  if (typeof share === "object" && share !== null) {
    const record = share as Record<string, unknown>;
    if (typeof record.splitBasisPoints === "number" && Number.isFinite(record.splitBasisPoints)) {
      return record.splitBasisPoints;
    }
  }
  throw badRequest(
    `Deal party ${participantId} takes a commission but its share states no splitBasisPoints rate; refusing to settle a commission of an unknown size.`,
  );
}

/** The engine result plus the exact FX rates it was produced with (audit A-05). */
interface ReconciledEvent {
  result: SettlementResult;
  baseCurrency: string;
  /** source currency → "base per 1 source", the map every non-base figure went through. */
  rates: Map<string, string>;
}

/** The budget-line columns that name an `event_participants` row. */
const PARTICIPANT_REFERENCE_FIELDS = ["collectedBy", "paidBy", "payeeParticipantId"] as const;

/** One stored budget line, in the shape the integrity guards need to name it. */
type BudgetLineReference = {
  id: string;
  budgetId: string;
  label: string;
  kind: "revenue" | "cost";
  /** The cost-split bearers name participants as KEYS — same check applies. */
  costSplit?: unknown;
} & Partial<Record<(typeof PARTICIPANT_REFERENCE_FIELDS)[number], string | null>>;

/** How a guard tells the operator which row is at fault and how to be rid of it. */
function unsettlableLine(eventId: string, line: BudgetLineReference, problem: string): HttpError {
  return conflict(
    `Budget line "${line.label}" (${line.id}) ${problem}, so the settlement cannot balance. Correct or remove it — DELETE /events/${eventId}/budgets/${line.budgetId}/lines/${line.id} — then compute again.`,
  );
}

/**
 * A stored budget line whose `collected_by` / `paid_by` / `payee_participant_id`
 * names a participant of some OTHER event breaks the conservation law by
 * construction: the amount moves the pool, but the cash is credited to a
 * participant this event's breakdowns do not contain, so `Σ net ≠ 0` and
 * `assertBalanced` throws (audit A-14).
 *
 * `assertBalanced` stays exactly as strict as it was — `Σ net = 0` is the invariant
 * the whole engine rests on and must never be relaxed to accommodate bad data. What
 * changes is WHERE the failure is reported and how legible it is: a 409 naming the
 * offending line, its budget and the DELETE that removes it, instead of a 500 whose
 * body is `{"error":{"code":"internal"}}` and whose cause is only in a log the API
 * does not even write. 409 rather than 400 because the request is fine — the stored
 * state is what blocks it, the same reasoning `assertNotFinalized` uses.
 */
function assertBudgetLinesAreEventScoped(
  eventId: string,
  lines: BudgetLineReference[],
  participantIdsOnEvent: ReadonlySet<string>,
): void {
  for (const line of lines) {
    for (const field of PARTICIPANT_REFERENCE_FIELDS) {
      const value = line[field];
      if (typeof value === "string" && !participantIdsOnEvent.has(value)) {
        throw unsettlableLine(
          eventId,
          line,
          `has ${field} ${value}, which is not a participant on this event, so its cash belongs to nobody`,
        );
      }
    }
    // A cost split reaches the engine as deductions against named parties, so a
    // bearer from another event breaks the conservation law exactly as a foreign
    // `payee_participant_id` does — and deserves the same legible refusal.
    if (typeof line.costSplit === "object" && line.costSplit !== null) {
      for (const participantId of Object.keys(line.costSplit as Record<string, unknown>)) {
        if (!participantIdsOnEvent.has(participantId)) {
          throw unsettlableLine(
            eventId,
            line,
            `has a cost split naming ${participantId}, which is not a participant on this event, so part of it is charged to nobody`,
          );
        }
      }
    }
  }
}

/**
 * The same defect through the other door: a stored line that names NOBODY.
 *
 * A foreign participant id and a NULL attribution are one bug with two spellings —
 * in both, `reconcile()` moves the pool by the amount but credits `held` to no
 * participant of this event, so `Σ net ≠ 0` and every compute 500s forever. The
 * route now requires `collected_by` on revenue and `paid_by` on cost, but rows
 * written before that fix are still sitting in the table, and their only symptom was
 * that opaque 500. Same 409, same diagnosis, same way out.
 *
 * `payee_participant_id` is deliberately not required: NULL there is the ordinary
 * external supplier, which is exactly what makes the cost a pool cost.
 */
function assertBudgetLinesAttributeTheirCash(eventId: string, lines: BudgetLineReference[]): void {
  for (const line of lines) {
    if (line.kind === "revenue" && !line.collectedBy) {
      throw unsettlableLine(
        eventId,
        line,
        "is revenue with no collectedBy, so it raises the pool while no participant holds the cash",
      );
    }
    if (line.kind === "cost" && !line.paidBy) {
      throw unsettlableLine(
        eventId,
        line,
        "is a cost with no paidBy, so it lowers the pool while no participant is out of pocket",
      );
    }
  }
}

/**
 * Read the event's spine (participants, deals, budget lines), convert every
 * non-base amount to base, and reconcile.
 *
 * Shared by compute and finalize on purpose: finalize captures the FX rates
 * (PLAN.md:258 — "locked FX rate captured at finalize") and must be able to prove
 * they are the rates the stored figures were produced with, which it can only do
 * by re-deriving the figures through the very same code path.
 */
async function reconcileEvent(
  database: Database | Transaction,
  eventId: string,
): Promise<ReconciledEvent> {
  const participantRows = await database
    .select()
    .from(schema.eventParticipants)
    .where(eq(schema.eventParticipants.eventId, eventId));

  const participants: SettlementParticipant[] = participantRows.map((row) => ({
    participantId: row.id,
    isOperator: OPERATOR_EVENT_ROLES.has(row.role),
  }));

  const dealRows = await database
    .select()
    .from(schema.deals)
    .where(eq(schema.deals.eventId, eventId));
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
      id: schema.budgetLines.id,
      budgetId: schema.budgetLines.budgetId,
      label: schema.budgetLines.label,
      kind: schema.budgetLines.kind,
      amount: schema.budgetLines.amount,
      currency: schema.budgetLines.currency,
      collectedBy: schema.budgetLines.collectedBy,
      paidBy: schema.budgetLines.paidBy,
      payeeParticipantId: schema.budgetLines.payeeParticipantId,
      costSplit: schema.budgetLines.costSplit,
      dealId: schema.budgetLines.dealId,
    })
    .from(schema.budgetLines)
    .innerJoin(schema.budgets, eq(schema.budgets.id, schema.budgetLines.budgetId))
    .where(eq(schema.budgets.eventId, eventId));

  // Refuse to reconcile a budget that references participants from outside the
  // event (audit A-14). The route now rejects such a reference at write time, but
  // rows written before that fix — or by any future path that forgets — are still
  // there, and their only symptom was a 500 on EVERY compute, forever, with an
  // empty body. `assertBalanced` is right to throw (Σ net = 0 is a hard invariant);
  // what was missing is a diagnosis. This names the line and the way out.
  assertBudgetLinesAreEventScoped(eventId, lineRows, new Set(participantRows.map((row) => row.id)));
  assertBudgetLinesAttributeTheirCash(eventId, lineRows);

  const [event] = await database
    .select({ baseCurrency: schema.events.baseCurrency })
    .from(schema.events)
    .where(eq(schema.events.id, eventId));
  if (!event) throw notFound("Event not found");
  const baseCurrency = event.baseCurrency;

  // Multi-currency: convert every non-base deal/line to base BEFORE reconciling —
  // the engine's Σnet=0 runs purely in base (money.md). The rate map returned
  // alongside the result IS the map these figures were produced with; finalize
  // freezes it, so the snapshot's `lockedRates` reproduce the snapshot's figures.
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
      const weight = weightFromShare(payee.share, payee.participantId);
      if (weight != null) {
        partyShares[payee.participantId] = weight;
        hasShares = true;
      }
    }
    // DISCLOSED commissions — an entitled party on this deal, paid out of each
    // payee's line (decisions.md #14 keeps an AGENT's private representation
    // commission out of here entirely: that settles separately, against the
    // performer's full gross, in `syncCommissionSettlements`; and
    // `routes/deals.ts::assertPartiesAreEntitled` refuses an agent participant
    // any deal role but `observer`, so an agent cannot reach this list at all).
    //
    // Sorted by participant so the engine sees the same order on every recompute
    // whatever order Postgres returns the rows in. It makes no difference to the
    // amounts while commissions apply in parallel, and it is what stops the day
    // ClickUp 86cba8wmb switches them to cascading from making a settlement depend
    // on row order.
    const commissions = parties
      .filter((party) => party.roleInDeal === "commission")
      .map((party) => ({
        participantId: party.participantId,
        basisPoints: commissionBasisPointsFromShare(party.share, party.participantId),
      }))
      .sort((left, right) => left.participantId.localeCompare(right.participantId));
    return {
      dealId: deal.id,
      structure: deal.structure,
      payeeParticipantIds: payees.map((payee) => payee.participantId),
      guaranteeAmount:
        deal.guaranteeAmount != null ? toBase(deal.guaranteeAmount, deal.currency) : undefined,
      splitBasisPoints: deal.splitBasisPoints ?? undefined,
      partyShares: hasShares ? partyShares : undefined,
      commissions: commissions.length > 0 ? commissions : undefined,
    };
  });

  const budgetLines: SettlementBudgetLine[] = lineRows
    // A cost line ASSIGNED TO A DEAL is the deal's own entitlement written down in
    // the planner — a forecast of what that agreement will pay, not cash that
    // moved (design-handoff-budget-planner §6: *"performer fee as a cost field →
    // a deal ENTITLEMENT, not a budget line — assign the line to the deal via
    // `deal_id` so it is never double-counted"*).
    //
    // Left in, it is counted twice: once lowering the pool as an external cost and
    // again as the deal's entitlement, so the operator's residual comes out short
    // by the whole fee. It cannot be netted out inside `reconcile()` either — every
    // cost is partitioned into pool share and borne shares there, and a third
    // "ignore" bucket would break `Σ net = 0`. So it is dropped at the boundary:
    // the deal is the authority on what the deal pays.
    .filter((line) => !(line.kind === "cost" && line.dealId))
    .map((line) => ({
      kind: line.kind,
      amount: toBase(line.amount, line.currency),
      collectedBy: line.collectedBy ?? undefined,
      paidBy: line.paidBy ?? undefined,
      payeeParticipantId: line.payeeParticipantId ?? undefined,
      costSplit: (line.costSplit as Record<string, number> | null) ?? undefined,
    }));

  const input: SettlementInput = { baseCurrency, participants, deals, budgetLines };
  const result = reconcile(input);
  assertBalanced(result);

  return { result, baseCurrency, rates };
}

/** The participant ids the caller's profiles hold on one event. */
async function participantIdsOf(
  database: Database,
  eventId: string,
  profileIds: string[],
): Promise<Set<string>> {
  if (profileIds.length === 0) return new Set();
  const rows = await database
    .select({ id: schema.eventParticipants.id })
    .from(schema.eventParticipants)
    .where(
      and(
        eq(schema.eventParticipants.eventId, eventId),
        inArray(schema.eventParticipants.profileId, profileIds),
      ),
    );
  return new Set(rows.map((row) => row.id));
}

/**
 * Every visible party's sign-off, approved or not — the roster.
 *
 * `settlement_approvals` has no unique constraint (idempotency is enforced in the
 * confirm route), so a party can in principle hold more than one row; the roster
 * folds them with "approved once is approved", keeping the earliest timestamp, so
 * a duplicate row can never read as a withdrawn signature.
 */
async function approvalRosterOf(
  database: Database,
  eventId: string,
  participantIds: Set<string>,
): Promise<Map<string, { approved: boolean; approvedAt: Date | null }>> {
  const roster = new Map<string, { approved: boolean; approvedAt: Date | null }>();
  if (participantIds.size === 0) return roster;
  const rows = await database
    .select({
      participantId: schema.settlementApprovals.partyParticipantId,
      approved: schema.settlementApprovals.approved,
      approvedAt: schema.settlementApprovals.approvedAt,
    })
    .from(schema.settlementApprovals)
    .where(
      and(
        eq(schema.settlementApprovals.eventId, eventId),
        inArray(schema.settlementApprovals.partyParticipantId, [...participantIds]),
      ),
    );
  for (const row of rows) {
    const seen = roster.get(row.participantId);
    const approvedAt =
      seen?.approvedAt && row.approvedAt
        ? seen.approvedAt < row.approvedAt
          ? seen.approvedAt
          : row.approvedAt
        : (seen?.approvedAt ?? row.approvedAt);
    roster.set(row.participantId, {
      approved: (seen?.approved ?? false) || row.approved,
      approvedAt,
    });
  }
  return roster;
}

/**
 * The roles on a deal that see the whole of it. A payer funds the deal (and is the
 * economic hub of the event); an `observer` is decisions #4's explicit read-only
 * way to share a deal — *"they can see it because they are now a party"*.
 */
const DEAL_ROLES_THAT_SEE_THE_DEAL = ["payer", "observer"] as const;

/**
 * The other parties on the deals the caller FUNDS or observes — the party set that
 * settlement visibility is membership of (audit A-07).
 *
 * Settlement visibility is PURE party-scoping (decisions.md #4): *"if you are not a
 * `deal_party`, you cannot see the deal or its settlement"*, and the operator's
 * breadth is **emergent** — *"they're a party (payer / economic hub) on the event's
 * main deals, not a see-everything capability"*. This route used to hand everything
 * to any caller holding `budget.view`, which IS the `settlement.view.all` override
 * that decision dropped: it showed the venue a performer's private sub-hire. Being
 * the host is not itself the grant — an operator who is a party to nothing sees
 * nothing but its own line.
 *
 * The relation is deliberately DIRECTIONAL, because party membership on a deal does
 * not make the parties equals: the payer sees what it is paying out, while a payee
 * seeing the payer's line would be reading the operator's whole margin (the
 * operator's per-participant line is the pool residual). For the same reason two
 * `split_member`s on one deal do not see each other — decisions #4: *"a shared split
 * shows each performer only their own line"*.
 */
async function partiesVisibleTo(
  database: Database,
  eventId: string,
  myParticipantIds: Set<string>,
): Promise<Set<string>> {
  if (myParticipantIds.size === 0) return new Set();
  const mine = alias(schema.dealParties, "my_party");
  const theirs = alias(schema.dealParties, "their_party");
  const rows = await database
    .select({ participantId: theirs.participantId })
    .from(mine)
    .innerJoin(theirs, eq(theirs.dealId, mine.dealId))
    .innerJoin(schema.deals, eq(schema.deals.id, mine.dealId))
    .where(
      and(
        eq(schema.deals.eventId, eventId),
        inArray(mine.participantId, [...myParticipantIds]),
        inArray(mine.roleInDeal, [...DEAL_ROLES_THAT_SEE_THE_DEAL]),
      ),
    );
  return new Set(rows.map((row) => row.participantId));
}

/** Every settlement row of an event, whichever subject it hangs off. */
async function settlementRowsOf(database: Database | Transaction, eventId: string) {
  return database.select().from(schema.settlements).where(eq(schema.settlements.eventId, eventId));
}

/**
 * Refuse to move the figures once they are frozen (audit A-09). Finalize writes an
 * immutable snapshot; a later recompute used to silently replace every figure
 * underneath it without producing a new one.
 */
function assertNotFinalized(rows: { status: string }[]): void {
  if (rows.some((row) => LOCKED_SETTLEMENT_STATUSES.has(row.status))) {
    throw conflict(
      "This settlement is finalized — its figures are locked to the snapshot. Transfers can still be marked paid; the figures cannot be recomputed.",
    );
  }
}

/** Compare two serialized breakdowns field by field (all six are string money). */
function sameBreakdown(left: StoredBreakdown | null, right: StoredBreakdown): boolean {
  return (
    left != null &&
    left.participantId === right.participantId &&
    left.entitlement === right.entitlement &&
    left.collected === right.collected &&
    left.paid === right.paid &&
    left.held === right.held &&
    left.net === right.net &&
    // The composition as well as the total. Moving a guarantee that still loses to
    // the door share leaves every figure above identical and changes what the
    // settlement SAYS — and a row skipped here is a row that keeps explaining
    // itself with last week's terms.
    // Structural, and NOT `JSON.stringify` — `computed` comes back out of a `jsonb`
    // column, which does not preserve key order. Stringifying would report every
    // stored row as changed on the first read after Postgres reordered its keys,
    // which is an infinite "the figures moved" and a settlement that can never be
    // finalized. `isDeepStrictEqual` compares by value.
    isDeepStrictEqual(left.lines ?? null, right.lines ?? null) &&
    isDeepStrictEqual(left.ladder ?? null, right.ladder ?? null)
  );
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

      assertNotFinalized(await settlementRowsOf(database, id));

      const { result, baseCurrency } = await reconcileEvent(database, id);

      const { statusCode, body } = await withIdempotency<SerializedSummary>(
        request,
        "POST /events/:id/settlement/compute",
        async () => {
          const summary = await database.transaction(async (tx) => {
            // Re-read inside the transaction: a concurrent finalize must not be
            // overtaken by a compute that checked before it committed.
            assertNotFinalized(await settlementRowsOf(tx, id));

            // Per-participant settlements are UPDATED in place, not dropped and
            // re-inserted: the row carries `version`, `manual_overrides` and
            // `status`, and delete-then-insert silently threw all three away.
            const priorRows = await tx
              .select()
              .from(schema.settlements)
              .where(
                and(
                  eq(schema.settlements.eventId, id),
                  isNotNull(schema.settlements.participantId),
                ),
              );
            const unmatched = new Map(priorRows.map((row) => [row.participantId as string, row]));

            for (const breakdown of result.breakdowns) {
              const computed = storeBreakdown(breakdown, result.ladder);
              const prior = unmatched.get(breakdown.participantId);
              if (!prior) {
                await tx.insert(schema.settlements).values({
                  eventId: id,
                  participantId: breakdown.participantId,
                  computed,
                });
                continue;
              }
              unmatched.delete(breakdown.participantId);
              if (sameBreakdown(prior.computed as StoredBreakdown | null, computed)) continue;
              await tx
                .update(schema.settlements)
                .set({ computed, version: prior.version + 1, updatedAt: new Date() })
                .where(eq(schema.settlements.id, prior.id));
            }
            for (const stale of unmatched.values()) {
              await tx.delete(schema.settlements).where(eq(schema.settlements.id, stale.id));
            }

            // Transfers are reconciled, never wholesale deleted: a transfer someone
            // marked `paid` must survive an identical recompute (audit A-08).
            const desired: DesiredTransfer[] = result.transfers.map((transfer) => ({
              fromParticipant: transfer.fromParticipantId,
              toParticipant: transfer.toParticipantId,
              amount: transfer.amount,
              currency: result.baseCurrency,
              representationId: null,
            }));
            await reconcileTransfers(tx, id, desired, "event");

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
              baseCurrency,
              pool: result.pool.toString(),
              ladder: {
                revenue: result.ladder.revenue.toString(),
                costs: result.ladder.costs.toString(),
                pool: result.ladder.pool.toString(),
                offTheTop: result.ladder.offTheTop.toString(),
                splitPool: result.ladder.splitPool.toString(),
              },
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

  // The caller's OWN settlements across every event — what the Settlements screen is a
  // list of. Everything else here is event-scoped, so that screen had nothing to read and
  // fell back to listing events with an empty payout column (audit A-35).
  //
  // Party-scoped like the event-scoped read, but folded into the SQL rather than fetched
  // and filtered: the joins from the caller's memberships through their participant rows
  // ARE the access rule, so a settlement that is not theirs never leaves Postgres.
  // Representation-scoped rows (the private agent commission) are excluded — they are
  // surfaced separately, per event, to the two parties only (decisions #14).
  app.get(
    "/settlements",
    { schema: { response: { 200: MySettlementsResponse } } },
    async (request) => {
      const { database } = request.server;
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");

      const profileIds = principal.memberships.map((membership) => membership.profileId);
      if (profileIds.length === 0) return { items: [] };

      const rows = await database
        .select({
          id: schema.settlements.id,
          status: schema.settlements.status,
          computed: schema.settlements.computed,
          version: schema.settlements.version,
          participantId: schema.settlements.participantId,
          eventId: schema.events.id,
          eventTitle: schema.events.title,
          eventDate: schema.events.eventDate,
          eventStatus: schema.events.status,
          baseCurrency: schema.events.baseCurrency,
        })
        .from(schema.settlements)
        .innerJoin(
          schema.eventParticipants,
          eq(schema.eventParticipants.id, schema.settlements.participantId),
        )
        .innerJoin(schema.events, eq(schema.events.id, schema.settlements.eventId))
        .where(
          and(
            inArray(schema.eventParticipants.profileId, profileIds),
            isNull(schema.settlements.representationId),
          ),
        )
        .orderBy(desc(schema.events.eventDate));

      return {
        items: rows.map((row) => {
          const computed = (row.computed as SerializedBreakdown | null) ?? null;
          return {
            id: row.id,
            status: row.status,
            version: row.version,
            participantId: row.participantId,
            // The viewer's own figures — this row is theirs by construction above.
            entitlement: computed?.entitlement ?? null,
            net: computed?.net ?? null,
            currency: row.baseCurrency,
            event: {
              id: row.eventId,
              title: row.eventTitle,
              eventDate: row.eventDate,
              status: row.eventStatus,
            },
          };
        }),
      };
    },
  );

  // Read: PURE party-scoping (decisions #4, audit A-07). The caller sees their own
  // settlement line plus the lines of the parties on the deals they fund or observe
  // (`partiesVisibleTo`); the transfers they are an end of, or whose two ends are
  // both inside that set; and a private agent↔performer commission only if they are
  // one of its two parties. No capability grants a wider view — the operator's
  // breadth is emergent from being a party on the event's deals, and an operator
  // that is a party to nothing sees nothing but its own line.
  app.get(
    "/events/:id/settlements",
    { schema: { params: EventParams, response: { 200: SettlementsResponse } } },
    async (request) => {
      const { database } = request.server;
      const { id } = request.params;
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");

      const capabilities = await requireEventCapability(request, id, "settlement.view.own");

      const profileIds = principal.memberships.map((membership) => membership.profileId);
      const mine = await participantIdsOf(database, id, profileIds);
      const visible = new Set<string>([...mine, ...(await partiesVisibleTo(database, id, mine))]);

      const settlementRows = await settlementRowsOf(database, id);
      const transferRows = await database
        .select()
        .from(schema.settlementTransfers)
        .where(eq(schema.settlementTransfers.eventId, id));

      const isMyEnd = (row: { fromParticipant: string; toParticipant: string }) =>
        mine.has(row.fromParticipant) || mine.has(row.toParticipant);

      // A commission settlement/transfer is visible ONLY to its two parties — never
      // to the operator, whatever else they are a party to (decisions #14).
      const isMyCommission = (row: (typeof settlementRows)[number]) => {
        if (!row.representationId) return false;
        const computed = row.computed as {
          performerParticipantId?: string;
          agentParticipantId?: string;
        } | null;
        return (
          (computed?.performerParticipantId != null && mine.has(computed.performerParticipantId)) ||
          (computed?.agentParticipantId != null && mine.has(computed.agentParticipantId))
        );
      };

      // WHO HAS SIGNED OFF, across every party the caller can already see. The set
      // is `visible`, not `mine`, and that is the whole change: an operator waiting
      // on three signatures could previously read only its own. It widens nothing —
      // a party outside `visible` is outside the roster too, so a performer still
      // learns nothing about anyone but themselves.
      const roster = await approvalRosterOf(database, id, visible);
      const visibleSettlements = settlementRows.filter(
        (row) => row.participantId != null && visible.has(row.participantId),
      );

      return {
        settlements: visibleSettlements.map((row) => ({
          // Same gate as `ladder` below, for the same figure: `basis.pool` IS
          // `ladder.splitPool`, and `door / basisPoints` recovers it. Withholding
          // one while serving the other would be a ceiling that only looks closed.
          ...serializeSettlement(row, { includePool: capabilities.has("budget.view") }),
          isYours: mine.has(row.participantId as string),
          // Still the CALLER's own signature, never the roster's. The roster now
          // covers every visible party, and reading it here would tell an operator
          // it had signed the performer's line the moment the performer did.
          approvedByYou:
            mine.has(row.participantId as string) &&
            (roster.get(row.participantId as string)?.approved ?? false),
        })),
        transfers: transferRows
          .filter((row) =>
            row.representationId
              ? isMyEnd(row)
              : isMyEnd(row) ||
                (visible.has(row.fromParticipant) && visible.has(row.toParticipant)),
          )
          .map(serializeTransfer),
        commissions: settlementRows.filter(isMyCommission).map(serializeCommission),
        // The whole night's takings and costs. `budget.view` is the capability the
        // ceiling already draws around pool figures (`POOL_CAPABILITIES` in
        // `packages/auth`), so asking it here means the settlement screen and the
        // budget planner can never disagree about who may read the pool.
        ladder: capabilities.has("budget.view") ? ladderOf(visibleSettlements) : null,
        approvals: visibleSettlements.map((row) => {
          const participantId = row.participantId as string;
          const signed = roster.get(participantId);
          return {
            participantId,
            approved: signed?.approved ?? false,
            approvedAt: signed?.approvedAt?.toISOString() ?? null,
          };
        }),
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
      // The private commission is not the operator's to correct, and its existence
      // is not theirs to learn (decisions #14) — 404, not 403.
      if (before.representationId) throw notFound("Settlement not found");
      assertNotFinalized([before]);

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
        // A hand-correction to somebody's money. Party-scoped to that settlement,
        // and carrying NO figures: the party is told their line was adjusted and
        // reads the new number off the settlement itself, where the serializer
        // decides what they may see.
        await writeActivity(tx, request, {
          eventId: id,
          type: "settlement.overridden",
          targetKind: "settlement",
          targetId: sid,
          summary: {
            // WHICH lines the operator moved, by label — an override is the operator
            // reaching into somebody else's money, and "something was corrected" is
            // not an answer. Never by how much: kind `settlement` reaches the party,
            // and the amount is the serializer's business, not the feed's. Whose
            // settlement it was is `target_id`, not a uuid repeated in the summary.
            overrideCount: Array.isArray(manualOverrides) ? manualOverrides.length : 0,
            overriddenLabels: Array.isArray(manualOverrides)
              ? manualOverrides
                  .map((override) =>
                    override != null && typeof override === "object" && "label" in override
                      ? String((override as { label?: unknown }).label ?? "")
                      : "",
                  )
                  .filter((label) => label.length > 0)
              : [],
          },
        });
        return after;
      });

      // This route already required `settlement.edit`, which the ceiling grants only
      // to a managing operator (`POOL_CAPABILITIES`), so the pool is theirs to read.
      return serializeSettlement(updated, { includePool: true });
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
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");

      await requireEventCapability(request, id, "settlement.confirm");

      const [settlement] = await database
        .select()
        .from(schema.settlements)
        .where(and(eq(schema.settlements.id, sid), eq(schema.settlements.eventId, id)));
      if (!settlement) throw notFound("Settlement not found");
      if (!settlement.participantId) {
        throw badRequest("Only a participant settlement can be confirmed");
      }
      // An approval is a signature: it may only be given for one's own line. The
      // route used to accept any settlement id on the event, so an operator could
      // record the performer's approval of the performer's own money.
      const profileIds = principal.memberships.map((membership) => membership.profileId);
      const mine = await participantIdsOf(database, id, profileIds);
      if (!mine.has(settlement.participantId)) {
        throw forbidden("You can only confirm your own settlement");
      }

      // Idempotent. A signature given twice is still one signature, and the route
      // used to append a second `settlement_approvals` row for every click — two
      // browser tabs, or a re-visit, and the event's record of "who signed off"
      // counted the same party more than once.
      const [existing] = await database
        .select()
        .from(schema.settlementApprovals)
        .where(
          and(
            eq(schema.settlementApprovals.eventId, id),
            eq(schema.settlementApprovals.partyParticipantId, settlement.participantId),
            eq(schema.settlementApprovals.approved, true),
          ),
        );
      if (existing) return { id: existing.id, approved: existing.approved };

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
        // The consent moment, and the one the whole trail turns on if the figures
        // are ever disputed. `settlement_approvals` records only WHO and WHEN — it
        // has no `confirmed_snapshot` the way a deal does, and the numbers stay
        // editable right up to finalize. So the forensic entry carries the figures
        // AS THEY STOOD when the signature was given: `before` is the settlement
        // the party was actually looking at, overrides included. Without it, "what
        // did they agree to" can only be re-derived by replaying every budget-line
        // audit row up to this timestamp.
        await writeAudit(tx, request, {
          capability: "settlement.confirm",
          action: "settlement.confirm",
          targetKind: "settlement",
          targetId: sid,
          eventId: id,
          // FULL fidelity, pool included: an audit row is a reconstruction record
          // and is never served to a party. Redacting it would make the trail
          // thinner than the `settlements` row it was copied from, which buys no
          // privacy — the pool is still sitting in that row — and costs the audit
          // the ability to say what the figures actually were.
          before: serializeSettlement(settlement, { includePool: true }),
          after: row,
        });
        // An approval is a signature — the one settlement step that is a decision
        // rather than a calculation, and the operator's answer to "has everyone
        // signed off yet?".
        await writeActivity(tx, request, {
          eventId: id,
          type: "settlement.confirmed",
          targetKind: "settlement",
          targetId: sid,
          // Deliberately NO participant or settlement uuid here. `target_id` above
          // already carries the settlement, which is where an id belongs, and the
          // route refuses any settlement but the caller's own — so `actor_display`
          // answers "who signed" with a NAME, which is what a person reading a
          // timeline can actually use. A summary is for people; ids are for the
          // audit trail, and `audit_log` has them plus the figures as they stood.
          summary: { approved: row.approved, settlementStatus: settlement.status },
        });
        return row;
      });

      return { id: approval.id, approved: approval.approved };
    },
  );

  // Finalize: freeze an immutable snapshot of the full computed state, LOCK the FX
  // rates that produced it, and move every settlement of the event to `finalized`.
  // Idempotent.
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
            const settlementRows = await settlementRowsOf(tx, id);
            const participantRows = settlementRows.filter((row) => row.participantId != null);
            if (participantRows.length === 0) {
              throw badRequest("Compute the settlement before finalizing it");
            }
            if (settlementRows.some((row) => LOCKED_SETTLEMENT_STATUSES.has(row.status))) {
              throw conflict("This settlement is already finalized");
            }

            const transferRows = await tx
              .select()
              .from(schema.settlementTransfers)
              .where(eq(schema.settlementTransfers.eventId, id));

            // LOCK the FX (PLAN.md:258, money.md:30): the snapshot must be
            // internally consistent — the rates it stores have to be the rates its
            // figures were produced with, or the audit record refutes itself
            // (A-05: an entitlement produced at 11.0 filed under a locked 5.0).
            //
            // Finalize used to re-read the live cache and write TODAY's rate next to
            // YESTERDAY's figures. Instead it re-derives the settlement through the
            // same code path with the rates it is about to lock, and refuses to
            // freeze anything that no longer matches what is stored. So either the
            // snapshot reproduces arithmetically, or the operator is told to
            // recompute and re-confirm — never a silent rewrite (decisions #8).
            const { result, baseCurrency, rates } = await reconcileEvent(tx, id);

            const freshByParticipant = new Map(
              result.breakdowns.map((breakdown) => [
                breakdown.participantId,
                // The STORED shape, ladder included — the same thing compute wrote.
                // Comparing a stored row against a ladder-less serialization would
                // report a mismatch on every event and refuse every finalize.
                storeBreakdown(breakdown, result.ladder),
              ]),
            );
            const figuresMatch =
              participantRows.length === freshByParticipant.size &&
              participantRows.every((row) => {
                const fresh = freshByParticipant.get(row.participantId as string);
                return (
                  fresh != null && sameBreakdown(row.computed as StoredBreakdown | null, fresh)
                );
              });

            const storedEventTransfers = transferRows.filter((row) => !row.representationId);
            const transferKey = (from: string, to: string, amount: bigint) =>
              `${from}:${to}:${amount}`;
            const freshTransferKeys = new Set(
              result.transfers.map((transfer) =>
                transferKey(transfer.fromParticipantId, transfer.toParticipantId, transfer.amount),
              ),
            );
            const transfersMatch =
              storedEventTransfers.length === freshTransferKeys.size &&
              storedEventTransfers.every((row) =>
                freshTransferKeys.has(
                  transferKey(row.fromParticipant, row.toParticipant, row.amount),
                ),
              );

            if (!figuresMatch || !transfersMatch) {
              throw conflict(
                "The settlement figures no longer match the event (a budget line, a deal or an exchange rate moved since the last compute). Recompute and re-confirm before finalizing, so the locked rates and the frozen figures agree.",
              );
            }

            const lockedRates = {
              baseCurrency,
              lockedAt: new Date().toISOString(),
              source: "exchangerate-api",
              rates: Object.fromEntries(rates),
            };

            // `finalized` is now reachable: the whole point of finalizing is that
            // the figures stop moving (audit A-09).
            const finalizedAtRow = new Date();
            for (const row of settlementRows) {
              await tx
                .update(schema.settlements)
                .set({
                  status: "finalized",
                  version: row.version + 1,
                  updatedAt: finalizedAtRow,
                })
                .where(eq(schema.settlements.id, row.id));
            }
            const finalizedRows = await settlementRowsOf(tx, id);

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
                  // The frozen legal record — pool included, and an explicit arrow so
                  // `map`'s index cannot land in the options slot and silently redact it.
                  settlements: finalizedRows.map((row) =>
                    serializeSettlement(row, { includePool: true }),
                  ),
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
              after: { version: nextVersion, status: "finalized", lockedRates },
            });
            // Event-level, unlike every other settlement row: finalizing is the
            // moment the figures and the FX STOP MOVING, which is news to everyone
            // on the bill even though what each of them is owed is not. The snapshot
            // version is the only number here — no amounts, no rates.
            await writeActivity(tx, request, {
              eventId: id,
              type: "settlement.finalized",
              targetKind: "event",
              targetId: id,
              summary: { version: nextVersion },
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
  //
  // Who may: a participant on EITHER END of the transfer — settling your own money
  // is party membership, not an operator capability. `settlement.edit` additionally
  // covers the event's own transfers, so the operator keeps administering the
  // event's cash; it does NOT reach a private agent↔performer commission, which is
  // its two parties' business alone and 404s for everybody else so that neither its
  // amount nor its direction leaks (decisions #14, audit A-10). This is also the
  // one write that stays open after finalize — freezing the figures is exactly what
  // makes the payments recordable.
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
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");

      const capabilities = await requireEventCapability(request, id, "settlement.view.own");

      const [before] = await database
        .select()
        .from(schema.settlementTransfers)
        .where(
          and(eq(schema.settlementTransfers.id, tid), eq(schema.settlementTransfers.eventId, id)),
        );
      if (!before) throw notFound("Transfer not found");

      const profileIds = principal.memberships.map((membership) => membership.profileId);
      const mine = await participantIdsOf(database, id, profileIds);
      const isParty = mine.has(before.fromParticipant) || mine.has(before.toParticipant);

      if (before.representationId) {
        if (!isParty) throw notFound("Transfer not found");
      } else if (!isParty && !capabilities.has("settlement.edit")) {
        throw forbidden("You are not a party to this transfer");
      }
      const capability = capabilities.has("settlement.edit")
        ? "settlement.edit"
        : "settlement.view.own";

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
          capability,
          action: "transfer.update",
          targetKind: "transfer",
          targetId: tid,
          eventId: id,
          before: serializeTransfer(before),
          after: serializeTransfer(after),
        });
        // "Paid" is the last thing that happens to a booking, so it belongs in the
        // history — but ONLY for an event transfer. A private agent↔performer
        // commission is its two parties' business alone and 404s for everybody else
        // (decisions #14, audit A-10); the operator sees every row on their own
        // event, so the only way to keep a commission out of their timeline is to
        // never write one. The amount stays out either way.
        if (!before.representationId) {
          await writeActivity(tx, request, {
            eventId: id,
            type: "transfer.state_changed",
            targetKind: "transfer",
            targetId: tid,
            summary: { from: before.state, to: after.state },
          });
        }
        return after;
      });

      return serializeTransfer(updated);
    },
  );
}
