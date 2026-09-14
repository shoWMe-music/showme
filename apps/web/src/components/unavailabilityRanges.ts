/**
 * THE UNAVAILABILITY RANGE ARITHMETIC — the pure half of `useMarkUnavailable`.
 *
 * Its own module so it can be TESTED WITHOUT BOOTING FIREBASE. The hook imports
 * `AuthProvider`, which imports `auth/firebase.ts`, which calls `initializeApp()`
 * at module scope — so importing the hook to reach two pure functions threw
 * `auth/invalid-api-key` wherever the web env vars are absent. That is every CI
 * run: `useMarkUnavailable.test.ts` has been red on `main` since at least
 * 2026-09-05 for this reason alone, while the arithmetic it covers was fine.
 *
 * Storage is RANGES, not days, which is where the difficulty lives: freeing one
 * night can trim a range, split it in two, or delete it outright, and the ranges
 * either side have to survive with their own reasons intact.
 */
import { dayKey } from "./calendarGrid";

/** A block as this module holds it. `id` is absent for one not yet saved. */
export interface UnavailabilityBlock {
  id?: string;
  startDate: string;
  endDate: string;
  reason: string | null;
}

/** Roles `PUT /profiles/:id/unavailability` accepts (profiles.ts `WRITE_ROLES`). */

export function sortBlocks(blocks: UnavailabilityBlock[]): UnavailabilityBlock[] {
  return [...blocks].sort((left, right) => left.startDate.localeCompare(right.startDate));
}

/** `yyyy-mm-dd` `offset` days away from `key`, via a local-midnight Date so the
 * month and year roll over correctly (and no timezone shifts the day west). */
export function shiftDay(key: string, offset: number): string {
  const date = new Date(`${key}T00:00:00`);
  date.setDate(date.getDate() + offset);
  return dayKey(date);
}

/** Every day a block covers → the reason recorded for it. The storage is RANGES
 * and both the grid and the selection think in DAYS, so this is the one
 * conversion everything else is built on. First block wins a shared day, which
 * is the earlier-starting one once sorted. */
export function expandBlocks(blocks: UnavailabilityBlock[]): Map<string, string | null> {
  const days = new Map<string, string | null>();
  for (const block of blocks) {
    let cursor = block.startDate;
    while (cursor <= block.endDate) {
      if (!days.has(cursor)) days.set(cursor, block.reason);
      cursor = shiftDay(cursor, 1);
    }
  }
  return days;
}

/**
 * Sorted day keys collapsed back into inclusive ranges — the shape the table
 * stores. Two days join one range only when they are consecutive AND carry the
 * same reason, so "touring" and "private hire" never merge into one row that
 * can only name one of them.
 */
export function collapseDays(
  days: string[],
  reasonOf: (day: string) => string | null,
): UnavailabilityBlock[] {
  const blocks: UnavailabilityBlock[] = [];
  for (const day of days) {
    const reason = reasonOf(day);
    const last = blocks[blocks.length - 1];
    if (last && last.reason === reason && shiftDay(last.endDate, 1) === day) {
      last.endDate = day;
      continue;
    }
    blocks.push({ startDate: day, endDate: day, reason });
  }
  return blocks;
}

/**
 * `blocks` with every day in `days` FLIPPED: blocked if it was free, free if it
 * was blocked — the whole "Done marking" write in one pure function.
 *
 * Freeing is the interesting half, because the storage is ranges: a day at
 * either end of a range trims it, a day in the middle splits it in two, and a
 * one-day range disappears. Expanding to days and collapsing back does all three
 * without a single special case. Ids are dropped on purpose — the PUT replaces
 * the whole set, so every row it writes is a new row.
 */
export function applyDaySelection(
  blocks: UnavailabilityBlock[],
  days: string[],
  reason: string | null,
): UnavailabilityBlock[] {
  const dayReasons = expandBlocks(blocks);
  for (const day of days) {
    if (dayReasons.has(day)) dayReasons.delete(day);
    else dayReasons.set(day, reason);
  }
  const sorted = [...dayReasons.keys()].sort();
  return collapseDays(sorted, (day) => dayReasons.get(day) ?? null);
}
