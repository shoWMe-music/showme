import { type Database, schema } from "@showme/db";
/**
 * A HOLD THAT JOINS A QUEUE LATE STILL HAS TO TAKE A NUMBER — QA sweep run 5 (QA5-4).
 *
 * `events.hold_rank` is nullable and every reader answers 1 for NULL, which is right
 * for the only pencil on a night: writing a 1 would file a rank change for a move
 * nobody made. It stops being right the moment the hold shares its queue, and the
 * app has a path straight into that state — a hold placed against a typed venue NAME
 * is in no queue at all (the pool is keyed on the venue PROFILE), so its placement
 * sees no competitors and writes no rank; attaching the venue afterwards drops it
 * into a queue that already has a first.
 *
 * Measured before the fix: `GET /events/:id/hold` answered `[1, 1, 2]` for three
 * holds on one night in one room, and **neither** hold reading 1st could be promoted
 * — `canPromoteToFirst` is `(holdRank ?? 1) !== 1`, so the tie was unbreakable from
 * the only screen that showed it.
 *
 * The arithmetic is `rankForHoldJoiningQueue` in `@showme/shared` (pure, tested per
 * branch). This is the database half: which rows are the queue, and the one write.
 */
import {
  type HoldRankUpdate,
  type HoldSibling,
  computeDeclinePromotion,
  rankForHoldJoiningQueue,
} from "@showme/shared";
import { type Column, type SQL, and, eq, isNull, ne, sql } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import { writeActivity } from "./activity";
import { type Transaction, writeAudit } from "./audit";
import { eventCapabilities } from "./authorize";

type EventRow = typeof schema.events.$inferSelect;

/** The fields that can move an event into, out of, or between hold queues. */
const QUEUE_FIELDS = ["status", "venueProfileId", "stageId", "eventDate"] as const;

/** The three that identify WHICH queue — status says whether it is in one at all. */
const QUEUE_IDENTITY_FIELDS = ["venueProfileId", "stageId", "eventDate"] as const;

/** Whether this PATCH could have changed which queue the event stands in. */
export function touchesHoldQueue(changedFields: readonly string[]): boolean {
  return QUEUE_FIELDS.some((field) => changedFields.includes(field));
}

/**
 * Did this PATCH move the hold to a DIFFERENT queue?
 *
 * A rank is a position in one queue and means nothing in another (QA sweep run 6,
 * QA6-6): a hold sitting 2nd on 4 December, moved to 11 December, carried its 2 into
 * a queue that already had one — two holds reading 2nd. So a hold that changes room,
 * venue or night re-joins at the back, and a hold that stays put keeps the number
 * somebody gave it.
 *
 * `status` is not in here on purpose. Coming INTO `on_hold` is not a move between
 * queues; it is arriving in one, and a rank that already exists at that moment was
 * set for this same date and room.
 */
export function movedHoldQueue(changedFields: readonly string[]): boolean {
  return QUEUE_IDENTITY_FIELDS.some((field) => changedFields.includes(field));
}

/**
 * Give this hold the back of its queue if it has no rank and the queue is not empty.
 * Returns the rank written, or null when nothing needed writing.
 *
 * Only this event's own row is touched. A queue spans operators — one room on one
 * night is one queue, and two operators courting it are in it together — so renumbering
 * the others would be writing rows this caller has no authority over. The back is also
 * exactly where the placement wizard already puts a new hold.
 */
export async function placeHoldInQueue(
  tx: Transaction,
  event: {
    id: string;
    status: string;
    holdRank: number | null;
    eventDate: string | null;
    venueProfileId: string | null;
    stageId: string | null;
    hostProfileId: string;
  },
  options: {
    /**
     * True when this PATCH changed the date, venue or room — so whatever rank the
     * hold carries belongs to a queue it has left. See `movedHoldQueue`.
     */
    movedQueue?: boolean;
  } = {},
): Promise<number | null> {
  // Only the first of these three is a RULE of its own — an event that is not a hold
  // is not in the queue, it has the night. The other two are short-circuits that save
  // a query on the commonest PATCHes: `rankForHoldJoiningQueue` already answers null
  // for a hold that has a rank, and a dateless hold would find no siblings anyway
  // (`eq(column, null)` compiles to `= NULL`, which matches nothing). They are stated
  // here so the query below never runs for a row that cannot need it; mutating either
  // away leaves the answer unchanged, which is the honest reason there is no test
  // pinning them.
  if (event.status !== "on_hold") return null;
  // A rank the hold already has is somebody's decision — UNLESS it moved queue, in
  // which case the number describes a night it is no longer on (QA6-6).
  if (event.holdRank !== null && !options.movedQueue) return null;
  if (event.eventDate === null) return null;

  // The same queue key the pool read and every cascade use (`loadSiblings` in
  // routes/holds.ts): date, venue and room — and, for a hold with no venue profile,
  // the host's own holds only, because a name typed into a box is not a shared room.
  const siblingRows = await tx
    .select({ id: schema.events.id, holdRank: schema.events.holdRank })
    .from(schema.events)
    .where(
      and(
        eq(schema.events.status, "on_hold"),
        eq(schema.events.eventDate, event.eventDate),
        event.venueProfileId === null
          ? and(
              isNull(schema.events.venueProfileId),
              eq(schema.events.hostProfileId, event.hostProfileId),
            )
          : eq(schema.events.venueProfileId, event.venueProfileId),
        event.stageId === null
          ? isNull(schema.events.stageId)
          : eq(schema.events.stageId, event.stageId),
        ne(schema.events.id, event.id),
      ),
    );

  const siblings: HoldSibling[] = siblingRows.map((row) => ({
    id: row.id,
    holdRank: row.holdRank ?? 1,
  }));
  // A hold that moved queue arrives unranked by definition: it holds no position in
  // the queue it just entered, whatever number it brought with it.
  const carriedRank = options.movedQueue ? null : event.holdRank;
  const rank = rankForHoldJoiningQueue({ holdRank: carriedRank, siblings });
  // Nothing to join, and a stale number from the queue it left would read as a
  // position in this one — so it goes back to NULL, the lone hold's own state.
  if (rank === null) {
    if (options.movedQueue && event.holdRank !== null && siblings.length === 0) {
      await tx
        .update(schema.events)
        .set({ holdRank: null, updatedAt: new Date() })
        .where(eq(schema.events.id, event.id));
    }
    return null;
  }
  // Nothing to write when the answer is the number it already has. A no-op UPDATE,
  // not a rule: mutating this line away changes no result, which is why no test pins
  // it — it is here so a PATCH that touches a queue field without moving anything
  // does not write a row.
  if (rank === event.holdRank) return null;

  await tx
    .update(schema.events)
    .set({ holdRank: rank, updatedAt: new Date() })
    .where(eq(schema.events.id, event.id));
  return rank;
}

/** `= value`, or `IS NULL` when the value is null — SQL `= null` never matches. */
function matchNullable(column: Column, value: unknown): SQL {
  return value === null ? isNull(column) : eq(column, value);
}

/**
 * The competing holds for an event: other `on_hold` events sharing the exact
 * `(event_date, venue_profile_id, stage_id)`. `includeTarget` keeps the event
 * itself in the pool (the rank math needs the full picture); confirm/decline
 * exclude it (they act on the siblings around a fixed target).
 *
 * TWO NULLS THAT ARE NOT SHARED QUEUES. `matchNullable` turns a null column into
 * `IS NULL`, and on two of these columns that quietly pooled strangers together.
 * The shared queue is justified by ONE PHYSICAL ROOM that only one show can
 * occupy (decisions #20); where there is no room and no night, there is nothing
 * to share, and the null match was the bug rather than the rule.
 *
 * - **No date** → no pool at all. A hold is a claim on a date; without one it
 *   claims nothing. `event_date IS NULL` had matched every dateless hold in the
 *   database against every other.
 * - **No venue profile** → this host's own holds only. The create-event wizard
 *   captures a free-text venue NAME, so its holds carry neither `venue_profile_id`
 *   nor `stage_id`, and `IS NULL` put every unpinned hold on a date into one
 *   platform-wide queue: taking "1st hold" from the wizard silently demoted a
 *   stranger's pencil in another city. An operator still cannot run two shows on
 *   one night, so their OWN unpinned holds keep queueing together.
 *
 * `stage_id IS NULL` under a real venue profile stays a shared pool, and should:
 * that is one venue's unassigned room, and two operators pencilling it are
 * competing for the same building on the same night.
 */
export async function holdSiblingsOf(
  database: Database | Transaction,
  event: EventRow,
  includeTarget: boolean,
): Promise<EventRow[]> {
  if (event.eventDate === null) return includeTarget ? [event] : [];
  return database
    .select()
    .from(schema.events)
    .where(
      and(
        eq(schema.events.status, "on_hold"),
        matchNullable(schema.events.eventDate, event.eventDate),
        matchNullable(schema.events.venueProfileId, event.venueProfileId),
        matchNullable(schema.events.stageId, event.stageId),
        // No room, no shared queue — see the second bullet above.
        event.venueProfileId === null
          ? eq(schema.events.hostProfileId, event.hostProfileId)
          : undefined,
        includeTarget ? undefined : ne(schema.events.id, event.id),
      ),
    );
}

/** Shape event rows into the pure-logic `HoldSibling[]` (rank defaults to 1). */
export function toHoldSiblings(rows: EventRow[]): HoldSibling[] {
  return rows.map((row) => ({
    id: row.id,
    holdRank: row.holdRank ?? 1,
    holdAutoPromote: row.holdAutoPromote,
  }));
}

/**
 * Of these holds, the ones the caller may WRITE — resolved through the one
 * authorization module, per hold, exactly as the pool read resolves each title.
 *
 * THE POOL IS SHARED; THE ROWS ARE NOT. A pool is keyed on (date, venue, stage)
 * and deliberately not scoped to one host, because one physical room on one night
 * is one queue and two operators courting that night genuinely are in it together
 * — separate queues would tell both of them they are first in line. But every
 * pencil in it is a separate EVENT belonging to a separate operator, and an
 * operator's authority stops at their own row. So every cascade in this file asks
 * this first: it decides which rank moves a caller is allowed to make at all, and
 * whose name may go on the ones the cascade makes anyway.
 *
 * Reads are untouched by any of it — a rival's title is withheld and stays
 * withheld (`GET /events/:id/hold`); this is about the WRITES.
 */
export async function writableHoldIds(
  request: FastifyRequest,
  rows: EventRow[],
): Promise<Set<string>> {
  const writable = new Set<string>();
  for (const row of rows) {
    const capabilities = await eventCapabilities(request, row.id);
    if (capabilities.has("event.edit")) writable.add(row.id);
  }
  return writable;
}

/**
 * ONE RULE FOR A QUEUE CLOSING BEHIND A HOLD THAT LEAVES — planned here, applied below.
 *
 * `computeDeclinePromotion` had exactly one caller: `dropHoldAndRepack` in `routes/holds.ts`,
 * serving `/hold/decline` and `/hold/release`. The Events row menu's **Cancel show…** is a plain
 * `PATCH { status: "cancelled" }` and did not call it — so which control the operator reached for
 * decided whether the queue advanced, and the one that PROMISES promotion in its own dialog
 * ("Every hold below it moves up one, unless it is frozen") is the one the Events list does not
 * offer (QA sweep run 14).
 *
 * SPLIT IN TWO BECAUSE OF WHERE THE READS MAY HAPPEN. `writableHoldIds` resolves capabilities per
 * hold, and the test pool is `max: 1`, so a query nested inside `database.transaction` deadlocks
 * rather than failing — the reason `dropHoldAndRepack` already resolved it before opening its
 * transaction. The events PATCH is inside one by the time it knows the status moved, so the plan is
 * taken first and applied after. It also keeps "a promotion on somebody else's hold gets an
 * actor-less audit row" in one place instead of copied into a second route.
 */
export interface HoldQueueClosePlan {
  promotions: HoldRankUpdate[];
  /** The rank each promoted hold held before — the `before` of its audit row. */
  previousRanks: Map<string, number | null>;
  /** Of the promoted holds, the ones this caller may write. */
  writableIds: Set<string>;
}

/** Read the queue as it will be once `event` leaves it. No writes; safe outside a transaction. */
export async function planHoldQueueClose(
  request: FastifyRequest,
  event: EventRow,
): Promise<HoldQueueClosePlan> {
  /*
   * An event that is not a pencil is in no queue, so nothing closes behind it. THE RULE LIVES HERE
   * rather than at either call site: `routes/events.ts` states the same thing as a short-circuit to
   * save the query below, and two guards that protect each other both survive mutation while the
   * behaviour is pinned by neither. This is the one a future caller inherits.
   */
  if (event.status !== "on_hold") {
    return { promotions: [], previousRanks: new Map(), writableIds: new Set() };
  }
  const remaining = await holdSiblingsOf(request.server.database, event, false);
  const promotions = computeDeclinePromotion({
    siblings: toHoldSiblings(remaining),
    removedRank: event.holdRank ?? 1,
  });
  return {
    promotions,
    previousRanks: new Map(remaining.map((row) => [row.id, row.holdRank])),
    writableIds: await writableHoldIds(request, remaining),
  };
}

/**
 * Write the promotions the plan found, with the audit and activity rows each one needs.
 *
 * Whose move it was depends on whose hold it is. An operator withdrawing one of their own pencils
 * and watching the next step up is doing their own housekeeping, and their name belongs on it. A
 * pencil belonging to somebody else moves up because the queue closed, not because this caller
 * touched it — and on the decline path the caller is the ACT, who holds no authority over any hold
 * in the pool, so every promotion there is a consequence. That row gets its own actor-less audit
 * entry too: it is the only trace of the write that lands on an event its own operator can read.
 */
export async function applyHoldQueueClose(
  tx: Transaction,
  request: FastifyRequest,
  plan: HoldQueueClosePlan,
): Promise<void> {
  for (const promotion of plan.promotions) {
    await tx
      .update(schema.events)
      .set({
        holdRank: promotion.holdRank,
        version: sql`${schema.events.version} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(schema.events.id, promotion.id));
  }
  for (const promotion of plan.promotions) {
    const isOwn = plan.writableIds.has(promotion.id);
    if (!isOwn) {
      await writeAudit(tx, request, {
        actor: "system",
        capability: null,
        action: "hold.promoted_queue_closed",
        targetKind: "event",
        targetId: promotion.id,
        eventId: promotion.id,
        before: { holdRank: plan.previousRanks.get(promotion.id) ?? null },
        after: { holdRank: promotion.holdRank, reason: "queue_closed" },
      });
    }
    await writeActivity(tx, request, {
      actor: isOwn ? "caller" : "system",
      eventId: promotion.id,
      type: "hold.promoted",
      targetKind: "hold",
      targetId: promotion.id,
      summary: { to: promotion.holdRank, reason: "queue_closed" },
    });
  }
}
