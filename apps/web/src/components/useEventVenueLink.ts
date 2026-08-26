import { ApiError, getGetApiV1EventsIdQueryKey, usePatchApiV1EventsId } from "@showme/api-client";
import { useToast } from "@showme/design-system";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { errorMessage } from "../lib/errors";
import type { VenueChoice } from "./EventVenuePicker";

/**
 * Attaching an existing event to a venue PROFILE.
 *
 * The create wizard can now pick a venue, but an event already in flight had no
 * way to be pointed at one — and pointing at one is what makes the venue's own
 * facts travel. The write is a single `venueProfileId` PATCH: the API fills the
 * event's BLANK fields from the venue (name, capacity, house curfew, amenities,
 * city) and leaves everything already filled exactly as the operator left it —
 * the rule is written out in `apps/api/src/routes/events.ts`.
 *
 * Deliberately not a form. There is nothing here for the operator to fill in:
 * they are identifying a room, and the room answers for itself.
 */
export interface EventVenueLink {
  link: (choice: VenueChoice | null) => void;
  isSaving: boolean;
}

export interface LinkableEvent {
  id: string;
  version: number;
  venueProfileId?: string | null;
}

export function useEventVenueLink(event: LinkableEvent): EventVenueLink {
  const toast = useToast();
  const queryClient = useQueryClient();

  const patchEvent = usePatchApiV1EventsId({
    mutation: {
      onSuccess: (updated) => {
        toast.success(
          updated.venueProfileId
            ? `Venue set to ${updated.venueName ?? "the selected profile"}`
            : "Venue profile unlinked",
        );
        queryClient.invalidateQueries({ queryKey: getGetApiV1EventsIdQueryKey(event.id) });
      },
      onError: (error) => {
        if (error instanceof ApiError && error.status === 409) {
          toast.error("Someone else changed this event — reload it and try again.");
          queryClient.invalidateQueries({ queryKey: getGetApiV1EventsIdQueryKey(event.id) });
          return;
        }
        toast.error(errorMessage(error, "Couldn't set the venue."));
      },
    },
  });

  const link = useCallback(
    (choice: VenueChoice | null) => {
      const next = choice?.profileId ?? null;
      if (next === (event.venueProfileId ?? null)) return;
      patchEvent.mutate({
        id: event.id,
        data: { venueProfileId: next, expectedVersion: event.version },
      });
    },
    [event.id, event.version, event.venueProfileId, patchEvent],
  );

  return { link, isSaving: patchEvent.isPending };
}
