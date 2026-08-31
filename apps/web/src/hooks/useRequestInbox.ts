import {
  getApiV1BookingRequests,
  getGetApiV1BookingRequestsQueryKey,
  usePostApiV1BookingRequestsRead,
} from "@showme/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { dayKey } from "../components/calendarGrid";
import { type CardExpansion, useCardExpansion } from "./useCardExpansion";
import { MAX_PAGE_SIZE, infiniteKey, useCursorList } from "./useCursorList";

export type RequestItem = Awaited<ReturnType<typeof getApiV1BookingRequests>>["items"][number];

export type RequestDirection = "incoming" | "outgoing";

/** How the inbox is drawn: one considered card per request, or a dense list. */
export type RequestViewMode = "cards" | "list";

/** The status-chip key that is not a status. See `FILTERS` in the screen. */
export const UNREAD_FILTER = "unread";

/**
 * Has nobody on the recipient's side opened this yet?
 *
 * `readAt` is ABSENT on an outgoing row — not null — because whether a venue has
 * opened your offer is the venue's business (`routes/inbound.ts` says so at
 * length). `=== null` is therefore the exact test: it is true only for a row in
 * MY inbox that carries the field and has never been stamped, and false for a
 * sent offer, which has no read state to report.
 */
export function isUnread(request: RequestItem): boolean {
  return request.readAt === null;
}

export interface RequestInbox {
  direction: RequestDirection;
  setDirection: (direction: RequestDirection) => void;
  /** The status chip: "all", `UNREAD_FILTER`, or a `booking_requests.status` value. */
  filter: string;
  setFilter: (filter: string) => void;
  view: RequestViewMode;
  setView: (view: RequestViewMode) => void;
  /** Which requests are open, per view — see `expansionKey`. */
  expansion: CardExpansion;
  /** The expansion id for a request in the CURRENT view. */
  expansionKey: (requestId: string) => string;
  selectedDay: string | undefined;
  toggleDay: (day: string) => void;
  selectDay: (day: string) => void;
  month: Date;
  moveMonth: (offset: number) => void;
  /** The whole inbox for this direction — what the calendar and badge count. */
  requests: RequestItem[];
  /** The inbox narrowed by the status chip and the selected day. */
  visible: RequestItem[];
  pendingCount: number;
  /** Requests nobody on this side has opened. Always 0 on the outgoing view. */
  unreadCount: number;
  /** Stamp (or clear) the read mark on some requests; no ids means all of them. */
  setRead: (options: { ids?: string[]; read: boolean }) => void;
  isSettingRead: boolean;
  markedDates: string[];
  isPending: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
}

/**
 * The Requests screen's data.
 *
 * `direction` is answered by the server (incoming = requests targeting one of my
 * profiles, outgoing = ones I sent), and the keyset cursor is drained so the
 * screen holds the WHOLE inbox rather than page one.
 *
 * The status chip and the calendar's day selection are then applied here, in the
 * browser — deliberately, and not for want of a contract: `GET /booking-requests`
 * does take `status` (and `unread`). But this screen reads the same list twice.
 * The mini calendar's marked dates, the "Requests by date" rail and the "N
 * pending" / "N unread" counts describe the inbox as a whole and must not move
 * when a chip is clicked; only the right-hand column narrows. Sending the chip to
 * the server would answer the column and blind the rail, so it would take a
 * second, unfiltered query over the very same rows. Filtering a complete list
 * once is the honest, cheaper answer — the bug this replaces was filtering an
 * INCOMPLETE list.
 *
 * There is no server-side filter for the day selection at all (no `wantedDate`
 * query), which is the other reason the complete list has to be here.
 */
export function useRequestInbox(): RequestInbox {
  const [direction, setDirectionState] = useState<RequestDirection>("incoming");
  /**
   * PENDING, not "all" (Ran, 2026-08-31). An inbox opens on the work: "all" led
   * with whatever the seed happened to hold — declined, archived, expired rows a
   * reader has already dealt with — and made them look like the job. The chip
   * list leads with Pending to match, so the panel's resting position is the
   * leftmost one and every other bucket is a step forward from it.
   */
  const [filter, setFilter] = useState("pending");
  const [view, setView] = useState<RequestViewMode>("cards");
  const [selectedDay, setSelectedDay] = useState<string | undefined>(undefined);
  const [month, setMonth] = useState(() => new Date());

  const params = { direction, limit: MAX_PAGE_SIZE } as const;
  const list = useCursorList<RequestItem>({
    queryKey: infiniteKey(getGetApiV1BookingRequestsQueryKey(params)),
    fetchPage: (cursor, signal) => getApiV1BookingRequests({ ...params, cursor }, signal),
    loadAllPages: true,
  });

  const requests = list.items;

  /**
   * Open cards in the card view, closed rows in the list view — and the two are
   * remembered SEPARATELY, because they are different readings of the same row.
   * Prefixing the id is all it takes: `useCardExpansion` never interprets one,
   * and answers the default once per id it is asked about.
   */
  const expansionKey = useCallback((requestId: string) => `${view}:${requestId}`, [view]);
  const expansion = useCardExpansion({
    storageKey: "showme:request-card-expansion",
    defaultExpanded: view === "cards",
  });

  const queryClient = useQueryClient();
  /**
   * Read state is not a status, so nothing here touches the triage path. The
   * invalidation is by PREFIX — the shell's sidebar badge reads
   * `GET /booking-requests?unread=true` under its own query key, and a screen
   * that cleared the mark without clearing the badge would be the worse half of
   * the feature.
   */
  const markRead = usePostApiV1BookingRequestsRead({
    mutation: {
      onSuccess: () =>
        queryClient.invalidateQueries({ queryKey: getGetApiV1BookingRequestsQueryKey() }),
    },
  });

  const setRead = useCallback(
    ({ ids, read }: { ids?: string[]; read: boolean }) => {
      markRead.mutate({ data: { ...(ids ? { ids } : {}), read } });
    },
    [markRead],
  );

  const markedDates = useMemo(
    () =>
      requests
        .filter((request) => request.wantedDate)
        .map((request) => dayKey(new Date(request.wantedDate))),
    [requests],
  );

  const visible = useMemo(
    () =>
      requests.filter((request) => {
        if (filter === UNREAD_FILTER) {
          if (!isUnread(request)) return false;
        } else if (filter !== "all" && request.status !== filter) {
          return false;
        }
        if (selectedDay && dayKey(new Date(request.wantedDate)) !== selectedDay) return false;
        return true;
      }),
    [requests, filter, selectedDay],
  );

  /**
   * Switching to the sent view has to drop an unread filter with it: read state
   * belongs to the recipient, so "unread" over sent offers is not a narrower
   * answer, it is a meaningless one — and the server refuses the same question
   * (`?direction=outgoing&unread=true` is a 400).
   */
  const setDirection = useCallback((next: RequestDirection) => {
    setDirectionState(next);
    if (next === "outgoing") setFilter((current) => (current === UNREAD_FILTER ? "all" : current));
  }, []);

  return {
    direction,
    setDirection,
    filter,
    setFilter,
    view,
    setView,
    expansion,
    expansionKey,
    selectedDay,
    toggleDay: (day) => setSelectedDay((current) => (current === day ? undefined : day)),
    selectDay: setSelectedDay,
    month,
    moveMonth: (offset) =>
      setMonth((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1)),
    requests,
    visible,
    pendingCount: requests.filter((request) => request.status === "pending").length,
    unreadCount: requests.filter(isUnread).length,
    setRead,
    isSettingRead: markRead.isPending,
    markedDates,
    isPending: list.isPending,
    isError: list.isError,
    error: list.error,
    refetch: list.refetch,
  };
}
