import {
  getGetApiV1EventsQueryKey,
  getGetApiV1MeEventInvitationsQueryKey,
  postApiV1EventsIdParticipationAccept,
  postApiV1EventsIdParticipationDecline,
  useGetApiV1MeEventInvitations,
} from "@showme/api-client";
import { useToast } from "@showme/design-system";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { errorMessage } from "../lib/errors";

/**
 * INVITATIONS THIS USER HAS NOT ANSWERED — and answering them.
 *
 * ClickUp 86cbcehmp (with 123qy9rnf87 as its reported symptom). Ran: *"Invited
 * users should first have the option to 'Accept invite' - currently the invited
 * party gets invited to an event → gets access to the event manager as a
 * collaborator immediately → stays as 'Invited' in the collaborators tab."*
 *
 * The server half of that is `NON_STANDING_PARTICIPANT_STATUSES` in
 * `@showme/auth`: an `invited` participation now grants no capabilities at all.
 * Which means the event is NOT in `GET /events` for the person invited to it,
 * and opening it answers 404. This hook feeds the one surface that can still see
 * the invitation — `GET /me/event-invitations`, a deliberately thin read that
 * carries who is asking, which night and where, and nothing else.
 *
 * ── Why the answer invalidates the EVENTS list too ─────────────────────────
 * Accepting is the moment the show appears in their events for the first time.
 * Invalidating only this list would leave the card gone and the event missing
 * until something else happened to refetch — which reads as the accept having
 * failed. Both keys, always.
 *
 * ── Declining is not undoable from here, on purpose ────────────────────────
 * The server refuses a second answer with a 409 (one participation, answered
 * once), so an "Undo" in the toast would be a button that cannot work. Getting
 * back onto a bill you turned down is the operator re-inviting you, which is
 * the honest model: it is their event.
 */
export interface EventInvitation {
  eventId: string;
  participantId: string;
  role: string;
  title: string | null;
  eventDate: string | null;
  venueName: string | null;
  hostName: string | null;
}

export interface EventInvitationsView {
  invitations: EventInvitation[];
  isLoading: boolean;
  /** The event id currently being answered, so one card can show a pending state. */
  answering: string | null;
  accept: (invitation: EventInvitation) => Promise<void>;
  decline: (invitation: EventInvitation, note?: string) => Promise<void>;
}

export function useEventInvitations(): EventInvitationsView {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [answering, setAnswering] = useState<string | null>(null);

  const query = useGetApiV1MeEventInvitations();

  const answer = useCallback(
    async (invitation: EventInvitation, decision: "accept" | "decline", note?: string) => {
      setAnswering(invitation.eventId);
      try {
        const body = note ? { note } : {};
        if (decision === "accept") {
          await postApiV1EventsIdParticipationAccept(invitation.eventId, body);
        } else {
          await postApiV1EventsIdParticipationDecline(invitation.eventId, body);
        }
        const show = invitation.title ?? "the event";
        toast.success(
          decision === "accept"
            ? `You're on the bill for ${show}.`
            : `You turned down ${show}. ${invitation.hostName ?? "The operator"} has been told.`,
        );
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: getGetApiV1MeEventInvitationsQueryKey() }),
          queryClient.invalidateQueries({ queryKey: getGetApiV1EventsQueryKey() }),
        ]);
      } catch (cause) {
        // A 409 here is the ordinary race — answered in another tab, or twice on
        // a slow connection — so it is worth saying what happened rather than
        // "something went wrong".
        toast.error(errorMessage(cause, "Couldn't send your answer. Try again."));
      } finally {
        setAnswering(null);
      }
    },
    [queryClient, toast],
  );

  return {
    invitations: (query.data ?? []) as EventInvitation[],
    isLoading: query.isLoading,
    answering,
    accept: useCallback((invitation: EventInvitation) => answer(invitation, "accept"), [answer]),
    decline: useCallback(
      (invitation: EventInvitation, note?: string) => answer(invitation, "decline", note),
      [answer],
    ),
  };
}
