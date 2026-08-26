import { type getApiV1Calendar, useGetApiV1Calendar } from "@showme/api-client";
import { Card, Icon, type Status, useToast } from "@showme/design-system";
import { useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { type CalendarEvent, type CalendarLabelMode, CalendarMonthGrid } from "../components";
import { AvailabilityShareModal } from "../components/AvailabilityShareModal";
import { CalendarCreatePopover } from "../components/CalendarCreatePopover";
import { CalendarDayAgenda } from "../components/CalendarDayAgenda";
import { CalendarWeekGrid } from "../components/CalendarWeekGrid";
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

/** The three "My Calendars" sources from the prototype, with their swatch. */
const MY_CALENDARS: { id: string; label: string; color: string }[] = [
  { id: "promoter", label: "Promoter events", color: "#EE5746" },
  { id: "performer", label: "Performer shows", color: "#F4A046" },
  { id: "venue", label: "Venue bookings", color: "#6FC97A" },
];

function toDayKey(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso.slice(0, 10) : dayKey(date);
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
  // The day "CREATE" popover: which day was clicked + the cell rect to anchor to.
  const [createAt, setCreateAt] = useState<{ dayKey: string; anchor: DOMRect } | null>(null);

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
  const visibleEvents: CalendarEvent[] = namedEvents.filter((event) => {
    if (!performerNeedle && !venueNeedle) return true;
    const haystack = `${event.performer ?? ""} ${event.eventName}`.toLowerCase();
    const matchesPerformer = !performerNeedle || haystack.includes(performerNeedle);
    const matchesVenue = !venueNeedle || haystack.includes(venueNeedle);
    return matchesPerformer && matchesVenue;
  });

  // The share modal is a read-only composite: the hook owns the form, derives the
  // free days from the real schedule, and builds the public link.
  const share = useAvailabilityShare(calendarEvents, events.items, MY_CALENDARS[0]?.label ?? "");

  // The arrows step whatever is on screen: a month, a week, or a single day.
  const stepView = (offset: number) =>
    setAnchorDate((current) => stepByView(view, current, offset));
  const viewNoun = view === "month" ? "month" : view === "week" ? "week" : "day";

  const onDateJump = (value: string) => {
    setDateJump(value);
    if (!value) return;
    const parsed = new Date(value);
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
          {viewTitle(view, anchorDate)}
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
            onClick={() => toast.info("Marking unavailability is coming soon.")}
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
            onClick={() => toast.info("ICS export is coming soon.")}
          >
            <Icon name="download" size={15} />
            Export ICS
          </button>
          <button
            type="button"
            style={toolbarButtonStyle()}
            onClick={() => toast.info("Calendar import is coming soon.")}
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
            onClick={() => toast.info("Calendar-source filters are coming soon.")}
          >
            <Icon name="grid" size={14} />
            Calendars
          </button>
          <button
            type="button"
            style={filterChipStyle()}
            onClick={() => toast.info("Status filters are coming soon.")}
          >
            <Icon name="eye" size={14} />
            Status
          </button>
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
              onSelect: () => toast.info("Creating holds from the calendar is coming soon."),
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
              onSelect: () => toast.info("Appointments are coming soon."),
            },
            {
              key: "note",
              label: "Note",
              icon: "file",
              onSelect: () => toast.info("Notes are coming soon."),
            },
          ]}
        />
      )}
    </>
  );
}
