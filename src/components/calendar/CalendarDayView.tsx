import { format } from "date-fns";
import { type Event as AppEvent, CalendarItem } from "@/lib/models";
import { cn } from "@/lib/utils";
import { EVENT_STATUS_COLORS } from "./calendarConstants";
import { CalendarViewSharedProps } from "./calendarViewTypes";
import { PopupItemType } from "./calendarConstants";

interface CalendarDayViewProps extends CalendarViewSharedProps {
  dayViewDate: Date;
  dayViewEvents: AppEvent[];
  dayViewCalItems: CalendarItem[];
}

export function CalendarDayView({
  dayViewDate,
  dayViewEvents,
  dayViewCalItems,
  parentEventMap,
  dragOverTarget,
  hours,
  renderCalItemChip,
  getEventEntityColor,
  onItemClick,
  onHourCellClick,
  onDragOver,
  onDragLeave,
  onDrop,
}: CalendarDayViewProps) {
  return (
    <div className="flex-1 rounded-xl border bg-card shadow-sm overflow-auto min-h-0">
      <div className="min-w-0">
        {/* All-day items */}
        {(dayViewEvents.length > 0 || dayViewCalItems.filter(ci => !ci.startTime).length > 0) && (
          <div className="border-b p-3">
            <p className="text-[10px] uppercase font-medium text-muted-foreground mb-2">All Day</p>
            <div className="flex flex-wrap gap-1.5">
              {(() => {
                const childGroups = new Map<string, typeof dayViewEvents>();
                const standalone: typeof dayViewEvents = [];
                dayViewEvents.forEach(event => {
                  if (event.parentEventId && parentEventMap.has(event.parentEventId)) {
                    if (!childGroups.has(event.parentEventId)) childGroups.set(event.parentEventId, []);
                    childGroups.get(event.parentEventId)!.push(event);
                  } else standalone.push(event);
                });
                const finalStandalone = standalone.filter(e => !childGroups.has(e.id));
                const renderEventButton = (event: typeof dayViewEvents[number], labelOverride?: string) => {
                  const color = getEventEntityColor(event);
                  const label = labelOverride ?? `${event.name}${event.artist ? ` — ${event.artist}` : ""}`;
                  return (
                    <button key={event.id} onClick={(e) => onItemClick({ kind: "event", data: event }, e)}
                      className={cn("text-xs px-2 py-1 rounded border font-medium flex items-center gap-1", EVENT_STATUS_COLORS[event.eventStatus], "hover:opacity-80")}>
                      {color && <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: color }} />}
                      {label}
                    </button>
                  );
                };
                return (
                  <>
                    {finalStandalone.map(event => renderEventButton(event))}
                    {Array.from(childGroups.entries()).map(([pid, children]) => {
                      const parent = parentEventMap.get(pid)!;
                      return (
                        <div key={pid} className="flex items-center gap-1 bg-muted/30 rounded-lg p-1">
                          {renderEventButton(parent, parent.name)}
                          <div className="flex items-center gap-1 pl-2 ml-1 border-l border-muted-foreground/30">
                            {children.map(event => renderEventButton(event, event.artist))}
                          </div>
                        </div>
                      );
                    })}
                  </>
                );
              })()}
              {dayViewCalItems.filter(ci => !ci.startTime).map(ci =>
                renderCalItemChip(ci, "text-xs px-2 py-1")
              )}
            </div>
          </div>
        )}
        {/* Hourly timeline */}
        {hours.map(hour => {
          const dateKey = format(dayViewDate, "yyyy-MM-dd");
          const hourStr = `${hour.toString().padStart(2, "0")}:`;
          const hourItems = dayViewCalItems.filter(ci => ci.startTime?.startsWith(hourStr));
          const scheduleItems: { eventName: string; artist: string; label: string; isParent: boolean }[] = [];
          const dropKey = `${dateKey}-${hour}`;
          const isDragOver = dragOverTarget === dropKey;
          return (
            <div key={hour}
              className={cn("flex border-b min-h-[3rem] hover:bg-muted/30 transition-colors cursor-pointer", isDragOver && "bg-primary/10")}
              onClick={(e) => onHourCellClick(dayViewDate, hour, e)}
              onDragOver={(e) => onDragOver(e, dropKey)}
              onDragLeave={onDragLeave}
              onDrop={(e) => onDrop(e, dateKey, hour)}
            >
              <div className="w-16 shrink-0 text-xs text-muted-foreground py-2 px-3 text-right border-r">
                {format(new Date(2026, 0, 1, hour), "h a")}
              </div>
              <div className="flex-1 p-1 flex flex-wrap gap-1">
                {hourItems.map(ci =>
                  renderCalItemChip(ci, "text-xs px-2 py-1", true)
                )}
                {scheduleItems.map((si, idx) => (
                  <span key={`sched-${idx}`} className="text-xs px-2 py-1 rounded border border-dashed border-primary/30 bg-primary/5 text-primary/80 italic truncate">
                    {si.isParent ? si.eventName : si.artist} — {si.label}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
