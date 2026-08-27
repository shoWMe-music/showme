import type { Database } from "@showme/db";
import { schema } from "@showme/db";
import { convertMinorUnits } from "@showme/shared";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { badRequest, notFound } from "../errors";
import {
  type SerializedBudget,
  type SerializedBudgetLine,
  serializeBudget,
} from "../serialize/budget";
import type { Transaction } from "./audit";
import { loadRatesToBase } from "./exchange-rate";

/**
 * The budget snapshot (decisions.md #16.8) — capturing the plan, and reading it
 * back against what actually happened.
 *
 * THE PROBLEM IN ONE SENTENCE: `budget_lines` are edited in place from forecast
 * to fact, so by the time a settlement exists the forecast has been overwritten
 * by the actuals and there is nothing left to compare against. The owner's
 * framing is the shape of the fix — *"It copies the budget. Since budgets will be
 * used to determine predicted income, settlements are the real numbers."*
 *
 * The engine is not involved and must not be. `packages/settlement` is
 * authoritative and `Σ net = 0` is its invariant; a snapshot is a RECORD taken
 * beside the settlement, never an input to it. Nothing here is read by
 * `reconcile()`.
 */

/** Which act took the copy. */
export type BudgetSnapshotReason = "compute" | "finalize";

/**
 * The frozen content of one capture — what lands in `budget_snapshots.data`.
 *
 * `budgets` is the exact shape `GET /events/:id/budgets` serves, produced by the
 * same `serializeBudget`. One spelling of a budget line everywhere: a second
 * hand-written copy of that shape is precisely what audit A-13 was.
 */
interface CapturedBudget {
  baseCurrency: string;
  /**
   * Currency → rate to base, as at capture. Stored so the three denormalized
   * totals on the row can be REPRODUCED from `budgets` rather than merely
   * trusted — the same discipline finalize applies to `lockedRates`. Empty on a
   * single-currency event, which is the ordinary case.
   */
  rates: Record<string, string>;
  budgets: SerializedBudget[];
}

/**
 * Does this line move the POOL the settlement divides?
 *
 * A cost line carrying `deal_id` is that deal's own figure written down while
 * planning — a forecast of what the agreement will pay, not cash anybody moved —
 * and `reconcileEvent` drops it at the engine boundary so the fee is not charged
 * to the pool AND paid to the payee (the `budget_lines` schema comment, migration
 * 0019). The planned pool has to apply the identical rule or it could never tie
 * out against the settlement pool it sits beside.
 *
 * `attributed_deal_id` is the opposite sense — a real third-party cost merely
 * reported under a deal — and counts like any other cost. This predicate reads
 * `dealId` alone, exactly as the engine boundary does.
 */
function countsTowardPool(line: { kind: string; dealId: string | null }): boolean {
  return !(line.kind === "cost" && line.dealId !== null);
}

/** A line's signed effect on the pool: revenue up, counted cost down, dropped zero. */
function contributionOf(line: SerializedBudgetLine, amountBase: bigint): bigint {
  if (!countsTowardPool(line)) return 0n;
  return line.kind === "revenue" ? amountBase : -amountBase;
}

/**
 * A line's amount in the event's base currency, using the rates captured WITH it.
 *
 * A plan captured in March and an actual read in August each convert with the
 * rates in force at their own moment, so on a multi-currency event part of any
 * variance is the exchange rate rather than the box office. That is inherent to
 * comparing two dates, and each side's `rates` travel with it in the stored
 * record; on a single-currency event — the common case, and every seeded one —
 * the conversion is the identity and the variance is exact.
 */
function baseConverter(captured: CapturedBudget): (line: SerializedBudgetLine) => bigint {
  return (line) => {
    const from = line.currency ?? captured.baseCurrency;
    const amount = BigInt(line.amount);
    if (from === captured.baseCurrency) return amount;
    const rate = captured.rates[from];
    if (!rate) throw badRequest(`No exchange rate cached for ${from}→${captured.baseCurrency}`);
    return convertMinorUnits(amount, from, captured.baseCurrency, rate);
  };
}

interface CapturedTotals {
  revenue: bigint;
  costs: bigint;
  pool: bigint;
}

/** Σ revenue and Σ counted cost of a captured budget, in base minor units. */
function totalsOf(captured: CapturedBudget): CapturedTotals {
  const toBase = baseConverter(captured);
  let revenue = 0n;
  let costs = 0n;
  for (const budget of captured.budgets) {
    for (const line of budget.lines) {
      if (!countsTowardPool(line)) continue;
      if (line.kind === "revenue") revenue += toBase(line);
      else costs += toBase(line);
    }
  }
  return { revenue, costs, pool: revenue - costs };
}

/**
 * Read the event's budget exactly as it stands, in the shape a capture stores.
 *
 * EVERY scope, shared and private. `reconcileEvent` joins `budget_lines` to
 * `budgets` on `event_id` with no scope filter, so a co-promoter's private line
 * moves the pool like any other; a capture that skipped them would record a
 * planned pool that could never agree with the settlement beside it.
 * Confidentiality is applied where it already lives — at the serving boundary
 * (`visibleBudgets` below) — not by writing an incomplete record.
 */
async function readBudget(
  database: Database | Transaction,
  eventId: string,
): Promise<CapturedBudget> {
  const [event] = await database
    .select({ baseCurrency: schema.events.baseCurrency })
    .from(schema.events)
    .where(eq(schema.events.id, eventId));
  if (!event) throw notFound("Event not found");

  const budgetRows = await database
    .select()
    .from(schema.budgets)
    .where(eq(schema.budgets.eventId, eventId))
    .orderBy(asc(schema.budgets.id));

  const lineRows =
    budgetRows.length > 0
      ? await database
          .select()
          .from(schema.budgetLines)
          .where(
            inArray(
              schema.budgetLines.budgetId,
              budgetRows.map((budget) => budget.id),
            ),
          )
          // Ordered so two captures of an UNCHANGED budget serialize identically
          // and the deduplication below can compare them structurally. Without
          // it Postgres is free to return the same rows in a different order, and
          // every recompute would record a change that never happened.
          .orderBy(asc(schema.budgetLines.id))
      : [];

  const linesByBudget = new Map<string, (typeof lineRows)[number][]>();
  for (const line of lineRows) {
    const bucket = linesByBudget.get(line.budgetId);
    if (bucket) bucket.push(line);
    else linesByBudget.set(line.budgetId, [line]);
  }

  const rates = await loadRatesToBase(
    database,
    event.baseCurrency,
    lineRows.map((line) => line.currency ?? event.baseCurrency),
  );

  return {
    baseCurrency: event.baseCurrency,
    rates: Object.fromEntries(rates),
    budgets: budgetRows.map((budget) =>
      serializeBudget(budget, linesByBudget.get(budget.id) ?? []),
    ),
  };
}

/**
 * The SETTLEMENT's lines, shaped as a captured budget so the comparison below
 * needs no special case.
 *
 * This is the "actual" side now. `readBudget` above reads the planner's rows and
 * remains the "planned" side; since 0025 the settlement keeps its own copy and
 * that copy is what `reconcile()` settles, so it is also what actually happened.
 *
 * **Each row is serialized under its ORIGIN id.** `linesOf` keys on `line.id`,
 * and pairing a settlement line to the forecast line it came from is exactly the
 * question planned-vs-actual asks — so a copied line answers with the budget line
 * it was copied from, and a line first entered in the settlement answers with its
 * own id, pairs with nothing, and is reported `added`. Which is the truth: it was
 * never budgeted.
 *
 * One synthetic budget wrapper, because `CapturedBudget` is grouped by budget and
 * the settlement's copy is flat — the grouping carries no meaning on this side.
 */
async function readSettlementLines(
  database: Database | Transaction,
  eventId: string,
): Promise<CapturedBudget> {
  const [event] = await database
    .select({ baseCurrency: schema.events.baseCurrency })
    .from(schema.events)
    .where(eq(schema.events.id, eventId));
  if (!event) throw notFound("Event not found");

  const rows = await database
    .select()
    .from(schema.settlementLines)
    .where(eq(schema.settlementLines.eventId, eventId))
    // Same reason as `readBudget`: a stable order so two reads of an unchanged
    // settlement serialize identically.
    .orderBy(asc(schema.settlementLines.id));

  const rates = await loadRatesToBase(
    database,
    event.baseCurrency,
    rows.map((line) => line.currency ?? event.baseCurrency),
  );

  // ONE SHARED BUCKET, and that is not a simplification — only the shared budget
  // is ever copied into a settlement (`lib/settlement-lines.ts`), so every row
  // here is shared by construction. There is no private line in the copy for the
  // visibility filter to withhold, because a private budget never gets in.
  return {
    baseCurrency: event.baseCurrency,
    rates: Object.fromEntries(rates),
    budgets: [
      {
        id: eventId,
        eventId,
        scope: "shared",
        ownerProfileId: null,
        planningAssumptions: null,
        version: 1,
        lines: rows.map((line) => ({
          id: line.originBudgetLineId ?? line.id,
          budgetId: eventId,
          kind: line.kind,
          source: line.source,
          providerRef: line.providerRef,
          label: line.label,
          amount: line.amount.toString(),
          currency: line.currency,
          collectedBy: line.collectedBy,
          paidBy: line.paidBy,
          payeeParticipantId: line.payeeParticipantId,
          costSplit: line.costSplit as Record<string, number> | null,
          details: line.details as SerializedBudgetLine["details"],
          dealId: line.dealId,
          attributedDealId: line.attributedDealId,
          version: line.version,
        })),
      } satisfies SerializedBudget,
    ],
  };
}

type BudgetSnapshotRow = typeof schema.budgetSnapshots.$inferSelect;

/** The newest capture on an event, or null if it has never been captured. */
async function latestCapture(
  database: Database | Transaction,
  eventId: string,
): Promise<BudgetSnapshotRow | null> {
  const [row] = await database
    .select()
    .from(schema.budgetSnapshots)
    .where(eq(schema.budgetSnapshots.eventId, eventId))
    .orderBy(desc(schema.budgetSnapshots.version))
    .limit(1);
  return row ?? null;
}

/**
 * Copy the budget as it stands now (decisions.md #16.8).
 *
 * WHEN, AND WHY BOTH MOMENTS. #16.8 says "created/finalized" and the answer is
 * genuinely both, for two different reasons:
 *
 *  - **On compute** — because a settlement is COMPUTED MANY TIMES before it is
 *    frozen, and the movement worth recording happens in between. The first
 *    compute is the operator declaring the night finished enough to reconcile,
 *    and the budget at that instant is the earliest state the platform can
 *    honestly claim to have witnessed. That capture becomes **version 1, the plan
 *    of record**, and it is never rewritten. Waiting for finalize would take the
 *    baseline AFTER the settlement conversation had already corrected everything
 *    — the variance would be zero on every event by construction, which is the
 *    failure mode of measuring the plan with the ruler you cut from it. Most
 *    events are also never finalized at all, and #16.9 needs those too.
 *
 *  - **On finalize** — because that is the legal freeze, and the frozen figures
 *    have to stay checkable against the budget they came out of. A `finalize`
 *    capture carries `settlement_snapshot_id`, so the immutable record and the
 *    budget that produced it are one join apart.
 *
 * A compute capture is SKIPPED when the budget has not moved since the last one:
 * recomputing an unchanged event is routine, and otherwise it would stack a pile
 * of identical rows a reader would have to diff to find the real changes. Same
 * structural comparison `sameBreakdown` makes on the settlement rows, for the
 * same reason. A finalize capture is ALWAYS written even when identical — it is
 * not a duplicate but a different fact, the one that names the freeze.
 *
 * Returns the row written, or null when a compute capture was deduplicated away.
 */
/**
 * A capture reduced to what would make somebody call it a different set of lines.
 *
 * Deliberately drops `budgetId`: version 1 groups lines under the planner's
 * budget and every later version under the settlement's own copy, and that
 * difference is bookkeeping, not a change to the night's money. Sorted by id so
 * two reads in different row orders fingerprint identically — the same reason
 * `readBudget` and `readSettlementLines` both order their queries.
 */
function fingerprintOf(captured: CapturedBudget): string {
  const lines = captured.budgets
    .flatMap((budget) => budget.lines)
    .map((line) => ({
      id: line.id,
      kind: line.kind,
      label: line.label,
      amount: line.amount,
      currency: line.currency,
      collectedBy: line.collectedBy,
      paidBy: line.paidBy,
      payeeParticipantId: line.payeeParticipantId,
      costSplit: line.costSplit,
      dealId: line.dealId,
      attributedDealId: line.attributedDealId,
      details: line.details,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  return JSON.stringify(lines);
}

export async function captureBudgetSnapshot(
  tx: Transaction,
  eventId: string,
  reason: BudgetSnapshotReason,
  settlementSnapshotId?: string,
): Promise<BudgetSnapshotRow | null> {
  // VERSION 1 IS THE FORECAST; everything after it is the settlement's own copy.
  //
  // The plan of record is the budget as it stood when the operator first declared
  // the night ready to reconcile — read from `budget_lines`, because at that
  // moment the settlement has no figures of its own. Every later capture records
  // what the SETTLEMENT says, since 0025 gave it a copy of its own and the engine
  // settles that. Capturing the budget again would be recording the forecast
  // twice and calling the second one the outcome.
  const latest = await latestCapture(tx, eventId);
  const captured = latest ? await readSettlementLines(tx, eventId) : await readBudget(tx, eventId);

  if (reason === "compute" && latest) {
    const previous = latest.data as CapturedBudget;
    // Compared by CONTENT, not by structure. Version 1 is grouped by budget and
    // every later version is the settlement's flat copy, so the two nest
    // differently even when not a figure has moved — and a raw structural
    // comparison would record a change on the first recompute after the plan,
    // every time, for every event. The fingerprint is what a reader would call
    // the same set of lines.
    if (fingerprintOf(previous) === fingerprintOf(captured)) return null;
  }

  const totals = totalsOf(captured);
  const [row] = await tx
    .insert(schema.budgetSnapshots)
    .values({
      eventId,
      version: (latest?.version ?? 0) + 1,
      reason,
      settlementSnapshotId: settlementSnapshotId ?? null,
      baseCurrency: captured.baseCurrency,
      plannedRevenue: totals.revenue,
      plannedCosts: totals.costs,
      plannedPool: totals.pool,
      data: captured,
    })
    .returning();
  if (!row) throw new Error("budget snapshot insert failed");
  return row;
}

// ── Reading it back: planned vs actual ──────────────────────────────────────

/** One side of the comparison, in the event's base currency as STRINGS (money.md). */
export interface PlannedVsActualSide {
  /** `plan` = the version-1 capture · `finalize` = the frozen one · `live` = the budget as it stands. */
  source: "plan" | "finalize" | "live";
  /** Which capture this is, when it is one. Null for the live budget. */
  version: number | null;
  capturedAt: string | null;
  revenue: string;
  costs: string;
  pool: string;
  /**
   * How many budgets on this event the caller may NOT see, and whose lines are
   * therefore absent from the figures above. A co-operator's private budget is
   * confidential (`routes/budget.ts`) but its lines DO move the settlement's
   * pool, so a total computed from the visible subset can legitimately fail to
   * match the settlement. Saying so is the honest alternative to a number that
   * quietly does not add up. Zero on every single-operator event.
   */
  withheldBudgetCount: number;
}

/** One captured line, in the shape the comparison serves it. */
export interface PlannedVsActualLineSide {
  label: string;
  /** As typed, in the line's OWN currency. */
  amount: string;
  currency: string | null;
  /** The same money in the event's base currency — what the variance is computed in. */
  amountBase: string;
  /** The planner's unit x quantity, when the line has one (200 tickets x 250). */
  details: SerializedBudgetLine["details"];
  /** False for a cost line the settlement engine drops as a deal's own figure. */
  countsTowardPool: boolean;
}

/** One budget line, as planned and as it turned out. */
export interface PlannedVsActualLine {
  lineId: string;
  budgetId: string;
  label: string;
  kind: string;
  /** `both` · `added` after the plan · `removed` before the actual. */
  status: "both" | "added" | "removed";
  planned: PlannedVsActualLineSide | null;
  actual: PlannedVsActualLineSide | null;
  /** `actual − planned` in base minor units; a missing side counts as zero. */
  variance: string;
  /**
   * What that movement did to the POOL — revenue up is positive, a cost up is
   * negative, and a line the engine drops (a `dealId` on a cost) contributes
   * zero. Σ `poolEffect` over every line equals `actual.pool − plan.pool`
   * exactly, which is what lets a Financials tab attribute the whole variance to
   * rows instead of showing a total nobody can account for.
   */
  poolEffect: string;
}

export interface PlannedVsActual {
  eventId: string;
  baseCurrency: string;
  /** Null until the event's first settlement compute — nothing was ever captured. */
  plan: PlannedVsActualSide | null;
  actual: PlannedVsActualSide;
  /** `actual − plan`, per total. Null when there is no plan to compare against. */
  variance: { revenue: string; costs: string; pool: string } | null;
  /**
   * The pool the SETTLEMENT produced, which is the authority on the night's
   * money — `actual.pool` is the budget's own arithmetic and can legitimately
   * differ from it (an off-the-top rental, a deal's own figure). Null before the
   * first compute, and withheld when part of the budget is withheld too.
   */
  settlementPool: string | null;
  lines: PlannedVsActualLine[];
  /** Every capture, oldest first — the history of the settlement conversation. */
  captures: { version: number; reason: string; capturedAt: string }[];
}

/**
 * Keep only the budgets this caller may see — the same predicate
 * `routes/budget.ts` folds into its WHERE, applied here to a frozen copy.
 * Shared budgets for every co-operator; a private one only for its owner.
 */
function visibleBudgets(
  captured: CapturedBudget,
  profileIds: readonly string[],
): { visible: CapturedBudget; withheldBudgetCount: number } {
  const budgets = captured.budgets.filter(
    (budget) =>
      budget.scope === "shared" ||
      (budget.ownerProfileId != null && profileIds.includes(budget.ownerProfileId)),
  );
  return {
    visible: { ...captured, budgets },
    withheldBudgetCount: captured.budgets.length - budgets.length,
  };
}

function sideOf(
  captured: CapturedBudget,
  profileIds: readonly string[],
  source: PlannedVsActualSide["source"],
  version: number | null,
  capturedAt: Date | null,
): { side: PlannedVsActualSide; visible: CapturedBudget } {
  const { visible, withheldBudgetCount } = visibleBudgets(captured, profileIds);
  const totals = totalsOf(visible);
  return {
    visible,
    side: {
      source,
      version,
      capturedAt: capturedAt?.toISOString() ?? null,
      revenue: totals.revenue.toString(),
      costs: totals.costs.toString(),
      pool: totals.pool.toString(),
      withheldBudgetCount,
    },
  };
}

/** One indexed line: the served side, plus the row it came from for the arithmetic. */
type IndexedLine = PlannedVsActualLineSide & { line: SerializedBudgetLine };

/** Index a captured budget's lines by id, converted with that capture's own rates. */
function linesOf(captured: CapturedBudget): Map<string, IndexedLine> {
  const toBase = baseConverter(captured);
  const index = new Map<string, IndexedLine>();
  for (const budget of captured.budgets) {
    for (const line of budget.lines) {
      index.set(line.id, {
        line,
        label: line.label,
        amount: line.amount,
        currency: line.currency,
        amountBase: toBase(line).toString(),
        details: line.details,
        countsTowardPool: countsTowardPool(line),
      });
    }
  }
  return index;
}

/** Drop the internal row carried alongside a side while indexing. */
function servedSide(indexed: IndexedLine): PlannedVsActualLineSide {
  const { line: _line, ...rest } = indexed;
  return rest;
}

/**
 * Answer "what was planned, and what actually happened" for one event.
 *
 * The PLAN is version 1 — the capture the first settlement compute took, and the
 * only pre-conversation state the platform ever witnessed. The ACTUAL is the
 * `finalize` capture once the event has been frozen (so the comparison matches
 * the legal record forever after), and otherwise the budget as it stands right
 * now, which is what an operator mid-settlement is looking for.
 *
 * `profileIds` are the CALLER's memberships and are load-bearing: they decide
 * which budgets are theirs to read. The route above has already established that
 * the caller holds `budget.view` — which `POOL_CAPABILITIES` makes ungrantable to
 * any arm's-length party, so no performer, agent or crew member reaches here at
 * all — and this second filter is the co-operator boundary inside that.
 */
/**
 * The "actual" side while a settlement is still open.
 *
 * Normally the settlement's own copy — that is what `reconcile()` settles and so
 * what actually happened. Before the FIRST compute there is no copy, and the
 * honest answer there is the budget: nothing has been settled yet, so what would
 * happen if you ran it now is the forecast, unchanged. Reporting zero would say
 * the night took nothing, which is a different and false claim.
 *
 * The distinction is never silent — `source: "live"` already means "as it stands
 * right now" rather than "as it was concluded".
 */
async function liveActual(
  database: Database | Transaction,
  eventId: string,
): Promise<CapturedBudget> {
  const [copied] = await database
    .select({ id: schema.settlementLines.id })
    .from(schema.settlementLines)
    .where(eq(schema.settlementLines.eventId, eventId))
    .limit(1);
  return copied ? readSettlementLines(database, eventId) : readBudget(database, eventId);
}

export async function plannedVsActual(
  database: Database,
  eventId: string,
  profileIds: readonly string[],
): Promise<PlannedVsActual> {
  const captures = await database
    .select()
    .from(schema.budgetSnapshots)
    .where(eq(schema.budgetSnapshots.eventId, eventId))
    .orderBy(asc(schema.budgetSnapshots.version));

  const planRow = captures[0] ?? null;
  // The newest FINALIZE capture, not the newest capture of any kind: once an
  // event is frozen the comparison must stop moving with the live budget, or a
  // later edit would silently restate what the settlement concluded.
  const finalizeRow = [...captures].reverse().find((row) => row.reason === "finalize") ?? null;

  const live = await readBudget(database, eventId);

  const plan = planRow
    ? sideOf(
        planRow.data as CapturedBudget,
        profileIds,
        "plan",
        planRow.version,
        planRow.capturedAt,
      )
    : null;
  const actual = finalizeRow
    ? sideOf(
        finalizeRow.data as CapturedBudget,
        profileIds,
        "finalize",
        finalizeRow.version,
        finalizeRow.capturedAt,
      )
    : sideOf(await liveActual(database, eventId), profileIds, "live", null, null);

  const plannedLines = plan ? linesOf(plan.visible) : new Map<string, IndexedLine>();
  const actualLines = linesOf(actual.visible);

  const lines: PlannedVsActualLine[] = [];
  for (const lineId of new Set([...plannedLines.keys(), ...actualLines.keys()])) {
    const plannedSide = plannedLines.get(lineId) ?? null;
    const actualSide = actualLines.get(lineId) ?? null;
    const reference = actualSide ?? plannedSide;
    if (!reference) continue;

    const plannedBase = plannedSide ? BigInt(plannedSide.amountBase) : 0n;
    const actualBase = actualSide ? BigInt(actualSide.amountBase) : 0n;
    // Computed from each side's own pool CONTRIBUTION rather than from the raw
    // delta, so a line whose kind or deal attribution changed between plan and
    // actual still accounts for itself — and Σ poolEffect stays exactly equal to
    // the difference of the two pools whatever anybody edited.
    const plannedContribution = plannedSide ? contributionOf(plannedSide.line, plannedBase) : 0n;
    const actualContribution = actualSide ? contributionOf(actualSide.line, actualBase) : 0n;

    lines.push({
      lineId,
      budgetId: reference.line.budgetId,
      label: reference.label,
      kind: reference.line.kind,
      status: plannedSide && actualSide ? "both" : actualSide ? "added" : "removed",
      planned: plannedSide ? servedSide(plannedSide) : null,
      actual: actualSide ? servedSide(actualSide) : null,
      variance: (actualBase - plannedBase).toString(),
      poolEffect: (actualContribution - plannedContribution).toString(),
    });
  }
  lines.sort(
    (left, right) =>
      left.label.localeCompare(right.label) || left.lineId.localeCompare(right.lineId),
  );

  // The settlement's own pool, read off whichever stored row carries the ladder
  // (every row of one compute carries the same one). Withheld when part of the
  // budget is withheld too: a pool covering lines the caller may not see would be
  // exactly the co-promoter disclosure `visibleBudgets` just prevented.
  let settlementPool: string | null = null;
  if (actual.side.withheldBudgetCount === 0) {
    const settlementRows = await database
      .select({ computed: schema.settlements.computed })
      .from(schema.settlements)
      .where(eq(schema.settlements.eventId, eventId));
    for (const row of settlementRows) {
      const ladder = (row.computed as { ladder?: { pool?: string } } | null)?.ladder;
      if (ladder?.pool != null) {
        settlementPool = ladder.pool;
        break;
      }
    }
  }

  return {
    eventId,
    baseCurrency: live.baseCurrency,
    plan: plan?.side ?? null,
    actual: actual.side,
    variance: plan
      ? {
          revenue: (BigInt(actual.side.revenue) - BigInt(plan.side.revenue)).toString(),
          costs: (BigInt(actual.side.costs) - BigInt(plan.side.costs)).toString(),
          pool: (BigInt(actual.side.pool) - BigInt(plan.side.pool)).toString(),
        }
      : null,
    settlementPool,
    lines,
    captures: captures.map((row) => ({
      version: row.version,
      reason: row.reason,
      capturedAt: row.capturedAt.toISOString(),
    })),
  };
}
