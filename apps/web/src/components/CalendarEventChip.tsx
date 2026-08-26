import { STATUS_COLOR, type Status } from "@showme/design-system";

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
  const clickable = Boolean(onSelect && event.eventId);
  const label = chipLabel(event, labelMode);
  const time = showTime ? formatStartTime(event.startTime) : null;

  return (
    <button
      type="button"
      onClick={(clickEvent) => {
        clickEvent.stopPropagation();
        if (event.eventId) onSelect?.(event.eventId);
      }}
      title={time ? `${time} ${label}` : label}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        cursor: clickable ? "pointer" : "default",
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
      {time && (
        <span
          style={{ fontFamily: "var(--font-mono)", fontSize: 10, marginRight: 6, opacity: 0.8 }}
        >
          {time}
        </span>
      )}
      {label}
    </button>
  );
}
