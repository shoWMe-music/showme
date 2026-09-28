import { schema } from "@showme/db";
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
import { type HoldSibling, rankForHoldJoiningQueue } from "@showme/shared";
import { and, eq, isNull, ne } from "drizzle-orm";
import type { Transaction } from "./audit";

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
