/**
 * Pure-logic helpers for hold-rank arithmetic. NO Firebase imports — these
 * functions accept plain Hold objects and return the minimal set of changes,
 * so the same code path can be unit-tested and reused server-side.
 *
 * Mirrors the client-side `resolveHoldRankConflicts` / `promoteHoldsOnDate`
 * shift semantics in `src/lib/queries/useEventMutations.ts` (≈1460–1635). If
 * you change one, change the other.
 */

export interface HoldSibling {
  id: string;
  holdRank: number;
  holdAutoPromote?: boolean; // default `true` when undefined
}

/**
 * Compute new ranks when a target hold is moved to `newRank`. Returns only
 * entries whose rank actually changes (so callers write minimal updates and
 * idempotency holds — feeding the output back through the function is a
 * no-op).
 *
 * Algorithm (matches useEventMutations.ts:1567-1607):
 *   - oldRank < newRank (demote): siblings whose current rank ∈ (oldRank,
 *     newRank] move down by one.
 *   - oldRank > newRank (promote): siblings whose current rank ∈ [newRank,
 *     oldRank) move up by one.
 *   - oldRank === newRank: no shift; only collisions are bumped (target
 *     wins, others get +1 cascading).
 *   - Final uniqueness pass guarantees a contiguous, collision-free
 *     ordering even if the input had pre-existing duplicates.
 */
export function computeRankShift(args: {
  siblings: HoldSibling[];
  targetId: string;
  oldRank: number;
  newRank: number;
}): Array<{ id: string; holdRank: number }> {
  const { siblings, targetId, oldRank, newRank } = args;

  // Build a working map of id → rank, falling back to 1 for missing/invalid.
  const localRanks: Record<string, number> = {};
  for (const s of siblings) {
    localRanks[s.id] = s.holdRank || 1;
  }
  // Ensure the target is represented even if not in the sibling list.
  if (!(targetId in localRanks)) {
    localRanks[targetId] = oldRank;
  }

  // Snapshot original ranks for the diff at the end.
  const originalRanks: Record<string, number> = { ...localRanks };

  localRanks[targetId] = newRank;

  const otherIds = Object.keys(localRanks).filter((id) => id !== targetId);

  if (oldRank !== newRank) {
    if (oldRank < newRank) {
      for (const id of otherIds) {
        const r = localRanks[id];
        if (r > oldRank && r <= newRank) localRanks[id] = r - 1;
      }
    } else {
      for (const id of otherIds) {
        const r = localRanks[id];
        if (r >= newRank && r < oldRank) localRanks[id] = r + 1;
      }
    }
  } else {
    // Same rank requested — bump any collider.
    otherIds.sort((a, b) => localRanks[a] - localRanks[b]);
    let bump = newRank;
    for (const id of otherIds) {
      if (localRanks[id] === bump) {
        localRanks[id] = localRanks[id] + 1;
        bump = localRanks[id];
      }
    }
  }

  // Uniqueness safety pass: target keeps its rank, colliders bump up.
  let changed = true;
  let iterations = 0;
  while (changed && iterations < 50) {
    changed = false;
    iterations++;
    const ids = Object.keys(localRanks);
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        if (localRanks[ids[i]] === localRanks[ids[j]]) {
          const bumpId = ids[j] === targetId ? ids[i] : ids[j];
          localRanks[bumpId] += 1;
          changed = true;
        }
      }
    }
  }

  // Diff: only return entries whose rank actually changed.
  const updates: Array<{ id: string; holdRank: number }> = [];
  for (const id of Object.keys(localRanks)) {
    if (localRanks[id] !== originalRanks[id]) {
      updates.push({ id, holdRank: localRanks[id] });
    }
  }
  return updates;
}

/**
 * Compute auto-promotions when the hold at `removedRank` leaves the pool
 * (declined or otherwise removed). Holds with `holdAutoPromote === false`
 * stay at their current rank — they keep their "slot." The remaining
 * auto-on holds compact downward, **jumping over** the frozen ranks, so the
 * final ordering has the lowest possible auto-on ranks while preserving
 * each auto-off hold's number.
 *
 * Example (user-specified):
 *   Before: rank 1 (auto-on), rank 2 (about to be removed), rank 3 (auto-off),
 *           rank 4 (auto-on), rank 5 (auto-on)
 *   After removing rank 2:
 *           rank 1 stays, rank 3 stays (auto-off), rank 4 → rank 2,
 *           rank 5 → rank 4.
 *   I.e. the auto-on holds skip rank 3 (which is frozen) and fill 1, 2, 4.
 *
 * A simple "shift every auto-on rank by 1" rule is wrong here because it
 * collides with frozen auto-off ranks (e.g. shifting rank-4-auto-on down by
 * one when rank 3 is frozen produces two holds at rank 3).
 *
 * Returns only entries whose rank changes. The `siblings` list MUST exclude
 * the removed hold. `removedRank` is the rank of the hold that just left;
 * it's used implicitly via the compact-from-1 algorithm but isn't required
 * by the math — surviving siblings are simply repacked.
 */
export function computeDeclinePromotion(args: {
  siblings: HoldSibling[];
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  removedRank: number;
}): Array<{ id: string; holdRank: number }> {
  const { siblings } = args;

  // Frozen ranks: auto-off holds keep their current numeric rank.
  const frozenRanks = new Set<number>();
  const movable: HoldSibling[] = [];
  for (const s of siblings) {
    const autoPromote = s.holdAutoPromote !== false; // undefined → true
    if (autoPromote) {
      movable.push(s);
    } else {
      frozenRanks.add(s.holdRank || 1);
    }
  }

  // Sort movable holds by current rank ASC — preserves relative order.
  movable.sort((a, b) => (a.holdRank || 1) - (b.holdRank || 1));

  // Assign each movable hold to the lowest rank not already claimed by a
  // frozen hold, skipping frozen ranks.
  const updates: Array<{ id: string; holdRank: number }> = [];
  let nextRank = 1;
  for (const hold of movable) {
    while (frozenRanks.has(nextRank)) nextRank++;
    const oldRank = hold.holdRank || 1;
    if (nextRank !== oldRank) {
      updates.push({ id: hold.id, holdRank: nextRank });
    }
    nextRank++;
  }
  return updates;
}

/**
 * Pure helper: given the surviving siblings (already filtered by date /
 * venue / roomStage / on_hold), return the IDs that should be cancelled
 * when a hold is confirmed. Currently equivalent to "every sibling that
 * isn't the target", but kept as a named function so policy changes (e.g.
 * keep auto-promote-OFF holds open as standby) live in one place.
 *
 * The caller is responsible for excluding the target hold from
 * `siblings`.
 */
export function competingHoldIds(args: {
  siblings: HoldSibling[];
}): string[] {
  return args.siblings.map((s) => s.id);
}
