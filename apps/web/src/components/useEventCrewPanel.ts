import {
  type GetApiV1Groups200ItemMembersItem,
  type PostApiV1EventsIdGroups200,
  type PostApiV1EventsIdGroups200SkippedNoProfileItem,
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

/**
 * Name a member the assignment could not place, as the person who has to act on
 * it would recognise them.
 *
 * The response only carries `memberId` and `email`, so the role label comes from
 * the group the operator just clicked — "Stage Manager (tobias@…)" is something
 * they can find in their own team list, where a bare UUID is not. An address-less
 * member is rare (the group form asks for one) but not impossible, and saying so
 * beats printing "null".
 */
function describeSkippedMember(
  skipped: PostApiV1EventsIdGroups200SkippedNoProfileItem,
  members: readonly GetApiV1Groups200ItemMembersItem[],
): string {
  const member = members.find((candidate) => candidate.id === skipped.memberId);
  const email = skipped.email ?? member?.email ?? null;
  const roleLabel = member?.roleLabel ?? null;
  if (roleLabel && email) return `${roleLabel} (${email})`;
  return email ?? roleLabel ?? "one member with no email on file";
}

/** "Tobias and Ana", "A, B and C", then "A, B and 3 more" — a toast, not a list. */
function nameList(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length <= 3) return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

/**
 * What actually happened, said out loud.
 *
 * THIS IS THE BUG THIS FUNCTION EXISTS FOR. The toast used to read "Everyone in
 * that team is already on this event" whenever nothing was added — including when
 * the reason was the opposite one, that a member has no shoWMe account and so
 * cannot be put on an event at all. The API has always returned the three
 * outcomes separately (`assigned`, `skippedExisting`, `skippedNoProfile`); the
 * screen simply threw two of them away and guessed. Every combination gets its
 * own sentence here, and nobody is told a team is complete when it is not.
 *
 * `added === 0` is deliberately NOT a failure — it is information — but it is not
 * a success either, which is why the caller picks the toast tone from it.
 */
function assignmentOutcome(
  teamName: string,
  result: PostApiV1EventsIdGroups200,
  members: readonly GetApiV1Groups200ItemMembersItem[],
): { added: number; message: string } {
  const added = result.assigned.length;
  const alreadyOn = result.skippedExisting.length;
  const offPlatform = result.skippedNoProfile.map((skipped) =>
    describeSkippedMember(skipped, members),
  );

  // Each skip, in its own words. The off-platform one is named and paired with
  // the affordance that can fix it — inviting by email is a real door on this very
  // tab. Putting an off-platform member straight onto an event is NOT
  // (docs/off-platform-access.md), so the copy does not pretend it is.
  const reasons: string[] = [];
  if (alreadyOn > 0) {
    reasons.push(`${alreadyOn} ${alreadyOn === 1 ? "was" : "were"} already on this event`);
  }
  if (offPlatform.length > 0) {
    reasons.push(
      `${nameList(offPlatform)} ${offPlatform.length === 1 ? "isn't" : "aren't"} on shoWMe yet, so invite ${offPlatform.length === 1 ? "them" : "each of them"} with “+ Add Member”`,
    );
  }

  if (added > 0) {
    const head = `Added ${added} crew member${added === 1 ? "" : "s"} from ${teamName}`;
    return {
      added,
      message: reasons.length === 0 ? `${head}.` : `${head} — ${reasons.join(", and ")}.`,
    };
  }
  // "Everyone is already here" is TRUE only when nothing else stopped anyone.
  if (offPlatform.length === 0 && alreadyOn > 0) {
    return { added, message: `Everyone in ${teamName} is already on this event.` };
  }
  if (reasons.length === 0) {
    return { added, message: `${teamName} has no members yet, so nobody was added.` };
  }
  return { added, message: `Nobody was added: ${reasons.join(", and ")}.` };
}

export function useEventCrewPanel(eventId: string): EventCrewPanel {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [pickerOpen, setPickerOpen] = useState(false);

  // Only fetched once the operator actually asks for the picker — the tab is
  // read far more often than a group is assigned.
  const groupsQuery = useGetApiV1Groups({ query: { enabled: pickerOpen } });
  const groups = groupsQuery.data;

  const assign = usePostApiV1EventsIdGroups({
    mutation: {
      onError: (error) => {
        toast.error(errorMessage(error, "Couldn't add that team to the event."));
      },
    },
  });

  const assignGroup = useCallback(
    (groupId: string) => {
      // The clicked group travels with the request so the answer can name the
      // team and the people in it — the response identifies members by id alone.
      const group = groups?.find((candidate) => candidate.id === groupId);
      assign.mutate(
        { id: eventId, data: { groupId } },
        {
          onSuccess: (result) => {
            const outcome = assignmentOutcome(
              group?.name ?? "That team",
              result,
              group?.members ?? [],
            );
            if (outcome.added > 0) toast.success(outcome.message);
            else toast.info(outcome.message);
            queryClient.invalidateQueries({
              queryKey: getGetApiV1EventsIdParticipantsQueryKey(eventId),
            });
            // Closed only when the crew actually changed. On a no-op the picker
            // stays put, beside the toast that explains why, so the next team is
            // one click away instead of four.
            if (outcome.added > 0) setPickerOpen(false);
          },
        },
      );
    },
    [assign, eventId, groups, queryClient, toast],
  );

  return {
    groups: (groups ?? []).map((group) => ({
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
