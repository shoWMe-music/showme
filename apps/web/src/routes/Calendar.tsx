import { type getApiV1Calendar, useGetApiV1Calendar } from "@showme/api-client";
import { Card, Icon, Select, type Status, useToast } from "@showme/design-system";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { type CalendarEvent, type CalendarLabelMode, CalendarMonthGrid } from "../components";
import { AvailabilityShareModal } from "../components/AvailabilityShareModal";
import { CalendarCreatePopover } from "../components/CalendarCreatePopover";
import { CalendarDayAgenda } from "../components/CalendarDayAgenda";
import { CalendarFilterChip } from "../components/CalendarFilterChip";
import { CalendarItemCreateModal } from "../components/CalendarItemCreateModal";
import { CalendarJumpToDate } from "../components/CalendarJumpToDate";
import { CalendarWeekGrid } from "../components/CalendarWeekGrid";
import { ExternalCalendarCard } from "../components/ExternalCalendarCard";
import { MarkUnavailableModal } from "../components/MarkUnavailableModal";
import { MyCalendarsCard } from "../components/MyCalendarsCard";
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
import { useExternalCalendarEntries } from "../components/useExternalCalendarEntries";
import {
  type UnavailableDays,
  blocksOverlappingRange,
  unavailableDaysInRange,
  useMarkUnavailable,
} from "../components/useMarkUnavailable";
import { useAvailabilityShare } from "../hooks/useAvailabilityShare";
import { useCalendarSources } from "../hooks/useCalendarSources";
import { useCalendarVenueFilter } from "../hooks/useCalendarVenueFilter";
import { type EventItem, useAllEvents } from "../hooks/useEventList";
import { buildCalendarInventory, placeEvents } from "../lib/calendarInventory";
import { formatDay, parseDayLocal } from "../lib/format";
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
  // Imported entries take the muted `concluded` tint: they are the one kind on
  // this grid that is NOT shoWMe's, and reading as background is exactly right
  // for something that occupies a night without being a show. The palette is
  // fixed by the design system and every hue is already spoken for, so the tint
  // is shared and the WORD does the telling apart — the same trade this map
  // already makes for appointments (see below).
  external: "concluded",
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
  external: "External",
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
  // Same reasoning as Draft: imported entries are real rows on the grid, and a
  // filter that cannot name what is on screen is a filter that hides it with no
  // way back. Not added to LEGEND, which is verbatim from the prototype.
  { key: "External", label: "External", color: "#B8A99B" },
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

/**
 * Every day key from `date` to `endDate` inclusive; just `[date]` when the entry
 * does not span. Capped, because the bound comes from a row somebody else's
 * calendar wrote and a runaway range would draw a year of chips.
 *
 * The cursor is built from the string's own parts for the reason `toDayKey`
 * explains: `new Date("2026-10-10")` is UTC midnight, and reading it back with
 * local getters lands on the 9th anywhere west of Greenwich.
 */
const MAX_SPANNED_DAYS = 366;

function spannedDayKeys(date: string, endDate: string | null | undefined): string[] {
  const start = toDayKey(date);
  const end = endDate ? toDayKey(endDate) : start;
  if (end <= start) return [start];

  const [year, month, day] = start.split("-").map(Number);
  if (!year || !month || !day) return [start];

  const days: string[] = [];
  const cursor = new Date(year, month - 1, day);
  while (days.length < MAX_SPANNED_DAYS) {
    const key = dayKey(cursor);
    days.push(key);
    if (key >= end) break;
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
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
    border: "1px solid var(--control-border)",
    background: "var(--control-surface)",
    borderRadius: 10,
    padding: "9px 13px",
    // One height for every control — see tokens.css. Without it this field sat
    // shorter than the Select and the date fields beside it on the same row.
    minHeight: "var(--control-height)",
    lineHeight: "var(--control-line-height)",
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
    // These open a menu, so they are a select by another name — and they share a
    // row with the two text filters and the date field. One height for every
    // control, or the row does not line up (measured 35 against their 40).
    minHeight: "var(--control-height)",
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
    background: "linear-gradient(135deg,var(--brand-red),var(--brand-amber))",
    color: "#fff",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  };
}

/** The lozenge beside the prev/next squares — "Today", and the jump-to-date
 * trigger that sits with it. One height and one border for the whole cluster. */
function navPillStyle(): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
    padding: "0 15px",
    height: 36,
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: "var(--surface)",
    color: "var(--text)",
    fontSize: 13,
    fontWeight: 500,
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
    background: "var(--shape-fill)",
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
    background: active ? "var(--brand-red)" : "transparent",
    color: active ? "#fff" : "var(--muted)",
  };
}

/** Which calendar the Month / Week / Day segment selects. A switch rather than one
 * component with a `view` prop, because the three lay days out in genuinely
 * different ways and share only the chip. */
function CalendarGridForView({
  view,
  anchorDate,
  selectedDay,
  events,
  unavailableDays,
  labelMode,
  onSelectDay,
  onSelectEvent,
}: {
  view: CalendarView;
  anchorDate: Date;
  /** The day the reader was sent to (`?date=`) or jumped to, marked so they can
   * see WHICH night they landed on. The day view is that day, so it needs none. */
  selectedDay: string | null;
  events: CalendarEvent[];
  unavailableDays: UnavailableDays;
  labelMode: CalendarLabelMode;
  onSelectDay: (dayKey: string, anchor: DOMRect) => void;
  onSelectEvent: (eventId: string) => void;
}) {
  if (view === "week") {
    return (
      <CalendarWeekGrid
        week={anchorDate}
        selectedDay={selectedDay ?? undefined}
        events={events}
        unavailableDays={unavailableDays}
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
        unavailableDays={unavailableDays}
        labelMode={labelMode}
        onSelectDay={onSelectDay}
        onSelectEvent={onSelectEvent}
      />
    );
  }
  return (
    <CalendarMonthGrid
      month={anchorDate}
      selectedDay={selectedDay ?? undefined}
      events={events}
      unavailableDays={unavailableDays}
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
  // `?date=yyyy-mm-dd`: what makes every date printed elsewhere in the app a link
  // back to the night it names (`components/DateText`). Validated by the route,
  // so it is either a well-formed day or absent.
  const { date: linkedDay } = useSearch({ from: "/calendar" });

  // One cursor for all three views: the month, week or day it lands in is what
  // gets drawn, so switching view keeps the reader where they already were.
  // Seeded from the link so the first paint is already the right month — an
  // effect alone would show one frame of today and then jump.
  const [anchorDate, setAnchorDate] = useState(() => parseDayLocal(linkedDay) ?? new Date());
  // Which day the calendar is POINTED AT, marked on the grid. Only a link or a
  // jump sets it: stepping the period is browsing, not landing somewhere.
  const [selectedDay, setSelectedDay] = useState<string | null>(linkedDay ?? null);
  const [view, setView] = useState<CalendarView>("month");
  const [labelMode, setLabelMode] = useState<CalendarLabelMode>("eventName");
  const [performerFilter, setPerformerFilter] = useState("");
  const [shareOpen, setShareOpen] = useState(false);
  const [unavailableOpen, setUnavailableOpen] = useState(false);
  // The day "CREATE" popover: which day was clicked + the cell rect to anchor to.
  const [createAt, setCreateAt] = useState<{ dayKey: string; anchor: DOMRect } | null>(null);
  // The appointment/note composer the day popover opens, and the day it is for.
  const [newItem, setNewItem] = useState<{ kind: CalendarItemKind; dayKey: string } | null>(null);
  /** Status LABELS the reader has switched off. Hidden rather than shown, so a
   * kind that gains a label later starts visible instead of silently missing. */
  const [hiddenStatuses, setHiddenStatuses] = useState<string[]>([]);

  // The API date params are inclusive bounds. Ask for the whole month(s) the view
  // touches rather than the seven or one visible days — see `queryRange`.
  const { from, to } = queryRange(view, anchorDate);
  const visibleRange = viewRange(view, anchorDate);

  const calendar = useGetApiV1Calendar({ from, to });
  // Every event: the grid is a month of the whole schedule, not of page one.
  const events = useAllEvents();
  // The calendars this user actually has — their venues, and the rooms inside
  // them. Replaces three hard-coded prototype labels that named a ROLE, not a
  // calendar (see `useCalendarSources`).
  const calendarSources = useCalendarSources();
  // Which of those calendars each show sits on, resolved once and used by both
  // the room filter and the rail's counts, so the two cannot disagree.
  const placements = useMemo(
    () => placeEvents(events.items, calendarSources.sources),
    [events.items, calendarSources.sources],
  );

  const calendarEvents = useMemo<CalendarEvent[]>(() => {
    // BOTH sources, concatenated: standalone calendar items (tasks, appointments,
    // notes) and the dated events. They come from different tables and share no
    // ids, so there is nothing to de-duplicate — and showing only one of them
    // would hide every event from anyone who had also written down a task.
    const items: CalendarEvent[] = (calendar.data ?? []).flatMap((item: CalendarItem) =>
      // One row can span days (an imported festival or holiday), and a grid draws
      // days — so a multi-day entry becomes one chip per day it covers. The chips
      // share the row's id with a day suffix, because React needs distinct keys
      // and nothing on the grid navigates by a calendar item's id.
      spannedDayKeys(item.date, item.endDate).map((day, index) => ({
        id: index === 0 ? item.id : `${item.id}@${day}`,
        date: day,
        eventName: item.title,
        performer: item.entity ?? undefined,
        startTime: item.startTime ?? undefined,
        status: TYPE_TO_STATUS[item.type] ?? "draft",
        statusLabel: TYPE_LABEL[item.type] ?? item.type,
      })),
    );
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

  // The rail's read-out: every calendar the reader has and what each is holding
  // in the period on screen. Counts are of the WHOLE period, deliberately not of
  // what survives the filters — narrowing to one room would otherwise zero every
  // other row and leave the reader nothing to click back to.
  const calendarInventory = useMemo(
    () => buildCalendarInventory(calendarSources.sources, placements, visibleEventIds),
    [calendarSources.sources, placements, visibleEventIds],
  );

  // Venue → room, and the rail's Rooms chip: one hook, one `hiddenRooms` array,
  // so the two controls cannot say different things about the same rooms.
  const venueFilter = useCalendarVenueFilter(
    events.items,
    calendarSources.sources,
    calendarInventory,
  );

  const performerNeedle = performerFilter.trim().toLowerCase();
  const hiddenStatusSet = new Set(hiddenStatuses);
  const visibleEvents: CalendarEvent[] = namedEvents.filter((event) => {
    if (event.statusLabel && hiddenStatusSet.has(event.statusLabel)) return false;

    // Where this show sits, when it sits at one of the reader's own venues.
    const placement = event.eventId ? placements.get(event.eventId) : undefined;
    if (!venueFilter.keepsEntry(event.eventId, placement)) return false;

    if (!performerNeedle) return true;
    const performerHaystack = `${event.performer ?? ""} ${event.eventName}`.toLowerCase();
    return performerHaystack.includes(performerNeedle);
  });

  // The share modal is a read-only composite: the hook owns the form, derives the
  // free nights of the SELECTED ROOM from the real schedule, and builds the
  // public link from the same computation.
  //
  // `calendarEvents` is deliberately not passed any more. It used to be a third
  // busy-source and it could never contribute one: the only calendar-item kinds
  // that exist are task / appointment / note / external, and none of them maps to
  // the `confirmed` or `hold` status the busy test looks for — while the dated
  // EVENTS inside it are the very list handed over beside it. Recorded and
  // imported blocks come from `GET /profiles/:id/availability`, which is the
  // route that actually knows about them.
  const share = useAvailabilityShare(events.items, calendarSources.sources);

  const periodTitle = viewTitle(view, anchorDate);

  // Blocked dates for the acting profile. Read on every render (not only while
  // the editor is open) so the rail can name what is blocked in this period.
  const markUnavailable = useMarkUnavailable(unavailableOpen, {
    onSaved: () => {
      setUnavailableOpen(false);
      toast.success("Blocked dates saved.");
    },
    onDayToggled: (day, isNowUnavailable) =>
      toast.success(isNowUnavailable ? `${day} marked unavailable.` : `${day} is available again.`),
    onDayToggleFailed: (message) => toast.error(message),
  });
  // The imported entries that touch what is on screen, plus the two writes the
  // rail card offers on each of them.
  const externalEntries = useExternalCalendarEntries(calendar.data ?? [], visibleRange);

  const blockedInView = blocksOverlappingRange(
    markUnavailable.savedBlocks,
    visibleRange.from,
    visibleRange.to,
  );

  // The same blocks, one entry per day, so a grid cell can ask about ITSELF
  // instead of scanning every range on every render.
  const unavailableDays = useMemo(
    () => unavailableDaysInRange(markUnavailable.savedBlocks, visibleRange.from, visibleRange.to),
    [markUnavailable.savedBlocks, visibleRange.from, visibleRange.to],
  );
  // Which way the day popover's availability item points, for the day it is open on.
  const selectedDayIsUnavailable = createAt ? unavailableDays.has(createAt.dayKey) : false;

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

  /**
   * Point the calendar at one day: the anchor moves so the period around it is
   * drawn, and the day itself is marked so the reader can see where they landed.
   *
   * `parseDayLocal` rather than `new Date(day)`, which the ES spec reads as UTC
   * midnight — anywhere west of Greenwich that anchored the day BEFORE the one
   * asked for, and Day view then showed the wrong night.
   */
  const goToDay = useCallback((day: string) => {
    const parsed = parseDayLocal(day);
    if (!parsed) return;
    setAnchorDate(parsed);
    setSelectedDay(day);
  }, []);

  // A `?date=` that changes while this screen is already mounted — one date link
  // followed from another. Deliberately keyed on the LINK alone: stepping the
  // month never touches the URL, so browsing away from the linked day cannot be
  // undone by this effect.
  useEffect(() => {
    if (linkedDay) goToDay(linkedDay);
  }, [linkedDay, goToDay]);

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
              style={navPillStyle()}
              onClick={() => goToDay(dayKey(new Date()))}
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
            {/* Beside Today, not among the filters: this moves the reader, it
                does not narrow what they see. */}
            <CalendarJumpToDate
              value={selectedDay ?? dayKey(anchorDate)}
              onSelect={goToDay}
              style={navPillStyle()}
            />
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
          {/* Offered only when there is something to tell apart. A venue with one
              room (or none recorded) has one calendar however it is sliced, and a
              filter with a single option is furniture. */}
          {venueFilter.roomFilterOptions.length > 0 && (
            <CalendarFilterChip
              label="Rooms"
              icon="grid"
              style={filterChipStyle()}
              options={venueFilter.roomFilterOptions}
              selected={venueFilter.roomFilterSelected}
              onToggle={venueFilter.toggleRoom}
              onSelectAll={venueFilter.showAllRooms}
              onSelectNone={venueFilter.hideAllRooms}
            />
          )}
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
          {/* Venue, then room: the two-step the one flat "Venue / Room…" box could
              never be. The room select stays disabled until a venue is picked,
              and says WHY when there is nothing to pick — one space, or a venue
              whose room roster is not the reader's to see. */}
          <div style={{ width: 178 }}>
            <Select
              value={venueFilter.venueProfileId}
              onChange={venueFilter.setVenueProfileId}
              options={venueFilter.venueOptions}
              aria-label="Filter by venue"
              placeholder="All venues"
            />
          </div>
          <div style={{ width: 178 }}>
            <Select
              value={venueFilter.roomKey}
              onChange={venueFilter.setRoomKey}
              options={venueFilter.roomOptions}
              disabled={venueFilter.roomsDisabled}
              aria-label="Filter by room or stage"
              placeholder={venueFilter.roomPlaceholder}
            />
          </div>
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
              selectedDay={selectedDay}
              events={visibleEvents}
              unavailableDays={unavailableDays}
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
                  color: "var(--brand-red)",
                  fontWeight: 500,
                }}
              >
                Edit blocked dates
              </button>
            </Card>

            <ExternalCalendarCard
              view={externalEntries}
              periodTitle={periodTitle}
              canCreateEvent={canCreateEvent}
              onOpenEvent={(eventId) => navigate({ to: "/events/$eventId", params: { eventId } })}
            />

            <MyCalendarsCard
              groups={calendarInventory}
              periodTitle={periodTitle}
              onManageRooms={() => navigate({ to: "/profiles" })}
            />
          </div>
        </div>
      </div>

      <AvailabilityShareModal
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        calendars={calendarSources.options}
        calendar={share.calendar}
        calendarLabel={share.calendarLabel}
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
          title={formatDay(createAt.dayKey)}
          onClose={() => setCreateAt(null)}
          // Blocking a day is not creating anything, so it sits in its own group
          // under the create list. Hidden entirely for a role the API would
          // refuse (viewer/crew), rather than shown and then rejected.
          secondaryGroup={
            markUnavailable.canEdit
              ? {
                  heading: "Availability",
                  options: [
                    {
                      key: "availability",
                      label: selectedDayIsUnavailable ? "Available again" : "Mark unavailable",
                      icon: selectedDayIsUnavailable ? ("check" as const) : ("x" as const),
                      disabled: markUnavailable.togglingDay !== null,
                      onSelect: () => markUnavailable.toggleDayUnavailable(createAt.dayKey),
                    },
                  ],
                }
              : undefined
          }
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
              // A hold IS an event with `status: "on_hold"` — the same wizard,
              // in hold mode, on the day that was clicked. Note the comment
              // that used to live here was wrong about the cost:
              // `CAP_COUNTING_EVENT_STATUSES` is confirmed|concluded, so going
              // on hold charges NOTHING. The slot is spent when the act
              // confirms, which is what the wizard's panel now says.
              onSelect: () =>
                openNewEvent({ initialDate: createAt.dayKey, initialStatus: "on_hold" }),
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
