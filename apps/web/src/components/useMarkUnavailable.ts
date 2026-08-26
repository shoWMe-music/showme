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
}

export function useMarkUnavailable(open: boolean, onSaved: () => void): MarkUnavailableView {
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
          onSaved();
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
