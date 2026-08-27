import { STATUS_COLOR, type Status } from "@showme/design-system";
import { CalendarEntryPreview } from "./CalendarEntryPreview";
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
