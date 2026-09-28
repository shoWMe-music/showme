import { getGetApiV1EventsDateConflictsQueryOptions } from "@showme/api-client";
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
import { useQueries } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import {
  DateText,
  MiniMonthCalendar,
  RequestCard,
  type RequestCardData,
  SegmentedToggle,
} from "../components";
import { EventInvitationsCard } from "../components/EventInvitationsCard";
import { RequestTriageDialogs } from "../components/RequestTriageDialogs";
import { SendOfferDialog } from "../components/SendOfferDialog";
import { dayKey } from "../components/calendarGrid";
import { Eyebrow } from "../components/primitives";
import { ErrorState, LoadingState } from "../components/states";
import { useRequestTriage } from "../components/useRequestTriage";
import { conflictMessage } from "../hooks/useDateConflicts";
import { useEventInvitations } from "../hooks/useEventInvitations";
import {
  type RequestItem,
  type RequestViewMode,
  UNREAD_FILTER,
  clashVenueFor,
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

/** The chip's own word for itself, lower-cased so it reads inside a sentence. */
function filterLabel(filter: string): string {
  return (FILTERS.find((option) => option.key === filter)?.label ?? filter).toLowerCase();
}

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

/**
 * IS THE NIGHT THIS REQUEST ASKS FOR ALREADY SOLD?
 *
 * One question per request that names both a venue and a night — which is what migration
 * `0047` made possible today. The same route and the same sentence the New Event wizard
 * uses (`useDateConflicts`), asked here because this is the other door onto the same act:
 * "Create Draft" puts a real event in a real room, and the QA sweep put two shows in Main
 * Room on one night through this flow without a word on screen (2026-09-27).
 *
 * Only PENDING requests are asked about. A declined or archived request is not a booking
 * anybody is about to make, and a clash warning on one is noise over a decision already
 * taken.
 */
function useRequestClashes(
  requests: RequestItem[],
  askAboutTheTarget: boolean,
): Map<string, string> {
  /*
   * Which venue each row asks about is `clashVenueFor` — including why the fallback to
   * `targetProfileId` is provably safe, and why the other direction must not ask at all
   * (QA sweep run 7, QA7-4). Without a room the question is whole-venue, the right answer
   * for a request that named none; the message already ends "You can book it anyway", so
   * it informs rather than blocks.
   */
  const askable = requests
    .map((request) => ({ request, venueProfileId: clashVenueFor(request, askAboutTheTarget) }))
    .filter(
      (row): row is { request: RequestItem; venueProfileId: string } => row.venueProfileId !== null,
    );

  const queries = useQueries({
    queries: askable.map(({ request, venueProfileId }) =>
      getGetApiV1EventsDateConflictsQueryOptions({
        venueProfileId,
        date: request.wantedDate,
        ...(request.stageId ? { stageId: request.stageId } : {}),
      }),
    ),
  });

  // Built each render rather than memoized: it is a handful of entries, and the Map
  // itself never leaves this function — the screen reads a string out of it per row, so
  // there is no identity for anything downstream to depend on.
  const clashes = new Map<string, string>();
  askable.forEach(({ request }, index) => {
    const data = queries[index]?.data;
    if (!data) return;
    const message = conflictMessage({
      roomIsBusy: data.roomIsBusy,
      events: data.events,
      blocks: data.unavailability,
      // No room in the request means the question was about the whole venue, and
      // "this room is still free" would answer one nobody asked (QA7-4).
      roomWasAsked: Boolean(request.stageId),
    });
    if (message) clashes.set(request.id, message);
  });
  return clashes;
}

function toCardData(request: RequestItem, clash?: string): RequestCardData {
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
    // The room the sender asked for, named by the API (`stageName`) rather than resolved
    // here: the room roster belongs to the venue, and the inbox should not have to fetch
    // one to read its own post.
    room: request.stageName ?? undefined,
    clash,
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
  /*
   * A TEAM-AND-CREW ACCOUNT HAS NO OFFER TO SEND (QA8-6).
   *
   * `story.md:61`: crew are *"not talent … an arm's-length service provider paid a fixed
   * fee"*, and the marketplace described there runs the other way — they apply to jobs
   * operators post, which is unbuilt. The API refuses the write; this stops the form being
   * drawn for an answer already known, which is the same rule QA7-15 applied to the team
   * invite dialog: a refusal the caller could have been told before they typed.
   */
  const canSendOffer = !isOperator && session?.kind !== "team_and_crew";
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
    hiddenByFilter,
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

  /**
   * EVENT INVITATIONS, IN THE SAME INBOX (ClickUp 86cbcehmp).
   *
   * Ran: a suggested event should *"arrive as requests in the incoming requests
   * ('Pending')"*, and once answered *"stays in the 'Accepted' tab ... until
   * Expired"*.
   *
   * They are NOT `booking_requests` rows and deliberately are not written as
   * any. A booking request is an enquiry coming TOWARD a venue; this is an
   * operator offering a night to an act, and the record of it is already the
   * `event_participants` row. Mirroring that into a second table would be the
   * fan-out this rebuild exists to delete (CLAUDE.md, core architecture #1):
   * two rows for one fact, free to disagree the moment somebody answers.
   *
   * So they are merged HERE, at read time. The inbox loads every page and
   * filters client-side, so sharing its `filter` and `selectedDay` state is all
   * it takes for the tabs to work on both kinds at once.
   */
  // Asked over the WHOLE inbox rather than the filtered view, so switching tabs does not
  // re-ask a question already answered — the answers are keyed by request id.
  // Only an operator reading their INCOMING inbox is being asked about their own rooms —
  // see `useRequestClashes` for why the other direction must not ask at all.
  const clashes = useRequestClashes(requests, isOperator && direction === "incoming");

  const invitations = useEventInvitations();
  const visibleInvitations = useMemo(
    () =>
      invitations.all.filter((invitation) => {
        // "Unread" is a booking-request notion — somebody's team has or has not
        // opened the row. An invitation addressed to you personally has no such
        // state, so it stays out of that bucket rather than claiming a false one.
        if (filter === UNREAD_FILTER) return false;
        if (filter !== "all" && invitation.requestStatus !== filter) return false;
        if (selectedDay && invitation.eventDate !== selectedDay) return false;
        return true;
      }),
    [invitations.all, filter, selectedDay],
  );

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
  /** Whether the offer composer is open — see `SendOfferDialog` (QA7-5). */
  const [composing, setComposing] = useState(false);
  const chipOrder = chips.map((option) => option.key);

  return (
    <>
      <SendOfferDialog
        open={composing}
        onClose={() => setComposing(false)}
        onSent={() => {
          // The new offer belongs in the Outgoing list, so land the sender on it rather
          // than leaving them looking at the tab they were on.
          setDirection("outgoing");
          void refetch();
        }}
      />
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
            {/*
              SENDING AN OFFER, which had no control anywhere in the app (QA sweep run 7,
              QA7-5). `POST /offers` and its generated hook have existed all along; the
              only producer of a booking request in the codebase was the marketing site's
              UNAUTHENTICATED public form, so this tab listed seeded rows no user of this
              build could make.

              Not offered to an operator: they receive offers and answer them, and the
              outbound move that is theirs — a suggested event — is the Events screen's
              (`event_participants`, not a booking request). The direction toggle above is
              hidden from them for the same reason.
            */}
            {canSendOffer && (
              <Button
                variant="primary"
                leftIcon={<Icon name="mail" size={14} />}
                onClick={() => setComposing(true)}
              >
                Send an offer
              </Button>
            )}
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
              {visibleInvitations.length > 0 && (
                <EventInvitationsCard
                  invitations={visibleInvitations}
                  answering={invitations.answering}
                  onAccept={invitations.accept}
                  onDecline={invitations.decline}
                  heading={
                    visibleInvitations.length === 1
                      ? "1 event invitation"
                      : `${visibleInvitations.length} event invitations`
                  }
                  // Only an unanswered one can still be answered. On the other
                  // tabs the row is a record, and a button that would 409 is
                  // worse than no button.
                  actionable={filter === "pending"}
                />
              )}
              {visible.length === 0 && visibleInvitations.length === 0 ? (
                <Card padding="lg">
                  <div style={{ textAlign: "center", color: "var(--muted)", padding: "24px 0" }}>
                    <Icon name="inbox" size={28} />
                    {/* THE RAIL OFFERED THIS DAY; THE CHIP IS HIDING IT (r2:758).
                        The "Requests by date" rail describes the whole inbox on
                        purpose, so it can legitimately offer a day whose only
                        request the current chip filters out — and "No requests
                        match this view" left the reader with no way to work that
                        out. Naming the count and carrying the way out is the
                        difference between an empty state and a dead end. */}
                    {hiddenByFilter > 0 ? (
                      <>
                        <p style={{ marginTop: 10 }}>
                          {hiddenByFilter === 1
                            ? "The one request on this day is not "
                            : `All ${hiddenByFilter} requests on this day are not `}
                          {filterLabel(filter)}.
                        </p>
                        <Button variant="secondary" onClick={() => setFilter("all")}>
                          Show every status on this day
                        </Button>
                      </>
                    ) : (
                      <p style={{ marginTop: 10 }}>No requests match this view.</p>
                    )}
                  </div>
                </Card>
              ) : (
                visible.map((request) => (
                  <RequestCard
                    key={request.id}
                    request={toCardData(request, clashes.get(request.id))}
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
