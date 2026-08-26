import {
  getGetApiV1EventsIdParticipantsQueryKey,
  useGetApiV1Groups,
  usePostApiV1EventsIdGroups,
} from "@showme/api-client";
import { useToast } from "@showme/design-system";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { errorMessage } from "../lib/errors";

/**
 * Putting people on an event's crew — the two doors the Team / Crew tab drew but
 * never opened.
 *
 * The tab shipped with a "From Team" button and a "+ Add Member" button, neither
 * of which had a handler: clicking them did nothing at all, which is exactly the
 * "I can't add team" the product owner's partner hit. The two are genuinely
 * different acts, which is why both exist (docs/decisions.md #12, *member → group
 * → participant*):
 *
 * - **From Team** assigns a saved work-GROUP you already keep (`POST
 *   /events/:id/groups`), expanding it into one crew participant per member.
 *   Nobody is asked anything: they are already your people.
 * - **+ Add Member** invites ONE person by email onto this event as crew
 *   (`POST /invitations`), and grants nothing until they accept. That flow is
 *   already built and correct — `EventCollaboratorInviteModal` — so this hook
 *   only holds the door open rather than growing a second, divergent invite.
 */
export interface EventCrewPanel {
  /** The caller's saved work-groups, for the "From Team" picker. */
  groups: { id: string; name: string; memberCount: number }[];
  groupsPending: boolean;
  /** Whether the picker is showing. */
  pickerOpen: boolean;
  openPicker: () => void;
  closePicker: () => void;
  assignGroup: (groupId: string) => void;
  isAssigning: boolean;
}

export function useEventCrewPanel(eventId: string): EventCrewPanel {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [pickerOpen, setPickerOpen] = useState(false);

  // Only fetched once the operator actually asks for the picker — the tab is
  // read far more often than a group is assigned.
  const groupsQuery = useGetApiV1Groups({ query: { enabled: pickerOpen } });

  const assign = usePostApiV1EventsIdGroups({
    mutation: {
      onSuccess: (result) => {
        const added = result.assigned.length;
        const skipped = result.skippedExisting.length + result.skippedNoProfile.length;
        // The count is the whole point: a group of six that adds two because
        // four were already on the bill must say so, not claim six.
        toast.success(
          added === 0
            ? "Everyone in that team is already on this event"
            : `Added ${added} crew member${added === 1 ? "" : "s"}${
                skipped > 0 ? ` (${skipped} already on the event or not yet on shoWMe)` : ""
              }`,
        );
        queryClient.invalidateQueries({
          queryKey: getGetApiV1EventsIdParticipantsQueryKey(eventId),
        });
        setPickerOpen(false);
      },
      onError: (error) => {
        toast.error(errorMessage(error, "Couldn't add that team to the event."));
      },
    },
  });

  const assignGroup = useCallback(
    (groupId: string) => {
      assign.mutate({ id: eventId, data: { groupId } });
    },
    [assign, eventId],
  );

  return {
    groups: (groupsQuery.data ?? []).map((group) => ({
      id: group.id,
      name: group.name,
      memberCount: group.members.length,
    })),
    groupsPending: pickerOpen && groupsQuery.isPending,
    pickerOpen,
    openPicker: useCallback(() => setPickerOpen(true), []),
    closePicker: useCallback(() => setPickerOpen(false), []),
    assignGroup,
    isAssigning: assign.isPending,
  };
}
