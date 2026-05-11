import type { Event } from "@/lib/models";

/**
 * Cap on selectable hold rank for a given (date, venue, roomStage) slot.
 *
 * - When EDITING an on-hold event already in the pool, the target counts
 *   toward the population, so `max = pool size`. Caller passes `excludeId
 *   = event.id`; if that id is found among siblings it's treated as
 *   "already in the pool" → max = N.
 * - When CREATING a new hold (or `excludeId` is absent / not yet present
 *   among siblings), the new event will join the pool, so `max = pool size
 *   + 1`. Reserves exactly one slot ahead.
 *
 * Always clamps to at least 1 so the dropdown has a usable first option.
 */
export function getMaxHoldRank(args: {
  events: readonly Event[];
  date: string;
  venue: string;
  roomStage: string;
  excludeId?: string;
}): number {
  const { events, date, venue, roomStage, excludeId } = args;
  if (!date || !venue) return 1;
  let count = 0;
  let includesTarget = false;
  for (const e of events) {
    if (e.archived) continue;
    if (e.eventStatus !== "on_hold") continue;
    if (e.date !== date) continue;
    if (e.venue !== venue) continue;
    if ((e.roomStage || "") !== (roomStage || "")) continue;
    count++;
    if (excludeId && e.id === excludeId) includesTarget = true;
  }
  return Math.max(1, includesTarget ? count : count + 1);
}

const SUFFIXES = ["st", "nd", "rd", "th", "th"] as const;

/** "1st" / "2nd" / "3rd" / "Nth" — used for the rank dropdown labels. */
export function rankLabel(n: number): string {
  return `${n}${SUFFIXES[n - 1] ?? "th"}`;
}
