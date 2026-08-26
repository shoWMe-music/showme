import { type getApiV1Calendar, useGetApiV1Calendar } from "@showme/api-client";
import { Card, Icon, type Status, useToast } from "@showme/design-system";
import { useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { type CalendarEvent, type CalendarLabelMode, CalendarMonthGrid } from "../components";
import { AvailabilityShareModal } from "../components/AvailabilityShareModal";
import { CalendarCreatePopover } from "../components/CalendarCreatePopover";
import { CalendarDayAgenda } from "../components/CalendarDayAgenda";
import { CalendarFilterChip } from "../components/CalendarFilterChip";
import { CalendarItemCreateModal } from "../components/CalendarItemCreateModal";
import { CalendarWeekGrid } from "../components/CalendarWeekGrid";
import { MarkUnavailableModal } from "../components/MarkUnavailableModal";
import {
  type CalendarView,
  dayKey,
  queryRange,
  stepByView,
  viewRange,
  viewTitle,
} from "../components/calendarGrid";
import { useCalendarPerformerNames } from "../components/calendarPerformers";
import { Eyebrow } from "../components/primitives";
import { ErrorState, LoadingState } from "../components/states";
import { useCalendarIcsExport } from "../components/useCalendarIcsExport";
import { type CalendarItemKind, useCalendarItemCreate } from "../components/useCalendarItemCreate";
import { blocksOverlappingRange, useMarkUnavailable } from "../components/useMarkUnavailable";
import { useAvailabilityShare } from "../hooks/useAvailabilityShare";
import { type EventItem, useAllEvents } from "../hooks/useEventList";
import { apiStatusToDisplay } from "../lib/status";
import { useNewEvent } from "../shell/NewEventProvider";

type CalendarItem = Awaited<ReturnType<typeof getApiV1Calendar>>[number];

const VIEW_OPTIONS: { value: CalendarView; label: string }[] = [
  { value: "month", label: "Month" },
  { value: "week", label: "Week" },
  { value: "day", label: "Day" },
];

const LABEL_OPTIONS: { value: CalendarLabelMode; label: string }[] = [
  { value: "performer", label: "Performer" },
  { value: "eventName", label: "Event Name" },
  { value: "both", label: "Both" },
];

/** Calendar-item type → design-system status tint (calendar items carry no
 * settlement-style status, so map their kind onto the shared palette). */
const TYPE_TO_STATUS: Record<string, Status> = {
  event: "confirmed",
  hold: "hold",
  task: "task",
  appointment: "task",
  note: "draft",
};

/** What to CALL each calendar-item kind. Separate from `TYPE_TO_STATUS` because
 * several kinds share one tint (an appointment is tinted like a task) — the
 * colour may collide, the word must not. */
const TYPE_LABEL: Record<string, string> = {
  event: "Event",
  hold: "Hold",
  task: "Task",
  appointment: "Appointment",
  note: "Note",
};

/** The legend, verbatim from the prototype (§2): the six event statuses plus
 * the three calendar-item kinds (task | appointment | note). It describes the
 * palette — it is not calendar data — so the labels/colours are static. */
const LEGEND: { label: string; color: string }[] = [
  { label: "Suggested", color: "#B58BE0" },
  { label: "Pending", color: "#F4A046" },
  { label: "Confirmed", color: "#6FC97A" },
  { label: "On hold", color: "#FFC266" },
  { label: "Concluded", color: "#B8A99B" },
  { label: "Cancelled", color: "#EE5746" },
  { label: "Task", color: "#3BB0C9" },
  { label: "Appointment", color: "#D14FC4" },
  { label: "Note", color: "#D9B44A" },
];

/**
 * What the "Status" filter can hide, keyed by the entry's own `statusLabel`.
 *
 * Keyed on the LABEL rather than the `Status` tint on purpose: the palette is
 * shared (an appointment is tinted like a task, a note like a draft), so
 * filtering on the tint would silently take three kinds out together.
 *
 * `Draft` is here but NOT in `LEGEND`, which is verbatim from the prototype and
 * omits it. A draft event is a real thing on the grid — every event starts as
 * one — and a filter that cannot name a row on screen is a filter that hides it
 * with no way back.
 */
const STATUS_FILTER_OPTIONS: { key: string; label: string; color: string }[] = [
  ...LEGEND.map((entry) => ({ key: entry.label, label: entry.label, color: entry.color })),
  { key: "Draft", label: "Draft", color: "#8C7A6C" },
];

/** The three "My Calendars" sources from the prototype, with their swatch. */
const MY_CALENDARS: { id: string; label: string; color: string }[] = [
  { id: "promoter", label: "Promoter events", color: "#EE5746" },
  { id: "performer", label: "Performer shows", color: "#F4A046" },
  { id: "venue", label: "Venue bookings", color: "#6FC97A" },
];

/** Matches a bare calendar date — what a Postgres `date` column serialises to. */
const BARE_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The day an entry belongs on.
 *
 * `events.event_date` and `calendar_items.date` are offset-free SQL `date`s and
 * reach the browser as `"2026-09-12"`. `new Date("2026-09-12")` parses that as
 * **UTC midnight** (ES spec: a date-only ISO form is UTC), and reading it back
 * with local getters then returns the 11th anywhere west of Greenwich — so the
 * whole calendar, and anything built from it, slid one day earlier for every
 * user in the Americas. A bare date has no zone to convert FROM: it is already
 * the day key, and is taken as written.
 *
 * Anything carrying an actual time still goes through `Date`, because that IS an
 * instant and does need rendering in the reader's zone.
 */
function toDayKey(value: string): string {
  if (BARE_DATE.test(value)) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value.slice(0, 10) : dayKey(date);
}

/** A bordered secondary control matching the prototype's toolbar buttons. */
function toolbarButtonStyle(): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
    padding: "9px 15px",
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: "var(--surface)",
    color: "var(--text)",
    fontSize: 13,
    fontWeight: 500,
    cursor: "pointer",
  };
}

/** The Performer… / Venue-Room… text filter fields. */
function filterInputStyle(): React.CSSProperties {
  return {
    border: "1px solid var(--border)",
    background: "var(--elevated)",
    borderRadius: 10,
    padding: "9px 13px",
    color: "var(--text)",
    fontSize: 12.5,
    outline: "none",
    width: 150,
  };
}

/** The "Calendars" / "Status" filter-row chips (prototype: 12.5px, 9×14). */
function filterChipStyle(): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
    padding: "9px 14px",
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: "var(--surface)",
    color: "var(--text)",
    fontSize: 12.5,
    fontWeight: 500,
    cursor: "pointer",
  };
}

/** The gradient "Create Event" primary action. */
function primaryButtonStyle(): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
    padding: "9px 15px",
    borderRadius: 10,
    border: 0,
    background: "linear-gradient(135deg,#EE5746,#F4A046)",
    color: "#fff",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  };
}

/** A 36×36 square icon button (prev/next month). */
function navSquareStyle(): React.CSSProperties {
  return {
    width: 36,
    height: 36,
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: "var(--surface)",
    color: "var(--muted)",
    cursor: "pointer",
    display: "grid",
    placeItems: "center",
  };
}

/** The Month/Week/Day + Performer/Event Name/Both pill wrapper. */
function segmentContainerStyle(): React.CSSProperties {
  return {
    display: "flex",
    gap: 2,
    background: "var(--elevated)",
    border: "1px solid var(--border)",
    borderRadius: 10,
    padding: 3,
  };
}

/** One segment inside `segmentContainerStyle`. */
function segmentButtonStyle(active: boolean, weight: number): React.CSSProperties {
  return {
    padding: "8px 15px",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: weight,
    cursor: "pointer",
    border: 0,
    background: active ? "#EE5746" : "transparent",
    color: active ? "#fff" : "var(--muted)",
  };
}

/** Which calendar the Month / Week / Day segment selects. A switch rather than one
 * component with a `view` prop, because the three lay days out in genuinely
 * different ways and share only the chip. */
function CalendarGridForView({
  view,
  anchorDate,
  events,
  labelMode,
  onSelectDay,
  onSelectEvent,
}: {
  view: CalendarView;
  anchorDate: Date;
  events: CalendarEvent[];
  labelMode: CalendarLabelMode;
  onSelectDay: (dayKey: string, anchor: DOMRect) => void;
  onSelectEvent: (eventId: string) => void;
}) {
  if (view === "week") {
    return (
      <CalendarWeekGrid
        week={anchorDate}
        events={events}
        labelMode={labelMode}
        onSelectDay={onSelectDay}
        onSelectEvent={onSelectEvent}
      />
    );
  }
  if (view === "day") {
    return (
      <CalendarDayAgenda
        day={anchorDate}
        events={events}
        labelMode={labelMode}
        onSelectDay={onSelectDay}
        onSelectEvent={onSelectEvent}
      />
    );
  }
  return (
    <CalendarMonthGrid
      month={anchorDate}
      events={events}
      labelMode={labelMode}
      showLegend={false}
      onSelectDay={onSelectDay}
      onSelectEvent={onSelectEvent}
    />
  );
}

export function Calendar() {
  const navigate = useNavigate();
  const toast = useToast();
  const { openNewEvent, canCreateEvent } = useNewEvent();

  // One cursor for all three views: the month, week or day it lands in is what
  // gets drawn, so switching view keeps the reader where they already were.
  const [anchorDate, setAnchorDate] = useState(() => new Date());
  const [view, setView] = useState<CalendarView>("month");
  const [labelMode, setLabelMode] = useState<CalendarLabelMode>("eventName");
  const [performerFilter, setPerformerFilter] = useState("");
  const [venueFilter, setVenueFilter] = useState("");
  const [dateJump, setDateJump] = useState("");
  const [shareOpen, setShareOpen] = useState(false);
  const [unavailableOpen, setUnavailableOpen] = useState(false);
  // The day "CREATE" popover: which day was clicked + the cell rect to anchor to.
  const [createAt, setCreateAt] = useState<{ dayKey: string; anchor: DOMRect } | null>(null);
  // The appointment/note composer the day popover opens, and the day it is for.
  const [newItem, setNewItem] = useState<{ kind: CalendarItemKind; dayKey: string } | null>(null);
  /** Status LABELS the reader has switched off. Hidden rather than shown, so a
   * kind that gains a label later starts visible instead of silently missing. */
  const [hiddenStatuses, setHiddenStatuses] = useState<string[]>([]);

  // "My Calendars" toggles are a client-only view preference (calendar items
  // carry no source grouping yet), so they start on and persist in local state.
  const [enabledCalendars, setEnabledCalendars] = useState<Record<string, boolean>>({
    promoter: true,
    performer: true,
    venue: true,
  });

  // The API date params are inclusive bounds. Ask for the whole month(s) the view
  // touches rather than the seven or one visible days — see `queryRange`.
  const { from, to } = queryRange(view, anchorDate);
  const visibleRange = viewRange(view, anchorDate);

  const calendar = useGetApiV1Calendar({ from, to });
  // Every event: the grid is a month of the whole schedule, not of page one.
  const events = useAllEvents();

  const calendarEvents = useMemo<CalendarEvent[]>(() => {
    // BOTH sources, concatenated: standalone calendar items (tasks, appointments,
    // notes) and the dated events. They come from different tables and share no
    // ids, so there is nothing to de-duplicate — and showing only one of them
    // would hide every event from anyone who had also written down a task.
    const items: CalendarEvent[] = (calendar.data ?? []).map((item: CalendarItem) => ({
      id: item.id,
      date: toDayKey(item.date),
      eventName: item.title,
      performer: item.entity ?? undefined,
      startTime: item.startTime ?? undefined,
      status: TYPE_TO_STATUS[item.type] ?? "draft",
      statusLabel: TYPE_LABEL[item.type] ?? item.type,
    }));
    // Events are real, so tag them with eventId to click through.
    const evented: EventItem[] = events.items;
    const dated: CalendarEvent[] = evented
      .filter((event) => event.eventDate)
      .map((event) => ({
        id: event.id,
        eventId: event.id,
        date: toDayKey(event.eventDate as string),
        eventName: event.title,
        status: apiStatusToDisplay(event.status).status,
        statusLabel: apiStatusToDisplay(event.status).label,
      }));
    return [...items, ...dated];
  }, [calendar.data, events.items]);

  // Who is playing: only for the events on screen, since it costs one request each.
  const visibleEventIds = useMemo(
    () =>
      events.items
        .filter((event) => {
          const date = event.eventDate?.slice(0, 10);
          return Boolean(date && date >= visibleRange.from && date <= visibleRange.to);
        })
        .map((event) => event.id),
    [events.items, visibleRange.from, visibleRange.to],
  );
  const performerNames = useCalendarPerformerNames(visibleEventIds);

  // Attach the resolved performer so the Performer / Both chip labels have a name
  // to show. Cheap enough to redo per render, and it must happen BEFORE the text
  // filter so "Performer…" searches the performer and not only the title.
  const namedEvents: CalendarEvent[] = calendarEvents.map((entry) => {
    const performer = entry.eventId ? performerNames.get(entry.eventId) : undefined;
    return performer ? { ...entry, performer } : entry;
  });

  // Client-only text filters over the real events (no server filter endpoint).
  const performerNeedle = performerFilter.trim().toLowerCase();
  const venueNeedle = venueFilter.trim().toLowerCase();
  const hiddenStatusSet = new Set(hiddenStatuses);
  const visibleEvents: CalendarEvent[] = namedEvents.filter((event) => {
    if (event.statusLabel && hiddenStatusSet.has(event.statusLabel)) return false;
    if (!performerNeedle && !venueNeedle) return true;
    const haystack = `${event.performer ?? ""} ${event.eventName}`.toLowerCase();
    const matchesPerformer = !performerNeedle || haystack.includes(performerNeedle);
    const matchesVenue = !venueNeedle || haystack.includes(venueNeedle);
    return matchesPerformer && matchesVenue;
  });

  // The share modal is a read-only composite: the hook owns the form, derives the
  // free days from the real schedule, and builds the public link.
  const share = useAvailabilityShare(calendarEvents, events.items, MY_CALENDARS[0]?.label ?? "");

  const periodTitle = viewTitle(view, anchorDate);

  // Blocked dates for the acting profile. Read on every render (not only while
  // the editor is open) so the rail can name what is blocked in this period.
  const markUnavailable = useMarkUnavailable(unavailableOpen, () => {
    setUnavailableOpen(false);
    toast.success("Blocked dates saved.");
  });
  const blockedInView = blocksOverlappingRange(
    markUnavailable.savedBlocks,
    visibleRange.from,
    visibleRange.to,
  );

  // End times never reach the grid (a chip has no room), but an export without
  // them turns a 15:00–16:00 meeting into a zero-length blip — so they travel
  // alongside, straight from the calendar feed.
  const endTimeById = useMemo(() => {
    const ends = new Map<string, string>();
    for (const item of calendar.data ?? []) {
      if (item.endTime) ends.set(item.id, item.endTime);
    }
    return ends;
  }, [calendar.data]);

  // Exports exactly what the grid is drawing, for exactly the period on screen.
  const exportIcs = useCalendarIcsExport({
    events: visibleEvents,
    labelMode,
    range: visibleRange,
    periodTitle,
    endTimeById,
  });

  const newItemCreate = useCalendarItemCreate(
    Boolean(newItem),
    newItem?.kind ?? "appointment",
    newItem?.dayKey ?? dayKey(new Date()),
    () => setNewItem(null),
  );

  // The arrows step whatever is on screen: a month, a week, or a single day.
  const stepView = (offset: number) =>
    setAnchorDate((current) => stepByView(view, current, offset));
  const viewNoun = view === "month" ? "month" : view === "week" ? "week" : "day";

  const onDateJump = (value: string) => {
    setDateJump(value);
    if (!value) return;
    // `new Date("2026-08-29")` is UTC midnight, so anywhere west of Greenwich the
    // anchor landed on the 28th and Day view showed the wrong day. The field's
    // value is a LOCAL calendar date; build the Date from its parts so it stays
    // one. (Same trap as `toDayKey` above.)
    const [year, month, day] = value.split("-").map(Number);
    if (!year || !month || !day) return;
    const parsed = new Date(year, month - 1, day);
    if (!Number.isNaN(parsed.getTime())) setAnchorDate(parsed);
  };

  const isPending = calendar.isPending || events.isPending;

  return (
    <>
      <div style={{ maxWidth: 1280, margin: "0 auto", width: "100%" }}>
        <h2
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: 600,
            fontSize: 28,
            letterSpacing: "-0.02em",
            color: "var(--text)",
            margin: "0 0 16px",
          }}
        >
          {periodTitle}
        </h2>

        {/* Toolbar: navigation + view toggle + label toggle */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            flexWrap: "wrap",
            marginBottom: 14,
          }}
        >
          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              aria-label={`Previous ${viewNoun}`}
              style={navSquareStyle()}
              onClick={() => stepView(-1)}
            >
              <Icon name="chevron-right" size={17} style={{ transform: "rotate(180deg)" }} />
            </button>
            <button
              type="button"
              style={{
                padding: "0 15px",
                height: 36,
                borderRadius: 10,
                border: "1px solid var(--border)",
                background: "var(--surface)",
                color: "var(--text)",
                fontSize: 13,
                fontWeight: 500,
                cursor: "pointer",
              }}
              onClick={() => setAnchorDate(new Date())}
            >
              Today
            </button>
            <button
              type="button"
              aria-label={`Next ${viewNoun}`}
              style={navSquareStyle()}
              onClick={() => stepView(1)}
            >
              <Icon name="chevron-right" size={17} />
            </button>
          </div>
          <div style={segmentContainerStyle()} role="tablist" aria-label="Calendar view">
            {VIEW_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="tab"
                aria-selected={view === option.value}
                style={segmentButtonStyle(view === option.value, 600)}
                onClick={() => setView(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div style={segmentContainerStyle()} role="tablist" aria-label="Chip label">
            {LABEL_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="tab"
                aria-selected={labelMode === option.value}
                style={segmentButtonStyle(labelMode === option.value, 500)}
                onClick={() => setLabelMode(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {/* Action row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
            marginBottom: 14,
          }}
        >
          <button
            type="button"
            style={toolbarButtonStyle()}
            onClick={() => setUnavailableOpen(true)}
          >
            <Icon name="calendar-check" size={15} />
            Mark Unavailable
          </button>
          <button type="button" style={toolbarButtonStyle()} onClick={() => setShareOpen(true)}>
            <Icon name="share" size={15} />
            Check &amp; Share Availability
          </button>
          <button
            type="button"
            style={toolbarButtonStyle()}
            title={`Download ${periodTitle} as an .ics file`}
            onClick={exportIcs}
          >
            <Icon name="download" size={15} />
            Export ICS
          </button>
          <button
            type="button"
            style={toolbarButtonStyle()}
            onClick={() =>
              // Left as a stub deliberately. Reading an .ics is the easy half;
              // the hard half is that an imported entry has to become something
              // this app owns — an `event` (operator-only, venue, currency,
              // participants, plan cap) or a `calendar_item` — and there is no
              // API that takes a batch of either. Guessing would create rows
              // nobody can settle.
              toast.info(
                "Import isn't built yet — there's no route that takes a batch of events, so an .ics has nowhere to land.",
              )
            }
          >
            <Icon name="upload" size={15} />
            Import
          </button>
          {canCreateEvent && (
            <button type="button" style={primaryButtonStyle()} onClick={() => openNewEvent()}>
              <Icon name="plus" size={15} />
              Create Event
            </button>
          )}
        </div>

        {/* Inline legend */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            flexWrap: "wrap",
            marginBottom: 14,
          }}
        >
          {LEGEND.map((entry) => (
            <span
              key={entry.label}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12,
                color: "var(--muted)",
              }}
            >
              <span
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: "50%",
                  background: entry.color,
                }}
              />
              {entry.label}
            </span>
          ))}
        </div>

        {/* Filter row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
            marginBottom: 20,
          }}
        >
          <button
            type="button"
            style={filterChipStyle()}
            onClick={() =>
              // Left as a stub deliberately. "Promoter events / Performer shows /
              // Venue bookings" is a question about the ACTING PROFILE'S ROLE on
              // each event, and `GET /events` returns the event spine only — no
              // participant role for the caller. Deriving it means one
              // `/events/:id/participants` request per event in the range, and it
              // still says nothing about tasks or notes. A chip that toggled
              // three boxes and changed nothing would be worse than this.
              toast.info(
                "Source filters need the events list to say what role you play on each event; it doesn't yet.",
              )
            }
          >
            <Icon name="grid" size={14} />
            Calendars
          </button>
          <CalendarFilterChip
            label="Status"
            icon="eye"
            style={filterChipStyle()}
            options={STATUS_FILTER_OPTIONS}
            selected={STATUS_FILTER_OPTIONS.map((option) => option.key).filter(
              (key) => !hiddenStatuses.includes(key),
            )}
            onToggle={(key) =>
              setHiddenStatuses((current) =>
                current.includes(key)
                  ? current.filter((hidden) => hidden !== key)
                  : [...current, key],
              )
            }
            onSelectAll={() => setHiddenStatuses([])}
            onSelectNone={() =>
              setHiddenStatuses(STATUS_FILTER_OPTIONS.map((option) => option.key))
            }
          />
          <input
            value={performerFilter}
            onChange={(event) => setPerformerFilter(event.target.value)}
            placeholder="Performer…"
            aria-label="Filter by performer"
            style={filterInputStyle()}
          />
          <input
            value={venueFilter}
            onChange={(event) => setVenueFilter(event.target.value)}
            placeholder="Venue / Room…"
            aria-label="Filter by venue or room"
            style={filterInputStyle()}
          />
          <input
            type="date"
            value={dateJump}
            onChange={(event) => onDateJump(event.target.value)}
            aria-label="Jump to date"
            style={{ ...filterInputStyle(), width: "auto" }}
          />
        </div>

        {/* Grid + right rail */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) 232px",
            gap: 20,
            alignItems: "start",
          }}
        >
          {isPending ? (
            <LoadingState label="Loading calendar" />
          ) : calendar.isError && events.isError ? (
            <ErrorState error={calendar.error} title="Couldn't load the calendar" />
          ) : (
            <CalendarGridForView
              view={view}
              anchorDate={anchorDate}
              events={visibleEvents}
              labelMode={labelMode}
              onSelectEvent={(eventId) => navigate({ to: "/events/$eventId", params: { eventId } })}
              onSelectDay={(selectedDayKey, anchor) =>
                setCreateAt({ dayKey: selectedDayKey, anchor })
              }
            />
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <Card padding="md" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <Eyebrow>Status legend</Eyebrow>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {LEGEND.map((entry) => (
                  <span
                    key={entry.label}
                    style={{ display: "flex", alignItems: "center", gap: 10 }}
                  >
                    <span
                      style={{
                        width: 11,
                        height: 11,
                        borderRadius: 3,
                        background: entry.color,
                      }}
                    />
                    <span style={{ fontSize: 12.5, color: "var(--text)" }}>{entry.label}</span>
                  </span>
                ))}
              </div>
            </Card>

            {/* What "Mark Unavailable" actually did, on the screen that offers
                it. Read-only: the editor is the modal. */}
            <Card padding="md" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <Eyebrow>Unavailable</Eyebrow>
              {blockedInView.length === 0 ? (
                <p style={{ margin: 0, fontSize: 12.5, color: "var(--muted)" }}>
                  {markUnavailable.savedBlocks.length === 0
                    ? "Nothing blocked."
                    : `Nothing blocked in ${periodTitle}.`}
                </p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                  {blockedInView.map((block) => (
                    <span
                      key={block.id ?? `${block.startDate}-${block.endDate}`}
                      style={{ display: "flex", flexDirection: "column", gap: 2 }}
                    >
                      <span style={{ fontSize: 12.5, color: "var(--text)" }}>
                        {block.startDate === block.endDate
                          ? block.startDate
                          : `${block.startDate} → ${block.endDate}`}
                      </span>
                      {block.reason && (
                        <span style={{ fontSize: 11.5, color: "var(--muted)" }}>
                          {block.reason}
                        </span>
                      )}
                    </span>
                  ))}
                </div>
              )}
              <button
                type="button"
                onClick={() => setUnavailableOpen(true)}
                style={{
                  all: "unset",
                  cursor: "pointer",
                  fontSize: 12,
                  color: "#EE5746",
                  fontWeight: 500,
                }}
              >
                Edit blocked dates
              </button>
            </Card>

            <Card padding="md" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <Eyebrow>My calendars</Eyebrow>
              <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
                {MY_CALENDARS.map((source) => {
                  const on = enabledCalendars[source.id] ?? false;
                  return (
                    <button
                      key={source.id}
                      type="button"
                      onClick={() =>
                        setEnabledCalendars((current) => ({ ...current, [source.id]: !on }))
                      }
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        background: "transparent",
                        border: "none",
                        padding: 0,
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      <span
                        style={{
                          width: 16,
                          height: 16,
                          borderRadius: 5,
                          display: "grid",
                          placeItems: "center",
                          flexShrink: 0,
                          color: "#fff",
                          background: on ? source.color : "transparent",
                          border: on ? "none" : "1.5px solid var(--border-strong)",
                        }}
                      >
                        {on && <Icon name="check" size={11} strokeWidth={3} />}
                      </span>
                      <span style={{ fontSize: 12.5, color: "var(--text)" }}>{source.label}</span>
                    </button>
                  );
                })}
              </div>
            </Card>
          </div>
        </div>
      </div>

      <AvailabilityShareModal
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        calendars={MY_CALENDARS.map((source) => source.label)}
        calendar={share.calendar}
        onCalendarChange={share.setCalendar}
        from={share.from}
        to={share.to}
        onFromChange={share.setFrom}
        onToChange={share.setTo}
        showConfirmed={share.showConfirmed}
        onShowConfirmedChange={share.setShowConfirmed}
        showHeld={share.showHeld}
        onShowHeldChange={share.setShowHeld}
        selectedWeekdays={share.selectedWeekdays}
        onToggleWeekday={share.toggleWeekday}
        availableDates={share.availableDates}
        onCopyDates={share.copyDates}
        shareLink={share.shareLink}
        onCopyLink={share.copyLink}
      />

      <MarkUnavailableModal
        open={unavailableOpen}
        onClose={() => setUnavailableOpen(false)}
        view={markUnavailable}
      />

      <CalendarItemCreateModal
        open={Boolean(newItem)}
        onClose={() => setNewItem(null)}
        view={newItemCreate}
      />

      {createAt && (
        <CalendarCreatePopover
          anchor={createAt.anchor}
          title={new Date(`${createAt.dayKey}T00:00:00`).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          })}
          onClose={() => setCreateAt(null)}
          options={[
            // Same wizard as the topbar/"Create Event" CTA (see NewEventProvider),
            // opened on the day that was clicked. Hidden for non-operators for the
            // same reason the toolbar CTA is: only operators may create events.
            ...(canCreateEvent
              ? [
                  {
                    key: "event",
                    label: "Event",
                    icon: "calendar" as const,
                    onSelect: () => openNewEvent({ initialDate: createAt.dayKey }),
                  },
                ]
              : []),
            {
              key: "hold",
              label: "Hold",
              icon: "calendar-check",
              onSelect: () =>
                // Left as a stub deliberately. A hold IS an event — the `holds`
                // routes rank/confirm/decline an EXISTING `on_hold` event and
                // create nothing. `POST /events` has no `status` field by
                // design (it keeps a fresh event off the plan cap), so putting
                // one on hold is a second PATCH that charges the cap, and the
                // create wizard has no way to ask for it.
                toast.info(
                  "Creating a hold needs the event wizard to offer it — a hold is an event, and creating one always starts as a draft.",
                ),
            },
            {
              key: "task",
              label: "Task",
              icon: "check",
              onSelect: () => navigate({ to: "/tasks" }),
            },
            {
              key: "appointment",
              label: "Appointment",
              icon: "clock",
              onSelect: () => setNewItem({ kind: "appointment", dayKey: createAt.dayKey }),
            },
            {
              key: "note",
              label: "Note",
              icon: "file",
              onSelect: () => setNewItem({ kind: "note", dayKey: createAt.dayKey }),
            },
          ]}
        />
      )}
    </>
  );
}
