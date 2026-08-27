import {
  getGetApiV1ProfilesIdUnavailabilityQueryKey,
  useGetApiV1Profiles,
  useGetApiV1ProfilesIdUnavailability,
  usePutApiV1ProfilesIdUnavailability,
} from "@showme/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { getActiveProfileId } from "../lib/activeProfile";
import { errorMessage } from "../lib/errors";
import { dayKey } from "./calendarGrid";

/**
 * "Mark unavailable" — the state behind the Calendar's MARKING MODE.
 *
 * The interaction, and why it is this one: you turn marking on, the grid takes
 * an X cursor, and you pick nights ON THE GRID — click one, drag across a
 * stretch, shift-click to extend — then press "Done marking". Nothing is written
 * until then, and the reason is asked for ONCE, at the end, for the whole
 * selection. Typing two dates into a form to block a weekend is the thing this
 * replaces: the dates are already on screen, so the calendar is the input.
 *
 * A click TOGGLES, which is what makes unmarking work without a second control —
 * picking a night that is already blocked frees it, and one "Done marking" can
 * both block and free in the same write.
 *
 * WHOSE unavailability this records: **the acting profile's**, and nothing
 * else's. `profile_unavailability` is keyed by `profile_id` alone — there is no
 * user column, no stage/room column and no event column — and the public page
 * reads it per profile slug. So the statement a row makes is *"this profile is
 * not bookable on these dates"*, which resolves differently per account kind
 * exactly as story.md draws the boundaries:
 *
 * - A **performer** profile blocking a date says "the act cannot play" — their
 *   own world is "my bookings, my availability", and this is that.
 * - An **operator** profile blocking a date says "this venue/promoter cannot
 *   take a booking" — a blackout, a private hire, a dark night. It is NOT a
 *   statement about anybody else's calendar: an operator has no standing to
 *   mark a performer unavailable, and this route gives them none (it authorises
 *   on membership of the profile being written, not on any event relationship).
 *
 * The room-level caveat is worth knowing: the table has no `stage_id`, so a
 * multi-room venue can only block the whole profile, never one room.
 *
 * WHY the whole set is submitted at once: the only write the API exposes is
 * `PUT /profiles/:id/unavailability`, which REPLACES every row for the profile.
 * That means the commit must hold the complete current list and send it back
 * with the selection folded in — which is also why entering marking mode
 * refetches rather than trusting whatever was cached, since a stale list would
 * silently delete a block somebody else added.
 */

/** A block as this module holds it. `id` is absent for one not yet saved. */
export interface UnavailabilityBlock {
  id?: string;
  startDate: string;
  endDate: string;
  reason: string | null;
}

/** Roles `PUT /profiles/:id/unavailability` accepts (profiles.ts `WRITE_ROLES`). */
const WRITE_ROLES = new Set(["owner", "admin", "editor"]);

function sortBlocks(blocks: UnavailabilityBlock[]): UnavailabilityBlock[] {
  return [...blocks].sort((left, right) => left.startDate.localeCompare(right.startDate));
}

/** `yyyy-mm-dd` `offset` days away from `key`, via a local-midnight Date so the
 * month and year roll over correctly (and no timezone shifts the day west). */
function shiftDay(key: string, offset: number): string {
  const date = new Date(`${key}T00:00:00`);
  date.setDate(date.getDate() + offset);
  return dayKey(date);
}

/** Every day a block covers → the reason recorded for it. The storage is RANGES
 * and both the grid and the selection think in DAYS, so this is the one
 * conversion everything else is built on. First block wins a shared day, which
 * is the earlier-starting one once sorted. */
function expandBlocks(blocks: UnavailabilityBlock[]): Map<string, string | null> {
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

export interface MarkUnavailableView {
  profileId: string | null;
  profileName: string;
  /** True when this profile has a public page, which is what makes a block visible
   * to the outside world (the availability page strikes those dates out). */
  isProfilePublic: boolean;
  /** False for viewer/crew members — the API refuses their write, so the screen
   * does not offer marking at all. */
  canEdit: boolean;
  isLoading: boolean;
  /** What is actually stored, for read-only surfaces like the calendar rail. */
  savedBlocks: UnavailabilityBlock[];

  /** Marking mode: the grid takes an X cursor and its day cells become pickable. */
  isMarking: boolean;
  startMarking: () => void;
  /** Escape, or "Cancel" — drops the selection and writes nothing. */
  cancelMarking: () => void;
  /** The nights picked so far, keyed `yyyy-mm-dd`. Nothing is written until
   * "Done marking" is confirmed. */
  selectedDays: ReadonlySet<string>;
  /**
   * One gesture from the grid: a click (one day, toggled), a shift-click (one
   * day, extending the range from the last one touched), or a drag's worth of
   * cells (all added).
   */
  markDays: (days: string[], modifiers?: { shiftKey?: boolean }) => void;
  /** "Done marking": opens the confirm step, or just leaves marking mode when
   * nothing was picked. */
  finishMarking: () => void;

  /** The confirm step — where the reason is asked for, once, for the lot. */
  isConfirmOpen: boolean;
  /** Back to marking with the selection intact. */
  closeConfirm: () => void;
  /** What the commit will block, and what it will free, as inclusive ranges so
   * the dialog can name them the way the calendar does. */
  blockRanges: UnavailabilityBlock[];
  freeRanges: UnavailabilityBlock[];
  daysToBlockCount: number;
  daysToFreeCount: number;
  reason: string;
  setReason: (value: string) => void;
  commit: () => void;
  isSaving: boolean;
  /** A refusal from the API (403, validation), verbatim. */
  saveError: string | null;
}

export interface MarkUnavailableHandlers {
  /** The commit landed: how many nights it blocked, and how many it freed. */
  onSaved: (blocked: number, freed: number) => void;
}

export function useMarkUnavailable(handlers: MarkUnavailableHandlers): MarkUnavailableView {
  const { session } = useAuth();
  const queryClient = useQueryClient();

  const activeProfileId = getActiveProfileId();
  const profiles = useGetApiV1Profiles();
  const profile = useMemo(
    () => (profiles.data ?? []).find((entry) => entry.id === activeProfileId),
    [profiles.data, activeProfileId],
  );
  const membership = session?.memberships.find((entry) => entry.profileId === activeProfileId);
  const canEdit = Boolean(membership && WRITE_ROLES.has(membership.role));

  // Fetched whether or not anyone is marking: the Calendar's right rail shows the
  // blocks that fall inside the period on screen, so the answer has to be there
  // before marking mode is ever entered.
  const unavailability = useGetApiV1ProfilesIdUnavailability(activeProfileId ?? "", {
    query: { enabled: Boolean(activeProfileId) },
  });
  const replaceUnavailability = usePutApiV1ProfilesIdUnavailability();

  const [isMarking, setIsMarking] = useState(false);
  const [selectedDays, setSelectedDays] = useState<ReadonlySet<string>>(() => new Set());
  /** The day a shift-click extends FROM: the last one a plain gesture touched. */
  const [anchorDay, setAnchorDay] = useState<string | null>(null);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);

  const serverBlocks = useMemo<UnavailabilityBlock[]>(
    () =>
      sortBlocks(
        (unavailability.data ?? []).map((row) => ({
          id: row.id,
          startDate: row.startDate,
          endDate: row.endDate,
          reason: row.reason,
        })),
      ),
    [unavailability.data],
  );
  const blockedDays = useMemo(() => expandBlocks(serverBlocks), [serverBlocks]);

  const refetch = unavailability.refetch;
  const startMarking = useCallback(() => {
    setSelectedDays(new Set());
    setAnchorDay(null);
    setReason("");
    setSaveError(null);
    setIsMarking(true);
    // The PUT replaces the whole set, so it has to be built on what is stored
    // right now — not on a list cached before somebody else edited it.
    void refetch();
  }, [refetch]);

  const cancelMarking = useCallback(() => {
    setIsMarking(false);
    setIsConfirmOpen(false);
    setSelectedDays(new Set());
    setAnchorDay(null);
    setReason("");
    setSaveError(null);
  }, []);

  const markDays = (days: string[], modifiers?: { shiftKey?: boolean }) => {
    if (!isMarking || days.length === 0) return;
    const single = days.length === 1 ? days[0] : undefined;

    if (single && modifiers?.shiftKey && anchorDay) {
      const [first, last] = single < anchorDay ? [single, anchorDay] : [anchorDay, single];
      setSelectedDays((current) => {
        const next = new Set(current);
        for (let cursor = first; cursor <= last; cursor = shiftDay(cursor, 1)) next.add(cursor);
        return next;
      });
      setAnchorDay(single);
      return;
    }

    setSelectedDays((current) => {
      const next = new Set(current);
      // A click toggles, so a mis-picked night is taken back the same way it was
      // picked. A drag only ADDS, so sweeping back across the cells you just
      // swept cannot silently undo half of them.
      if (single) {
        if (next.has(single)) next.delete(single);
        else next.add(single);
      } else {
        for (const day of days) next.add(day);
      }
      return next;
    });
    setAnchorDay(days[days.length - 1] ?? null);
  };

  const finishMarking = () => {
    if (selectedDays.size === 0) {
      cancelMarking();
      return;
    }
    setSaveError(null);
    setIsConfirmOpen(true);
  };

  // Escape abandons marking without writing. Not while the confirm dialog is up —
  // the Modal's own Escape closes that first, which puts the reader back on the
  // grid with the selection still in hand rather than throwing it away.
  useEffect(() => {
    if (!isMarking || isConfirmOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancelMarking();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isMarking, isConfirmOpen, cancelMarking]);

  const sortedSelection = useMemo(() => [...selectedDays].sort(), [selectedDays]);
  const daysToBlock = sortedSelection.filter((day) => !blockedDays.has(day));
  const daysToFree = sortedSelection.filter((day) => blockedDays.has(day));
  const noReason = () => null;

  const commit = () => {
    if (!activeProfileId) return;
    setSaveError(null);
    const next = applyDaySelection(serverBlocks, sortedSelection, reason.trim() || null);
    replaceUnavailability.mutate(
      {
        id: activeProfileId,
        data: {
          entries: next.map((block) => ({
            startDate: block.startDate,
            endDate: block.endDate,
            reason: block.reason,
          })),
        },
      },
      {
        onSuccess: () => {
          void queryClient.invalidateQueries({
            queryKey: getGetApiV1ProfilesIdUnavailabilityQueryKey(activeProfileId),
          });
          const blocked = daysToBlock.length;
          const freed = daysToFree.length;
          cancelMarking();
          handlers.onSaved(blocked, freed);
        },
        onError: (error) => setSaveError(errorMessage(error)),
      },
    );
  };

  return {
    profileId: activeProfileId,
    profileName: profile?.name ?? "This profile",
    isProfilePublic: Boolean(profile?.isPublic),
    canEdit,
    isLoading: unavailability.isPending && Boolean(activeProfileId),
    savedBlocks: serverBlocks,

    isMarking,
    startMarking,
    cancelMarking,
    selectedDays,
    markDays,
    finishMarking,

    isConfirmOpen,
    closeConfirm: () => setIsConfirmOpen(false),
    blockRanges: collapseDays(daysToBlock, noReason),
    freeRanges: collapseDays(daysToFree, noReason),
    daysToBlockCount: daysToBlock.length,
    daysToFreeCount: daysToFree.length,
    reason,
    setReason,
    commit,
    isSaving: replaceUnavailability.isPending,
    saveError,
  };
}

/**
 * The saved blocks that touch `from`..`to`, so the calendar can name what is
 * blocked in the period on screen.
 */
export function blocksOverlappingRange(
  blocks: UnavailabilityBlock[],
  from: string,
  to: string,
): UnavailabilityBlock[] {
  // Two inclusive ranges overlap iff each starts on or before the other ends.
  return blocks.filter((block) => block.startDate <= to && block.endDate >= from);
}

/** Blocked days keyed by `yyyy-mm-dd`, valued by the reason recorded for the
 * block covering them (`null` when none was given). */
export type UnavailableDays = ReadonlyMap<string, string | null>;

/**
 * The blocks flattened to one entry per day, clipped to `from`..`to`.
 *
 * The table stores RANGES and a calendar draws DAYS, so something has to expand
 * one into the other before a cell can know whether it is blocked. Clipping to
 * the visible window keeps that expansion bounded — a year-long block is 366
 * rows of nothing if the reader is looking at one week.
 *
 * When two blocks overlap the same day, the FIRST one's reason wins (blocks are
 * sorted by start date, so that is the earlier-starting block). The day is
 * blocked either way; only the label shown differs.
 */
export function unavailableDaysInRange(
  blocks: UnavailabilityBlock[],
  from: string,
  to: string,
): UnavailableDays {
  const days = new Map<string, string | null>();
  for (const block of blocksOverlappingRange(blocks, from, to)) {
    let cursor = block.startDate < from ? from : block.startDate;
    const last = block.endDate > to ? to : block.endDate;
    // Bounded by construction: `cursor` starts inside the window and the loop
    // stops at its far edge.
    while (cursor <= last) {
      if (!days.has(cursor)) days.set(cursor, block.reason);
      cursor = shiftDay(cursor, 1);
    }
  }
  return days;
}
