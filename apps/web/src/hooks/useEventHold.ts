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
  /**
   * Whether this entry is ours to move. A pool for a real room is ONE queue
   * shared across operators, and nobody reorders a pencil they do not hold — so
   * a move across a `false` entry is refused by the server, not half-applied.
   */
  canReorder: boolean;
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
  /** The ranks this hold can ACTUALLY be moved to — see {@link takeableRanks}. */
  rankOptions: number[];
  /** 1st is a move this hold can make: not already there, and not a rival's. */
  canPromoteToFirst: boolean;
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

/**
 * The ranks this hold can actually be moved to.
 *
 * TAKING A RANK PUSHES THE HOLDS AT OR BELOW IT DOWN ONE, and a pool for a real
 * room is one queue shared across operators — so some of the rows a move would
 * push are not the caller's to push. `POST /hold/rank` refuses such a move
 * whole (409) rather than half-applying it, which means offering the rank at all
 * is the exact failure `capabilities[]` exists to end: a control whose click
 * comes back an error the operator can do nothing about.
 *
 * The intervals mirror `computeRankShift` in `@showme/shared`, which is the code
 * the server actually runs: a demotion to `rank` moves everything in
 * `(current, rank]`, a promotion moves everything in `[rank, current)`. Staying
 * put moves nothing, so the current rank always survives the filter and the
 * Select keeps a valid value.
 */
function takeableRanks(pool: HoldPoolEntry[], currentRank: number): number[] {
  const foreignRanks = pool.filter((entry) => !entry.canReorder).map((entry) => entry.holdRank);
  const ranks: number[] = [];
  for (let rank = 1; rank <= Math.max(pool.length, 1); rank++) {
    const wouldPush = foreignRanks.some((foreignRank) =>
      rank > currentRank
        ? foreignRank > currentRank && foreignRank <= rank
        : foreignRank >= rank && foreignRank < currentRank,
    );
    if (!wouldPush) ranks.push(rank);
  }
  return ranks;
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
  const rankOptions = takeableRanks(pool, holdRank ?? 1);

  return {
    isLoading: holdQuery.isPending,
    isHold: hold?.status === "on_hold",
    holdRank,
    holdAutoPromote: hold?.holdAutoPromote ?? false,
    pool,
    canManageRank: hold?.canManageRank ?? false,
    canDecide: hold?.canDecide ?? false,
    rankOptions,
    canPromoteToFirst: (holdRank ?? 1) !== 1 && rankOptions.includes(1),
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
