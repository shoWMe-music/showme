import { Card, Icon } from "@showme/design-system";
import type { CSSProperties, KeyboardEventHandler, ReactNode } from "react";
import { useEffect, useRef } from "react";
import { formatDayWithWeekday } from "../lib/format";
import {
  WEEKDAYS_SHORT,
  buildMonthGrid,
  dayKey,
  monthTitle,
  trimTrailingWeeks,
} from "./calendarGrid";

/** The compact left-rail month picker (§8) — also reusable on the dashboard /
 * event date-picking (it is the grid inside `DatePickerPopover`). Marks days
 * that have items with a dot and highlights the selected day. Presentational:
 * the screen owns the current month + selection. */
export interface MiniMonthCalendarProps {
  /** Any date within the month to render. */
  month: Date;
  /** `yyyy-mm-dd` keys of days that have items (rendered with a dot). */
  markedDates?: string[];
  /** Currently selected day, `yyyy-mm-dd`. */
  selected?: string;
  onSelect?: (dayKey: string) => void;
  /** Month step: -1 = previous, +1 = next. */
  onNavigate?: (offset: number) => void;
  /** Roving-focus day, `yyyy-mm-dd`. When set, that day is the grid's ONLY tab
   * stop (the standard roving-tabindex grid); omit it and every day stays
   * tabbable, which is what the always-visible left-rail calendar wants. */
  focusedDay?: string;
  /** Move real DOM focus onto `focusedDay`. The popover turns this on only while
   * the grid has keyboard control, so it never steals focus from someone typing
   * into the date field next to it. */
  autoFocusDay?: boolean;
  /** Key handling for the whole grid — arrow-key navigation belongs to the owner
   * of `focusedDay`, so the calendar itself stays free of navigation state. */
  onGridKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  /** Extra row below the grid (the popover's Today / Clear actions). */
  footer?: ReactNode;
  /** Style overrides for the surrounding card (the popover sets its width). */
  style?: CSSProperties;
}

export function MiniMonthCalendar({
  month,
  markedDates,
  selected,
  onSelect,
  onNavigate,
  focusedDay,
  autoFocusDay = false,
  onGridKeyDown,
  footer,
  style,
}: MiniMonthCalendarProps) {
  const marked = new Set(markedDates ?? []);
  const cells = trimTrailingWeeks(buildMonthGrid(month));
  const todayKey = dayKey(new Date());
  const gridRef = useRef<HTMLDivElement>(null);

  // Follow the roving focus with real DOM focus, so arrow keys keep landing on a
  // focused element even when the step crosses into another month (the owner
  // swaps `month` and `focusedDay` together; this runs after that re-render).
  useEffect(() => {
    if (!autoFocusDay || !focusedDay) return;
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-day="${focusedDay}"]`)?.focus();
  }, [autoFocusDay, focusedDay]);

  return (
    <Card padding="md" style={{ display: "flex", flexDirection: "column", gap: 12, ...style }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <button
          type="button"
          aria-label="Previous month"
          onClick={() => onNavigate?.(-1)}
          tabIndex={focusedDay ? -1 : undefined}
          style={navButtonStyle}
        >
          <Icon name="chevron-right" size={16} style={{ transform: "rotate(180deg)" }} />
        </button>
        <span
          aria-live="polite"
          style={{ fontFamily: "var(--font-display)", fontSize: 15, color: "var(--text)" }}
        >
          {monthTitle(month)}
        </span>
        <button
          type="button"
          aria-label="Next month"
          onClick={() => onNavigate?.(1)}
          tabIndex={focusedDay ? -1 : undefined}
          style={navButtonStyle}
        >
          <Icon name="chevron-right" size={16} />
        </button>
      </div>

      <div
        ref={gridRef}
        onKeyDown={onGridKeyDown}
        style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}
      >
        {WEEKDAYS_SHORT.map((day) => (
          <span
            key={day}
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              color: "var(--muted)",
              textAlign: "center",
              padding: "2px 0",
            }}
          >
            {day[0]}
          </span>
        ))}
        {cells.map((cell) => {
          const isSelected = cell.key === selected;
          const isToday = cell.key === todayKey;
          return (
            <button
              key={cell.key}
              type="button"
              data-day={cell.key}
              onClick={() => onSelect?.(cell.key)}
              aria-current={isToday ? "date" : undefined}
              aria-label={formatDayWithWeekday(cell.key)}
              tabIndex={focusedDay ? (cell.key === focusedDay ? 0 : -1) : undefined}
              style={{
                position: "relative",
                aspectRatio: "1",
                border:
                  isToday && !isSelected
                    ? "1px solid var(--border-strong)"
                    : "1px solid transparent",
                borderRadius: 8,
                background: isSelected ? "var(--brand-red)" : "transparent",
                color: isSelected ? "#fff" : cell.inMonth ? "var(--text)" : "var(--dim)",
                fontSize: 13,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {cell.date.getDate()}
              {marked.has(cell.key) && !isSelected && (
                <span
                  style={{
                    position: "absolute",
                    bottom: 4,
                    width: 4,
                    height: 4,
                    borderRadius: "50%",
                    background: "var(--brand-gold)",
                  }}
                />
              )}
            </button>
          );
        })}
      </div>

      {footer}
    </Card>
  );
}

const navButtonStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 28,
  height: 28,
  border: "1px solid var(--border)",
  borderRadius: 8,
  background: "var(--button-surface)",
  color: "var(--text)",
  cursor: "pointer",
} as const;
