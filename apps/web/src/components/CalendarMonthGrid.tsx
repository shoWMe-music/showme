import { Card, STATUSES, STATUS_LABEL, StatusDot } from "@showme/design-system";
import { type CalendarEvent, CalendarEventChip, type CalendarLabelMode } from "./CalendarEventChip";
import {
  CalendarUnavailableMark,
  dayCellBackground,
  unavailableSuffix,
} from "./CalendarUnavailableMark";
import type { EventMenuItem } from "./EventRowMenu";
import { WEEKDAYS_SHORT, buildMonthGrid, dayKey, trimTrailingWeeks } from "./calendarGrid";
import { Eyebrow } from "./primitives";
import type { UnavailableDays } from "./useMarkUnavailable";

/** The full month grid for the Calendar screen (§2), matching the Claude Design
 * prototype: one rounded card with hairline dividers (not gapped cells), tall
 * 104px day cells, a circular day number, and left-border status chips.
 * Presentational — the screen supplies resolved events; interaction via callbacks. */

/** Re-exported so the existing `components` barrel and its importers keep their
 * one import site, while the chip itself now lives beside the week/day views. */
export type { CalendarEvent, CalendarLabelMode } from "./CalendarEventChip";

export interface CalendarMonthGridProps {
  /** Any date within the month to render. */
  month: Date;
  events: CalendarEvent[];
  /** Days the acting profile has blocked, keyed `yyyy-mm-dd`. Omit for a grid
   * that has no availability to show (the mini month, a preview). */
  unavailableDays?: UnavailableDays;
  labelMode?: CalendarLabelMode;
  /** Optional cap on chips per day (collapses to "+N more"). Omit to show all. */
  maxPerDay?: number;
  showLegend?: boolean;
  /** Fires on a day-cell click; `anchor` is the cell's rect so callers can
   * position a popover against it. */
  onSelectDay?: (dayKey: string, anchor: DOMRect) => void;
  onSelectEvent?: (eventId: string) => void;
  onCreateAt?: (dayKey: string) => void;
  /**
   * What one event's overflow menu offers (archive today). Returns nothing for a
   * standalone calendar item — a task or a note is not an event and has nothing
   * to file. The chip hands it to the preview it opens; there is no room for a ⋮
   * on the chip itself.
   */
  eventMenuItems?: (event: CalendarEvent) => EventMenuItem[];
}

const TODAY_TINT = "color-mix(in srgb, var(--brand-red) 5%, transparent)";

/** The hairline that separates two cells. Drawn only BETWEEN cells — never on the
 * last column or last row — because the card already draws its own 1px border
 * there, and the two sitting flush would read as a doubled 2px outer edge. */
/** `1fr` alone is `minmax(auto, 1fr)`, so a single nowrap chip wider than its
 * share of the row stretches that column and squeezes the other six — the day
 * numbers then stop lining up with the weekday headers. `minmax(0, 1fr)` pins
 * the seven columns equal and lets the chip ellipsize, which is what it is
 * already styled to do. */
const WEEK_COLUMNS = "repeat(7, minmax(0, 1fr))";

const CELL_RULE = "1px solid var(--border)";

export function CalendarMonthGrid({
  month,
  events,
  unavailableDays,
  labelMode = "both",
  maxPerDay,
  showLegend = true,
  onSelectDay,
  onSelectEvent,
  onCreateAt,
  eventMenuItems,
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
            gridTemplateColumns: WEEK_COLUMNS,
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

        <div style={{ display: "grid", gridTemplateColumns: WEEK_COLUMNS }}>
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
            const isUnavailable = unavailableDays?.has(cell.key) ?? false;
            const unavailableReason = unavailableDays?.get(cell.key) ?? null;

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
                  background: dayCellBackground(
                    isUnavailable,
                    isToday ? TODAY_TINT : "transparent",
                  ),
                  cursor: onSelectDay ? "pointer" : "default",
                }}
              >
                <button
                  type="button"
                  // The cell's keyboard equivalent: this button is already in the tab
                  // order, so selecting the day from it costs no extra tab stops and
                  // needs no ARIA. It measures the CELL's rectangle, not its own, so the
                  // popover lands where a click would have put it.
                  aria-label={`Select ${cell.key}${unavailableSuffix(isUnavailable, unavailableReason)}`}
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
                    background: isToday ? "var(--brand-red)" : "transparent",
                    color: isToday ? "#fff" : "var(--muted)",
                  }}
                >
                  {/* The rule has to go on an INLINE span, not on the button:
                      the button is `display: inline-grid`, and a text decoration
                      set on a grid container does not paint on its grid items —
                      the computed style said `line-through` while the screen
                      showed a perfectly clean number. */}
                  <span style={{ textDecoration: isUnavailable ? "line-through" : undefined }}>
                    {cell.date.getDate()}
                  </span>
                </button>

                {isUnavailable && <CalendarUnavailableMark reason={unavailableReason} />}

                {visible.map((event) => (
                  <CalendarEventChip
                    key={event.id}
                    event={event}
                    labelMode={labelMode}
                    onSelect={onSelectEvent}
                    menuItems={eventMenuItems?.(event)}
                  />
                ))}

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
