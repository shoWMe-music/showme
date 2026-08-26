import {
  ApiError,
  getGetApiV1EventsIdQueryKey,
  getGetApiV1EventsQueryKey,
  type patchApiV1EventsId,
  usePatchApiV1EventsId,
} from "@showme/api-client";
import { useToast } from "@showme/design-system";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { errorMessage } from "../lib/errors";

/**
 * Setting an event's status BY HAND.
 *
 * The status is the operator's own record of where a booking stands — not a
 * handshake. This product does have counterparty consent, and it is deliberately
 * elsewhere: a DEAL freezes only when every non-observer party has confirmed its
 * own `deal_parties` row (docs/decisions.md, "Agreements"), and an INVITATION
 * grants nothing until the invitee accepts it. Neither is touched here, and
 * neither may ever be driven from this control.
 *
 * What was missing is the operator working ALONE — a venue running its own room,
 * or anyone typing in the bookings they already have while onboarding. For them
 * there is no counterparty to wait for, and the event workspace offered no way to
 * say "this one is confirmed", or "this one is a past show I'm entering as
 * concluded". `PATCH /events/:id` has always accepted `status` behind
 * `event.edit`; the screen simply never asked.
 *
 * Any status may be chosen, in any direction. Onboarding is mostly BACKWARDS
 * moves — a booking typed in as confirmed, then corrected to pending when the
 * artist turns out not to have signed — and a one-way rail would make the first
 * mistake permanent.
 */
/** The status vocabulary the API will actually accept, read off the generated
 * client (the same trick `useEventInformationEdit` uses for the body) — so a
 * status added or dropped server-side fails the build, not a request. */
type EventStatusValue = NonNullable<Parameters<typeof patchApiV1EventsId>[1]["status"]>;

export interface EventStatusOption {
  value: EventStatusValue;
  label: string;
  description: string;
}

/**
 * The `event_status` enum (packages/db/src/schema/enums.ts) in the order an
 * event travels it, with what each stop MEANS — inferred from docs/story.md's
 * purpose/boundary for the operator, not from booking-industry convention.
 */
export const EVENT_STATUS_OPTIONS: EventStatusOption[] = [
  {
    value: "draft",
    label: "Draft",
    description: "Yours alone. Nothing has been put to anybody yet.",
  },
  {
    value: "suggested",
    label: "Suggested",
    description: "Floated as an idea. No date is being held and nothing is promised.",
  },
  {
    value: "pending",
    label: "Pending",
    description: "Offered, and waiting on an answer.",
  },
  {
    value: "on_hold",
    label: "On hold",
    description:
      "The date is pencilled in a queue rather than booked. Set the priority from the hold flow; without one it queues first.",
  },
  {
    value: "confirmed",
    label: "Confirmed",
    description: "The booking is on. This is the status that counts against your plan.",
  },
  {
    value: "concluded",
    label: "Concluded",
    description: "The show happened. What is left is the settlement.",
  },
  {
    value: "cancelled",
    label: "Cancelled",
    description: "Called off. The event and its history stay, nothing is deleted.",
  },
];

export interface EditableEventStatus {
  id: string;
  status: string;
  version: number;
}

export interface EventStatusEditor {
  status: string;
  options: EventStatusOption[];
  /** What the currently-selected status means, for the line under the control. */
  current: EventStatusOption | undefined;
  setStatus: (next: string) => void;
  isSaving: boolean;
  /** A refusal that belongs on screen rather than in a toast (plan limits). */
  refusal: string | null;
}

export function useEventStatusEditor(event: EditableEventStatus): EventStatusEditor {
  const toast = useToast();
  const queryClient = useQueryClient();

  const patchEvent = usePatchApiV1EventsId({
    mutation: {
      onSuccess: (updated) => {
        const option = EVENT_STATUS_OPTIONS.find((entry) => entry.value === updated.status);
        toast.success(`Status set to ${option?.label ?? updated.status}`);
        queryClient.invalidateQueries({ queryKey: getGetApiV1EventsIdQueryKey(event.id) });
        // The Events list and the dashboard counters read the same status.
        queryClient.invalidateQueries({ queryKey: getGetApiV1EventsQueryKey() });
      },
      onError: (error) => {
        if (error instanceof ApiError && error.status === 409) {
          toast.error("Someone else changed this event — reload it and try again.");
          queryClient.invalidateQueries({ queryKey: getGetApiV1EventsIdQueryKey(event.id) });
          return;
        }
        // A free plan refusing `confirmed` is the answer to the question just
        // asked, so it is shown verbatim rather than as "something went wrong".
        toast.error(errorMessage(error, "Couldn't change the status."));
      },
    },
  });

  const setStatus = useCallback(
    (next: string) => {
      if (next === event.status) return;
      // The Select hands back a plain string; only a value that IS one of the
      // options above ever reaches the API.
      const option = EVENT_STATUS_OPTIONS.find((entry) => entry.value === next);
      if (!option) return;
      patchEvent.mutate({
        id: event.id,
        // Optimistically locked like every other write on this screen
        // (decisions #8) — a status set against a stale version is refused, not
        // silently applied over whoever moved it first.
        data: { status: option.value, expectedVersion: event.version },
      });
    },
    [event.id, event.status, event.version, patchEvent],
  );

  return {
    status: event.status,
    options: EVENT_STATUS_OPTIONS,
    current: EVENT_STATUS_OPTIONS.find((option) => option.value === event.status),
    setStatus,
    isSaving: patchEvent.isPending,
    refusal:
      patchEvent.error && !(patchEvent.error instanceof ApiError && patchEvent.error.status === 409)
        ? errorMessage(patchEvent.error, "Couldn't change the status.")
        : null,
  };
}
