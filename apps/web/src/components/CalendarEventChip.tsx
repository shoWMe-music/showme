import { STATUS_COLOR, type Status } from "@showme/design-system";
import { CalendarEntryPreview } from "./CalendarEntryPreview";
import { CountryTag } from "./CountryTag";
import { useCalendarEntryPreview } from "./useCalendarEntryPreview";

/** One entry on the calendar, and the chip that draws it. Lives here rather than
 * inside the month grid because all three calendar views (month, week, day) draw
 * the SAME chip — the views differ in how they lay days out, never in what an
 * entry looks like. */

export type CalendarLabelMode = "performer" | "eventName" | "both";

export interface CalendarEvent {
  id: string;
  /** `yyyy-mm-dd`. */
  date: string;
  eventName: string;
  /** Who is playing. Events carry a date but no performer of their own — the
   * name is resolved from the event's participants (see `calendarPerformers`),
   * so it is absent until that resolves, and absent forever for an event with
   * no performer on it yet. */
  performer?: string;
  /** `HH:mm` or `HH:mm:ss`. Only standalone calendar items (tasks, appointments,
   * notes) carry a clock time; events are dated, not timed. */
  startTime?: string;
  status: Status;
  /** What to call this entry in prose ("Confirmed", "Appointment"). The status
   * palette is shared between real event statuses and the three calendar-item
   * kinds, so several kinds land on the same tint — an appointment tinted like a
   * task must still be able to say "Appointment". */
  statusLabel?: string;
  /** Set only when this chip is a real event (not a standalone calendar item);
   * drives the click-through to the event workspace. */
  eventId?: string;
  /**
   * ISO 3166-1 alpha-2 of the venue's country, drawn as `SE 🇸🇪` before the label
   * (ClickUp `123qy9rnfab`). Absent for a standalone calendar item and for an
   * event whose venue is free text — neither has a country to claim.
   */
  country?: string | null;
  /**
   * WHAT THE DAY POPOVER SHOWS (ClickUp `123qy9rnk21`). Every one of these is
   * already on the events list the calendar draws from, which is why the preview
   * keeps its "deliberately no fetch" property — a month grid draws dozens of chips
   * and a request per click would be a storm for facts the grid already holds.
   *
   * All optional: a standalone calendar item has none of them, and an event whose
   * venue is free text has a name but no city.
   */
  venueName?: string | null;
  /** The venue's city, from its profile's primary location (`123qy9rnfab`). */
  city?: string | null;
  /** The hold's place in the queue, when this night is a hold at all. */
  holdRank?: number | null;
  /** Whether losing a higher hold promotes this one automatically. */
  holdAutoPromote?: boolean;
  /** Whether the show has a public page right now — the publish action's state. */
  published?: boolean;
  /** The reader's OWN capabilities on this event, so the popover offers only what
   * they may actually do (the lesson of QA4-9 on the events row menu). */
  capabilities?: readonly string[];
}

export function chipLabel(event: CalendarEvent, mode: CalendarLabelMode): string {
  if (mode === "performer") return event.performer ?? event.eventName;
  if (mode === "eventName") return event.eventName;
  return event.performer ? `${event.performer} · ${event.eventName}` : event.eventName;
}

/** `20:30:00` → `20:30`. Returns null for a missing or unrecognisable value, so a
 * malformed time is simply not shown rather than printed raw next to a title. */
export function formatStartTime(startTime: string | undefined): string | null {
  if (!startTime) return null;
  const match = /^(\d{2}):(\d{2})/.exec(startTime);
  return match ? `${match[1]}:${match[2]}` : null;
}

export interface CalendarEventChipProps {
  event: CalendarEvent;
  labelMode: CalendarLabelMode;
  /** Week and day cells are tall enough to carry the clock time; a month cell is
   * not, and the prototype's month chips show the title alone. */
  showTime?: boolean;
  onSelect?: (eventId: string) => void;
}

export function CalendarEventChip({
  event,
  labelMode,
  showTime = false,
  onSelect,
}: CalendarEventChipProps) {
  const color = STATUS_COLOR[event.status];
  const label = chipLabel(event, labelMode);
  const startTime = formatStartTime(event.startTime);
  // Every chip previews; only a real event has somewhere to go afterwards.
  const preview = useCalendarEntryPreview(event.eventId, onSelect);

  return (
    // `display: contents` so the wrapper is invisible to the day cell's flex
    // layout — it exists only to give the popover a node to test clicks against.
    <div ref={preview.wrapperRef} style={{ display: "contents" }}>
      <button
        ref={preview.triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={preview.open}
        onClick={(clickEvent) => {
          // The cell behind the chip opens its own "create" menu on click.
          clickEvent.stopPropagation();
          preview.toggle();
        }}
        // Without this a double-click on a chip also reaches the month cell and
        // opens the create modal on top of the preview.
        onDoubleClick={(clickEvent) => clickEvent.stopPropagation()}
        title={showTime && startTime ? `${startTime} ${label}` : label}
        style={{
          display: "block",
          width: "100%",
          textAlign: "left",
          cursor: "pointer",
          border: 0,
          borderLeft: `2px solid ${color.fg}`,
          borderRadius: 6,
          padding: "3px 7px",
          marginBottom: 3,
          fontSize: 11,
          fontWeight: 500,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          background: color.tint,
          color: color.fg,
        }}
      >
        {showTime && startTime && (
          <span
            style={{ fontFamily: "var(--font-mono)", fontSize: 10, marginRight: 6, opacity: 0.8 }}
          >
            {startTime}
          </span>
        )}
        {/* BEFORE the title, and it keeps its width while the title truncates.
            Ran asked for the country on every calendar entry *"for the Performers
            and agents to know"* — which is precisely the reader whose titles all
            say their own name, so the country is the part of this chip carrying
            information and the title is the part that can afford to be cut. */}
        {event.country && (
          <span style={{ marginRight: 5, opacity: 0.85 }}>
            <CountryTag country={event.country} size={10} />
          </span>
        )}
        {label}
      </button>

      {preview.open && preview.anchorRect && (
        <CalendarEntryPreview
          entry={event}
          time={startTime}
          anchor={preview.anchorRect}
          panelRef={preview.panelRef}
          onOpenEvent={preview.openEvent}
        />
      )}
    </div>
  );
}
