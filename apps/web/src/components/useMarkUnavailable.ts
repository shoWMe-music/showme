import {
  getGetApiV1ProfilesIdUnavailabilityQueryKey,
  useGetApiV1Profiles,
  useGetApiV1ProfilesIdUnavailability,
  usePutApiV1ProfilesIdUnavailability,
} from "@showme/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { getActiveProfileId } from "../lib/activeProfile";
import { errorMessage } from "../lib/errors";
import { dayKey } from "./calendarGrid";

/**
 * "Mark Unavailable" — the state behind the Calendar toolbar's blocked-dates
 * modal.
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
 * That means the editor must hold the complete current list and send it back
 * intact — which is also why it refetches on open rather than trusting whatever
 * was cached, since a stale list would silently delete a block somebody else
 * added.
 */

/** A block as the editor holds it. `id` is absent for one not yet saved. */
export interface UnavailabilityBlock {
  id?: string;
  startDate: string;
  endDate: string;
  reason: string | null;
}

/** Roles `PUT /profiles/:id/unavailability` accepts (profiles.ts `WRITE_ROLES`). */
const WRITE_ROLES = new Set(["owner", "admin", "editor"]);

/** Guards a hand-typed year from turning one row into a decade-long block. */
const MAX_BLOCK_DAYS = 366;

function daysBetween(startDate: string, endDate: string): number {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return Number.NaN;
  return (end - start) / 86_400_000 + 1;
}

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

function sameBlocks(left: UnavailabilityBlock[], right: UnavailabilityBlock[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((block, index) => {
    const other = right[index];
    return (
      other !== undefined &&
      block.startDate === other.startDate &&
      block.endDate === other.endDate &&
      (block.reason ?? "") === (other.reason ?? "")
    );
  });
}

export interface MarkUnavailableView {
  profileId: string | null;
  profileName: string;
  /** True when this profile has a public page, which is what makes a block visible
   * to the outside world (the availability page strikes those dates out). */
  isProfilePublic: boolean;
  /** False for viewer/crew members — the API refuses their write, so the form says so. */
  canEdit: boolean;
  isLoading: boolean;
  /** The editor's working copy — may contain unsaved additions/removals. */
  blocks: UnavailabilityBlock[];
  /** What is actually stored, for read-only surfaces like the calendar rail. */
  savedBlocks: UnavailabilityBlock[];
  /** Unsaved changes are pending until Save; nothing is written per keystroke. */
  isDirty: boolean;
  isSaving: boolean;
  /** A refusal from the API (403, validation), verbatim. */
  saveError: string | null;
  /** A refusal from this form (inverted range, over the cap). */
  formError: string | null;
  startDate: string;
  setStartDate: (value: string) => void;
  endDate: string;
  setEndDate: (value: string) => void;
  reason: string;
  setReason: (value: string) => void;
  addBlock: () => void;
  removeBlock: (index: number) => void;
  save: () => void;
  /** Flip one day straight from its card in the grid, saved immediately — the
   * modal's staged add/remove/Save is for ranges, this is for "not that night".
   * A no-op for a role that may not write. */
  toggleDayUnavailable: (day: string) => void;
  /** The day a toggle is in flight for, so the screen can say so. */
  togglingDay: string | null;
}

/** What the screen is told after a day-card toggle. Passed in rather than read
 * back out as state, because the answer belongs in a toast on the Calendar and
 * not in a field only the modal renders. */
export interface MarkUnavailableHandlers {
  /** The modal's Save landed. */
  onSaved: () => void;
  /** One day was flipped from its card. */
  onDayToggled?: (day: string, isNowUnavailable: boolean) => void;
  /** The API refused a day-card toggle, verbatim. */
  onDayToggleFailed?: (message: string) => void;
}

export function useMarkUnavailable(
  open: boolean,
  handlers: MarkUnavailableHandlers,
): MarkUnavailableView {
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

  // Fetched whether or not the modal is open: the Calendar's right rail shows the
  // blocks that fall inside the period on screen, so the answer has to be there
  // before anybody opens the editor.
  const unavailability = useGetApiV1ProfilesIdUnavailability(activeProfileId ?? "", {
    query: { enabled: Boolean(activeProfileId) },
  });
  const replaceUnavailability = usePutApiV1ProfilesIdUnavailability();

  const [blocks, setBlocks] = useState<UnavailabilityBlock[]>([]);
  const [savedBlocks, setSavedBlocks] = useState<UnavailabilityBlock[]>([]);
  const [startDate, setStartDate] = useState(() => dayKey(new Date()));
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Every open starts from the server's current list, not from the last session's
  // edits — a PUT built on a stale list deletes rows nobody asked to delete.
  useEffect(() => {
    if (!open) return;
    setStartDate(dayKey(new Date()));
    setEndDate("");
    setReason("");
    setFormError(null);
    setSaveError(null);
    void unavailability.refetch();
    // `refetch` is stable per query instance; re-running on it would loop.
  }, [open, unavailability.refetch]);

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

  // Seed the editor whenever the server list changes underneath it, but only
  // while there is nothing unsaved to lose.
  useEffect(() => {
    if (!sameBlocks(savedBlocks, serverBlocks)) {
      setBlocks(serverBlocks);
      setSavedBlocks(serverBlocks);
    }
  }, [serverBlocks, savedBlocks]);

  const addBlock = () => {
    setSaveError(null);
    const start = startDate.trim();
    // One day is the common case, so an empty "to" means "just that day"
    // rather than an error — the table has no open-ended representation.
    const end = endDate.trim() || start;

    if (!start) {
      setFormError("Pick a start date.");
      return;
    }
    if (end < start) {
      setFormError("The end date is before the start date.");
      return;
    }
    const length = daysBetween(start, end);
    if (!Number.isFinite(length)) {
      setFormError("Those dates aren't valid.");
      return;
    }
    if (length > MAX_BLOCK_DAYS) {
      setFormError(`A single block can't span more than ${MAX_BLOCK_DAYS} days.`);
      return;
    }
    if (blocks.some((block) => block.startDate === start && block.endDate === end)) {
      setFormError("That range is already blocked.");
      return;
    }

    setFormError(null);
    setBlocks((current) =>
      sortBlocks([...current, { startDate: start, endDate: end, reason: reason.trim() || null }]),
    );
    setReason("");
  };

  const removeBlock = (index: number) => {
    setFormError(null);
    setSaveError(null);
    setBlocks((current) => current.filter((_, position) => position !== index));
  };

  const [togglingDay, setTogglingDay] = useState<string | null>(null);

  /**
   * WHY THIS WRITES FROM `serverBlocks` AND NOT FROM `blocks`. `blocks` is the
   * modal's working copy and may hold unsaved edits; the PUT replaces the whole
   * set, so flipping one day from the grid while a draft sat in the editor would
   * silently commit that draft. The card acts on what is actually stored.
   *
   * Ownership is not decided here: the rows belong to the ACTIVE profile, and
   * `PUT /profiles/:id/unavailability` re-checks the caller's role on that
   * profile server-side. `canEdit` only keeps the affordance off a screen whose
   * owner would be refused.
   */
  const toggleDayUnavailable = (day: string) => {
    if (!activeProfileId || !canEdit || togglingDay) return;
    const wasUnavailable = serverBlocks.some(
      (block) => block.startDate <= day && block.endDate >= day,
    );
    const next = toggleDayInBlocks(serverBlocks, day);
    setTogglingDay(day);
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
          handlers.onDayToggled?.(day, !wasUnavailable);
        },
        onError: (error) => handlers.onDayToggleFailed?.(errorMessage(error)),
        onSettled: () => setTogglingDay(null),
      },
    );
  };

  const save = () => {
    if (!activeProfileId) return;
    setSaveError(null);
    replaceUnavailability.mutate(
      {
        id: activeProfileId,
        data: {
          entries: blocks.map((block) => ({
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
          handlers.onSaved();
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
    blocks,
    savedBlocks: serverBlocks,
    isDirty: !sameBlocks(blocks, savedBlocks),
    isSaving: replaceUnavailability.isPending,
    saveError,
    formError,
    startDate,
    setStartDate,
    endDate,
    setEndDate,
    reason,
    setReason,
    addBlock,
    removeBlock,
    save,
    toggleDayUnavailable,
    togglingDay,
  };
}

/**
 * The saved blocks that touch `from`..`to`, so the calendar can name what is
 * blocked in the period on screen. A control whose result never appears on the
 * screen that hosts it reads as a dead button, and this is that result.
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

/**
 * `blocks` with `day` flipped: blocked if it was free, free if it was blocked.
 *
 * Flipping a day OFF is the interesting half, because the storage is ranges. A
 * day at either end of a range trims it; a day in the middle SPLITS the range in
 * two; a one-day range simply disappears. The halves are returned without an
 * `id` — they are new ranges, not edits of the old row, and `PUT
 * /profiles/:id/unavailability` replaces the whole set anyway.
 *
 * The reason travels with both halves: "touring" still describes the days either
 * side of the one night off.
 */
export function toggleDayInBlocks(
  blocks: UnavailabilityBlock[],
  day: string,
): UnavailabilityBlock[] {
  const covers = (block: UnavailabilityBlock) => block.startDate <= day && block.endDate >= day;
  if (!blocks.some(covers)) {
    return sortBlocks([...blocks, { startDate: day, endDate: day, reason: null }]);
  }

  const remaining: UnavailabilityBlock[] = [];
  for (const block of blocks) {
    if (!covers(block)) {
      remaining.push(block);
      continue;
    }
    if (block.startDate < day) {
      remaining.push({
        startDate: block.startDate,
        endDate: shiftDay(day, -1),
        reason: block.reason,
      });
    }
    if (block.endDate > day) {
      remaining.push({ startDate: shiftDay(day, 1), endDate: block.endDate, reason: block.reason });
    }
  }
  return sortBlocks(remaining);
}
