import { Card, Icon } from "@showme/design-system";
import {
  WEEKDAYS_SHORT,
  buildMonthGrid,
  dayKey,
  monthTitle,
  trimTrailingWeeks,
} from "./calendarGrid";

/** The compact left-rail month picker (§8) — also reusable on the dashboard /
 * event date-picking. Marks days that have items with a dot and highlights the
 * selected day. Presentational: the screen owns the current month + selection. */
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
}

export function MiniMonthCalendar({
  month,
  markedDates,
  selected,
  onSelect,
  onNavigate,
}: MiniMonthCalendarProps) {
  const marked = new Set(markedDates ?? []);
  const cells = trimTrailingWeeks(buildMonthGrid(month));
  const todayKey = dayKey(new Date());

  return (
    <Card padding="md" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <button
          type="button"
          aria-label="Previous month"
          onClick={() => onNavigate?.(-1)}
          style={navButtonStyle}
        >
          <Icon name="chevron-right" size={16} style={{ transform: "rotate(180deg)" }} />
        </button>
        <span style={{ fontFamily: "var(--font-display)", fontSize: 15, color: "var(--text)" }}>
          {monthTitle(month)}
        </span>
        <button
          type="button"
          aria-label="Next month"
          onClick={() => onNavigate?.(1)}
          style={navButtonStyle}
        >
          <Icon name="chevron-right" size={16} />
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
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
              onClick={() => onSelect?.(cell.key)}
              aria-current={isToday ? "date" : undefined}
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
  background: "transparent",
  color: "var(--text)",
  cursor: "pointer",
} as const;
