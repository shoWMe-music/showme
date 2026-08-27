import {
  customFetch,
  getGetApiV1EventsIdQueryKey,
  getGetApiV1EventsQueryKey,
} from "@showme/api-client";
import { useToast } from "@showme/design-system";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { holdOrdinal } from "../components/HoldPlacement";
import { errorMessage } from "../lib/errors";

/**
 * The state behind the holds panel — everything an operator needs to run a
 * pencil queue, and everything an act needs to answer one.
 *
 * WHY IT READS ITS OWN ROUTE rather than deriving the queue from the events
 * list. The wizard's `useHoldPlacement` counts competing holds out of
 * `GET /events?status=on_hold`, and says so in its own comment: that list is
 * scoped to what the CALLER can reach, while the server pools a date by
 * `(event_date, venue_profile_id, stage_id)` across every operator. The two
 * disagree the moment a hold the caller cannot see joins the date, and the
 * client's version would offer a rank the rank route would not honour. It is a
 * fair approximation for a wizard that has not created the event yet; it is the
 * wrong source for a panel that reorders a live queue.
 *
 * WHY `canDecide` IS SERVER-ANSWERED. Confirm and decline need `agreement.confirm`
 * AND standing as the booked act (`requireBookingDecision` in
 * `apps/api/src/routes/holds.ts`). The capability alone is not the answer:
 * `operator_full` carries `agreement.confirm`, and the host is never the act —
 * so a panel gating Confirm on the capability would hand every operator a button
 * whose click comes back 403. That is precisely what `capabilities[]` was added
 * to end, so the flag is computed by the same code the route enforces with.
 */

/** One pencil in the queue for a date. `title` is null when it is not ours to name. */
export interface HoldPoolEntry {
  id: string;
  title: string | null;
  holdRank: number;
  holdAutoPromote: boolean;
  isSelf: boolean;
}

/** `GET /events/:id/hold` — see `HoldStateResponse` in the route. */
interface HoldState {
  id: string;
  status: string;
  eventDate: string | null;
  holdRank: number | null;
  holdAutoPromote: boolean | null;
  pool: HoldPoolEntry[];
  canManageRank: boolean;
  canDecide: boolean;
}

export interface EventHoldView {
  isLoading: boolean;
  /** This event is a hold right now — the panel renders nothing otherwise. */
  isHold: boolean;
  /** Operator-only; null for everyone else, because the API never sends it. */
  holdRank: number | null;
  holdAutoPromote: boolean;
  pool: HoldPoolEntry[];
  /** `event.edit` — may reorder, promote, freeze and release. */
  canManageRank: boolean;
  /** The booked act, or the agent it delegated to — may confirm or decline. */
  canDecide: boolean;
  /** The ranks this hold may move to: `1 … pool.length`, never a gap. */
  rankOptions: number[];
  isWorking: boolean;
  setRank: (rank: number) => void;
  promoteToFirst: () => void;
  setAutoPromote: (next: boolean) => void;
  /** The operator withdraws this pencil; the queue closes behind it. */
  release: () => void;
  /** The act accepts the date; every competing hold is cancelled. */
  confirmDate: () => void;
  /** The act turns the date down; the queue closes behind it. */
  declineDate: () => void;
}

export function eventHoldQueryKey(eventId: string): readonly unknown[] {
  return ["events", eventId, "hold"];
}

export function useEventHold(eventId: string): EventHoldView {
  const toast = useToast();
  const queryClient = useQueryClient();

  const holdQuery = useQuery({
    queryKey: eventHoldQueryKey(eventId),
    queryFn: ({ signal }) =>
      customFetch<HoldState>({ url: `/api/v1/events/${eventId}/hold`, method: "GET", signal }),
  });

  // A hold action moves OTHER events too — the siblings shift rank, a confirm
  // cancels them outright — so the whole event list goes stale, not just this row.
  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: eventHoldQueryKey(eventId) });
    queryClient.invalidateQueries({ queryKey: getGetApiV1EventsIdQueryKey(eventId) });
    queryClient.invalidateQueries({ queryKey: getGetApiV1EventsQueryKey() });
  }, [queryClient, eventId]);

  const act = useMutation({
    mutationFn: (action: { path: string; body?: unknown; success: string }) =>
      customFetch<unknown>({
        url: `/api/v1/events/${eventId}/hold${action.path}`,
        method: "POST",
        data: action.body,
      }),
    onSuccess: (_result, action) => {
      refresh();
      toast.success(action.success);
    },
    onError: (error) => toast.error(errorMessage(error, "That didn't work.")),
  });

  const hold = holdQuery.data;
  const pool = hold?.pool ?? [];
  const holdRank = hold?.holdRank ?? null;

  return {
    isLoading: holdQuery.isPending,
    isHold: hold?.status === "on_hold",
    holdRank,
    holdAutoPromote: hold?.holdAutoPromote ?? false,
    pool,
    canManageRank: hold?.canManageRank ?? false,
    canDecide: hold?.canDecide ?? false,
    // `pool` already contains this hold, so its length IS the number of ranks on
    // offer — moving to a rank past the end of the queue is not a move.
    rankOptions: Array.from({ length: Math.max(pool.length, 1) }, (_, index) => index + 1),
    isWorking: act.isPending,
    setRank: (rank) =>
      act.mutate({
        path: "/rank",
        body: { holdRank: rank },
        success: `Moved to ${holdOrdinal(rank)} hold`,
      }),
    promoteToFirst: () =>
      act.mutate({ path: "/rank", body: { holdRank: 1 }, success: "Promoted to 1st hold" }),
    setAutoPromote: (next) =>
      act.mutate({
        path: "/auto-promote",
        body: { holdAutoPromote: next },
        success: next ? "This hold will move up on its own" : "This hold will keep its place",
      }),
    release: () => act.mutate({ path: "/release", success: "Hold released" }),
    confirmDate: () => act.mutate({ path: "/confirm", success: "Date confirmed" }),
    declineDate: () => act.mutate({ path: "/decline", success: "Date turned down" }),
  };
}
