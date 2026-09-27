/**
 * Hold-rank arithmetic — pure functions over plain hold objects (no DB, no
 * framework). Ported from the reference app's `holdRankLogic.ts`. In the rebuild
 * a hold is an event with `status='on_hold'` + `hold_rank` + `hold_auto_promote`;
 * "siblings" are the competing holds for the same `(event_date, venue, stage)`.
 *
 * VISIBILITY IS NOT ENFORCED HERE. `hold_rank` is operator-only — the serializer
 * redacts it from performers (a performer sees `on_hold` + can confirm/decline,
 * never the number). This module is just the math the operator's routes call.
 */

/** A competing hold. `holdAutoPromote` defaults to `true` when undefined. */
export interface HoldSibling {
  id: string;
  holdRank: number;
  holdAutoPromote?: boolean;
}

/** A minimal rank change — callers write only these (diff, not full state). */
export interface HoldRankUpdate {
  id: string;
  holdRank: number;
}

/**
 * Compute new ranks when the target hold moves to `newRank`. Returns only the
 * entries whose rank actually changes, so writes are minimal and the operation
 * is idempotent (feeding the output back in is a no-op).
 *
 * - demote (`oldRank < newRank`): siblings in `(oldRank, newRank]` move down one.
 * - promote (`oldRank > newRank`): siblings in `[newRank, oldRank)` move up one.
 * - same rank: only colliders are bumped (the target wins), cascading up.
 * A final uniqueness pass guarantees a contiguous, collision-free ordering even
 * if the input already contained duplicates.
 */
export function computeRankShift(args: {
  siblings: HoldSibling[];
  targetId: string;
  oldRank: number;
  newRank: number;
}): HoldRankUpdate[] {
  const { siblings, targetId, oldRank, newRank } = args;

  // Working map of id → rank, falling back to 1 for missing/invalid ranks.
  const ranks = new Map<string, number>();
  for (const sibling of siblings) {
    ranks.set(sibling.id, sibling.holdRank || 1);
  }
  if (!ranks.has(targetId)) {
    ranks.set(targetId, oldRank);
  }

  const originalRanks = new Map(ranks);
  ranks.set(targetId, newRank);

  const otherIds = [...ranks.keys()].filter((id) => id !== targetId);

  if (oldRank !== newRank) {
    if (oldRank < newRank) {
      for (const id of otherIds) {
        const rank = ranks.get(id) ?? 1;
        if (rank > oldRank && rank <= newRank) {
          ranks.set(id, rank - 1);
        }
      }
    } else {
      for (const id of otherIds) {
        const rank = ranks.get(id) ?? 1;
        if (rank >= newRank && rank < oldRank) {
          ranks.set(id, rank + 1);
        }
      }
    }
  } else {
    // Same rank requested — bump any collider, cascading upward.
    otherIds.sort((left, right) => (ranks.get(left) ?? 1) - (ranks.get(right) ?? 1));
    let bump = newRank;
    for (const id of otherIds) {
      if ((ranks.get(id) ?? 1) === bump) {
        const bumped = (ranks.get(id) ?? 1) + 1;
        ranks.set(id, bumped);
        bump = bumped;
      }
    }
  }

  // Uniqueness safety pass: the target keeps its rank, colliders bump up.
  let changed = true;
  let iterations = 0;
  while (changed && iterations < 50) {
    changed = false;
    iterations++;
    const ids = [...ranks.keys()];
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const idI = ids[i];
        const idJ = ids[j];
        if (idI === undefined || idJ === undefined) {
          continue;
        }
        if (ranks.get(idI) === ranks.get(idJ)) {
          const bumpId = idJ === targetId ? idI : idJ;
          ranks.set(bumpId, (ranks.get(bumpId) ?? 1) + 1);
          changed = true;
        }
      }
    }
  }

  const updates: HoldRankUpdate[] = [];
  for (const [id, rank] of ranks) {
    if (rank !== originalRanks.get(id)) {
      updates.push({ id, holdRank: rank });
    }
  }
  return updates;
}

/**
 * Compute auto-promotions when the hold at `removedRank` leaves the pool
 * (declined/removed). Holds with `holdAutoPromote === false` are FROZEN — they
 * keep their number. The remaining auto-on holds compact downward from rank 1,
 * jumping over frozen ranks. Returns only entries whose rank changes.
 *
 * `siblings` MUST exclude the removed hold. `removedRank` is kept for call-site
 * symmetry; the repack is derived purely from the surviving siblings.
 */
export function computeDeclinePromotion(args: {
  siblings: HoldSibling[];
  removedRank: number;
}): HoldRankUpdate[] {
  const { siblings } = args;

  const frozenRanks = new Set<number>();
  const movable: HoldSibling[] = [];
  for (const sibling of siblings) {
    const autoPromote = sibling.holdAutoPromote !== false; // undefined → true
    if (autoPromote) {
      movable.push(sibling);
    } else {
      frozenRanks.add(sibling.holdRank || 1);
    }
  }

  // Preserve relative order among the movable holds.
  movable.sort((left, right) => (left.holdRank || 1) - (right.holdRank || 1));

  const updates: HoldRankUpdate[] = [];
  let nextRank = 1;
  for (const hold of movable) {
    while (frozenRanks.has(nextRank)) {
      nextRank++;
    }
    const currentRank = hold.holdRank || 1;
    if (nextRank !== currentRank) {
      updates.push({ id: hold.id, holdRank: nextRank });
    }
    nextRank++;
  }
  return updates;
}

/**
 * THE RANK A HOLD NEEDS WHEN IT JOINS A QUEUE THAT ALREADY HAS SOMEBODY IN IT —
 * or `null` when nothing should be written (QA sweep run 5, QA5-4).
 *
 * `hold_rank` is nullable and every reader treats NULL as rank 1, which is right
 * for a LONE hold — the only pencil on a night is the first one, and writing a 1
 * would file a "hold.ranked" line for a move nobody made. It stops being right the
 * moment a second hold shares the queue: two NULLs, or a NULL beside a real 1, and
 * the pool shows a tie for first that no screen can break, because "Promote to 1st"
 * is disabled on anything already reading 1st.
 *
 * Measured: a hold placed with a typed venue NAME (no profile) is invisible to the
 * pool, so its own placement sees no competitors and writes no rank; attaching the
 * venue afterwards puts it in a queue that already had a 1st, and the pool came back
 * `[1, 1, 2]`.
 *
 * AT THE BACK, and only this hold's own row is written. The back is where the
 * placement wizard already puts a new hold (its rank select defaults to the last
 * option), and it is the honest answer for a pencil that has been in no queue until
 * now: it never held a position, it was being *displayed* as first by a fallback.
 * Touching nobody else also keeps this out of the authorization question the rank
 * cascade has to answer — a queue spans operators, and one operator's authority
 * stops at their own row.
 */
export function rankForHoldJoiningQueue(args: {
  /** The joining hold's stored rank — NULL is "never ranked". */
  holdRank: number | null;
  /** The OTHER holds already in the queue. Empty means there is no queue to join. */
  siblings: HoldSibling[];
}): number | null {
  const { holdRank, siblings } = args;
  // Already ranked: its position is somebody's decision, and this is not the
  // function that changes decisions.
  if (holdRank !== null) return null;
  if (siblings.length === 0) return null;
  const lastRank = siblings.reduce(
    (deepest, sibling) => Math.max(deepest, sibling.holdRank || 1),
    0,
  );
  return lastRank + 1;
}

/**
 * The holds that should be cancelled when one hold is confirmed — currently
 * every sibling but the target (the caller pre-filters the target out). Kept a
 * named function so policy changes (e.g. keep auto-off holds as standby) live in
 * one place.
 */
export function competingHoldIds(args: { siblings: HoldSibling[] }): string[] {
  return args.siblings.map((sibling) => sibling.id);
}
