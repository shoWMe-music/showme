import { Card, STATUS_COLOR, STATUS_LABEL } from "@showme/design-system";
import {
  type CalendarEvent,
  type CalendarLabelMode,
  chipLabel,
  formatStartTime,
} from "./CalendarEventChip";
import {
  CalendarUnavailableMark,
  dayCellBackground,
  unavailableSuffix,
} from "./CalendarUnavailableMark";
import { type EventMenuItem, EventRowMenu, rowClickTargetStyle } from "./EventRowMenu";
import { dayKey, dayTitle } from "./calendarGrid";
import type { UnavailableDays } from "./useMarkUnavailable";

/** One day of the Calendar screen (§2), read as an agenda rather than a grid.
 * Again NOT an hour ruler: events are dated, not timed, so the entries that know
 * their clock time sort to the top in time order and everything else sits under
 * "All day" — which is the truth about the data, where a 09:00 slot would not be. */

export interface CalendarDayAgendaProps {
  day: Date;
  events: CalendarEvent[];
  /** Days the acting profile has blocked, keyed `yyyy-mm-dd`. */
  unavailableDays?: UnavailableDays;
  labelMode?: CalendarLabelMode;
  onSelectDay?: (dayKey: string, anchor: DOMRect) => void;
  onSelectEvent?: (eventId: string) => void;
  /**
   * What one entry's overflow menu offers (archive today). Returns nothing for a
   * standalone calendar item — a task or a note is not an event and has nothing
   * to file. Unlike the month/week chip, an agenda row is wide enough to carry
   * the ⋮ itself.
   */
  eventMenuItems?: (event: CalendarEvent) => EventMenuItem[];
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
  unavailableDays,
  labelMode = "both",
  onSelectDay,
  onSelectEvent,
  eventMenuItems,
}: CalendarDayAgendaProps) {
  const key = dayKey(day);
  const isToday = key === dayKey(new Date());
  const dayEvents = sortByStartTime(events.filter((event) => event.date === key));
  const isUnavailable = unavailableDays?.has(key) ?? false;
  const unavailableReason = unavailableDays?.get(key) ?? null;

  return (
    <Card padding="none" style={{ borderRadius: 16, overflow: "hidden" }}>
      <div
        aria-label={`${dayTitle(day)}${unavailableSuffix(isUnavailable, unavailableReason)}`}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "13px 16px",
          borderBottom: "1px solid var(--border)",
          background: dayCellBackground(
            isUnavailable,
            isToday ? "color-mix(in srgb, var(--brand-red) 5%, transparent)" : "transparent",
          ),
        }}
      >
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--text)",
            textDecoration: isUnavailable ? "line-through" : undefined,
          }}
        >
          {dayTitle(day)}
        </span>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 10,
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--dim)",
          }}
        >
          {/* A one-day view has the most room of the three, so the reason shows. */}
          {isUnavailable && <CalendarUnavailableMark reason={unavailableReason} showReason />}
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
            const menuItems = eventMenuItems?.(event) ?? [];
            return (
              <div
                key={event.id}
                style={{
                  position: "relative",
                  display: "grid",
                  // The trailing track is the menu's. `0` when there is nothing
                  // to offer, so a calendar item's row keeps its old geometry.
                  gridTemplateColumns: `72px 3px minmax(0, 1fr) auto ${
                    menuItems.length > 0 ? "32px" : "0px"
                  }`,
                  alignItems: "center",
                  gap: 12,
                  width: "100%",
                  textAlign: "left",
                  padding: "13px 16px",
                  borderTop: index === 0 ? undefined : "1px solid var(--border)",
                  background: "transparent",
                }}
              >
                {/* The row's click target, so the row can also carry a menu — see
                    `rowClickTargetStyle`. Only drawn when there is somewhere to
                    go: a task or a note has no page of its own. */}
                {clickable && (
                  <button
                    type="button"
                    aria-label={`Open ${event.eventName}`}
                    onClick={() => {
                      if (event.eventId) onSelectEvent?.(event.eventId);
                    }}
                    style={rowClickTargetStyle}
                  />
                )}
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
                {/* Positioned, so it paints ABOVE the stretched click target and
                    takes its own clicks rather than opening the event. */}
                {menuItems.length > 0 && (
                  <span style={{ position: "relative", justifySelf: "end" }}>
                    <EventRowMenu items={menuItems} label={`Actions for ${event.eventName}`} />
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
