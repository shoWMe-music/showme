import { Card } from "@showme/design-system";
import { type CalendarEvent, CalendarEventChip, type CalendarLabelMode } from "./CalendarEventChip";
import {
  CalendarUnavailableMark,
  MARKING_CURSOR,
  PENDING_RING,
  PENDING_TINT,
  dayCellBackground,
  unavailableSuffix,
} from "./CalendarUnavailableMark";
import { WEEKDAYS_SHORT, buildWeekGrid, dayKey } from "./calendarGrid";
import { useDayCellSelection } from "./useDayCellSelection";
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
  /** `yyyy-mm-dd` of the day the reader was sent to or jumped to, ringed so they
   * can see which one it was. */
  selectedDay?: string;
  events: CalendarEvent[];
  /** Days the acting profile has blocked, keyed `yyyy-mm-dd`. */
  unavailableDays?: UnavailableDays;
  labelMode?: CalendarLabelMode;
  onSelectDay?: (dayKey: string, anchor: DOMRect) => void;
  onSelectEvent?: (eventId: string) => void;
  /** Marking mode: the columns take an X cursor and become pickable instead of
   * clickable. See `useMarkUnavailable`. */
  markingMode?: boolean;
  /** Days picked in this marking session but not yet committed. */
  pendingDays?: ReadonlySet<string>;
  /** One marking gesture: a click, a shift-click, or a dragged run of columns. */
  onMarkDays?: (days: string[], modifiers?: { shiftKey?: boolean }) => void;
}

const TODAY_TINT = "color-mix(in srgb, var(--brand-red) 5%, transparent)";

/** A ring rather than a border, so marking a day cannot shift the number inside
 * the 24px circle by a pixel. */
const SELECTED_RING = "0 0 0 1px var(--brand-red)";

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
  selectedDay,
  events,
  unavailableDays,
  labelMode = "both",
  onSelectDay,
  onSelectEvent,
  markingMode = false,
  pendingDays,
  onMarkDays,
}: CalendarWeekGridProps) {
  const cells = buildWeekGrid(week);
  const todayKey = dayKey(new Date());
  const byDay = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    const bucket = byDay.get(event.date) ?? [];
    bucket.push(event);
    byDay.set(event.date, bucket);
  }

  const isMarking = markingMode && Boolean(onMarkDays);
  // One row of seven, so the shared rectangle degenerates to the run of columns
  // the pointer swept.
  const selection = useDayCellSelection(
    cells.map((cell) => cell.key),
    isMarking,
    onMarkDays,
  );

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
          // Today already wears the filled circle; ringing it as well would just
          // thicken it.
          const isSelected = cell.key === selectedDay && !isToday;
          const isUnavailable = unavailableDays?.has(cell.key) ?? false;
          const isPending = isMarking && pendingDays?.has(cell.key);
          const circleStyle: React.CSSProperties = {
            display: "inline-grid",
            placeItems: "center",
            width: 24,
            height: 24,
            borderRadius: "50%",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            fontWeight: isToday || isSelected ? 700 : 500,
            background: isToday ? "var(--brand-red)" : "transparent",
            color: isToday ? "#fff" : isSelected ? "var(--brand-red)" : "var(--muted)",
            boxShadow: isSelected ? SELECTED_RING : undefined,
          };
          // Inline span, for the same reason as the month grid: this circle is
          // `display: inline-grid`, which swallows a text decoration set on it.
          const dayNumber = (
            <span style={{ textDecoration: isUnavailable ? "line-through" : undefined }}>
              {cell.date.getDate()}
            </span>
          );
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
              {/* The week grid's columns are divs, not buttons, so outside marking
                  mode there is nothing here for a keyboard to focus. Marking mode
                  needs one — a drag-only way to block a night would be a
                  regression — so the day number becomes a real button for as long
                  as marking is on, and costs no tab stop the rest of the time. */}
              {isMarking ? (
                <button
                  type="button"
                  aria-label={`Mark ${cell.key}${unavailableSuffix(isUnavailable, unavailableDays?.get(cell.key) ?? null)}`}
                  aria-pressed={Boolean(isPending)}
                  // Safe to mark straight from the click: this button lives in the
                  // header row, OUTSIDE the drag container below, so nothing else
                  // has already reported the day.
                  onClick={(clickEvent) =>
                    onMarkDays?.([cell.key], { shiftKey: clickEvent.shiftKey })
                  }
                  style={{
                    ...circleStyle,
                    border: 0,
                    padding: 0,
                    cursor: MARKING_CURSOR,
                    boxShadow: isPending ? PENDING_RING : circleStyle.boxShadow,
                  }}
                >
                  {dayNumber}
                </button>
              ) : (
                <span style={circleStyle}>{dayNumber}</span>
              )}
            </div>
          );
        })}
      </div>

      <div
        style={{ display: "grid", gridTemplateColumns: WEEK_COLUMNS }}
        {...selection.containerProps}
      >
        {cells.map((cell, columnIndex) => {
          const dayEvents = byDay.get(cell.key) ?? [];
          const isToday = cell.key === todayKey;
          const isSelected = cell.key === selectedDay;
          const isUnavailable = unavailableDays?.has(cell.key) ?? false;
          const unavailableReason = unavailableDays?.get(cell.key) ?? null;
          const isPending =
            isMarking && (pendingDays?.has(cell.key) || selection.isInDrag(columnIndex));
          return (
            <div
              key={cell.key}
              aria-label={`${cell.key}${unavailableSuffix(isUnavailable, unavailableReason)}`}
              // Same contract as the month cell: a click anywhere selects the day,
              // and the keyboard route is the day-number button in the header row
              // above rather than a role on this div, which already contains the
              // event chips as real buttons. In marking mode the click belongs to
              // the pick-a-night gesture instead.
              onClick={
                isMarking
                  ? undefined
                  : (clickEvent) =>
                      onSelectDay?.(cell.key, clickEvent.currentTarget.getBoundingClientRect())
              }
              onKeyDown={(keyEvent) => {
                if (keyEvent.target !== keyEvent.currentTarget) return;
                if (keyEvent.key !== "Enter" && keyEvent.key !== " ") return;
                keyEvent.preventDefault();
                if (isMarking) {
                  onMarkDays?.([cell.key], { shiftKey: keyEvent.shiftKey });
                  return;
                }
                onSelectDay?.(cell.key, keyEvent.currentTarget.getBoundingClientRect());
              }}
              {...selection.cellProps(columnIndex)}
              style={{
                minHeight: 420,
                padding: 8,
                display: "flex",
                flexDirection: "column",
                borderRight: columnIndex === cells.length - 1 ? undefined : CELL_RULE,
                background: dayCellBackground(
                  isUnavailable,
                  isPending ? PENDING_TINT : isToday || isSelected ? TODAY_TINT : "transparent",
                ),
                boxShadow: isPending ? PENDING_RING : undefined,
                cursor: isMarking ? MARKING_CURSOR : onSelectDay ? "pointer" : "default",
              }}
            >
              {/* A week column is 420px tall, so the reason fits inline here in a
                  way it does not in a 104px month cell. */}
              {isUnavailable && <CalendarUnavailableMark reason={unavailableReason} showReason />}
              {/* `display: contents` + `inert` for the same reason as the month
                  grid: in marking mode a chip must not swallow the drag, nor take
                  a tab stop that navigates away mid-selection. */}
              <div style={{ display: "contents" }} inert={isMarking || undefined}>
                {dayEvents.map((event) => (
                  <CalendarEventChip
                    key={event.id}
                    event={event}
                    labelMode={labelMode}
                    showTime
                    onSelect={onSelectEvent}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
