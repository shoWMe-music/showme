import { getApiV1BookingRequests, getGetApiV1BookingRequestsQueryKey } from "@showme/api-client";
import { useMemo, useState } from "react";
import { dayKey } from "../components/calendarGrid";
import { MAX_PAGE_SIZE, infiniteKey, useCursorList } from "./useCursorList";

export type RequestItem = Awaited<ReturnType<typeof getApiV1BookingRequests>>["items"][number];

export type RequestDirection = "incoming" | "outgoing";

export interface RequestInbox {
  direction: RequestDirection;
  setDirection: (direction: RequestDirection) => void;
  /** The status chip: "all" or a `booking_requests.status` value. */
  filter: string;
  setFilter: (filter: string) => void;
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
 * does take `status`. But this screen reads the same list twice. The mini
 * calendar's marked dates, the "Requests by date" rail and the "N pending" badge
 * describe the inbox as a whole and must not move when a chip is clicked; only
 * the right-hand column narrows. Sending the chip to the server would answer the
 * column and blind the rail, so it would take a second, unfiltered query over the
 * very same rows. Filtering a complete list once is the honest, cheaper answer —
 * the bug this replaces was filtering an INCOMPLETE list.
 *
 * There is no server-side filter for the day selection at all (no `wantedDate`
 * query), which is the other reason the complete list has to be here.
 */
export function useRequestInbox(): RequestInbox {
  const [direction, setDirection] = useState<RequestDirection>("incoming");
  const [filter, setFilter] = useState("all");
  const [selectedDay, setSelectedDay] = useState<string | undefined>(undefined);
  const [month, setMonth] = useState(() => new Date());

  const params = { direction, limit: MAX_PAGE_SIZE } as const;
  const list = useCursorList<RequestItem>({
    queryKey: infiniteKey(getGetApiV1BookingRequestsQueryKey(params)),
    fetchPage: (cursor, signal) => getApiV1BookingRequests({ ...params, cursor }, signal),
    loadAllPages: true,
  });

  const requests = list.items;

  const markedDates = useMemo(
    () =>
      requests
        .filter((request) => request.wantedDate)
        .map((request) => dayKey(new Date(request.wantedDate as string))),
    [requests],
  );

  const visible = useMemo(
    () =>
      requests.filter((request) => {
        if (filter !== "all" && request.status !== filter) return false;
        if (
          selectedDay &&
          (!request.wantedDate || dayKey(new Date(request.wantedDate)) !== selectedDay)
        ) {
          return false;
        }
        return true;
      }),
    [requests, filter, selectedDay],
  );

  return {
    direction,
    setDirection,
    filter,
    setFilter,
    selectedDay,
    toggleDay: (day) => setSelectedDay((current) => (current === day ? undefined : day)),
    selectDay: setSelectedDay,
    month,
    moveMonth: (offset) =>
      setMonth((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1)),
    requests,
    visible,
    pendingCount: requests.filter((request) => request.status === "pending").length,
    markedDates,
    isPending: list.isPending,
    isError: list.isError,
    error: list.error,
    refetch: list.refetch,
  };
}
