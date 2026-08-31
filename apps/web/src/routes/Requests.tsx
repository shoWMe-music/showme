import {
  Badge,
  Button,
  Card,
  Chip,
  Icon,
  SectionHeader,
  type Status,
  TabPanels,
  useToast,
} from "@showme/design-system";
import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "../auth/AuthProvider";
import {
  DateText,
  MiniMonthCalendar,
  RequestCard,
  type RequestCardData,
  SegmentedToggle,
} from "../components";
import { RequestTriageDialogs } from "../components/RequestTriageDialogs";
import { dayKey } from "../components/calendarGrid";
import { Eyebrow } from "../components/primitives";
import { ErrorState, LoadingState } from "../components/states";
import { useRequestTriage } from "../components/useRequestTriage";
import {
  type RequestItem,
  type RequestViewMode,
  UNREAD_FILTER,
  isUnread,
  useRequestInbox,
} from "../hooks/useRequestInbox";
import { formatAmount, formatDay, formatMoney, relativeTime } from "../lib/format";
import styles from "./Requests.module.css";

/** Booking-request status → design-system status vocabulary + a display label. */
const REQUEST_STATUS: Record<string, { status: Status; label: string }> = {
  pending: { status: "pending", label: "Pending" },
  accepted: { status: "confirmed", label: "Accepted" },
  declined: { status: "cancelled", label: "Declined" },
  flagged: { status: "cancelled", label: "Flagged" },
  archived: { status: "draft", label: "Archived" },
  expired: { status: "draft", label: "Expired" },
};

/**
 * The filter chips (main column), in shot order. They narrow the right column
 * only — the calendar, the date rail and the "N pending" badge always describe
 * the whole inbox, which is why `useRequestInbox` holds all of it.
 *
 * PENDING LEADS, because it is the default (Ran, 2026-08-31) and because the
 * chip order is also the panel's motion order: the bucket the screen opens on
 * has to be the leftmost one, or the first click a reader ever makes scoots the
 * list backwards. "All" sits beside it as the escape hatch, and the settled
 * buckets keep their lifecycle order behind the two.
 *
 * UNREAD IS A BUCKET, NOT A SECOND AXIS. It could have been an independent
 * toggle crossed with the status — "unread AND declined" is a legal question —
 * but the chips are a single-select set and adding a second kind of chip to the
 * same row teaches nothing except that some of them behave differently. One
 * axis, and unread reads as what it is: the part of the inbox nobody has looked
 * at yet. It exists on the incoming view only; see `Requests` below.
 */
const FILTERS: { key: string; label: string }[] = [
  { key: "pending", label: "Pending" },
  { key: UNREAD_FILTER, label: "Unread" },
  { key: "all", label: "All" },
  { key: "accepted", label: "Accepted" },
  { key: "declined", label: "Declined" },
  { key: "flagged", label: "Flagged" },
  { key: "archived", label: "Archived" },
  { key: "expired", label: "Expired" },
];

/** The two layouts, on the toggle `Contacts` already uses for exactly this. */
const VIEW_OPTIONS: { value: RequestViewMode; label: string }[] = [
  { value: "cards", label: "Cards" },
  { value: "list", label: "List" },
];

/**
 * A request is triaged once. `pending` is the live case; `accepted` still allows
 * work (a draft, an offer) because saying yes is not the same as having planned
 * the show. The rest are settled, and the only honest action left is undoing them.
 */
const TRIAGEABLE_STATUSES = new Set(["pending", "accepted"]);
const RESTORABLE_STATUSES = new Set(["declined", "archived", "flagged"]);

function initials(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  const first = parts[0];
  if (!first) return "?";
  const last = parts[parts.length - 1];
  if (parts.length === 1 || !last) return first.slice(0, 2).toUpperCase();
  return ((first[0] ?? "") + (last[0] ?? "")).toUpperCase();
}

/**
 * The ACT being offered — the represented performer first, never the agency. An
 * agent's offer carries the performer it is FOR (audit A-24), so the inbox names
 * the act and credits the agency on the line beneath it.
 */
function requesterName(request: RequestItem): string {
  return request.onBehalfOfName ?? request.artistName ?? request.contactName ?? "Unknown requester";
}

/**
 * The sub-line under the act: who actually sent it, and when. An agent's offer
 * reads "via Astra Bookings" so the venue can tell a self-booked act from a
 * represented one at a glance.
 */
function contactLine(request: RequestItem): string | undefined {
  const sentBy = request.onBehalfOfProfileId
    ? request.contactName
      ? `via ${request.contactName}`
      : "via an agency"
    : request.contactName;
  const parts = [sentBy, relativeTime(request.createdAt)].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

/**
 * A request's fee, in the currency stamped on the row — the target venue's, since
 * currency follows venue location (decisions.md #17). Public-form senders state a
 * single `artistFee`; performers and agents offer an `offerFeeMin`/`Max` range, so
 * reading only one of the two shows "Fee TBD" for half the inbox. When no currency
 * was stamped (venue country unknown) the amount is shown bare rather than under a
 * guessed symbol.
 */
function formatFee(request: RequestItem): string {
  const asMoney = (value: string) =>
    request.currency ? formatMoney(value, request.currency) : formatAmount(value);
  if (request.offerFeeMin && request.offerFeeMax && request.offerFeeMax !== request.offerFeeMin) {
    return `${asMoney(request.offerFeeMin)} – ${asMoney(request.offerFeeMax)}`;
  }
  const single = request.offerFeeMin ?? request.artistFee;
  return single ? asMoney(single) : "Fee TBD";
}

function toCardData(request: RequestItem): RequestCardData {
  const requester = requesterName(request);
  const meta = REQUEST_STATUS[request.status] ?? {
    status: "draft" as Status,
    label: request.status,
  };
  return {
    id: request.id,
    requester,
    initials: initials(requester),
    tone: "purple",
    contactLine: contactLine(request),
    status: meta.status,
    statusLabel: meta.label,
    wantedDate: formatDay(request.wantedDate),
    // The raw key travels with the label: the label is for the reader, the key
    // is what `POST /booking-requests/:id/draft-event` takes back as `eventDate`.
    alternateDates: request.additionalDates.map((date) => ({
      key: date,
      label: formatDay(date),
    })),
    source: request.source
      ? request.source.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())
      : "—",
    fee: formatFee(request),
    email: request.email ?? undefined,
    message: request.pitch ?? undefined,
    draftEventId: request.eventId ?? undefined,
    // `undefined`, not `false`, where the row carries no read state at all — a
    // sent offer never discloses whether the venue opened it, so the card must
    // render no read control rather than an honest-looking "read" one.
    unread: request.readAt === undefined ? undefined : isUnread(request),
    canTriage: TRIAGEABLE_STATUSES.has(request.status),
    canRestore: RESTORABLE_STATUSES.has(request.status),
  };
}

export function Requests() {
  const toast = useToast();
  const { session } = useAuth();
  /**
   * An OPERATOR is approached; they do not tout.
   *
   * story.md gives the operator (venue / promoter / organizer / festival) as the
   * party who receives interest and decides on it — the offer comes from the act
   * or their agent, and the operator answers it, counter-offers on it, or turns
   * it down. "Outgoing" is a performer's and an agent's view of the world, and on
   * an operator account it was a permanently empty screen with a toggle
   * advertising it.
   *
   * Note this hides a VIEW, never a rule: the server still answers
   * `direction=outgoing` for anyone who asks, so nothing here is a permission.
   */
  const isOperator = session?.kind === "operator";
  // Incoming = requests targeting me; Outgoing = offers/requests I have sent
  // (fix-list #6) — answered by the server, over every page of the inbox.
  const {
    direction,
    setDirection,
    filter,
    setFilter,
    view,
    setView,
    expansion,
    expansionKey,
    selectedDay,
    toggleDay,
    selectDay,
    month,
    moveMonth,
    requests,
    visible,
    pendingCount,
    unreadCount,
    setRead,
    isSettingRead,
    markedDates,
    isPending,
    isError,
    error,
    refetch,
  } = useRequestInbox();

  // Hiding the control is not enough: `direction` is the inbox hook's state and
  // survives navigation, so an operator who reached `outgoing` before this
  // change — or through a stale link — would sit on a permanently empty screen
  // with nothing on the page able to move them off it.
  useEffect(() => {
    if (isOperator && direction !== "incoming") setDirection("incoming");
  }, [isOperator, direction, setDirection]);

  const navigate = useNavigate();
  const triage = useRequestTriage({
    requests,
    refetch,
    onSuccess: (message) => toast.success(message),
  });

  // Triage belongs to the RECIPIENT of a request. On the outgoing view these are
  // offers this user SENT, so declining or blocking them is meaningless (Block
  // would flag your own request as spam). Passing no handlers makes RequestCard
  // render no action bar, which is the honest state until a withdraw flow exists.
  const triageActions =
    direction === "incoming"
      ? {
          ...triage.handlers,
          onOpenDraftEvent: (eventId: string) =>
            navigate({ to: "/events/$eventId", params: { eventId } }),
          /**
           * Choosing one of the sender's alternate nights is not a fifth triage
           * action — it is "Create Draft", started on a different date. The API
           * takes it (`POST /booking-requests/:id/draft-event` accepts
           * `eventDate`), so the dialog opens pre-filled on the night that was
           * picked and the operator still confirms it.
           */
          onUseAlternateDate: (id: string, date: string) => triage.handlers.onCreateDraft(id, date),
          onSetRead: (id: string, read: boolean) => setRead({ ids: [id], read }),
        }
      : {};

  /**
   * READ IS AN EXPLICIT ACT HERE, and deliberately not the inbox convention.
   *
   * Two reasons, and the first is structural: this screen has no "open". In the
   * card view every request is already rendered in full, side by side — there is
   * no detail pane to enter — so "mark on open" could only mean "mark everything
   * the moment you land on /requests", which clears the whole inbox for the act
   * of looking at it. The list view does have a disclosure to hang it on, but a
   * rule that fires in one layout and not in the other is a rule nobody can
   * predict, and it would quietly make the layout switch destructive.
   *
   * The second is what a request IS. A notification is news, and news is read
   * once; a booking request is a decision somebody still owes an answer to, and
   * the unread mark is the only to-do list they have for it. Silently clearing
   * it is how "I'll deal with that on Monday" becomes a lost booking.
   *
   * So: a control per request, and "Mark all read" for the sweep — the same two
   * moves, and the same words, as the notification bell, so the app has one
   * vocabulary for this rather than two.
   */
  const markAllRead = () => setRead({ read: true });

  // Read state belongs to the recipient, so the sent view has no unread bucket
  // to offer. Dropping the chip also drops it from the panel's motion order,
  // which is the same list by construction rather than a second one to keep
  // in step.
  const chips =
    direction === "incoming" ? FILTERS : FILTERS.filter((option) => option.key !== UNREAD_FILTER);
  const chipOrder = chips.map((option) => option.key);

  return (
    <>
      <SectionHeader
        eyebrow={direction === "outgoing" ? "Outbound" : "Inbound"}
        title={direction === "outgoing" ? "Outgoing Requests" : "Incoming Requests"}
        subtitle={
          direction === "outgoing"
            ? "Offers and requests you have sent, and where they stand."
            : "Manage booking requests from artists, agents, and venues."
        }
        actions={
          // A fragment, not a row: `SectionHeader` already lays its actions out
          // in a flex row that WRAPS. A second row inside it is one unbreakable
          // child, which is what pushes a phone sideways instead of dropping
          // onto a second line (the same trap `Contacts` records).
          <>
            {!isOperator && (
              <SegmentedToggle
                aria-label="Request direction"
                value={direction}
                onChange={setDirection}
                options={[
                  { value: "incoming", label: "Incoming" },
                  { value: "outgoing", label: "Outgoing" },
                ]}
              />
            )}
            <SegmentedToggle<RequestViewMode>
              aria-label="Layout"
              value={view}
              onChange={setView}
              options={VIEW_OPTIONS}
            />
            {direction === "incoming" && unreadCount > 0 && (
              <Button variant="ghost" onClick={markAllRead} disabled={isSettingRead}>
                Mark all read
              </Button>
            )}
            {pendingCount > 0 ? (
              <Badge status="pending" dot>
                {pendingCount} pending
              </Badge>
            ) : null}
          </>
        }
      />

      {isPending ? (
        <LoadingState label="Loading requests" />
      ) : isError ? (
        <ErrorState error={error} title="Couldn't load requests" />
      ) : (
        <div className={styles.layout}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
            <MiniMonthCalendar
              month={month}
              markedDates={markedDates}
              selected={selectedDay}
              onSelect={toggleDay}
              onNavigate={moveMonth}
            />
            <RequestsByDate requests={requests} selectedDay={selectedDay} onSelectDay={selectDay} />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
              {selectedDay && (
                <DateText
                  value={selectedDay}
                  weekday
                  style={{ fontFamily: "var(--font-display)", fontSize: 16, marginRight: 8 }}
                />
              )}
              {chips.map((option) => (
                <Chip
                  key={option.key}
                  active={filter === option.key}
                  onClick={() => setFilter(option.key)}
                >
                  {option.key === UNREAD_FILTER && unreadCount > 0
                    ? `${option.label} ${unreadCount}`
                    : option.label}
                </Chip>
              ))}
            </div>

            {/* The bucket chips are tabs in everything but name, so the list
                scoots the way a tab panel does instead of swapping under the
                cursor. `order` is FILTERS, so moving right pulls the next
                bucket in from the right. The empty state travels with it —
                changing filter and landing on "nothing here" is the case where
                the motion is doing the most work, because otherwise the screen
                simply blanks. */}
            <TabPanels
              activeKey={filter}
              order={chipOrder}
              // The wrapper owns the spacing now. The parent column's gap used to
              // separate the cards; once they moved inside one child it separated
              // nothing, and the list rendered flush. Same 16 as everywhere else on
              // the page — a request card is a distinct decision to make, not a row
              // in a table.
              style={{ display: "flex", flexDirection: "column", gap: 16 }}
            >
              {visible.length === 0 ? (
                <Card padding="lg">
                  <div style={{ textAlign: "center", color: "var(--muted)", padding: "24px 0" }}>
                    <Icon name="inbox" size={28} />
                    <p style={{ marginTop: 10 }}>No requests match this view.</p>
                  </div>
                </Card>
              ) : (
                visible.map((request) => (
                  <RequestCard
                    key={request.id}
                    request={toCardData(request)}
                    layout={view === "list" ? "row" : "card"}
                    expanded={expansion.isExpanded(expansionKey(request.id))}
                    onToggleExpanded={(id) => expansion.toggle(expansionKey(id))}
                    {...triageActions}
                  />
                ))
              )}
            </TabPanels>
          </div>
        </div>
      )}

      <RequestTriageDialogs triage={triage} onOpenEvents={() => navigate({ to: "/events" })} />
    </>
  );
}

/** Left-rail "Requests by date" list, grouped Earlier / Selected day / Later. */
function RequestsByDate({
  requests,
  selectedDay,
  onSelectDay,
}: {
  requests: RequestItem[];
  selectedDay?: string;
  onSelectDay: (day: string) => void;
}) {
  const dated = requests
    .filter((request) => request.wantedDate)
    .slice()
    .sort((a, b) => Date.parse(a.wantedDate as string) - Date.parse(b.wantedDate as string));

  if (dated.length === 0) {
    return (
      <Card padding="md">
        <Eyebrow>Requests by date</Eyebrow>
        <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 8 }}>No dated requests yet.</p>
      </Card>
    );
  }

  const earlier: RequestItem[] = [];
  const onSelected: RequestItem[] = [];
  const later: RequestItem[] = [];
  for (const request of dated) {
    const key = dayKey(new Date(request.wantedDate as string));
    if (selectedDay && key === selectedDay) onSelected.push(request);
    else if (selectedDay && key < selectedDay) earlier.push(request);
    else later.push(request);
  }
  const groups: { key: string; label: string; items: RequestItem[] }[] = [
    { key: "earlier", label: "Earlier", items: earlier },
    { key: "selected", label: "Selected day", items: onSelected },
    { key: "later", label: "Later", items: later },
  ];

  return (
    <Card padding="md" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Eyebrow>Requests by date</Eyebrow>
      {groups
        .filter((group) => group.items.length > 0)
        .map((group) => (
          <div key={group.key} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {selectedDay && (
              <span style={{ fontSize: 11, color: "var(--dim)", textTransform: "uppercase" }}>
                {group.label}
              </span>
            )}
            {group.items.map((request) => {
              const key = dayKey(new Date(request.wantedDate as string));
              return (
                <button
                  key={request.id}
                  type="button"
                  onClick={() => onSelectDay(key)}
                  // Touch: these rows are 28px tall and stacked 6px apart, so a
                  // 44px halo on one would cover 8px of the row above and jump
                  // the reader to the wrong date. Growing the row itself is
                  // both safe and what a list of dates wants on a phone.
                  className="touch-target"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "6px 8px",
                    borderRadius: 8,
                    border: "none",
                    background: key === selectedDay ? "var(--shape-fill)" : "transparent",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 12,
                      color: "var(--muted)",
                      minWidth: 96,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {formatDay(request.wantedDate)}
                  </span>
                  <span style={{ color: "var(--text)", fontSize: 13 }}>
                    {requesterName(request)}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
    </Card>
  );
}
