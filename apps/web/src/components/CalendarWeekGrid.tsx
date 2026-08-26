import { Card } from "@showme/design-system";
import { type CalendarEvent, CalendarEventChip, type CalendarLabelMode } from "./CalendarEventChip";
import {
  CalendarUnavailableMark,
  dayCellBackground,
  unavailableSuffix,
} from "./CalendarUnavailableMark";
import type { EventMenuItem } from "./EventRowMenu";
import { WEEKDAYS_SHORT, buildWeekGrid, dayKey } from "./calendarGrid";
import type { UnavailableDays } from "./useMarkUnavailable";

/** One week of the Calendar screen (§2): the month grid's seven columns, one week
 * tall. Deliberately NOT an hour-ruled time grid — an event carries a date and no
 * clock time in this data model, so hour rows would place every show at a time
 * nobody entered. Each column is therefore a tall day list, and the entries that
 * DO know their time (tasks, appointments, notes) print it on the chip.
 * Presentational — the screen supplies resolved events; interaction via callbacks. */

export interface CalendarWeekGridProps {
  /** Any date within the week to render. */
  week: Date;
  events: CalendarEvent[];
  /** Days the acting profile has blocked, keyed `yyyy-mm-dd`. */
  unavailableDays?: UnavailableDays;
  labelMode?: CalendarLabelMode;
  onSelectDay?: (dayKey: string, anchor: DOMRect) => void;
  onSelectEvent?: (eventId: string) => void;
  /**
   * What one event's overflow menu offers (archive today). Returns nothing for a
   * standalone calendar item — a task or a note is not an event and has nothing
   * to file. The chip hands it to the preview it opens; there is no room for a ⋮
   * on the chip itself.
   */
  eventMenuItems?: (event: CalendarEvent) => EventMenuItem[];
}

const TODAY_TINT = "color-mix(in srgb, var(--brand-red) 5%, transparent)";

/** Drawn only BETWEEN columns — the card draws the outer edge itself, and the two
 * flush against each other would read as a doubled 2px border. */
/** `1fr` alone is `minmax(auto, 1fr)`, so a single nowrap chip wider than its
 * share of the row stretches that column and squeezes the other six — the day
 * numbers then stop lining up with the weekday headers. `minmax(0, 1fr)` pins
 * the seven columns equal and lets the chip ellipsize, which is what it is
 * already styled to do. */
const WEEK_COLUMNS = "repeat(7, minmax(0, 1fr))";

const CELL_RULE = "1px solid var(--border)";

export function CalendarWeekGrid({
  week,
  events,
  unavailableDays,
  labelMode = "both",
  onSelectDay,
  onSelectEvent,
  eventMenuItems,
}: CalendarWeekGridProps) {
  const cells = buildWeekGrid(week);
  const todayKey = dayKey(new Date());
  const byDay = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    const bucket = byDay.get(event.date) ?? [];
    bucket.push(event);
    byDay.set(event.date, bucket);
  }

  return (
    <Card padding="none" style={{ borderRadius: 16, overflow: "hidden" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: WEEK_COLUMNS,
          borderBottom: "1px solid var(--border)",
        }}
      >
        {cells.map((cell, columnIndex) => {
          const isToday = cell.key === todayKey;
          const isUnavailable = unavailableDays?.has(cell.key) ?? false;
          return (
            <div
              key={cell.key}
              title={isUnavailable ? "Unavailable" : undefined}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "9px 10px",
                borderRight: columnIndex === cells.length - 1 ? undefined : CELL_RULE,
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 10,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  color: "var(--dim)",
                }}
              >
                {WEEKDAYS_SHORT[columnIndex]?.toUpperCase()}
              </span>
              <span
                style={{
                  display: "inline-grid",
                  placeItems: "center",
                  width: 24,
                  height: 24,
                  borderRadius: "50%",
                  fontFamily: "var(--font-mono)",
                  fontSize: 12,
                  fontWeight: isToday ? 700 : 500,
                  background: isToday ? "var(--brand-red)" : "transparent",
                  color: isToday ? "#fff" : "var(--muted)",
                }}
              >
                {/* Inline span, for the same reason as the month grid: this
                    circle is `display: inline-grid`, which swallows a text
                    decoration set on it. */}
                <span style={{ textDecoration: isUnavailable ? "line-through" : undefined }}>
                  {cell.date.getDate()}
                </span>
              </span>
            </div>
          );
        })}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: WEEK_COLUMNS }}>
        {cells.map((cell, columnIndex) => {
          const dayEvents = byDay.get(cell.key) ?? [];
          const isToday = cell.key === todayKey;
          const isUnavailable = unavailableDays?.has(cell.key) ?? false;
          const unavailableReason = unavailableDays?.get(cell.key) ?? null;
          return (
            <div
              key={cell.key}
              aria-label={`${cell.key}${unavailableSuffix(isUnavailable, unavailableReason)}`}
              // Same contract as the month cell: a click anywhere selects the day,
              // and the keyboard route is the day-number button in the header row
              // above rather than a role on this div, which already contains the
              // event chips as real buttons.
              onClick={(clickEvent) =>
                onSelectDay?.(cell.key, clickEvent.currentTarget.getBoundingClientRect())
              }
              onKeyDown={(keyEvent) => {
                if (keyEvent.target !== keyEvent.currentTarget) return;
                if (keyEvent.key !== "Enter" && keyEvent.key !== " ") return;
                keyEvent.preventDefault();
                onSelectDay?.(cell.key, keyEvent.currentTarget.getBoundingClientRect());
              }}
              style={{
                minHeight: 420,
                padding: 8,
                display: "flex",
                flexDirection: "column",
                borderRight: columnIndex === cells.length - 1 ? undefined : CELL_RULE,
                background: dayCellBackground(isUnavailable, isToday ? TODAY_TINT : "transparent"),
                cursor: onSelectDay ? "pointer" : "default",
              }}
            >
              {/* A week column is 420px tall, so the reason fits inline here in a
                  way it does not in a 104px month cell. */}
              {isUnavailable && <CalendarUnavailableMark reason={unavailableReason} showReason />}
              {dayEvents.map((event) => (
                <CalendarEventChip
                  key={event.id}
                  event={event}
                  labelMode={labelMode}
                  showTime
                  onSelect={onSelectEvent}
                  menuItems={eventMenuItems?.(event)}
                />
              ))}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
