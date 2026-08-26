import { Card, STATUS_COLOR, STATUS_LABEL } from "@showme/design-system";
import {
  type CalendarEvent,
  type CalendarLabelMode,
  chipLabel,
  formatStartTime,
} from "./CalendarEventChip";
import { dayKey, dayTitle } from "./calendarGrid";

/** One day of the Calendar screen (§2), read as an agenda rather than a grid.
 * Again NOT an hour ruler: events are dated, not timed, so the entries that know
 * their clock time sort to the top in time order and everything else sits under
 * "All day" — which is the truth about the data, where a 09:00 slot would not be. */

export interface CalendarDayAgendaProps {
  day: Date;
  events: CalendarEvent[];
  labelMode?: CalendarLabelMode;
  onSelectDay?: (dayKey: string, anchor: DOMRect) => void;
  onSelectEvent?: (eventId: string) => void;
}

/** Timed entries first, in clock order; undated-within-the-day entries after. */
function sortByStartTime(events: CalendarEvent[]): CalendarEvent[] {
  return [...events].sort((left, right) => {
    const leftTime = formatStartTime(left.startTime);
    const rightTime = formatStartTime(right.startTime);
    if (leftTime && rightTime) return leftTime.localeCompare(rightTime);
    if (leftTime) return -1;
    if (rightTime) return 1;
    return left.eventName.localeCompare(right.eventName);
  });
}

export function CalendarDayAgenda({
  day,
  events,
  labelMode = "both",
  onSelectDay,
  onSelectEvent,
}: CalendarDayAgendaProps) {
  const key = dayKey(day);
  const isToday = key === dayKey(new Date());
  const dayEvents = sortByStartTime(events.filter((event) => event.date === key));

  return (
    <Card padding="none" style={{ borderRadius: 16, overflow: "hidden" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "13px 16px",
          borderBottom: "1px solid var(--border)",
          background: isToday ? "rgba(238,87,70,.05)" : "transparent",
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{dayTitle(day)}</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--dim)" }}>
          {dayEvents.length} {dayEvents.length === 1 ? "ENTRY" : "ENTRIES"}
        </span>
      </div>

      {dayEvents.length === 0 ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 6,
            padding: "56px 16px",
          }}
        >
          <span style={{ fontSize: 13, color: "var(--muted)" }}>Nothing scheduled</span>
          <button
            type="button"
            onClick={(clickEvent) =>
              onSelectDay?.(key, clickEvent.currentTarget.getBoundingClientRect())
            }
            style={{
              border: "1px solid var(--border)",
              background: "var(--surface)",
              color: "var(--text)",
              borderRadius: 10,
              padding: "7px 13px",
              fontSize: 12.5,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Add to this day
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {dayEvents.map((event, index) => {
            const color = STATUS_COLOR[event.status];
            const time = formatStartTime(event.startTime);
            const clickable = Boolean(event.eventId);
            return (
              <button
                key={event.id}
                type="button"
                onClick={() => {
                  if (event.eventId) onSelectEvent?.(event.eventId);
                }}
                style={{
                  display: "grid",
                  gridTemplateColumns: "72px 3px minmax(0, 1fr) auto",
                  alignItems: "center",
                  gap: 12,
                  width: "100%",
                  textAlign: "left",
                  padding: "13px 16px",
                  border: 0,
                  borderTop: index === 0 ? undefined : "1px solid var(--border)",
                  background: "transparent",
                  cursor: clickable ? "pointer" : "default",
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 11.5,
                    color: time ? "var(--muted)" : "var(--dim)",
                  }}
                >
                  {time ?? "All day"}
                </span>
                <span style={{ height: 22, borderRadius: 2, background: color.fg }} />
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    color: "var(--text)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {chipLabel(event, labelMode)}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    padding: "3px 9px",
                    borderRadius: 999,
                    background: color.tint,
                    color: color.fg,
                  }}
                >
                  {event.statusLabel ?? STATUS_LABEL[event.status]}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </Card>
  );
}
