import { useState, useCallback, useRef } from "react";
import { format, isSameMonth, isSameDay, isToday } from "date-fns";
import { CalendarOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { CalendarViewSharedProps } from "./calendarViewTypes";

const WEEK_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

interface CalendarMonthViewProps extends CalendarViewSharedProps {
  currentMonth: Date;
  calendarDays: Date[];
  selectedDate: Date | null;
  onSelectDays?: (dateKeys: string[]) => void;
}

function isInSelectionRect(index: number, start: number, end: number): boolean {
  const startRow = Math.floor(start / 7);
  const startCol = start % 7;
  const endRow = Math.floor(end / 7);
  const endCol = end % 7;
  const row = Math.floor(index / 7);
  const col = index % 7;
  return (
    row >= Math.min(startRow, endRow) &&
    row <= Math.max(startRow, endRow) &&
    col >= Math.min(startCol, endCol) &&
    col <= Math.max(startCol, endCol)
  );
}

export function CalendarMonthView({
  currentMonth,
  calendarDays,
  selectedDate,
  eventsByDate,
  calItemsByDate,
  parentNameMap,
  flatCombinedUnavailable,
  dragOverTarget,
  markingMode,
  renderCalItemChip,
  renderEventChip,
  onCellClick,
  onDragOver,
  onDragLeave,
  onDrop,
  onSelectDays,
}: CalendarMonthViewProps) {
  // Refs hold the authoritative values — no stale closure issues in commitSelection
  const isDragging = useRef(false);
  const movedCells = useRef(false);
  const startRef = useRef<number | null>(null);
  const endRef = useRef<number | null>(null);

  // State drives the visual highlight only
  const [selectionStart, setSelectionStart] = useState<number | null>(null);
  const [selectionEnd, setSelectionEnd] = useState<number | null>(null);

  const handleMouseDown = useCallback((index: number, e: React.MouseEvent) => {
    if (!markingMode) return;
    e.preventDefault();
    isDragging.current = true;
    movedCells.current = false;
    startRef.current = index;
    endRef.current = index;
    setSelectionStart(index);
    setSelectionEnd(index);
  }, [markingMode]);

  const handleMouseEnter = useCallback((index: number) => {
    if (!isDragging.current) return;
    if (startRef.current !== null && index !== startRef.current) {
      movedCells.current = true;
    }
    endRef.current = index;
    setSelectionEnd(index);
  }, []);

  // commitSelection reads from refs — always sees the latest values
  const commitSelection = useCallback(() => {
    if (!isDragging.current) return;
    isDragging.current = false;

    if (
      movedCells.current &&
      startRef.current !== null &&
      endRef.current !== null &&
      onSelectDays
    ) {
      const selected: string[] = [];
      calendarDays.forEach((day, i) => {
        if (isInSelectionRect(i, startRef.current!, endRef.current!)) {
          selected.push(format(day, "yyyy-MM-dd"));
        }
      });
      if (selected.length > 0) onSelectDays(selected);
    }

    startRef.current = null;
    endRef.current = null;
    setSelectionStart(null);
    setSelectionEnd(null);
    movedCells.current = false;
  }, [calendarDays, onSelectDays]);

  return (
    <div
      className="flex-1 shrink-0 rounded-xl border bg-card shadow-sm overflow-hidden flex flex-col min-h-0"
      onMouseUp={commitSelection}
      onMouseLeave={commitSelection}
    >
      <div className="grid grid-cols-7 border-b bg-muted/50">
        {WEEK_DAYS.map((d) => (
          <div key={d} className="px-2 py-2 text-xs font-medium text-muted-foreground text-center uppercase tracking-wider">{d}</div>
        ))}
      </div>
      <div className={cn("grid grid-cols-7 flex-1 auto-rows-fr min-h-0", markingMode && "select-none")}>
        {calendarDays.map((day, i) => {
          const dateKey = format(day, "yyyy-MM-dd");
          const dayEvents = eventsByDate.get(dateKey) || [];
          const dayCalItems = calItemsByDate.get(dateKey) || [];
          const totalItems = dayEvents.length + dayCalItems.length;
          const inMonth = isSameMonth(day, currentMonth);
          const today = isToday(day);
          const selected = selectedDate && isSameDay(day, selectedDate);
          const isUnavailable = flatCombinedUnavailable.has(dateKey);
          const isDragOver = dragOverTarget === dateKey;

          const inSelection =
            markingMode &&
            selectionStart !== null &&
            selectionEnd !== null &&
            isInSelectionRect(i, selectionStart, selectionEnd);

          return (
            <div
              key={i}
              onMouseDown={(e) => handleMouseDown(i, e)}
              onMouseEnter={() => handleMouseEnter(i)}
              onClick={(e) => {
                // If the user dragged across cells, suppress the click on release
                if (movedCells.current) return;
                onCellClick(day, e);
              }}
              onDragOver={(e) => onDragOver(e, dateKey)}
              onDragLeave={onDragLeave}
              onDrop={(e) => onDrop(e, dateKey)}
              className={cn(
                "group border-b border-r p-1 transition-colors overflow-hidden flex flex-col relative",
                !inMonth && "bg-muted/30",
                selected && "bg-primary/5 ring-1 ring-inset ring-primary/30",
                !selected && !isUnavailable && !inSelection && "hover:bg-muted/50",
                isUnavailable && "calendar-unavailable",
                markingMode ? "cursor-crosshair" : "cursor-pointer",
                isDragOver && "ring-2 ring-inset ring-primary/50 bg-primary/10",
                inSelection && "bg-primary/10 ring-2 ring-inset ring-primary/40",
              )}
            >
              <div className="flex items-center justify-between px-1 mb-0.5">
                <span className={cn(
                  "text-xs font-medium h-6 w-6 flex items-center justify-center rounded-full",
                  !inMonth && "text-muted-foreground/50",
                  today && "bg-primary text-primary-foreground",
                  !today && inMonth && "text-foreground",
                )}>{format(day, "d")}</span>
                <div className="flex items-center gap-1">
                  {isUnavailable && <CalendarOff className="h-3 w-3 text-destructive/60" />}
                  {totalItems > 0 && <span className="text-[10px] text-muted-foreground">{totalItems}</span>}
                </div>
              </div>
              <div className="flex flex-col gap-0.5 overflow-y-auto overflow-x-hidden flex-1 min-h-0 scrollbar-thin">
                {(() => {
                  const grouped: { parentName?: string; events: typeof dayEvents }[] = [];
                  const parentGroups = new Map<string, typeof dayEvents>();
                  const standalone: typeof dayEvents = [];
                  dayEvents.forEach(event => {
                    if (event.parentEventId && parentNameMap.has(event.parentEventId)) {
                      if (!parentGroups.has(event.parentEventId)) parentGroups.set(event.parentEventId, []);
                      parentGroups.get(event.parentEventId)!.push(event);
                    } else {
                      standalone.push(event);
                    }
                  });
                  standalone.forEach(e => grouped.push({ events: [e] }));
                  parentGroups.forEach((children, pid) => grouped.push({ parentName: parentNameMap.get(pid), events: children }));
                  return grouped.map((group, gi) => (
                    <div key={gi}>
                      {group.parentName && (
                        <div className="text-[9px] leading-tight px-1 text-muted-foreground font-medium truncate" title={group.parentName} />
                      )}
                      {group.events.map(event =>
                        renderEventChip(event, "text-[11px] leading-tight px-1.5 py-0.5", !!group.parentName)
                      )}
                    </div>
                  ));
                })()}
                {dayCalItems.map((ci) =>
                  renderCalItemChip(ci, "text-[11px] leading-tight px-1.5 py-0.5", true)
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
