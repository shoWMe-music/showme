import {
  type GetApiV1Groups200ItemMembersItem,
  type PostApiV1EventsIdGroups200,
  type PostApiV1EventsIdGroups200SkippedNoProfileItem,
  getGetApiV1EventsIdParticipantsQueryKey,
  useGetApiV1EventsIdParticipants,
  useGetApiV1Groups,
  useGetApiV1Tasks,
  usePatchApiV1EventsIdCrewPidInHouse,
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
 *
 * It also carries the tab's PRIVATE half — the In-House Management block. That
 * surface used to be one sentence promising "team schedules, private notes and
 * assigned tasks" and delivering none of the three. It now delivers all three,
 * and each comes from somewhere that was already private:
 *
 * - **Call time** and **private note** live in `event_participants.details`,
 *   which `serializeParticipant` returns to the managing operators and to nobody
 *   else. The write door is `PATCH /events/:id/crew/:pid/in-house`.
 * - **Assigned tasks** are the event's own to-do list filtered to that crew
 *   member's `assigneeParticipantId` — the column the To Do tab now writes. No
 *   new endpoint: the shared list is already gated by `event.view`, and grouping
 *   it by assignee is a view of it, not a second copy.
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
  /** The In-House block for each crew participant, keyed by participant id. */
  inHouse: Record<string, CrewInHouse>;
  inHousePending: boolean;
  saveInHouse: (participantId: string, next: CrewInHouseEdit) => void;
  isSavingInHouse: boolean;
}

/** One crew member's private working record, as the In-House tab renders it. */
export interface CrewInHouse {
  /** Wall-clock `HH:MM` on the show's day, in the event's timezone. */
  callTime: string | null;
  privateNote: string | null;
  /** That person's tasks on THIS event — the To Do tab, filtered to them. */
  tasks: CrewTask[];
}

export interface CrewTask {
  id: string;
  title: string;
  completed: boolean;
  dueDate: string | null;
}

/** A save: an absent field is left alone, `null` clears it — the API's own rule. */
export interface CrewInHouseEdit {
  callTime?: string | null;
  privateNote?: string | null;
}

/** Empty rather than undefined, so a member with nothing on file still renders. */
export const EMPTY_IN_HOUSE: CrewInHouse = { callTime: null, privateNote: null, tasks: [] };

/**
 * The two in-house fields, dug out of the participant's `details` blob.
 *
 * `details` is typed `unknown` by the generated client because the API declares
 * it that way — deliberately, since it is a jsonb bag whose contents differ by
 * event-role (a crew row carries `sponsorParticipantId`, a delegated performer
 * carries `delegatedToAgentProfileId`). Reading two known string keys out of it
 * is the whole of the narrowing this screen needs.
 *
 * AND IT IS ABSENT FOR EVERYONE BUT THE OPERATOR. `serializeParticipant` omits
 * the key entirely below `participants.manage`/`budget.view`, so on a performer's
 * or an agent's own fetch this function is reading from `{}` — the privacy is the
 * server's, not this screen's.
 */
function readInHouse(details: unknown): { callTime: string | null; privateNote: string | null } {
  const bag = (details ?? {}) as Record<string, unknown>;
  return {
    callTime: typeof bag.callTime === "string" ? bag.callTime : null,
    privateNote: typeof bag.privateNote === "string" ? bag.privateNote : null,
  };
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

  // Both reads are the SAME queries the event screen and the To Do tab already
  // run, with the same keys, so React Query serves them from cache rather than
  // issuing a second request. Re-deriving here instead of threading the rows down
  // through `EventDetail` keeps the panel's data its own business.
  const participantsQuery = useGetApiV1EventsIdParticipants(eventId);
  const tasksQuery = useGetApiV1Tasks({ eventId });

  // Only fetched once the operator actually asks for the picker — the tab is
  // read far more often than a group is assigned.
  const groupsQuery = useGetApiV1Groups({ query: { enabled: pickerOpen } });
  const groups = groupsQuery.data;

  const saveInHouseMutation = usePatchApiV1EventsIdCrewPidInHouse({
    mutation: {
      onSuccess: () => {
        // The saved values live on the participant row, so the roster query is
        // what has to be refetched — the same key the group assignment invalidates.
        queryClient.invalidateQueries({
          queryKey: getGetApiV1EventsIdParticipantsQueryKey(eventId),
        });
        toast.success("Saved to your private team notes.");
      },
      onError: (error) => {
        toast.error(errorMessage(error, "Couldn't save that."));
      },
    },
  });

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

  // One pass over the event's tasks, bucketed by assignee — the alternative is a
  // filter per crew member, which re-walks the list once for every row on screen.
  const tasksByParticipant: Record<string, CrewTask[]> = {};
  for (const task of tasksQuery.data?.items ?? []) {
    if (!task.assigneeParticipantId) continue;
    const bucket = tasksByParticipant[task.assigneeParticipantId] ?? [];
    bucket.push({
      id: task.id,
      title: task.title,
      completed: task.completed,
      dueDate: task.dueDate,
    });
    tasksByParticipant[task.assigneeParticipantId] = bucket;
  }

  const inHouse: Record<string, CrewInHouse> = {};
  for (const participant of participantsQuery.data ?? []) {
    inHouse[participant.id] = {
      ...readInHouse(participant.details),
      tasks: tasksByParticipant[participant.id] ?? [],
    };
  }

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
    inHouse,
    inHousePending: participantsQuery.isPending || tasksQuery.isPending,
    saveInHouse: (participantId, next) =>
      saveInHouseMutation.mutate({ id: eventId, pid: participantId, data: next }),
    isSavingInHouse: saveInHouseMutation.isPending,
  };
}
