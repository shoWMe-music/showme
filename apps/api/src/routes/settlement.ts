import { isDeepStrictEqual } from "node:util";
import { liveEventDelegations } from "@showme/auth";
import type { Database } from "@showme/db";
import { schema } from "@showme/db";
import {
  eventParticipantRecipients,
  notifyUsers,
  settlementPartyReach,
  settlementRecipients,
} from "@showme/db/notify";
import {
  type SettlementBudgetLine,
  type SettlementDeal,
  type SettlementInput,
  type SettlementParticipant,
  type SettlementResult,
  assertBalanced,
  prepaidAmountOf,
  reconcile,
} from "@showme/settlement";
import { convertMinorUnits } from "@showme/shared";
import { and, asc, desc, eq, inArray, isNotNull, isNull, ne } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { type HttpError, badRequest, conflict, forbidden, notFound } from "../errors";
import { writeActivity } from "../lib/activity";
import type { Transaction } from "../lib/audit";
import { writeAudit } from "../lib/audit";
import { requireEventCapability } from "../lib/authorize";
import { captureBudgetSnapshot, plannedVsActual } from "../lib/budget-snapshot";
import { syncCommissionSettlements } from "../lib/commission-settlement";
import { assertEveryAgreementSigned } from "../lib/deal-confirmation";
import { renderNotificationEmail, renderSettlementReviewEmail } from "../lib/email-templates";
import { loadEventSummary } from "../lib/event-summary";
import { loadRatesToBase } from "../lib/exchange-rate";
import { ensureSettlementLines } from "../lib/settlement-lines";
import { type DesiredTransfer, reconcileTransfers } from "../lib/settlement-transfers";
import { createShareWithRecipients, sendShareInvitations } from "../lib/share-invite";
import { narrowSharedCapabilities } from "../lib/share-scope";
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
  /** Money moved before the night under a deal. Optional for the same reason. */
  prepaid: z.string().optional(),
  /** Who that early money was with, so the screen can name both ends of it. */
  prepaidCounterpartyIds: z.array(z.string()).optional(),
  /** The costs behind `deductibles`, itemised — this party's own portion of each. */
  deductibleLines: z.array(z.object({ label: z.string(), amount: z.string() })).optional(),
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
  /**
   * Whether the CALLER may sign this particular line off.
   *
   * Usually the same as `isYours`, and deliberately a separate field because of
   * the one case where it is not: a delegated performer's signature belongs to
   * their agent (decisions.md #14), so the agent may sign a line that is not its
   * own. The server resolves that against the live representation; sending the
   * answer rather than the inputs keeps the screen from re-deriving a rule about
   * who may sign for whose money.
   */
  signableByYou: z.boolean(),
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
  /**
   * Per party: can "send for review" reach them on its own, and where has their
   * settlement been sent. Empty for a caller who cannot send it out.
   */
  delivery: z.array(
    z.object({
      participantId: z.string(),
      onPlatform: z.boolean(),
      invitedEmail: z.string().nullable(),
      invitedAt: z.string().nullable(),
      lastSeenAt: z.string().nullable(),
    }),
  ),
});

// ── Planned vs actual (decisions.md #16.8) ──────────────────────────────────
//
// Money is STRING minor units throughout, in the event's base currency
// (money.md). Nothing here is a JS number.

const PlannedVsActualLineDetailsResponse = z.object({
  basis: z.string(),
  unitAmount: z.string(),
  quantity: z.number(),
});

const PlannedVsActualLineSideResponse = z.object({
  label: z.string(),
  /** As the operator typed it, in the line's OWN currency. */
  amount: z.string(),
  currency: z.string().nullable(),
  /** The same money in base — what the variance below is computed in. */
  amountBase: z.string(),
  /** The planner's unit x quantity (200 tickets x 250), when the line has one. */
  details: PlannedVsActualLineDetailsResponse.nullable(),
  /** False for a cost line the engine drops as a deal's own figure (0019). */
  countsTowardPool: z.boolean(),
});

const PlannedVsActualSideResponse = z.object({
  source: z.enum(["plan", "finalize", "live"]),
  version: z.number().nullable(),
  capturedAt: z.string().nullable(),
  revenue: z.string(),
  costs: z.string(),
  pool: z.string(),
  /** Budgets on this event the caller may not see; their lines are absent above. */
  withheldBudgetCount: z.number(),
});

const PlannedVsActualResponse = z.object({
  eventId: z.string(),
  baseCurrency: z.string(),
  /** Null until the first compute — the platform captured nothing before then. */
  plan: PlannedVsActualSideResponse.nullable(),
  actual: PlannedVsActualSideResponse,
  variance: z.object({ revenue: z.string(), costs: z.string(), pool: z.string() }).nullable(),
  settlementPool: z.string().nullable(),
  lines: z.array(
    z.object({
      lineId: z.string(),
      budgetId: z.string(),
      label: z.string(),
      kind: z.string(),
      status: z.enum(["both", "added", "removed"]),
      planned: PlannedVsActualLineSideResponse.nullable(),
      actual: PlannedVsActualLineSideResponse.nullable(),
      variance: z.string(),
      /** Σ over the lines equals `actual.pool − plan.pool`, exactly. */
      poolEffect: z.string(),
    }),
  ),
  captures: z.array(z.object({ version: z.number(), reason: z.string(), capturedAt: z.string() })),
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
/**
 * The review states an operator or a party may MOVE a settlement to by hand.
 *
 * Deliberately not the whole `settlement_status` enum. Two of its members —
 * `partly_paid` and `paid` — are DERIVED from the transfers and never set by a
 * button: the platform cannot know who holds cash (the 2026-08 meeting, 01:24:48
 * — "collaborators confirm their received amounts manually"), so the payment state
 * lives on the individual transfers and the settlement's status is a read of them.
 * `docs/decisions.md` #14 states the same principle for the representation
 * settlement: "status is derived, not a new enum". `finalized` is not here either;
 * it has its own route, because it locks FX and cannot be undone.
 *
 * What is left is the review conversation the meeting describes (01:12:54): the
 * figures go out, comments come back, the operator adjusts and re-issues.
 */
const REVIEW_STATUSES = ["pending_review", "revised", "dispute"] as const;
type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/**
 * Who may move a settlement to each review state.
 *
 * Sending for review and re-issuing are the operator's acts — they are statements
 * about figures the operator owns. DISPUTE is the party's, and gated on
 * `settlement.confirm`: the capability that signs a settlement off is the same
 * authority inverted, and a performer who may say "these figures match my books"
 * must be able to say the opposite. It is the one transition an arm's-length party
 * can make.
 */
const REVIEW_STATUS_CAPABILITY: Record<ReviewStatus, "settlement.edit" | "settlement.confirm"> = {
  pending_review: "settlement.edit",
  revised: "settlement.edit",
  dispute: "settlement.confirm",
};

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
  // Names the SETTLEMENT's line and the settlement's own route, because since
  // 0025 that is the row the engine read and the only place it can be corrected.
  // Pointing at the planner would send the operator to fix a forecast that the
  // settlement has already stopped listening to.
  return conflict(
    `Settlement line "${line.label}" (${line.id}) ${problem}, so the settlement cannot balance. Correct or remove it — DELETE /events/${eventId}/settlement/lines/${line.id} — then compute again.`,
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
  // THE DEALS COME FIRST, AHEAD OF EVERY WRITE THIS FUNCTION MAKES.
  //
  // A CANCELLED DEAL IS NOT AN AGREEMENT, so it entitles nobody.
  //
  // This read used to take every `deals` row of the event whatever its `status`,
  // so a withdrawn agreement still produced an entitlement and still generated a
  // transfer — money leaving on the strength of a contract that was cancelled.
  // `cancelled` is the one member of `deal_status` whose meaning is unambiguous:
  // there is nothing left to reconcile under it.
  //
  // Dropping it cannot unbalance the night. The operator's line is the residual
  // (pool − Σ everyone else), so the entitlement that disappears is absorbed
  // there and `Σ net = 0` still holds (`assertBalanced`, and asserted on the wire
  // in `settlement.test.ts` → "deal status at the engine boundary").
  const dealRows = await database
    .select()
    .from(schema.deals)
    .where(and(eq(schema.deals.eventId, eventId), ne(schema.deals.status, "cancelled")));
  const dealIds = dealRows.map((deal) => deal.id);
  const partyRows =
    dealIds.length > 0
      ? await database
          .select()
          .from(schema.dealParties)
          .where(inArray(schema.dealParties.dealId, dealIds))
      : [];

  // ...AND NOW THE DOOR: "a settlement cannot open unless the deal is signed"
  // (the product owner, 2026-08-31). The reasoning, and why it is a refusal
  // rather than a filter on the maths, is on `assertEveryAgreementSigned`.
  //
  // It is the FIRST thing this function does with what it read, and that ordering
  // is load-bearing: `ensureSettlementLines` below takes the settlement's copy of
  // the budget and SEALS it from the planner forever. A refused compute must not
  // leave that behind — an operator who is told to go and get a signature would
  // come back to a settlement quietly detached from the budget they then edited.
  // A refusal writes nothing.
  //
  // It sits here rather than in the two handlers for the same reason the deal
  // read does: compute and finalize are two doors into one piece of arithmetic,
  // and a rule enforced at one call site is enforced nowhere. The rows checked
  // are literally the rows the engine is about to settle.
  assertEveryAgreementSigned(dealRows, partyRows);

  // Take the settlement's copy of the budget if it does not have one yet. A
  // no-op on every run after the first — the copy is sealed, and re-pulling
  // would discard the actuals somebody typed into it (`lib/settlement-lines.ts`).
  await ensureSettlementLines(database, eventId);

  const participantRows = await database
    .select()
    .from(schema.eventParticipants)
    .where(eq(schema.eventParticipants.eventId, eventId));

  const participants: SettlementParticipant[] = participantRows.map((row) => ({
    participantId: row.id,
    isOperator: OPERATOR_EVENT_ROLES.has(row.role),
  }));

  // THE SETTLEMENT'S OWN LINES, never the planner's.
  //
  // "The settlement has a copy of the budget. The budget is never changed from
  // the settlement" (the product owner, 2026-08-27). Reading `budget_lines` here
  // is what used to collapse the forecast and the record into one set of rows —
  // see `migrations/0025`. The copy is taken by `ensureSettlementLines` on the
  // first compute and is sealed from the budget thereafter.
  const lineRows = await database
    .select({
      id: schema.settlementLines.id,
      budgetId: schema.settlementLines.eventId,
      label: schema.settlementLines.label,
      kind: schema.settlementLines.kind,
      amount: schema.settlementLines.amount,
      currency: schema.settlementLines.currency,
      collectedBy: schema.settlementLines.collectedBy,
      paidBy: schema.settlementLines.paidBy,
      payeeParticipantId: schema.settlementLines.payeeParticipantId,
      costSplit: schema.settlementLines.costSplit,
      dealId: schema.settlementLines.dealId,
    })
    .from(schema.settlementLines)
    .where(eq(schema.settlementLines.eventId, eventId));

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
    // WHO PAID, for an advance. The `payer` deal-party role is the statement of
    // record; `deals.payer_participant_id` is the older column and stands in when
    // no party row carries the role, so a deal authored either way still books
    // both ends of a prepayment.
    const payerParticipantId =
      parties.find((party) => party.roleInDeal === "payer")?.participantId ??
      deal.payerParticipantId ??
      undefined;

    // What this deal already moved before the night (`packages/settlement/prepaid.ts`).
    // Converted to base with the same locked rate as every other figure — an
    // advance agreed in EUR on a SEK night is still SEK in the settlement.
    const prepaidAmount = prepaidAmountOf({
      structure: deal.structure,
      paymentTiming: deal.paymentTiming,
      guaranteeAmount:
        deal.guaranteeAmount != null ? toBase(deal.guaranteeAmount, deal.currency) : undefined,
      advanceAmount:
        deal.advanceAmount != null ? toBase(deal.advanceAmount, deal.currency) : undefined,
    });

    // A DEAL THAT PREPAID NOBODY IS UNSETTLABLE, AND SAYS SO.
    //
    // `reconcile()` throws a bare `Error` here ("states money paid before the
    // event but names no payee"), which reaches the caller as a 500 whose body is
    // `{"error":{"code":"internal"}}` — the same opaque failure `unsettlableLine`
    // exists to replace one layer down, and the same 409 for the same reason: the
    // request is fine, the stored state is what blocks it. A deal that pays nobody
    // is deliberately allowed (the standalone operator's own record); it is the
    // money *already moved* to nobody that cannot be reconciled.
    //
    // `routes/deals.ts` refuses to WRITE this shape, so nothing reaches here that
    // was authored after that guard. This catches the rows that were not.
    if (payees.length === 0 && prepaidAmount > 0n) {
      throw conflict(
        `Deal "${deal.name}" (${deal.id}) states money paid before the event but names nobody it was paid to, so the settlement cannot balance. Give a party the Is paid role on it, or set it to settle at the event, then compute again.`,
      );
    }

    return {
      dealId: deal.id,
      structure: deal.structure,
      payeeParticipantIds: payees.map((payee) => payee.participantId),
      guaranteeAmount:
        deal.guaranteeAmount != null ? toBase(deal.guaranteeAmount, deal.currency) : undefined,
      splitBasisPoints: deal.splitBasisPoints ?? undefined,
      partyShares: hasShares ? partyShares : undefined,
      commissions: commissions.length > 0 ? commissions : undefined,
      // How those commissions stack, from the AGREEMENT rather than a global rule
      // (ClickUp 86cba8wmb). Moot when there is one commission or none, which is
      // every deal today — `parallel` and `cascading` agree on a single cut.
      commissionMode: deal.commissionMode,
      prepaidAmount: prepaidAmount > 0n ? prepaidAmount : undefined,
      payerParticipantId,
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
      // Carried purely so a short entitlement can name the costs that shortened
      // it. Nothing in the engine computes with it.
      label: line.label,
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
  const visible = new Set(rows.map((row) => row.participantId));

  // NOT co-operators. A co-promoter shares the residual with the host and still
  // sees only its own line, because visibility here is emergent from being a
  // party to a DEAL and an operator that is a party to nothing is a party to
  // nothing (decisions #4; pinned by "shows an operator that is a party to
  // nothing only its own line" in `settlement.test.ts`). Worth knowing when
  // reading a co-host's screen: the residual it is owed is half of a number it
  // cannot see the whole of.
  const participants = await database
    .select({
      id: schema.eventParticipants.id,
      profileId: schema.eventParticipants.profileId,
    })
    .from(schema.eventParticipants)
    .where(eq(schema.eventParticipants.eventId, eventId));

  // AN AGENT SEES THE LINE OF A PERFORMER IT REPRESENTS on this event.
  //
  // The agent is not on the performer's deal — it negotiates the deal, it is not
  // a party to it — so the join above never reaches the very line the agent's
  // whole involvement is about. It already earns a commission computed from that
  // entitlement, and `commissions` discloses the figure to it by name; and since
  // decisions.md #14 hands the agent the performer's `settlement.confirm`, it is
  // now expected to SIGN the line as well. Being asked to sign a number you are
  // not allowed to read is not a rule, it is a bug.
  //
  // Live representation, not the delegation stamp — the stamp outlives an
  // effective-dated termination until the sweep clears it.
  const myProfileIds = new Set(
    participants.filter((row) => myParticipantIds.has(row.id)).map((row) => row.profileId),
  );
  for (const delegation of await liveEventDelegations(database, eventId)) {
    if (myProfileIds.has(delegation.agentProfileId)) {
      visible.add(delegation.performerParticipantId);
    }
  }
  return visible;
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

/**
 * Re-read the settlement's PAYMENT state from its transfers.
 *
 * `partly_paid` and `paid` are not things anyone sets. The platform cannot know who
 * holds cash — the 2026-08 meeting is explicit (01:24:48): "collaborators confirm
 * their received amounts manually". What they confirm is a TRANSFER, one at a time,
 * and the settlement's status is a read of those confirmations. `decisions.md` #14
 * states the same principle for the representation settlement: "status is derived,
 * not a new enum".
 *
 * Only ever runs on a settlement that is already `finalized` or beyond. Before
 * that the figures can still move, so payment progress would be a claim about a
 * total that is not yet agreed — and the review states (`pending_review`,
 * `revised`, `dispute`) must not be silently overwritten by somebody ticking a
 * transfer.
 *
 * REPRESENTATION transfers are excluded. A private agent commission is its two
 * parties' business (decisions #14) and the operator never sees it; letting it
 * hold the event's settlement at `partly_paid` would leak its existence through
 * the status.
 */
async function syncPaymentStatus(tx: Transaction, eventId: string): Promise<void> {
  const rows = await tx
    .select({ id: schema.settlements.id, status: schema.settlements.status })
    .from(schema.settlements)
    .where(eq(schema.settlements.eventId, eventId));
  const payable = rows.filter((row) => PAYMENT_TRACKING_STATUSES.has(row.status));
  if (payable.length === 0) return;

  const transfers = await tx
    .select({ state: schema.settlementTransfers.state })
    .from(schema.settlementTransfers)
    .where(
      and(
        eq(schema.settlementTransfers.eventId, eventId),
        isNull(schema.settlementTransfers.representationId),
      ),
    );
  // No transfers at all means nothing was owed between the parties — a settlement
  // that nets to zero all round is settled the moment it is finalized.
  const settled = transfers.filter((row) => row.state === "paid" || row.state === "handled");
  const next =
    transfers.length === 0 || settled.length === transfers.length
      ? "paid"
      : settled.length > 0
        ? "partly_paid"
        : "finalized";

  for (const row of payable) {
    if (row.status === next) continue;
    await tx
      .update(schema.settlements)
      .set({ status: next, updatedAt: new Date() })
      .where(eq(schema.settlements.id, row.id));
  }
}

/**
 * The statuses whose payment progress is tracked — everything downstream of
 * finalize. A settlement still under review has no payment state to report.
 */
const PAYMENT_TRACKING_STATUSES: ReadonlySet<string> = new Set([
  "finalized",
  "partly_paid",
  "paid",
]);

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

            // Copy the budget (decisions.md #16.8). The FIRST compute writes
            // version 1, which is the plan of record — the budget as it stood
            // when the operator declared the night ready to reconcile, and the
            // earliest state anything in this system ever witnessed, because
            // `budget_lines` are edited in place and everything before it was
            // overwritten. Later computes capture only when the budget has
            // actually moved. Purely a record: `reconcile()` has already run
            // above and nothing here can reach it.
            await captureBudgetSnapshot(tx, id, "compute");

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

  // Planned vs actual (decisions.md #16.8, feeding the #16.9 analytics surface):
  // what the budget said before the reconciliation started, against what the night
  // actually did — per line, and in total.
  //
  // WHO MAY READ THIS, which is the whole security question here. A budget
  // snapshot is THE WHOLE NIGHT'S MONEY: every takings line, every cost, who
  // collected which. story.md:44 makes a performer's view of the pool an
  // inviolable ceiling — "only their own slice — never the event budget/pool …
  // even if an operator wanted to show them" — so this route is gated on
  // `budget.view`, the capability that already means exactly "may read the whole
  // night's money" and guards `GET /events/:id/budgets`.
  //
  // `budget.view` and not `settlement.edit`, though both are in
  // `POOL_CAPABILITIES` and either would hold the ceiling: this endpoint serves a
  // BUDGET, so the capability that names budgets is the one that should decide,
  // and reading the plan is not an act of editing the settlement. Because it is a
  // pool capability, `isGrantable` refuses it to any role but host/co_host — a
  // performer cannot be granted it even by an operator who wants to hand it over,
  // so no redaction path exists here and none is needed.
  //
  // The second boundary is INSIDE the operators: a co-promoter's private budget
  // is confidential (`routes/budget.ts` hides it), so the payload is filtered by
  // the caller's own memberships and says how many budgets it withheld rather
  // than quietly serving totals that do not add up.
  app.get(
    "/events/:id/settlement/planned-vs-actual",
    { schema: { params: EventParams, response: { 200: PlannedVsActualResponse } } },
    async (request) => {
      const { database } = request.server;
      const { id } = request.params;
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");

      await requireEventCapability(request, id, "budget.view");

      return plannedVsActual(
        database,
        id,
        principal.memberships.map((membership) => membership.profileId),
      );
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
      // Whose signature is the caller's to give: their own lines, plus the line of
      // any performer whose action capabilities currently sit with them
      // (decisions.md #14). The confirm route enforces exactly this set — this is
      // the same question asked for display, so the screen never offers a
      // signature the route will refuse, nor withholds one it would accept.
      const signable = new Set(mine);
      const myProfileIds = new Set(profileIds);
      for (const delegation of await liveEventDelegations(database, id)) {
        if (myProfileIds.has(delegation.agentProfileId)) {
          signable.add(delegation.performerParticipantId);
        }
      }

      const roster = await approvalRosterOf(database, id, visible);

      // Reach + invitation state, for the operator's delivery list below. Both are
      // asked only when the caller could act on the answer.
      const canSend = capabilities.has("settlement.edit");
      const reach = canSend
        ? await settlementPartyReach(database, id)
        : new Map<string, { participantId: string; emails: string[]; userIds: string[] }>();
      const invitedByParticipant = new Map<
        string,
        { email: string; invitedAt: Date; lastSeenAt: Date | null }
      >();
      if (canSend) {
        // The most recent live invitation per party. A share that has been revoked
        // or has expired is not a way in any more, so it must not read as "already
        // sent" — that is precisely the state where somebody needs sending again.
        const invitations = await database
          .select({
            participantId: schema.shareRecipients.linkedParticipantId,
            email: schema.shareRecipients.email,
            invitedAt: schema.shareRecipients.invitedAt,
            lastSeenAt: schema.shareRecipients.lastSeenAt,
          })
          .from(schema.shareRecipients)
          .innerJoin(schema.shares, eq(schema.shares.id, schema.shareRecipients.shareId))
          .where(
            and(
              eq(schema.shares.eventId, id),
              eq(schema.shares.targetKind, "settlement"),
              isNull(schema.shares.revokedAt),
              isNotNull(schema.shareRecipients.linkedParticipantId),
            ),
          )
          .orderBy(asc(schema.shareRecipients.invitedAt));
        for (const invitation of invitations) {
          if (!invitation.participantId) continue;
          invitedByParticipant.set(invitation.participantId, {
            email: invitation.email,
            invitedAt: invitation.invitedAt,
            lastSeenAt: invitation.lastSeenAt,
          });
        }
      }
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
            signable.has(row.participantId as string) &&
            (roster.get(row.participantId as string)?.approved ?? false),
          signableByYou: signable.has(row.participantId as string),
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
        // HOW EACH PARTY IS REACHED — the operator's half of the review step.
        //
        // Only for a caller who can send it out. Whether somebody has an account,
        // and which address the operator sent their settlement to, is not a
        // performer's business about their fellow acts; it is the roster of who
        // still has to be told, and telling them is `settlement.edit`.
        delivery: capabilities.has("settlement.edit")
          ? visibleSettlements.map((row) => {
              const participantId = row.participantId as string;
              const reached = reach.get(participantId);
              const invited = invitedByParticipant.get(participantId) ?? null;
              return {
                participantId,
                // An account behind the party ⇒ "send for review" reaches them
                // on its own. No account ⇒ they need an address assigned.
                onPlatform: (reached?.userIds.length ?? 0) > 0,
                invitedEmail: invited?.email ?? null,
                invitedAt: invited?.invitedAt?.toISOString() ?? null,
                // When they last opened the link — the difference between "sent"
                // and "read", which is the only thing the operator actually
                // wants to know while waiting on a signature.
                lastSeenAt: invited?.lastSeenAt?.toISOString() ?? null,
              };
            })
          : [],
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

  /**
   * The comment thread on this event's settlement.
   *
   * The 2026-08 meeting names comments as part of the workflow (01:12:54 — "the
   * process may involve comments or operator adjustment"), and the table has
   * existed all along. What was missing is any way for a SIGNED-IN party to read
   * or write it: the only writer was the off-platform share link
   * (`routes/shares.ts`), so the operator and the performer could each be sent a
   * link and comment on it, but neither could see the thread inside the product.
   *
   * VISIBILITY is the same rule the share document already applies
   * (`lib/share-document.ts` `loadComments`), because there must be one answer to
   * "whose conversation is this": your own party's comments, plus the event-side
   * ones that belong to nobody in particular. An operator holding
   * `settlement.edit` sees the whole thread — they are the party the review is
   * addressed to, and a review conversation they cannot read is not a review.
   */
  app.get(
    "/events/:id/settlement/comments",
    {
      schema: {
        params: EventParams,
        response: {
          200: z.array(
            z.object({
              id: z.string(),
              partyParticipantId: z.string().nullable(),
              authorName: z.string().nullable(),
              section: z.string().nullable(),
              /** The one figure this is about, when it is about one. */
              settlementLineId: z.string().nullable(),
              message: z.string(),
              createdAt: z.string(),
              isYours: z.boolean(),
            }),
          ),
        },
      },
    },
    async (request) => {
      const { database } = request.server;
      const { id } = request.params;
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");

      const capabilities = await requireEventCapability(request, id, "settlement.view.own");
      const profileIds = principal.memberships.map((membership) => membership.profileId);
      const mine = await participantIdsOf(database, id, profileIds);

      const rows = await database
        .select()
        .from(schema.settlementComments)
        .where(eq(schema.settlementComments.eventId, id))
        .orderBy(asc(schema.settlementComments.createdAt));

      const readsWholeThread = capabilities.has("settlement.edit");
      return rows
        .filter(
          (row) =>
            readsWholeThread || row.partyParticipantId == null || mine.has(row.partyParticipantId),
        )
        .map((row) => ({
          id: row.id,
          partyParticipantId: row.partyParticipantId,
          authorName: row.authorName,
          section: row.section,
          settlementLineId: row.settlementLineId,
          message: row.message,
          createdAt: row.createdAt.toISOString(),
          isYours: row.partyParticipantId != null && mine.has(row.partyParticipantId),
        }));
    },
  );

  /**
   * Add a remark to the thread.
   *
   * Scoped to the author's OWN participant row, which is what makes the read rule
   * above work: a comment belongs to a party, and the parties who are not that
   * party do not see it. An operator comments as the event side
   * (`party_participant_id` null) — the remark is addressed to everyone it is
   * being reviewed by, which is the operator's half of the conversation.
   *
   * POSTING MOVES THE STATUS. A settlement sitting at `pending_review` becomes
   * `comments_received` the moment somebody actually comments, because that is
   * the fact the operator needs on the list screen — "this one came back". The
   * prototype does the same thing (`postComment`), and it is the one status
   * change that should not need a button, since the comment IS the event.
   */
  app.post(
    "/events/:id/settlement/comments",
    {
      schema: {
        params: EventParams,
        body: z.object({
          message: z.string().min(1).max(4000),
          section: z.string().max(64).optional(),
          /**
           * The settlement line this remark is about (ClickUp `86cbcn1ue`: *"The
           * option for collaborators to comment on a specific field"*). Omitted
           * for a comment on the settlement as a whole, which stays the common
           * case and is what every existing caller sends.
           */
          settlementLineId: z.string().uuid().optional(),
        }),
        response: { 201: z.object({ id: z.string(), status: z.string() }) },
      },
    },
    async (request, reply) => {
      const { database } = request.server;
      const { id } = request.params;
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");

      const capabilities = await requireEventCapability(request, id, "message.post");
      const profileIds = principal.memberships.map((membership) => membership.profileId);
      const mine = await participantIdsOf(database, id, profileIds);
      // The operator speaks for the event, not for a party. Everyone else speaks
      // as themselves, and their own participant row is what scopes the remark.
      const asParty = capabilities.has("settlement.edit") ? null : ([...mine][0] ?? null);

      const rows = await settlementRowsOf(database, id);
      const partyRows = rows.filter((row) => row.representationId == null);
      const movesToCommentsReceived = partyRows.some((row) => row.status === "pending_review");

      const created = await database.transaction(async (tx) => {
        const [comment] = await tx
          .insert(schema.settlementComments)
          .values({
            eventId: id,
            partyParticipantId: asParty,
            // NULL on purpose. `author_name` exists for OFF-PLATFORM commenters,
            // who have no participant row to be looked up from. A signed-in author
            // is identified by `party_participant_id`, and the reader already turns
            // that into a person against the roster — copying the name in here
            // would be a second source for it, free to drift the moment somebody
            // renames a profile.
            authorName: null,
            section: request.body.section ?? null,
            settlementLineId: request.body.settlementLineId ?? null,
            message: request.body.message,
          })
          .returning();
        if (!comment) throw new Error("comment insert failed");

        if (movesToCommentsReceived) {
          for (const row of partyRows) {
            if (row.status !== "pending_review") continue;
            await tx
              .update(schema.settlements)
              .set({ status: "comments_received", updatedAt: new Date() })
              .where(eq(schema.settlements.id, row.id));
          }
        }
        await writeAudit(tx, request, {
          capability: "message.post",
          action: "settlement.comment",
          targetKind: "settlement",
          targetId: comment.id,
          eventId: id,
          after: { section: comment.section, settlementLineId: comment.settlementLineId },
        });
        // The MESSAGE never travels into the feed — a remark is addressed to the
        // parties in the thread, and the timeline reaches a wider room than that.
        // That somebody commented is the fact worth recording.
        await writeActivity(tx, request, {
          eventId: id,
          type: "settlement.commented",
          targetKind: "settlement",
          targetId: comment.id,
          summary: comment.section ? { section: comment.section } : {},
        });
        return comment;
      });

      // Realtime + feed. RECIPIENTS MIRROR THE READ RULE ABOVE, exactly: a party's
      // remark is readable only by the operators (`settlement.edit`), so only they
      // are told about it — notifying the other parties would announce the
      // existence of a message they would then find missing from their thread. The
      // operator's own remark is addressed to everyone reviewing, so it reaches
      // every party with a settlement.
      //
      // This is the step the review conversation was missing. A party who disputes
      // a figure moves the settlement to `comments_received` and, until now, was
      // relying on the operator happening to look at the list screen.
      try {
        const actorUserId = principal.userId;
        const recipients = asParty
          ? await eventParticipantRecipients(database, id, actorUserId, { operatorsOnly: true })
          : await settlementRecipients(database, id, actorUserId);
        const event = await loadEventSummary(database, id);
        const authorName = request.firebaseUser?.name ?? "Someone";
        await notifyUsers(
          database,
          recipients,
          actorUserId,
          {
            type: "settlement.commented",
            title: asParty ? "A party commented on the settlement" : "The organizer commented",
            // The MESSAGE never travels — same rule the activity row follows, and
            // the same rule the templates follow: the thread is the only surface
            // that can scope who reads which remark.
            body: `${authorName} left a remark for you to read.`,
            eventId: id,
            actorDisplay: request.firebaseUser?.name ?? undefined,
            link: `/events/${id}/settlement`,
            metadata: { commentId: created.id, section: created.section },
          },
          event
            ? {
                sink: request.server.emailSink,
                message: renderNotificationEmail({
                  subject: `Settlement comment: ${event.title}`,
                  preheader: "Someone has a question about the figures.",
                  heading: "There's a remark on the settlement",
                  paragraphs: [
                    `${authorName} left a comment on the settlement for ${event.title}.`,
                    "Open the settlement to read it and reply. The remark itself stays in the thread — it is addressed to the people in the conversation, and this message is not.",
                  ],
                  event,
                  action: { label: "Open the settlement", path: `/events/${event.id}/settlement` },
                }),
              }
            : undefined,
        );
      } catch (error) {
        request.log.error({ error, eventId: id }, "settlement comment notification failed");
      }

      return reply.status(201).send({
        id: created.id,
        status: movesToCommentsReceived ? "comments_received" : "unchanged",
      });
    },
  );

  /**
   * Move the settlement through the REVIEW conversation.
   *
   * The 2026-08 meeting describes this workflow and no more (01:12:54): the
   * collaborators put their revenue and costs in, the figures are computed from
   * real data, and "the process may involve comments or operator adjustment". So
   * this route carries exactly the states that conversation needs — sent out,
   * re-issued after adjustment, and contested — and nothing else.
   *
   * It deliberately CANNOT set `finalized` (its own route, because it locks FX and
   * is irreversible) nor `partly_paid`/`paid` (derived from the transfers; see
   * `syncPaymentStatus`). The prototype offers buttons for those last two; ours
   * would be lying, because the platform cannot know who holds cash.
   */
  app.post(
    "/events/:id/settlement/status",
    {
      schema: {
        params: EventParams,
        body: z.object({
          status: z.enum(REVIEW_STATUSES),
          /** Why — carried into the history so the timeline reads as a story. */
          note: z.string().max(500).optional(),
          /**
           * SEND IT TO THESE PARTIES ONLY — omit for everyone, which is what every
           * existing caller does and what it has always meant.
           *
           * ClickUp `86cbcn1ue`: *"the option to send settlement per collaborator
           * or to all."* The model already supported it and the route did not:
           * `status` lives on each participant's own settlement row, so one party
           * can be asked to review while another is still being worked on. A
           * promoter who has agreed their half should not have to wait for the
           * caterer's invoice to arrive before being asked to sign.
           */
          participantIds: z.array(z.string().uuid()).min(1).optional(),
        }),
        response: {
          200: z.object({
            status: z.string(),
            updated: z.number(),
            /** Addresses the review request was mailed to. Never assumed. */
            emailed: z.array(z.string()),
          }),
        },
      },
    },
    async (request) => {
      const { database } = request.server;
      const { id } = request.params;
      const { status, note } = request.body;

      await requireEventCapability(request, id, REVIEW_STATUS_CAPABILITY[status]);

      const rows = await settlementRowsOf(database, id);
      const everyParty = rows.filter((row) => row.representationId == null);
      if (everyParty.length === 0) {
        throw badRequest("Run the settlement before sending it for review");
      }

      /**
       * The rows this call actually changes — everyone, or the named few.
       *
       * A name that is not a party to this event is refused rather than ignored.
       * Silently sending to a subset of what was asked for is the worst of the
       * three outcomes here: the operator is told it went out, and the person they
       * meant to reach never hears about it.
       */
      const chosen = request.body.participantIds;
      const partyRows = chosen
        ? everyParty.filter((row) => chosen.includes(row.participantId ?? ""))
        : everyParty;
      if (chosen && partyRows.length !== chosen.length) {
        throw badRequest("One of the parties named is not on this settlement, so nothing was sent");
      }

      // A DISPUTE may be raised over frozen figures — that is precisely when a
      // party most needs to say the number is wrong, and flagging it changes no
      // money. The two operator states may not: re-issuing figures that are locked
      // would claim an adjustment the engine will refuse to make.
      if (
        status !== "dispute" &&
        partyRows.some((row) => LOCKED_SETTLEMENT_STATUSES.has(row.status))
      ) {
        throw conflict("This settlement is finalized; its figures can no longer be re-issued");
      }
      // Nothing follows being paid in full. Re-opening a closed settlement is a
      // credit note, not a status change.
      if (partyRows.some((row) => row.status === "paid")) {
        throw conflict("This settlement is fully paid");
      }

      const updated = await database.transaction(async (tx) => {
        let count = 0;
        for (const row of partyRows) {
          if (row.status === status) continue;
          const [after] = await tx
            .update(schema.settlements)
            .set({ status, updatedAt: new Date() })
            .where(eq(schema.settlements.id, row.id))
            .returning();
          if (after) count += 1;
          await writeAudit(tx, request, {
            capability: REVIEW_STATUS_CAPABILITY[status],
            action: `settlement.${status}`,
            targetKind: "settlement",
            targetId: row.id,
            eventId: id,
            before: { status: row.status },
            after: { status },
          });
        }
        // ONE activity row for the event, not one per party. The status is a fact
        // about the settlement as a whole, and a timeline that repeated it per
        // participant would read as three things happening instead of one. No
        // figures travel in the summary — the status is not money.
        await writeActivity(tx, request, {
          eventId: id,
          type: `settlement.${status}`,
          targetKind: "settlement",
          targetId: id,
          summary: note ? { note } : {},
        });
        return count;
      });

      /**
       * SENDING IT OUT MEANS SENDING IT OUT.
       *
       * `pending_review` is the operator saying "these are the figures, check
       * them". A status column nobody is told about is not a request for review —
       * it is a settlement quietly sitting in a state, waiting for parties to
       * happen to open the app. So every party with an account gets it in the
       * system AND in their inbox, which is what the operator already believes
       * pressing the button does.
       *
       * Only `pending_review`. Re-issuing (`revised`) lands on people already in
       * the conversation and reaches them through the app; a dispute is raised BY
       * a party and mailing them their own objection helps nobody.
       *
       * Parties with no account cannot be reached this way at all — there is no
       * address on file — and they are the reason `POST …/settlement/invitations`
       * exists. `emailed` reports who was actually reached so the screen can say
       * who still needs an address rather than implying everyone was told.
       *
       * NOT GATED by the settlements email preference, and the categories say so
       * (`NOTIFICATION_CATEGORIES`). This is the same message, word for word, that
       * goes to an OFF-PLATFORM party who has no preferences and no account — it is
       * the settlement being served on the people it concerns, not a copy of a
       * notification about it. A preference that could switch off the only channel
       * carrying an ask would leave somebody unable to answer it. The in-app
       * `settlement.pending_review` beside it IS gated, through `notifyUsers`.
       */
      const emailed: string[] = [];
      if (status === "pending_review") {
        try {
          const actorUserId = request.principal?.userId ?? null;
          const everyReach = await settlementPartyReach(database, id);
          // The same subset the status moved for. Telling somebody their figures
          // are ready to review when their row is still `open` would be worse than
          // not telling them at all.
          const reach = chosen
            ? new Map([...everyReach].filter(([participantId]) => chosen.includes(participantId)))
            : everyReach;
          const userIds = [
            ...new Set(
              [...reach.values()]
                .flatMap((party) => party.userIds)
                .filter((u) => u !== actorUserId),
            ),
          ];
          await notifyUsers(database, userIds, actorUserId, {
            type: "settlement.pending_review",
            title: "Settlement ready to review",
            body: "Check your figures and sign off when they match your books.",
            eventId: id,
            actorDisplay: request.firebaseUser?.name ?? undefined,
            link: `/events/${id}/settlement`,
            metadata: { eventId: id },
          });

          const event = await loadEventSummary(database, id);
          if (event) {
            const addresses = [
              ...new Set(
                [...reach.values()]
                  .filter((party) => !party.userIds.includes(actorUserId ?? ""))
                  .flatMap((party) => party.emails),
              ),
            ];
            for (const address of addresses) {
              try {
                await request.server.emailSink.sendEmail({
                  to: address,
                  // The SAME message an off-platform party gets, minus the share
                  // token: one review request, one wording, two doors in.
                  ...renderSettlementReviewEmail({
                    event,
                    senderName: request.firebaseUser?.name,
                  }),
                });
                emailed.push(address);
              } catch (error) {
                request.log.error({ error, eventId: id }, "settlement review email failed");
              }
            }
          }
        } catch (error) {
          request.log.error({ error, eventId: id }, "settlement review notification failed");
        }
      }

      return { status, updated, emailed };
    },
  );

  /**
   * SEND THE SETTLEMENT TO SOMEBODY WHO IS NOT ON SHOWME.
   *
   * The other half of "send for review". A party with an account is reached by
   * the status route above; a party without one has no address anybody has
   * recorded, so the operator picks them off the roster and says where to send
   * it. This is the same mechanism as the event's Share & Export — a protected
   * `shares` row, addressed to an email, opened with a one-time code
   * (`lib/share-invite.ts` is the single path both go through) — with the scope
   * fixed rather than chosen.
   *
   * FIXED SCOPE, and that is the point of having a settlement-specific door onto
   * it: `settlement.view.own` so they can read their own line, and
   * `settlement.confirm` so they can sign it off — which is what "verify their
   * end" means. Nothing else travels. The recipient is bound to the participant
   * the operator picked, so `POST /shares/:token/approve` records the signature
   * against the right party (`share_recipients.linked_participant_id`), and the
   * ceiling still applies on the way out: `narrowSharedCapabilities` will not put
   * a capability on the link that the operator does not hold themselves.
   *
   * `settlement.edit` to issue one. Choosing who receives an event's settlement
   * is the same authority as producing it, and a lower bar would let somebody who
   * may only READ a settlement post it to an arbitrary mailbox.
   */
  app.post(
    "/events/:id/settlement/invitations",
    {
      schema: {
        params: EventParams,
        body: z.object({
          participantId: z.string().uuid(),
          email: z.string().email(),
          name: z.string().max(120).optional(),
          expiresAt: z.string().datetime().optional(),
        }),
        response: {
          201: z.object({
            token: z.string(),
            email: z.string(),
            /** False when the mail sink refused it — the link still exists. */
            emailed: z.boolean(),
          }),
        },
      },
    },
    async (request, reply) => {
      const { database } = request.server;
      const { id } = request.params;
      const { participantId, email, name, expiresAt } = request.body;
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");
      if (!principal.actingProfileId) throw badRequest("No acting profile");

      const held = await requireEventCapability(request, id, "settlement.edit");

      // The party must be one this event actually settles. Inviting somebody to
      // verify a line that does not exist would mint a live token pointing at
      // nothing, and the recipient would prove their address for an empty page.
      const rows = await settlementRowsOf(database, id);
      const party = rows.find((row) => row.participantId === participantId);
      if (!party) {
        throw badRequest("That party has no settlement on this event to review");
      }

      const capabilities = narrowSharedCapabilities(
        ["settlement.view.own", "settlement.confirm"],
        held,
        "protected",
      );
      if (!capabilities.includes("settlement.view.own")) {
        // The operator cannot grant a view of the settlement they do not hold.
        throw forbidden("You cannot share a settlement you cannot see yourself");
      }

      const created = await createShareWithRecipients(request, {
        eventId: id,
        capabilities,
        access: "protected",
        targetKind: "settlement",
        targetId: party.id,
        expiresAt: expiresAt ? new Date(expiresAt) : undefined,
        recipients: [{ email, name, participantId }],
        ownerUserId: principal.userId,
        ownerProfileId: principal.actingProfileId,
        capability: "settlement.edit",
      });

      const delivered = await sendShareInvitations(request, {
        eventId: id,
        token: created.token,
        recipients: created.recipients,
        senderName: request.firebaseUser?.name,
      }).catch((error) => {
        request.log.error({ error, eventId: id }, "settlement invitation email failed");
        return [] as string[];
      });

      return reply.status(201).send({
        token: created.token,
        email: created.recipients[0]?.email ?? email,
        emailed: delivered.length > 0,
      });
    },
  );

  /**
   * THE SETTLEMENT'S OWN LINES — read, add, correct, remove.
   *
   * Where the real numbers are typed. A budget is a forecast and stays a
   * planning document; these are the record of what the night actually took and
   * cost, and `reconcile()` reads them. Nothing here touches `budget_lines` —
   * that is the rule these routes exist to keep.
   *
   * `settlement.edit` throughout: entering an actual cost is the same authority
   * as producing the settlement, and everything here moves money. `budget.edit`
   * would be the wrong gate — it is the forecast's permission, and the ceiling
   * hands it to people who have no business restating the night.
   *
   * Every write refuses a FINALIZED settlement (`assertNotFinalized`). Finalize
   * freezes an immutable snapshot; a line edited underneath it would silently
   * contradict the legal record. Correcting a finalized settlement is a credit
   * note, not an UPDATE.
   */
  const LineAmount = z
    .string()
    .regex(/^-?\d+$/, 'amount must be a whole number of minor units as a string, e.g. "150000"');
  const LineCostSplit = z.record(z.string().uuid(), z.number().int().min(1).max(10_000));

  /**
   * HOW THE OPERATOR ARRIVED AT A FIGURE — 260 tickets at 250, not just 65 000.
   *
   * The same shape the Budget Planner writes into `budget_lines.details`, and
   * `ensureSettlementLines` has always copied it across onto the settlement's own
   * line. Until now nothing on this surface would say so: the route neither
   * returned it nor accepted it, so the settlement could show the LABEL the
   * planner had baked the breakdown into ("Advance ticket sales (260 @ 250 SEK)")
   * while being unable to restate it.
   *
   * That is the defect behind *"tickets info (name, quantity, price) missing from
   * settlements"* (ClickUp 86cbcn1ue). After the show you know 168 sold, not 260,
   * and the honest edit is to change the COUNT and let the amount follow — not to
   * multiply it out by hand and leave the label lying about the arithmetic.
   *
   * `amount` stays authoritative and is what `reconcile` reads, exactly as on the
   * budget side. This only remembers how it was reached.
   */
  const SettlementLineDetails = z.object({
    basis: z
      .enum([
        "ticket_tier",
        "bar_spend",
        "merch_spend",
        "other_revenue",
        "custom_revenue",
        "custom_cost",
        "percentage_of",
      ])
      .default("ticket_tier"),
    unitAmount: LineAmount,
    quantity: z.number().int().min(0),
    /** Carried through from the budget copy — see `budget.ts`'s `LineDetails`. */
    ofKey: z.string().max(200).optional(),
    ofLabel: z.string().max(200).optional(),
    basisPoints: z.number().int().min(0).max(10_000).optional(),
  });

  const SettlementLineResponse = z.object({
    id: z.string(),
    kind: z.string(),
    label: z.string(),
    amount: z.string(),
    currency: z.string().nullable(),
    collectedBy: z.string().nullable(),
    paidBy: z.string().nullable(),
    payeeParticipantId: z.string().nullable(),
    costSplit: z.record(z.string(), z.number()).nullable(),
    dealId: z.string().nullable(),
    attributedDealId: z.string().nullable(),
    /** The forecast line this came from. Null = added here, never budgeted. */
    originBudgetLineId: z.string().nullable(),
    details: SettlementLineDetails.nullable(),
    version: z.number(),
  });

  const serializeLine = (row: typeof schema.settlementLines.$inferSelect) => ({
    id: row.id,
    kind: row.kind,
    label: row.label,
    amount: row.amount.toString(),
    currency: row.currency,
    collectedBy: row.collectedBy,
    paidBy: row.paidBy,
    payeeParticipantId: row.payeeParticipantId,
    costSplit: (row.costSplit as Record<string, number> | null) ?? null,
    dealId: row.dealId,
    attributedDealId: row.attributedDealId,
    originBudgetLineId: row.originBudgetLineId,
    details: (row.details as z.infer<typeof SettlementLineDetails> | null) ?? null,
    version: row.version,
  });

  app.get(
    "/events/:id/settlement/lines",
    {
      schema: { params: EventParams, response: { 200: z.array(SettlementLineResponse) } },
    },
    async (request) => {
      const { database } = request.server;
      const { id } = request.params;
      // `budget.view` — the same capability the pool ceiling already uses to mean
      // "may read the night's money" (`POOL_CAPABILITIES`). A performer reading
      // their own settlement never reaches here, which is the point.
      await requireEventCapability(request, id, "budget.view");
      const rows = await database
        .select()
        .from(schema.settlementLines)
        .where(eq(schema.settlementLines.eventId, id))
        .orderBy(asc(schema.settlementLines.createdAt));
      return rows.map(serializeLine);
    },
  );

  app.post(
    "/events/:id/settlement/lines",
    {
      schema: {
        params: EventParams,
        body: z.object({
          kind: z.enum(["revenue", "cost"]),
          label: z.string().min(1).max(200),
          amount: LineAmount,
          currency: z.string().min(1).optional(),
          collectedBy: z.string().uuid().optional(),
          paidBy: z.string().uuid().optional(),
          payeeParticipantId: z.string().uuid().optional(),
          costSplit: LineCostSplit.nullable().optional(),
          attributedDealId: z.string().uuid().optional(),
          details: SettlementLineDetails.nullable().optional(),
        }),
        response: { 201: SettlementLineResponse },
      },
    },
    async (request, reply) => {
      const { database } = request.server;
      const { id } = request.params;
      await requireEventCapability(request, id, "settlement.edit");
      assertNotFinalized(await settlementRowsOf(database, id));

      // A line added here was never budgeted, so `originBudgetLineId` stays null
      // and planned-vs-actual reports it as `added` — which is the truth.
      const created = await database.transaction(async (tx) => {
        const [row] = await tx
          .insert(schema.settlementLines)
          .values({
            eventId: id,
            kind: request.body.kind,
            label: request.body.label,
            amount: BigInt(request.body.amount),
            currency: request.body.currency,
            collectedBy: request.body.collectedBy,
            paidBy: request.body.paidBy,
            payeeParticipantId: request.body.payeeParticipantId,
            costSplit: request.body.costSplit ?? null,
            attributedDealId: request.body.attributedDealId,
            details: request.body.details ?? null,
          })
          .returning();
        if (!row) throw new Error("settlement line insert failed");
        await writeAudit(tx, request, {
          capability: "settlement.edit",
          action: "settlement.line.create",
          targetKind: "settlement_line",
          targetId: row.id,
          eventId: id,
          after: { label: row.label, kind: row.kind, amount: row.amount.toString() },
        });
        return row;
      });
      return reply.status(201).send(serializeLine(created));
    },
  );

  app.patch(
    "/events/:id/settlement/lines/:lid",
    {
      schema: {
        params: z.object({ id: z.string().uuid(), lid: z.string().uuid() }),
        body: z.object({
          label: z.string().min(1).max(200).optional(),
          amount: LineAmount.optional(),
          currency: z.string().min(1).nullable().optional(),
          collectedBy: z.string().uuid().nullable().optional(),
          paidBy: z.string().uuid().nullable().optional(),
          payeeParticipantId: z.string().uuid().nullable().optional(),
          costSplit: LineCostSplit.nullable().optional(),
          attributedDealId: z.string().uuid().nullable().optional(),
          details: SettlementLineDetails.nullable().optional(),
          /** Optimistic lock (decisions #8); mismatch → 409. */
          expectedVersion: z.number().int().optional(),
        }),
        response: { 200: SettlementLineResponse },
      },
    },
    async (request) => {
      const { database } = request.server;
      const { id, lid } = request.params;
      await requireEventCapability(request, id, "settlement.edit");
      assertNotFinalized(await settlementRowsOf(database, id));

      const [existing] = await database
        .select()
        .from(schema.settlementLines)
        .where(and(eq(schema.settlementLines.id, lid), eq(schema.settlementLines.eventId, id)));
      if (!existing) throw notFound("Settlement line not found");
      const { expectedVersion, amount, ...rest } = request.body;
      if (expectedVersion != null && expectedVersion !== existing.version) {
        throw conflict("This line changed since you loaded it — reload and try again");
      }

      const updated = await database.transaction(async (tx) => {
        const [row] = await tx
          .update(schema.settlementLines)
          .set({
            ...rest,
            ...(amount !== undefined ? { amount: BigInt(amount) } : {}),
            version: existing.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(schema.settlementLines.id, lid))
          .returning();
        if (!row) throw new Error("settlement line update failed");
        await writeAudit(tx, request, {
          capability: "settlement.edit",
          action: "settlement.line.update",
          targetKind: "settlement_line",
          targetId: lid,
          eventId: id,
          before: { label: existing.label, amount: existing.amount.toString() },
          after: { label: row.label, amount: row.amount.toString() },
        });
        return row;
      });
      return serializeLine(updated);
    },
  );

  app.delete(
    "/events/:id/settlement/lines/:lid",
    {
      schema: {
        params: z.object({ id: z.string().uuid(), lid: z.string().uuid() }),
        response: { 200: z.object({ id: z.string(), deleted: z.boolean() }) },
      },
    },
    async (request) => {
      const { database } = request.server;
      const { id, lid } = request.params;
      await requireEventCapability(request, id, "settlement.edit");
      assertNotFinalized(await settlementRowsOf(database, id));

      const [existing] = await database
        .select()
        .from(schema.settlementLines)
        .where(and(eq(schema.settlementLines.id, lid), eq(schema.settlementLines.eventId, id)));
      if (!existing) throw notFound("Settlement line not found");

      await database.transaction(async (tx) => {
        await tx.delete(schema.settlementLines).where(eq(schema.settlementLines.id, lid));
        await writeAudit(tx, request, {
          capability: "settlement.edit",
          action: "settlement.line.delete",
          targetKind: "settlement_line",
          targetId: lid,
          eventId: id,
          before: { label: existing.label, amount: existing.amount.toString() },
        });
      });
      return { id: lid, deleted: true };
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
      // An approval is a signature: it may only be given for one's own line, or
      // for the line of a performer whose signature is currently the caller's to
      // give. The route used to accept any settlement id on the event, so an
      // operator could record the performer's approval of the performer's own
      // money.
      //
      // The second case is DELEGATION, and decisions.md #14 is explicit about it:
      // a performer with an active agent hands over their action capabilities —
      // "confirm/approve/negotiate" — and keeps only the view floor. Without this
      // clause the authority went nowhere: the performer could no longer sign and
      // the agent could not sign for them, so a represented act's settlement was
      // unsignable by anybody and sat at "0/1 pending" for ever.
      //
      // Resolved against the live representation, never the `delegatedToAgent`
      // stamp alone — the stamp outlives an effective-dated termination until the
      // sweep clears it, and a lapsed agreement must not still sign for somebody's
      // money. Same rule, same reason, as `participantRiderDomain` in
      // `routes/riders.ts`.
      const profileIds = principal.memberships.map((membership) => membership.profileId);
      const mine = await participantIdsOf(database, id, profileIds);
      const signable = new Set(mine);
      const myProfileIds = new Set(profileIds);
      for (const delegation of await liveEventDelegations(database, id)) {
        if (myProfileIds.has(delegation.agentProfileId)) {
          signable.add(delegation.performerParticipantId);
        }
      }
      if (!signable.has(settlement.participantId)) {
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

      // Realtime + feed: the OPERATORS only. "Has everyone signed off yet?" is the
      // operator's question — it is what gates finalize — and it was answerable
      // only by re-reading the settlement list. The other parties are deliberately
      // not told: whether a different act has signed is that act's business, and
      // announcing it round the bill would leak the shape of a party-scoped
      // review to everyone on it.
      try {
        const actorUserId = principal.userId;
        const recipients = await eventParticipantRecipients(database, id, actorUserId, {
          operatorsOnly: true,
        });
        const event = await loadEventSummary(database, id);
        const signerName = request.firebaseUser?.name ?? "A party";
        await notifyUsers(
          database,
          recipients,
          actorUserId,
          {
            type: "settlement.party_confirmed",
            title: `${signerName} signed off their settlement`,
            body: "One more party has agreed their figures.",
            eventId: id,
            actorDisplay: request.firebaseUser?.name ?? undefined,
            link: `/events/${id}/settlement`,
            metadata: { settlementId: sid },
          },
          event
            ? {
                sink: request.server.emailSink,
                message: renderNotificationEmail({
                  subject: `Settlement signed off: ${event.title}`,
                  preheader: "One more party has agreed their figures.",
                  heading: "A party signed off their settlement",
                  paragraphs: [
                    `${signerName} has agreed their figures on ${event.title}.`,
                    // NO FIGURES, and no count of who is left — both are
                    // party-scoped facts, and only the screen can decide which of
                    // them this particular reader may see.
                    "Open the settlement to see where the review stands.",
                  ],
                  event,
                  action: { label: "Open the settlement", path: `/events/${event.id}/settlement` },
                }),
              }
            : undefined,
        );
      } catch (error) {
        request.log.error({ error, eventId: id, sid }, "settlement confirm notification failed");
      }

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
            // The budget the frozen figures came out of (decisions.md #16.8),
            // joined to the legal record by `settlement_snapshot_id`. Written
            // unconditionally, even when the budget has not moved since the last
            // compute capture: this row is not a duplicate of that one but a
            // different fact — the one that says WHICH budget produced the
            // snapshot above, and the one planned-vs-actual reads as "actual"
            // from now on so a later edit cannot restate what was concluded.
            await captureBudgetSnapshot(tx, id, "finalize", row.id);
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
        // The settlement's own status is a READ of these transfers, so it is
        // re-derived here rather than anywhere a human could set it by hand.
        await syncPaymentStatus(tx, id);
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
