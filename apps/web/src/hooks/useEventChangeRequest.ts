import {
  getGetApiV1EventsIdChangeRequestQueryKey,
  getGetApiV1EventsIdQueryKey,
  getGetApiV1EventsQueryKey,
  postApiV1EventsIdChangeRequestCridAnswer,
  useGetApiV1EventsIdChangeRequest,
} from "@showme/api-client";
import { useToast } from "@showme/design-system";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { errorMessage } from "../lib/errors";

/**
 * THE OPEN PROPOSAL TO MOVE THIS BOOKING — and answering it.
 *
 * ClickUp 86cbcftg3. Ran: *"{operator} has request changing the date of this
 * event" - "Confirm/Decline" (notifications for each side for any decision)."*
 *
 * Null nearly always, which is the point: the card below only draws when there
 * is a question outstanding.
 *
 * ── Why confirming invalidates the event, not just this query ──────────────
 * The last confirmation APPLIES the change server-side, so the event the screen
 * is drawn from is stale the instant the answer returns. Refreshing only the
 * proposal would clear the card and leave the old date sitting on the page —
 * which reads as the confirmation having done nothing.
 */
export interface EventChangeProposal {
  id: string;
  changes: Record<string, string | null>;
  previous: Record<string, string | null>;
  reason: string | null;
  createdAt: string;
  required: number;
  confirmed: number;
  declined: number;
  /** Whether THIS viewer still has an answer to give. */
  answerable: boolean;
}

export interface EventChangeRequestView {
  proposal: EventChangeProposal | null;
  isAnswering: boolean;
  confirm: () => Promise<void>;
  decline: (note?: string) => Promise<void>;
}

export function useEventChangeRequest(eventId: string): EventChangeRequestView {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [isAnswering, setIsAnswering] = useState(false);

  const query = useGetApiV1EventsIdChangeRequest(eventId);
  const proposal = (query.data?.request ?? null) as EventChangeProposal | null;

  const answer = useCallback(
    async (decision: "confirm" | "decline", note?: string) => {
      if (!proposal) return;
      setIsAnswering(true);
      try {
        const result = await postApiV1EventsIdChangeRequestCridAnswer(
          eventId,
          proposal.id,
          decision,
          note ? { note } : {},
        );
        // What to say depends on whether THIS answer settled it. With two acts on
        // the bill the first "Confirm" changes nothing yet, and telling that
        // person the date has moved would be a lie they would act on.
        if (result.status === "confirmed") {
          toast.success("Confirmed — the event has been updated.");
        } else if (result.status === "declined") {
          toast.success("Declined. The organiser has been told, and the date stands.");
        } else {
          toast.success("Your answer is in. Waiting on the others before anything moves.");
        }
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: getGetApiV1EventsIdChangeRequestQueryKey(eventId),
          }),
          queryClient.invalidateQueries({ queryKey: getGetApiV1EventsIdQueryKey(eventId) }),
          queryClient.invalidateQueries({ queryKey: getGetApiV1EventsQueryKey() }),
        ]);
      } catch (cause) {
        toast.error(errorMessage(cause, "Couldn't send your answer. Try again."));
      } finally {
        setIsAnswering(false);
      }
    },
    [eventId, proposal, queryClient, toast],
  );

  return {
    proposal,
    isAnswering,
    confirm: useCallback(() => answer("confirm"), [answer]),
    decline: useCallback((note?: string) => answer("decline", note), [answer]),
  };
}
