import {
  type getApiV1Calendar,
  type getApiV1Events,
  useGetApiV1Calendar,
  useGetApiV1Events,
} from "@showme/api-client";
import { Card, Icon, type Status, useToast } from "@showme/design-system";
import { useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { type CalendarEvent, type CalendarLabelMode, CalendarMonthGrid } from "../components";
import { AvailabilityShareModal } from "../components/AvailabilityShareModal";
import { CalendarCreatePopover } from "../components/CalendarCreatePopover";
import { buildMonthGrid, dayKey, monthTitle } from "../components/calendarGrid";
import { Eyebrow } from "../components/primitives";
import { ErrorState, LoadingState } from "../components/states";
import { apiStatusToDisplay } from "../lib/status";
import { useNewEvent } from "../shell/NewEventProvider";

type CalendarItem = Awaited<ReturnType<typeof getApiV1Calendar>>[number];
type EventItem = Awaited<ReturnType<typeof getApiV1Events>>["items"][number];

type CalendarView = "month" | "week" | "day";

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

export function Calendar() {
  const navigate = useNavigate();
  const toast = useToast();
  const { openNewEvent, canCreateEvent } = useNewEvent();

  const [month, setMonth] = useState(() => new Date());
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

  // Availability-share form (the modal is a read-only composite; the screen
  // owns every field). Dates derive from the real calendar below.
  const [shareCalendar, setShareCalendar] = useState("Promoter events");
  // Default the share window to today → +30 days so the available-dates list
  // shows a real, filtered range (not every day of the month).
  const [shareFrom, setShareFrom] = useState(() => dayKey(new Date()));
  const [shareTo, setShareTo] = useState(() => {
    const end = new Date();
    end.setDate(end.getDate() + 30);
    return dayKey(end);
  });
  const [shareConfirmed, setShareConfirmed] = useState(true);
  // Held events default to NOT counting as unavailable (matches the design).
  const [shareHeld, setShareHeld] = useState(false);
  const [shareWeekdays, setShareWeekdays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);

  // Query the visible month's window; the API date params are inclusive bounds.
  const from = dayKey(new Date(month.getFullYear(), month.getMonth(), 1));
  const to = dayKey(new Date(month.getFullYear(), month.getMonth() + 1, 0));

  const calendar = useGetApiV1Calendar({ from, to });
  const events = useGetApiV1Events();

  const calendarEvents = useMemo<CalendarEvent[]>(() => {
    const items: CalendarItem[] = calendar.data ?? [];
    if (items.length > 0) {
      return items.map((item) => ({
        id: item.id,
        date: toDayKey(item.date),
        eventName: item.title,
        performer: item.entity ?? undefined,
        status: TYPE_TO_STATUS[item.type] ?? "draft",
      }));
    }
    // Fallback: map dated events onto the grid when the calendar is sparse.
    // These are real events, so tag them with eventId to click through.
    const evented: EventItem[] = events.data?.items ?? [];
    return evented
      .filter((event) => event.eventDate)
      .map((event) => ({
        id: event.id,
        eventId: event.id,
        date: toDayKey(event.eventDate as string),
        eventName: event.title,
        status: apiStatusToDisplay(event.status).status,
      }));
  }, [calendar.data, events.data]);

  // Client-only text filters over the real events (no server filter endpoint).
  const visibleEvents = useMemo<CalendarEvent[]>(() => {
    const performerNeedle = performerFilter.trim().toLowerCase();
    const venueNeedle = venueFilter.trim().toLowerCase();
    if (!performerNeedle && !venueNeedle) return calendarEvents;
    return calendarEvents.filter((event) => {
      const haystack = `${event.performer ?? ""} ${event.eventName}`.toLowerCase();
      const matchesPerformer = !performerNeedle || haystack.includes(performerNeedle);
      const matchesVenue = !venueNeedle || haystack.includes(venueNeedle);
      return matchesPerformer && matchesVenue;
    });
  }, [calendarEvents, performerFilter, venueFilter]);

  // Available (unbooked) dates for the share modal, derived from real data:
  // in-month days with no blocking event, matching the chosen weekdays.
  const availableDates = useMemo<string[]>(() => {
    const blocked = new Set<string>();
    for (const event of calendarEvents) {
      const blocks =
        (shareConfirmed && event.status === "confirmed") || (shareHeld && event.status === "hold");
      if (blocks) blocked.add(event.date);
    }
    const selected = new Set(shareWeekdays);
    return buildMonthGrid(month)
      .filter((cell) => cell.inMonth)
      .filter((cell) => selected.has((cell.date.getDay() + 6) % 7))
      .filter((cell) => !blocked.has(cell.key))
      .filter((cell) => (!shareFrom || cell.key >= shareFrom) && (!shareTo || cell.key <= shareTo))
      .map((cell) => {
        // Match the design's "Fri · Jul 11" pill format (Ddd · Mmm DD).
        const weekday = cell.date.toLocaleDateString("en-US", { weekday: "short" });
        const monthShort = cell.date.toLocaleDateString("en-US", { month: "short" });
        const day = String(cell.date.getDate()).padStart(2, "0");
        return `${weekday} · ${monthShort} ${day}`;
      });
  }, [calendarEvents, month, shareConfirmed, shareHeld, shareWeekdays, shareFrom, shareTo]);

  const stepMonth = (offset: number) =>
    setMonth((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1));

  const onDateJump = (value: string) => {
    setDateJump(value);
    if (!value) return;
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) setMonth(parsed);
  };

  const toggleShareWeekday = (index: number) =>
    setShareWeekdays((current) =>
      current.includes(index) ? current.filter((day) => day !== index) : [...current, index],
    );

  const copyAvailableDates = () => {
    if (availableDates.length === 0) {
      toast.info("No available dates to copy in this range.");
      return;
    }
    navigator.clipboard
      ?.writeText(availableDates.join(", "))
      .then(() => toast.success("Available dates copied"))
      .catch(() => toast.error("Couldn't copy the dates."));
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
          {monthTitle(month)}
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
              aria-label="Previous month"
              style={navSquareStyle()}
              onClick={() => stepMonth(-1)}
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
              onClick={() => setMonth(new Date())}
            >
              Today
            </button>
            <button
              type="button"
              aria-label="Next month"
              style={navSquareStyle()}
              onClick={() => stepMonth(1)}
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
            <button type="button" style={primaryButtonStyle()} onClick={openNewEvent}>
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
            <CalendarMonthGrid
              month={month}
              events={visibleEvents}
              view={view}
              labelMode={labelMode}
              showLegend={false}
              onSelectEvent={(eventId) => navigate({ to: "/events/$eventId", params: { eventId } })}
              onSelectDay={(dayKey, anchor) => setCreateAt({ dayKey, anchor })}
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
        calendar={shareCalendar}
        onCalendarChange={setShareCalendar}
        from={shareFrom}
        to={shareTo}
        onFromChange={setShareFrom}
        onToChange={setShareTo}
        showConfirmed={shareConfirmed}
        onShowConfirmedChange={setShareConfirmed}
        showHeld={shareHeld}
        onShowHeldChange={setShareHeld}
        selectedWeekdays={shareWeekdays}
        onToggleWeekday={toggleShareWeekday}
        availableDates={availableDates}
        onCopyDates={copyAvailableDates}
        shareLink=""
        onCopyLink={() => toast.info("Public availability links are coming soon.")}
        helperText="Public availability links aren't available yet — copy the dates above to share them."
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
            {
              key: "event",
              label: "Event",
              icon: "calendar",
              onSelect: () => navigate({ to: "/events" }),
            },
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
