import {
  getGetApiV1ProfilesIdStagesQueryKey,
  useDeleteApiV1ProfilesIdStagesSid,
  useGetApiV1ProfilesIdStages,
  usePatchApiV1ProfilesIdStagesSid,
  usePostApiV1ProfilesIdStages,
} from "@showme/api-client";
import { useToast } from "@showme/design-system";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { errorMessage } from "../lib/errors";
import type { RoomSetupDraft } from "./ProfileSetupsField";

/**
 * THE ROOMS OF A VENUE, and their capacities — the one place a capacity is
 * entered.
 *
 * Rooms are rows in `stages`, not a jsonb leaf on the profile, because an event
 * POINTS AT one (`events.stage_id`) — and a jsonb entry has nothing to point at.
 * That is also why this saves as you go instead of riding along with the profile
 * form's "Save changes": a room has an identity the moment it exists, and a form
 * that batched them would have to invent temporary ids and then reconcile them
 * against events that already reference the real ones.
 *
 * A room CARRIES its alternate setups ("Theater seating" 220 — the same walls
 * counted another way). They used to be a separate list on the profile beside a
 * separate flat capacity field, which asked one venue for its capacity three
 * times; the nesting is what makes the difference legible without a disclaimer.
 * `venue_details.capacity` still exists as the largest room's figure, but the
 * server derives it — nothing here writes it.
 */

export interface RoomRow {
  id: string;
  name: string;
  capacity: number | null;
  /** The same room counted another way. Empty for most rooms. */
  capacitySetups: RoomSetupDraft[];
  /** Shows currently placed in this room — what deleting it would unassign. */
  eventCount: number;
}

export interface ProfileRoomsView {
  rooms: RoomRow[];
  isPending: boolean;
  isError: boolean;
  error: unknown;
  /** The new-room form. */
  draftName: string;
  setDraftName: (value: string) => void;
  draftCapacity: string;
  setDraftCapacity: (value: string) => void;
  canAdd: boolean;
  add: () => void;
  isAdding: boolean;
  rename: (roomId: string, name: string) => void;
  changeCapacity: (roomId: string, capacity: string) => void;
  changeSetups: (roomId: string, setups: RoomSetupDraft[]) => void;
  /**
   * The capacity of a venue that has one room, or none yet — the flat case the
   * card shows without any hierarchy. Creating the room on first use is what
   * keeps it flat: the owner types a number, not a floor plan.
   */
  saveSoleRoomCapacity: (capacity: string) => void;
  remove: (roomId: string) => void;
  isSaving: boolean;
}

/** "" clears the capacity; anything unparseable is dropped rather than sent as NaN. */
function toOptionalInteger(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function useProfileRooms(profileId: string): ProfileRoomsView {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [draftName, setDraftName] = useState("");
  const [draftCapacity, setDraftCapacity] = useState("");

  const rooms = useGetApiV1ProfilesIdStages(profileId, {
    query: { enabled: Boolean(profileId) },
  });

  /**
   * Every mutation invalidates the same key. It is not only this card that reads
   * it — the Calendar's picker, the event room selector and the availability math
   * all draw from the same list, and a renamed room that stayed stale in the
   * dropdown would be a different room as far as the reader is concerned.
   */
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: getGetApiV1ProfilesIdStagesQueryKey(profileId) });

  const onError = (fallback: string) => (error: unknown) =>
    toast.error(errorMessage(error, fallback));

  const create = usePostApiV1ProfilesIdStages({
    mutation: {
      onSuccess: () => {
        setDraftName("");
        setDraftCapacity("");
        toast.success("Room added");
        void refresh();
      },
      onError: onError("Couldn't add the room."),
    },
  });

  const update = usePatchApiV1ProfilesIdStagesSid({
    mutation: {
      onSuccess: () => void refresh(),
      onError: onError("Couldn't save the room."),
    },
  });

  const remove = useDeleteApiV1ProfilesIdStagesSid({
    mutation: {
      onSuccess: (result) => {
        // Say what happened to the shows rather than letting them quietly lose
        // their room: `events.stage_id` is ON DELETE SET NULL, so they survive.
        const unassigned = result?.unassignedEvents ?? 0;
        toast.success(
          unassigned === 0
            ? "Room removed"
            : `Room removed — ${unassigned} ${unassigned === 1 ? "event" : "events"} kept their date and lost their room`,
        );
        void refresh();
      },
      onError: onError("Couldn't remove the room."),
    },
  });

  const list: RoomRow[] = (rooms.data ?? []).map((room) => ({
    id: room.id,
    name: room.name,
    capacity: room.capacity,
    capacitySetups: room.capacitySetups.map((setup) => ({
      id: setup.id,
      name: setup.name,
      capacity: setup.capacity === null ? "" : String(setup.capacity),
    })),
    eventCount: room.eventCount,
  }));

  const toSetupBodies = (setups: RoomSetupDraft[]) =>
    setups.map((setup) => ({
      id: setup.id,
      name: setup.name,
      capacity: toOptionalInteger(setup.capacity),
    }));

  return {
    rooms: list,
    isPending: rooms.isPending,
    isError: rooms.isError,
    error: rooms.error,
    draftName,
    setDraftName,
    draftCapacity,
    setDraftCapacity,
    canAdd: draftName.trim().length > 0,
    add: () => {
      if (draftName.trim().length === 0) return;
      create.mutate({
        id: profileId,
        data: { name: draftName.trim(), capacity: toOptionalInteger(draftCapacity) },
      });
    },
    isAdding: create.isPending,
    rename: (roomId, name) => {
      const trimmed = name.trim();
      // An emptied field is a half-finished edit, not a request to unname a room.
      if (trimmed === "") return;
      update.mutate({ id: profileId, sid: roomId, data: { name: trimmed } });
    },
    changeCapacity: (roomId, capacity) => {
      update.mutate({
        id: profileId,
        sid: roomId,
        data: { capacity: toOptionalInteger(capacity) },
      });
    },
    changeSetups: (roomId, setups) => {
      update.mutate({
        id: profileId,
        sid: roomId,
        data: { capacitySetups: toSetupBodies(setups) },
      });
    },
    saveSoleRoomCapacity: (capacity) => {
      const [sole] = list;
      if (sole) {
        update.mutate({
          id: profileId,
          sid: sole.id,
          data: { capacity: toOptionalInteger(capacity) },
        });
        return;
      }
      // No room yet. "Main Room" is the name the add-a-room field has always
      // suggested, and a one-room venue never has to see it.
      const parsed = toOptionalInteger(capacity);
      if (parsed === null) return;
      create.mutate({ id: profileId, data: { name: "Main Room", capacity: parsed } });
    },
    remove: (roomId) => remove.mutate({ id: profileId, sid: roomId }),
    isSaving: update.isPending || remove.isPending,
  };
}
