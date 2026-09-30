import {
  type getApiV1MeInvitations,
  getGetApiV1EventsQueryKey,
  getGetApiV1MeEventInvitationsQueryKey,
  postApiV1EventsIdParticipationAccept,
  postApiV1EventsIdParticipationDecline,
  useGetApiV1MeEventInvitations,
  useGetApiV1MeInvitations,
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
  /** The participation's own state: `invited` until it is answered. */
  status: string;
  /** Which inbox tab this belongs in — `expired` is derived from the date. */
  /**
   * `cancelled` is derived by the API from the EVENT's status (QA sweep run 5, QA5-2) —
   * a night that has been called off is not a pending question, and the Events screen's
   * filter below drops it for that reason. A party still hears about the cancellation
   * itself: the notice goes to every participant, `invited` ones included.
   */
  requestStatus: "pending" | "accepted" | "declined" | "expired" | "cancelled";
  /**
   * IS THIS THE READER'S TO ANSWER (decisions §25.7.3).
   *
   * False on a represented act's own invitation: they SEE the night and the Accept/Decline
   * belongs to their agent. Until QA sweep run 11 the row was filtered out of the API's list
   * entirely, which is a different thing from read-only and is not what the ruling said.
   */
  answerableByYou: boolean;
  /**
   * THE OTHER PARTY IN THE DELEGATION, read from whichever end is looking: the act on the
   * agent's card, the agent on the act's. Null when nobody else is involved, which is most
   * invitations.
   */
  delegateName: string | null;
}

/**
 * AN INVITATION SENT TO THIS USER'S EMAIL, which is a different object (QA sweep run 10, QA10-4).
 *
 * `EventInvitation` above is a **participation** — a row on the bill, answered in place. This is an
 * `invitations` row with a token, and until it is redeemed there is no participation at all: nothing
 * for `/events/:id/participation/accept` to move, and nothing for `/me/event-invitations` to find.
 * That is why an Invite Collaborator invitation left the invitee's inbox empty and their Dashboard
 * saying *"You're all caught up"* — for every role, not only the co-host the sweep met it on.
 *
 * It is answered on its own page (`/invitations/:token`), so the card LINKS rather than offering
 * Accept and Decline. Two shapes, one heading: what the reader has is "an invitation addressed to
 * me", and which mechanism carries it is not their problem.
 */
/*
 * Derived from the endpoint rather than restated, the same way `useEventAgreements` derives its
 * `Deal` — a hand-written copy of a response shape is one more thing that can fall behind it. The
 * intersection narrows `token` to non-null, which is what `addressed` below filters for: a row this
 * card can actually open.
 */
export type AddressedInvitation = Awaited<ReturnType<typeof getApiV1MeInvitations>>[number] & {
  token: string;
};

export interface EventInvitationsView {
  /**
   * UNANSWERED ones only — what "you have an invitation" means on the Events
   * card and on the calendar. The endpoint returns answered ones too (the
   * Requests inbox needs an Accepted tab), so the narrowing happens here rather
   * than in two screens that would each have to remember to do it.
   */
  invitations: EventInvitation[];
  /** Every invitation addressed to this user, whatever its state. */
  all: EventInvitation[];
  /**
   * Pending EMAIL invitations — the ones with a token, which are answered on their own page. Only
   * ever unanswered: the endpoint returns `pending` rows and an answered one stops being one.
   */
  addressed: AddressedInvitation[];
  isLoading: boolean;
  /** The event id currently being answered, so one card can show a pending state. */
  answering: string | null;
  accept: (invitation: EventInvitation) => Promise<void>;
  decline: (invitation: EventInvitation, note?: string) => Promise<void>;
}

/*
 * PENDING **AND CANCELLED** — decisions §25.9.9, and the verification sweep of 2026-09-30.
 *
 * This filtered to `pending` alone, and the API crosses the EVENT's status into `requestStatus`
 * (QA5-2), so an invitation to a night that was called off simply vanished from this list. That
 * was defensible while a cancelled invitation could still be accepted and the reader lost
 * nothing by it being filed under "All".
 *
 * §25.9.9 changed what it costs. The ruling refuses the ACCEPT and deliberately keeps the
 * DECLINE — *"closing the invitation is the answer a performer most wants on record"* — and on
 * this surface the decline was unreachable: the row never rendered, so the card's own
 * `requestStatus !== "cancelled"` guard was dead code and *"Accept is gone"* was true for the
 * wrong reason. The Dashboard even routes the reader here ("this show is off") to a list the
 * row is filtered out of.
 *
 * A cancelled row carries its own badge (the card says why it has to — it belongs to no chip),
 * and with Accept withheld the only control on it is the Decline the ruling preserved.
 */
export function invitationStillNeedsAnAnswer(invitation: { requestStatus: string }): boolean {
  return invitation.requestStatus === "pending" || invitation.requestStatus === "cancelled";
}

export function useEventInvitations(): EventInvitationsView {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [answering, setAnswering] = useState<string | null>(null);

  const query = useGetApiV1MeEventInvitations();
  /*
   * The second source. Two reads rather than one, because they are two objects with two answers — see
   * `AddressedInvitation`. Both are cheap, and the screens that show one always want the other.
   */
  const addressedQuery = useGetApiV1MeInvitations();

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

  const all = (query.data ?? []) as EventInvitation[];

  return {
    invitations: all.filter(invitationStillNeedsAnAnswer),
    all,
    // Only the ones with somewhere to go: a code-only invite has no in-app page, so offering a row
    // that cannot be opened would be the dead affordance this whole finding is about.
    addressed: (addressedQuery.data ?? []).filter(
      (one): one is AddressedInvitation => one.token != null,
    ),
    isLoading: query.isLoading || addressedQuery.isLoading,
    answering,
    accept: useCallback((invitation: EventInvitation) => answer(invitation, "accept"), [answer]),
    decline: useCallback(
      (invitation: EventInvitation, note?: string) => answer(invitation, "decline", note),
      [answer],
    ),
  };
}
