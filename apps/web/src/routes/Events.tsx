import {
  Avatar,
  Button,
  EmptyState,
  Icon,
  SearchInput,
  StatusDot,
  TabPanels,
} from "@showme/design-system";
import { useNavigate } from "@tanstack/react-router";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { CountryTag } from "../components/CountryTag";
import { DateText } from "../components/DateText";
import { EventCancelModal } from "../components/EventCancelModal";
import { EventInvitationsCard } from "../components/EventInvitationsCard";
import { type EventMenuItem, EventRowMenu, rowClickTargetStyle } from "../components/EventRowMenu";
import { GradientButton } from "../components/eventUi";
import ledgerTable from "../components/ledgerTable.module.css";
import { initialsOf, settlementStatusToDisplay } from "../components/settlementDocument";
import { ErrorState, LoadMore, LoadingState } from "../components/states";
import { useEventInvitations } from "../hooks/useEventInvitations";
import { type EventFilterKey, type EventItem, useEventList } from "../hooks/useEventList";
import { useEventRowActions } from "../hooks/useEventRowActions";
import { useEventsViewMotion } from "../hooks/useEventsViewMotion";
import { useNewEvent } from "../shell/NewEventProvider";
import styles from "./Events.module.css";

/** The filter pill row (left of the view toggle). Each chip is answered by the
 * server (`useEventList` maps it to the status list `GET /events` filters on), so
 * a chip filters every event the caller has — not the page that happens to be
 * loaded. "Pending" still folds in offers awaiting a response (suggested). */
const FILTER_CHIPS: [value: EventFilterKey, label: string][] = [
  ["all", "All"],
  ["pending", "Pending"],
  // In the ladder's own order: an answered offer becomes `confirmed`, which is the
  // rung after `pending` (ClickUp `123qy9rpdup`).
  ["confirmed", "Confirmed"],
  ["on_hold", "On hold"],
  ["concluded", "Concluded"],
  // Beside `concluded` because both are end states — a night that happened and a
  // night that will not. Before `draft`, which is where a booking starts.
  ["cancelled", "Cancelled"],
  ["draft", "Draft"],
  // The shelf. Every other chip asks about the BOOKING; this one asks what this
  // profile has filed away (`archived=only`). It sits last because it is where
  // things go, not a stage they pass through — and it exists because a feature
  // that hides events with no way back is a delete that lies about itself.
  ["archived", "Archived"],
];

/** The chips in display order — what tells the panel which way to scoot when the
 * reader moves between them. Same contract as the Requests page's buckets. */
const FILTER_ORDER = FILTER_CHIPS.map(([value]) => value);

/** Board view = four fixed columns, in this order and colour (prototype boardDefs). */
const BOARD_DEFS: [status: string, label: string, color: string][] = [
  ["pending", "Pending", "#F4A046"],
  ["on_hold", "On hold", "#FFC266"],
  ["confirmed", "Confirmed", "#6FC97A"],
  ["concluded", "Concluded", "#B8A99B"],
];

/** The last track is the overflow menu's — fixed, because it holds one 28px
 * button and must not steal width from the columns that carry information.
 *
 * EVERY OTHER TRACK IS `minmax(0, Nfr)`, NOT `Nfr`. A bare `1fr` is
 * `minmax(auto, 1fr)`: the column refuses to go below its content's min-content
 * width and takes the difference out of the table rather than out of the word.
 * The card around this grid is `overflow: hidden`, so what that widening
 * produced was not a scrollbar but a silently amputated last column — measured
 * at 390px, 375px of row inside a 360px card, with both the page's
 * `scrollWidth` check and the card's own perfectly content. `minmax(0, Nfr)`
 * removes the floor so a narrow column wraps its text instead of hiding it, and
 * above the width where every column already clears its min-content — which is
 * every desktop layout in this app — the two forms resolve to identical tracks.
 * `DataTable`'s `shrinkableTrack()` does this to the tracks its callers pass;
 * here the template is a literal, so it is simply written out.
 *
 * The status track keeps its `min-content` floor because its content genuinely
 * cannot wrap: the badge is `white-space: nowrap`, so a track narrower than the
 * badge does not reflow it, it just pushes it out of the card again. */
export function Events() {
  const navigate = useNavigate();
  const { openNewEvent, canCreateEvent } = useNewEvent();
  const {
    filter,
    setFilter,
    view,
    setView,
    items,
    search,
    setSearch,
    isPending,
    isError,
    error,
    hasMore,
    isLoadingMore,
    loadMore,
  } = useEventList();
  const rows = items;
  // The row menu, from either view: cancel, archive, unarchive, delete. The hook
  // owns the calls, the toasts (with Undo on the reversible one), the two dialogs
  // and the cache invalidation; the rows below just draw what it says is offered.
  const { menuItems, confirmDialogProps, cancelModalProps } = useEventRowActions();
  // Invitations the caller has not answered. These are NOT in `rows` — an
  // unanswered participation grants no capabilities, so the events list cannot
  // see them (86cbcehmp). The card above the list is the only place they exist.
  const invitations = useEventInvitations();
  const viewPanel = useEventsViewMotion(view);

  const openEvent = (eventId: string) => navigate({ to: "/events/$eventId", params: { eventId } });

  return (
    <div style={{ width: "100%", maxWidth: 1180, margin: "0 auto" }}>
      <EventInvitationsCard
        invitations={invitations.invitations}
        answering={invitations.answering}
        onAccept={invitations.accept}
        onDecline={invitations.decline}
      />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          marginBottom: 20,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
          {FILTER_CHIPS.map(([value, label]) => (
            <FilterChip
              key={value}
              label={label}
              active={value === filter}
              onSelect={() => setFilter(value)}
            />
          ))}
        </div>
        {/* WRAPS, and the search box SHRINKS. Added as a rigid 240px box in a
            non-wrapping row, this group measured 490px against a 350px phone and
            put a sideways scrollbar on the whole page — caught by the mobile
            sweep, not by eye. `maxWidth: 100%` did not save it: the row's
            min-content is its children's, so the fix is to remove the floor
            (`flex` basis + `min-width: 0`) rather than to buy pixels back. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 10,
            // `1 1 auto` so the group TAKES the width the chips left on the row
            // instead of being squeezed to its own shrunk size and wrapping with
            // 200px of empty row beside it — which is what it did at 1440 when
            // this was left to `0 1 auto`.
            flex: "1 1 auto",
            flexWrap: "wrap",
          }}
        >
          {/* ClickUp `123qy9rngbp`. Answered by the SERVER (`useEventList`), so it
              searches every event the caller has and not the page on screen —
              which matters here precisely because this list pages. */}
          {/* `0 1 240px`: it may SHRINK below 240 on a phone but never grow past
              it, which is the difference between the two ways this row can break.
              Growing pushed "New event" onto a second line at desktop width — a
              wrap that looks like a mistake on a screen with room to spare. */}
          <div style={{ flex: "0 1 240px", minWidth: 0 }}>
            <SearchInput
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search events, venues, artists…"
              aria-label="Search events"
            />
          </div>
          <ViewToggle value={view} onChange={setView} />
          {canCreateEvent && (
            <>
              {/* A SECOND WAY TO PLACE A HOLD (QA sweep run 2, r2:706).
                  The hold wizard had exactly one entry point in the whole app —
                  Calendar → click a day → Hold — so an operator working from the
                  Events screen had no way to reach it, and the wizard's own
                  fallback toast pointed them at a status control on the event
                  workspace instead. A hold IS an event with `status: "on_hold"`,
                  the same wizard in hold mode; it costs no plan slot
                  (`CAP_COUNTING_EVENT_STATUSES` is confirmed|concluded), which is
                  why it sits beside the CTA rather than behind it.

                  No initial date: the Calendar's entry has the day that was
                  clicked, and here there is none to pass — the wizard asks. */}
              <Button
                variant="secondary"
                leftIcon={<Icon name="clock" size={14} />}
                onClick={() => openNewEvent({ initialStatus: "on_hold" })}
              >
                Place a hold
              </Button>
              <GradientButton onClick={openNewEvent}>
                <Icon name="plus" size={15} /> New event
              </GradientButton>
            </>
          )}
        </div>
      </div>

      {isPending ? (
        <LoadingState label="Loading events" />
      ) : isError ? (
        <ErrorState error={error} title="Couldn't load events" />
      ) : (
        // Two wrappers, one job each. The outer one fades when the VIEW changes
        // (see `useEventsViewMotion` for why a fade and not a scoot); the inner
        // one scoots when the FILTER changes, the same `TabPanels` the event
        // workspace's tabs and the Requests page's buckets already use — the
        // chips are tabs in everything but name.
        <div ref={viewPanel}>
          <TabPanels activeKey={filter} order={FILTER_ORDER}>
            {rows.length === 0 ? (
              // The empty state travels with the filter, which is the case where
              // the motion earns the most: landing on "nothing here" otherwise
              // reads as the screen having blanked.
              <EventsEmptyState
                filter={filter}
                search={search}
                canCreateEvent={canCreateEvent}
                onCreateEvent={openNewEvent}
                onShowAll={() => setFilter("all")}
                onClearSearch={() => setSearch("")}
              />
            ) : (
              <>
                {view === "board" ? (
                  <EventBoard rows={rows} onOpen={openEvent} menuItems={menuItems} />
                ) : (
                  <EventList rows={rows} onOpen={openEvent} menuItems={menuItems} />
                )}
                <LoadMore hasMore={hasMore} isLoading={isLoadingMore} onLoadMore={loadMore} />
              </>
            )}
          </TabPanels>
        </div>
      )}
      {/* Two dialogs for the whole screen — the row menu raises them,
          `useEventRowActions` holds the questions, and both layouts share them. */}
      <ConfirmDialog {...confirmDialogProps} />
      <EventCancelModal {...cancelModalProps} />
    </div>
  );
}

/** Nothing to show. The filter is the server's answer now, so an empty result
 * under a chip means "you have none of these", not "you have no events". */
function EventsEmptyState({
  filter,
  search,
  canCreateEvent,
  onCreateEvent,
  onShowAll,
  onClearSearch,
}: {
  filter: EventFilterKey;
  search: string;
  canCreateEvent: boolean;
  onCreateEvent: () => void;
  onShowAll: () => void;
  onClearSearch: () => void;
}) {
  /*
   * A SEARCH THAT FOUND NOTHING IS NOT AN EMPTY ACCOUNT.
   *
   * Without this branch, typing a name that does not match drew "No events yet —
   * events you create or join will show up here", offering to create one. That
   * tells an operator with forty shows that they have none, which is the worst
   * thing this screen could say.
   */
  if (search.trim() !== "") {
    return (
      <EmptyState
        icon={<Icon name="search" />}
        title={`Nothing matches "${search.trim()}"`}
        description="Searches cover the event's name, its venue and everybody on the bill."
        action={
          <Button variant="secondary" onClick={onClearSearch}>
            Clear search
          </Button>
        }
      />
    );
  }
  if (filter === "all") {
    return (
      <EmptyState
        icon={<Icon name="calendar" />}
        title="No events yet"
        description="Events you create or join will show up here."
        action={
          canCreateEvent ? (
            <Button variant="primary" leftIcon={<Icon name="plus" />} onClick={onCreateEvent}>
              New event
            </Button>
          ) : undefined
        }
      />
    );
  }
  return (
    <EmptyState
      icon={<Icon name="calendar" />}
      title={filter === "archived" ? "Nothing archived" : "No events match this filter"}
      description={
        filter === "archived"
          ? "Events you file away land here, and the row menu puts them back."
          : "Nothing of yours is in this state right now."
      }
      action={
        <Button variant="secondary" onClick={onShowAll}>
          Show all events
        </Button>
      }
    />
  );
}

/**
 * One status filter pill. Selected = the brand gradient, exactly as the prototype
 * draws it — but ARRIVED AT rather than snapped to.
 *
 * The gradient is a separate layer that fades, and it has to be: a CSS transition
 * cannot interpolate a `linear-gradient` against `transparent` (they are not the
 * same property — one is a background-image, the other a background-color), so
 * the obvious `transition: background` on the button would silently do nothing.
 * Cross-fading an overlay is the only way this fill can move at all.
 *
 * `--duration-quick`, because nothing here travels — colour, edge and fill are a
 * paint, and §4 gives a paint 140ms. The layer sits at `inset: -1px` so it covers
 * the border ring too, which is what makes the active pill read as one solid
 * gradient shape rather than a fill with a hairline gap around it.
 */
function FilterChip({
  label,
  active,
  onSelect,
}: {
  label: string;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onSelect}
      // Touch: 29px tall in a strip that wraps on a phone. The halo is capped at
      // half this strip's gutter rather than taking the full 44px — the
      // reasoning is written out in Events.module.css.
      className={styles.filterChip}
      style={{
        position: "relative",
        padding: "6px 13px",
        borderRadius: 999,
        fontSize: 12.5,
        fontWeight: 500,
        cursor: "pointer",
        border: "1px solid",
        borderColor: active ? "transparent" : "var(--border)",
        background: "transparent",
        color: active ? "#fff" : "var(--muted)",
        transition:
          "color var(--duration-quick) var(--ease-out), border-color var(--duration-quick) var(--ease-out)",
      }}
    >
      <span
        aria-hidden
        style={{
          position: "absolute",
          inset: -1,
          borderRadius: 999,
          background: "linear-gradient(135deg,var(--brand-red),var(--brand-amber))",
          opacity: active ? 1 : 0,
          transition: "opacity var(--duration-quick) var(--ease-out)",
        }}
      />
      {/* Positioned, so the label paints above the fill instead of under it. */}
      <span style={{ position: "relative" }}>{label}</span>
    </button>
  );
}

/** List / Board segmented pill (top-right of the filter row). Full 999px pill
 * container; the active option gets the surface fill + soft shadow. */
function ViewToggle({
  value,
  onChange,
}: {
  value: "list" | "board";
  onChange: (next: "list" | "board") => void;
}) {
  const options: { key: "list" | "board"; label: string }[] = [
    { key: "list", label: "List" },
    { key: "board", label: "Board" },
  ];
  return (
    <div
      style={{
        display: "flex",
        gap: 4,
        background: "var(--shape-fill)",
        border: "1px solid var(--border)",
        borderRadius: 999,
        padding: 4,
      }}
    >
      {options.map((option) => {
        const active = option.key === value;
        return (
          <button
            key={option.key}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.key)}
            // Touch: 28px tall, and the two segments sit 4px apart inside one
            // pill — an overlay would reach 8px into the other option. Growing
            // is safe and puts the pill on the same 44px line as the New event
            // button beside it.
            className="touch-target"
            style={{
              padding: "6px 16px",
              borderRadius: 999,
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
              border: 0,
              background: active ? "var(--surface)" : "transparent",
              color: active ? "var(--text)" : "var(--muted)",
              boxShadow: active ? "var(--shadow)" : "none",
              // A paint, not a movement: the fill, the label and the lift under
              // the selected option all land together on --duration-quick. Every
              // one of these is a plain colour, so unlike the gradient on a
              // filter chip they interpolate directly.
              transition:
                "background var(--duration-quick) var(--ease-out), color var(--duration-quick) var(--ease-out), box-shadow var(--duration-quick) var(--ease-out)",
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * WHO IS PLAYING, with their face — the sub-line under the event title in both
 * views.
 *
 * The picture is the performer profile's own avatar, resolved and signed by
 * `GET /events` (`headlinePerformerAvatarUrl`); a profile that has never uploaded
 * one falls back to initials, which is what the design system's `Avatar` is for.
 * Nothing is drawn at all for an event with nobody on the bill — an em-dash beside
 * an empty circle would claim there is an act and that we have lost its picture.
 */
function HeadlinePerformer({ name, avatarUrl }: { name: string | null; avatarUrl: string | null }) {
  if (!name) return <span style={{ color: "var(--muted)" }}>—</span>;
  return (
    <>
      {/* Decorative: the name is read out by the span beside it, so an alt text
          or initials announced here would say it twice. */}
      <Avatar
        initials={initialsOf(name)}
        src={avatarUrl ?? undefined}
        alt=""
        tone="brand"
        shape="circle"
        size={18}
        aria-hidden
        style={{ flexShrink: 0 }}
      />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {name}
      </span>
    </>
  );
}

/** What both views need: the rows, where a click goes, and what the row's
 * overflow menu offers for one event (built once by `useEventRowActions`). */
interface EventViewProps {
  rows: EventItem[];
  onOpen: (eventId: string) => void;
  menuItems: (event: {
    id: string;
    title: string;
    status?: string;
    archived?: boolean;
    published?: boolean;
    capabilities?: readonly string[];
  }) => EventMenuItem[];
}

/** The List view — a bordered card with a mono header row and one grid row per
 * event. Every column draws a real fact the list payload carries; a cell falls
 * back to "—" only where the event genuinely has nothing to say (no venue named,
 * no act booked, no settlement run). */
function EventList({ rows, onOpen, menuItems }: EventViewProps) {
  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 18,
        overflow: "hidden",
        boxShadow: "var(--shadow)",
      }}
    >
      <div
        className={`${ledgerTable.cells} ${styles.listHeader}`}
        style={{
          gap: 12,
          padding: "13px 22px",
          borderBottom: "1px solid var(--border)",
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          letterSpacing: ".12em",
          textTransform: "uppercase",
          color: "var(--dim)",
        }}
      >
        <span>Event / Artist</span>
        <span>Venue</span>
        <span>Date</span>
        {/* CAP AND STATUS ARE GONE FROM THIS TABLE (Ran, ClickUp `123qy9rpe3y`:
            *"No Cap Status needed"*; Daniel confirmed both, 2026-09-27).
            Neither is lost to the reader: the status chips above the table filter
            on exactly that field and the Board view IS the status, grouped; a
            room's capacity is on the event itself, next to the room it belongs to.
            The columns were the two narrowest here and the two that pushed the
            phone layout into a fourth row. */}
        <span>Settlement</span>
        {/* The menu's column. Unlabelled on purpose — the header names what a
            cell CONTAINS, and this one contains a control, not a fact. */}
        <span />
      </div>
      {rows.map((event) => {
        // No settlement row yet means nobody has run one — the absence is the
        // answer, so the cell says so rather than borrowing a stage from the
        // ladder. Everything else goes through the shared reader, so this cell and
        // the settlement workspace cannot disagree about what a status means.
        const settlement = event.settlementStatus
          ? settlementStatusToDisplay(event.settlementStatus)
          : { status: "draft" as const, label: "Not started" };
        return (
          // Hover tint only; the row's keyboard affordance is the stretched
          // button inside it, which is a real focusable control.
          <div
            key={event.id}
            className={`${ledgerTable.cells} ${styles.listRow}`}
            onMouseEnter={(mouse) => {
              mouse.currentTarget.style.background = "var(--shape-fill)";
            }}
            onMouseLeave={(mouse) => {
              mouse.currentTarget.style.background = "transparent";
            }}
            style={{
              position: "relative",
              width: "100%",
              gap: 12,
              alignItems: "center",
              padding: "15px 22px",
              background: "transparent",
              borderTop: "1px solid var(--border)",
              textAlign: "left",
              transition: "background var(--duration-quick) var(--ease-out)",
            }}
          >
            <button
              type="button"
              aria-label={`Open ${event.title}`}
              onClick={() => onOpen(event.id)}
              style={rowClickTargetStyle}
            />
            <span className={styles.cellTitle} style={{ minWidth: 0 }}>
              {/* The truncation lives in the stylesheet rather than here, because
                  a phone undoes it — an inline style cannot be overridden by a
                  media query without `!important`. */}
              <span className={styles.eventTitle}>{event.title}</span>
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  color: "var(--muted)",
                  fontSize: 12.5,
                  minWidth: 0,
                }}
              >
                <HeadlinePerformer
                  name={event.headlinePerformerName}
                  avatarUrl={event.headlinePerformerAvatarUrl}
                />
              </span>
            </span>
            <span
              className={styles.cellVenue}
              style={{
                color: "var(--muted)",
                fontSize: 13,
                display: "flex",
                alignItems: "center",
                gap: 7,
                minWidth: 0,
              }}
            >
              {/* The room, then WHICH COUNTRY it is in (ClickUp `123qy9rnfab`) —
                  the fact a performer or agent reading their own list needs, and
                  the one an operator had no reason to put in the title. */}
              <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                {event.venueName ?? "—"}
              </span>
              <CountryTag country={event.venueLocation?.country} />
            </span>
            {/* Unlinked: the row already IS a link (the stretched button above),
                and a link inside a link is not a thing. */}
            <DateText
              value={event.eventDate}
              link={false}
              className={styles.cellDate}
              style={{ fontFamily: "var(--font-mono)", color: "var(--text)", fontSize: 13 }}
            />
            <span
              className={styles.cellSettlement}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                color: "var(--dim)",
                fontSize: 12,
              }}
            >
              <StatusDot status={settlement.status} size={6} />
              {settlement.label}
            </span>
            {/* Positioned, so it paints ABOVE the stretched click target and
                takes its own clicks rather than opening the event. */}
            <span className={styles.cellMenu} style={{ position: "relative", justifySelf: "end" }}>
              <EventRowMenu items={menuItems(event)} label={`Actions for ${event.title}`} />
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** The Board view — the four fixed status columns, each holding the events in
 * that status. A card names the show, the act on it, the date and the room's
 * capacity. Draft/suggested/cancelled events fall outside the four columns,
 * exactly as in the prototype.
 *
 * The per-column count is a real count: `useEventList` drains the keyset cursor
 * in board view, so `rows` is every event the chip selects. */
function EventBoard({ rows, onOpen, menuItems }: EventViewProps) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(4,minmax(220px,1fr))",
        gap: 14,
        overflowX: "auto",
        // The board fills the screen rather than hugging its tallest column.
        // A kanban whose columns end just under the cards reads as a list that
        // happened to wrap — the empty space below a column IS the affordance
        // that says a card could go there. Grid items stretch by default, so
        // the height set here is what every column inherits.
        minHeight: "calc(100vh - 300px)",
      }}
    >
      {BOARD_DEFS.map(([status, label, color]) => {
        const items = rows.filter((event) => event.status === status);
        return (
          <div
            key={status}
            style={{
              background: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: 16,
              padding: 14,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: color }} />
              <span style={{ fontWeight: 600, fontSize: 13.5, color: "var(--text)" }}>{label}</span>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  color: "var(--muted)",
                  marginLeft: "auto",
                }}
              >
                {items.length}
              </span>
            </div>
            {items.map((event) => (
              // Hover lift only; the card's keyboard affordance is the button
              // stretched inside it, which is a real focusable control.
              <div
                key={event.id}
                onMouseEnter={(mouse) => {
                  mouse.currentTarget.style.transform = "translateY(-2px)";
                }}
                onMouseLeave={(mouse) => {
                  mouse.currentTarget.style.transform = "none";
                }}
                style={{
                  position: "relative",
                  width: "100%",
                  textAlign: "left",
                  // No fill: the column is already a surface, and a tinted card
                  // inside it made a second one. The border is enough to say
                  // "this is a thing you can pick up" — and in light mode the
                  // beige tint read as dirt on a white column.
                  background: "transparent",
                  border: "1px solid var(--border)",
                  borderRadius: 12,
                  padding: 12,
                  marginBottom: 9,
                  transition:
                    "transform var(--duration-base) var(--ease-out), border-color var(--duration-quick), background var(--duration-quick)",
                }}
              >
                <button
                  type="button"
                  aria-label={`Open ${event.title}`}
                  onClick={() => onOpen(event.id)}
                  style={rowClickTargetStyle}
                />
                <span
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    gap: 6,
                  }}
                >
                  <span
                    style={{
                      fontWeight: 600,
                      color: "var(--text)",
                      fontSize: 13.5,
                      minWidth: 0,
                    }}
                  >
                    {event.title}
                  </span>
                  <span style={{ position: "relative", flexShrink: 0 }}>
                    <EventRowMenu items={menuItems(event)} label={`Actions for ${event.title}`} />
                  </span>
                </span>
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    minWidth: 0,
                    color: "var(--muted)",
                    fontSize: 12,
                    margin: "2px 0 8px",
                  }}
                >
                  <HeadlinePerformer
                    name={event.headlinePerformerName}
                    avatarUrl={event.headlinePerformerAvatarUrl}
                  />
                </span>
                <span
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontFamily: "var(--font-mono)",
                    fontSize: 11.5,
                    color: "var(--muted)",
                  }}
                >
                  {/* Unlinked for the same reason as the list row: the card is
                      already one click target, stretched over the whole of it. */}
                  <DateText value={event.eventDate} link={false} />
                  <span>{event.capacity != null ? `${event.capacity} cap` : "— cap"}</span>
                </span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
