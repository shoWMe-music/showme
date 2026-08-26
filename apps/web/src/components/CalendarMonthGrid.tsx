import {
  Card,
  STATUSES,
  STATUS_COLOR,
  STATUS_LABEL,
  type Status,
  StatusDot,
} from "@showme/design-system";
import { WEEKDAYS_SHORT, buildMonthGrid, dayKey, trimTrailingWeeks } from "./calendarGrid";
import { Eyebrow } from "./primitives";

/** The full month grid for the Calendar screen (§2), matching the Claude Design
 * prototype: one rounded card with hairline dividers (not gapped cells), tall
 * 104px day cells, a circular day number, and left-border status chips.
 * Presentational — the screen supplies resolved events; interaction via callbacks. */

export type CalendarLabelMode = "performer" | "eventName" | "both";

export interface CalendarEvent {
  id: string;
  /** `yyyy-mm-dd`. */
  date: string;
  eventName: string;
  performer?: string;
  status: Status;
  /** Set only when this chip is a real event (not a standalone calendar item);
   * drives the click-through to the event workspace. */
  eventId?: string;
}

export interface CalendarMonthGridProps {
  /** Any date within the month to render. */
  month: Date;
  events: CalendarEvent[];
  labelMode?: CalendarLabelMode;
  /** Reserved for the Month/Week/Day switch; the grid renders a month. */
  view?: "month" | "week" | "day";
  /** Optional cap on chips per day (collapses to "+N more"). Omit to show all. */
  maxPerDay?: number;
  showLegend?: boolean;
  /** Fires on a day-cell click; `anchor` is the cell's rect so callers can
   * position a popover against it. */
  onSelectDay?: (dayKey: string, anchor: DOMRect) => void;
  onSelectEvent?: (eventId: string) => void;
  onCreateAt?: (dayKey: string) => void;
}

const TODAY_TINT = "rgba(238,87,70,.05)";

/** The hairline that separates two cells. Drawn only BETWEEN cells — never on the
 * last column or last row — because the card already draws its own 1px border
 * there, and the two sitting flush would read as a doubled 2px outer edge. */
const CELL_RULE = "1px solid var(--border)";

function chipLabel(event: CalendarEvent, mode: CalendarLabelMode): string {
  if (mode === "performer") return event.performer ?? event.eventName;
  if (mode === "eventName") return event.eventName;
  return event.performer ? `${event.performer} · ${event.eventName}` : event.eventName;
}

export function CalendarMonthGrid({
  month,
  events,
  labelMode = "both",
  maxPerDay,
  showLegend = true,
  onSelectDay,
  onSelectEvent,
  onCreateAt,
}: CalendarMonthGridProps) {
  const cells = trimTrailingWeeks(buildMonthGrid(month));
  const todayKey = dayKey(new Date());
  const byDay = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    const bucket = byDay.get(event.date) ?? [];
    bucket.push(event);
    byDay.set(event.date, bucket);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* The month table: a single card with internal hairline dividers. */}
      <Card padding="none" style={{ borderRadius: 16, overflow: "hidden" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(7, 1fr)",
            borderBottom: "1px solid var(--border)",
          }}
        >
          {WEEKDAYS_SHORT.map((day, columnIndex) => (
            <div
              key={day}
              style={{
                padding: "11px 8px",
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: "var(--dim)",
                borderRight: columnIndex === WEEKDAYS_SHORT.length - 1 ? undefined : CELL_RULE,
              }}
            >
              {day.toUpperCase()}
            </div>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)" }}>
          {cells.map((cell, cellIndex) => {
            // Every cell carries the grid rules, out-of-month padding days included.
            // The prototype leaves those cells border-less, which tears a visible hole
            // in the table whenever a month starts or ends mid-week (August 2026 starts
            // on a Saturday: the whole first week loses its rules). We deliberately
            // depart from the prototype here so the hairlines stay continuous.
            const rules = {
              borderRight: cellIndex % 7 === 6 ? undefined : CELL_RULE,
              borderBottom: cellIndex >= cells.length - 7 ? undefined : CELL_RULE,
            };

            // Padding days get the rules and NOTHING else: no day number, no today
            // tint, no hover cursor, no click target. They must stay inert — a click
            // there would select a day outside the month being shown.
            if (!cell.inMonth) return <div key={cell.key} style={rules} />;

            const dayEvents = byDay.get(cell.key) ?? [];
            const visible = maxPerDay != null ? dayEvents.slice(0, maxPerDay) : dayEvents;
            const overflow = dayEvents.length - visible.length;
            const isToday = cell.key === todayKey;

            return (
              <div
                key={cell.key}
                // Clicking anywhere in the cell selects the day. The keyboard route is
                // the day-number button below, NOT a role/tabIndex on this div: the cell
                // already contains real buttons (the day number, every event chip), so
                // making it a button too would nest interactive elements. This handler
                // exists for the keyboard user who has focused the cell itself, and
                // ignores keys bubbling up from those inner controls.
                onClick={(clickEvent) =>
                  onSelectDay?.(cell.key, clickEvent.currentTarget.getBoundingClientRect())
                }
                onKeyDown={(keyEvent) => {
                  if (keyEvent.target !== keyEvent.currentTarget) return;
                  if (keyEvent.key !== "Enter" && keyEvent.key !== " ") return;
                  keyEvent.preventDefault();
                  onSelectDay?.(cell.key, keyEvent.currentTarget.getBoundingClientRect());
                }}
                onDoubleClick={() => onCreateAt?.(cell.key)}
                style={{
                  position: "relative",
                  minHeight: 104,
                  padding: 8,
                  display: "flex",
                  flexDirection: "column",
                  ...rules,
                  background: isToday ? TODAY_TINT : "transparent",
                  cursor: onSelectDay ? "pointer" : "default",
                }}
              >
                <button
                  type="button"
                  // The cell's keyboard equivalent: this button is already in the tab
                  // order, so selecting the day from it costs no extra tab stops and
                  // needs no ARIA. It measures the CELL's rectangle, not its own, so the
                  // popover lands where a click would have put it.
                  aria-label={`Select ${cell.key}`}
                  onClick={(clickEvent) => {
                    clickEvent.stopPropagation();
                    const cellElement = clickEvent.currentTarget.parentElement;
                    if (!cellElement) return;
                    onSelectDay?.(cell.key, cellElement.getBoundingClientRect());
                  }}
                  style={{
                    alignSelf: "flex-start",
                    display: "inline-grid",
                    placeItems: "center",
                    width: 24,
                    height: 24,
                    borderRadius: "50%",
                    border: "none",
                    cursor: "pointer",
                    padding: 0,
                    marginBottom: 5,
                    fontFamily: "var(--font-mono)",
                    fontSize: 12,
                    fontWeight: isToday ? 700 : 500,
                    background: isToday ? "#EE5746" : "transparent",
                    color: isToday ? "#fff" : "var(--muted)",
                  }}
                >
                  {cell.date.getDate()}
                </button>

                {visible.map((event) => {
                  const color = STATUS_COLOR[event.status];
                  const clickable = Boolean(onSelectEvent && event.eventId);
                  return (
                    <button
                      key={event.id}
                      type="button"
                      onClick={(clickEvent) => {
                        clickEvent.stopPropagation();
                        if (event.eventId) onSelectEvent?.(event.eventId);
                      }}
                      title={chipLabel(event, labelMode)}
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
                      {chipLabel(event, labelMode)}
                    </button>
                  );
                })}

                {overflow > 0 && (
                  <span style={{ fontSize: 11, color: "var(--muted)", paddingLeft: 2 }}>
                    +{overflow} more
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      {showLegend && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
          <Eyebrow>Status legend</Eyebrow>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
            {STATUSES.map((status) => (
              <span key={status} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <StatusDot status={status} size={10} />
                <span style={{ fontSize: 12, color: "var(--muted)" }}>{STATUS_LABEL[status]}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
