import { getApiV1Events, getGetApiV1EventsQueryKey } from "@showme/api-client";
import { useState } from "react";
import { type CursorList, infiniteKey, useCursorList } from "./useCursorList";

export type EventItem = Awaited<ReturnType<typeof getApiV1Events>>["items"][number];

export type EventFilterKey = "all" | "pending" | "on_hold" | "concluded" | "draft" | "archived";
export type EventView = "list" | "board";

/** The `events.status` values the list filters on (mirrors the API's enum). */
type EventStatus =
  | "draft"
  | "suggested"
  | "pending"
  | "confirmed"
  | "on_hold"
  | "concluded"
  | "cancelled";

/**
 * A filter chip is a question about the WHOLE list, so each one maps to the
 * status(es) the server should answer for — nothing is filtered in the browser.
 *
 * "Pending" means an event awaiting a response, which is two row values:
 * `pending` and `suggested` (an offer nobody has answered yet). That is why the
 * API's `status` query takes a list — one chip stays one query.
 */
const CHIP_STATUSES: Record<EventFilterKey, readonly EventStatus[]> = {
  all: [],
  pending: ["pending", "suggested"],
  on_hold: ["on_hold"],
  concluded: ["concluded"],
  draft: ["draft"],
  // "Archived" is the one chip that asks a question about the READER rather than
  // about the booking, so it selects no status at all — see `ARCHIVED_CHIP`.
  archived: [],
};

/**
 * The chip that shows what the reader has FILED AWAY.
 *
 * It sits in the same row as the status chips and behaves like one, but it is a
 * different kind of question. A status says where the booking got to; archiving
 * says whether this profile still wants to look at it
 * (`event_participants.archived_at`) — which is why it could not be one more
 * value in the `status` list, and why it travels as its own `archived=only`
 * parameter. Every other chip leaves `archived` unset, so the server's default
 * (`exclude`) keeps filed-away events out of the everyday views.
 *
 * It exists at all because the alternative is a feature that hides things with
 * no way back, which is a delete that lies about itself.
 */
const ARCHIVED_CHIP: EventFilterKey = "archived";

const PAGE_SIZE = 20;

type EventsQuery = NonNullable<Parameters<typeof getApiV1Events>[0]>;

export interface EventListView extends CursorList<EventItem> {
  filter: EventFilterKey;
  setFilter: (filter: EventFilterKey) => void;
  view: EventView;
  setView: (view: EventView) => void;
}

/**
 * The chip the reader pressed, as a query the server can answer.
 *
 * Lifted out of the hook so it can be ASSERTED. It is the whole of the screen's
 * filtering logic — nothing is filtered in the browser — and every part of it is a
 * rule that reads as arbitrary from the call site: that "Pending" is two statuses,
 * that "Archived" sends no status at all, that "All" sends neither parameter. A
 * wrong answer here does not throw; it renders a shorter list, which looks exactly
 * like a correct list of a customer with fewer shows.
 */
export function eventListQuery(filter: EventFilterKey): EventsQuery {
  const statuses = CHIP_STATUSES[filter];
  return {
    limit: PAGE_SIZE,
    // `GET /events?status=` takes a LIST — the "Pending" chip is pending ∪ suggested,
    // and the fetch mutator stringifies the array to `status=pending,suggested`.
    status: statuses.length > 0 ? [...statuses] : undefined,
    archived: filter === ARCHIVED_CHIP ? "only" : undefined,
  };
}

/**
 * The Events screen's data: server-side status filtering over the keyset-paginated
 * list. The List view pages on demand ("Load more"); the Board view drains the
 * cursor, because its columns show counts and a count over page one is a lie.
 */
export function useEventList(): EventListView {
  const [filter, setFilter] = useState<EventFilterKey>("all");
  const [view, setView] = useState<EventView>("list");

  const params = eventListQuery(filter);

  const list = useCursorList<EventItem>({
    queryKey: infiniteKey(getGetApiV1EventsQueryKey(params)),
    fetchPage: (cursor, signal) => getApiV1Events({ ...params, cursor }, signal),
    loadAllPages: view === "board",
  });

  return { ...list, filter, setFilter, view, setView };
}

/**
 * Every event the caller can reach, all pages of it — for the screens that read
 * the list as a whole (calendar grid, reports, projections) rather than as a page
 * of rows. Those screens were silently showing the first 20 events.
 */
export function useAllEvents(): CursorList<EventItem> {
  const params: EventsQuery = { limit: 100 };
  return useCursorList<EventItem>({
    queryKey: infiniteKey(getGetApiV1EventsQueryKey(params)),
    fetchPage: (cursor, signal) => getApiV1Events({ ...params, cursor }, signal),
    loadAllPages: true,
  });
}
