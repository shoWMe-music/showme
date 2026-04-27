import { format, isToday } from "date-fns";
import { CalendarOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { EVENT_STATUS_COLORS } from "./calendarConstants";
import { CalendarViewSharedProps } from "./calendarViewTypes";

interface CalendarWeekViewProps extends CalendarViewSharedProps {
  weekViewDays: Date[];
}

export function CalendarWeekView({
  weekViewDays,
  eventsByDate,
  calendarItems,
  parentNameMap,
  flatCombinedUnavailable,
  dragOverTarget,
  hours,
  renderCalItemChip,
  getEventEntityColor,
  onItemClick,
  onHourCellClick,
  onDragOver,
  onDragLeave,
  onDrop,
  onWeekAllDayDrop,
}: CalendarWeekViewProps) {
  return (
    <div className="flex-1 rounded-xl border bg-card shadow-sm overflow-auto min-h-0 flex flex-col">
      {/* Week header */}
      <div className="grid grid-cols-[4rem_repeat(7,1fr)] border-b bg-muted/50 sticky top-0 z-10">
        <div className="border-r" />
        {weekViewDays.map((day, i) => {
          const today = isToday(day);
          const isUnavailable = flatCombinedUnavailable.has(format(day, "yyyy-MM-dd"));
          return (
            <div key={i} className={cn("px-2 py-2 text-center border-r", isUnavailable && "calendar-unavailable")}>
              <div className="text-[10px] uppercase font-medium text-muted-foreground">{format(day, "EEE")}</div>
              <div className={cn(
                "text-sm font-semibold mt-0.5 h-7 w-7 mx-auto flex items-center justify-center rounded-full",
                today && "bg-primary text-primary-foreground",
              )}>{format(day, "d")}</div>
              {isUnavailable && <CalendarOff className="h-3 w-3 text-destructive/60 mx-auto mt-0.5" />}
            </div>
          );
        })}
      </div>
      {/* All-day row */}
      {(() => {
        const hasAllDay = weekViewDays.some(day => {
          const k = format(day, "yyyy-MM-dd");
          return (eventsByDate.get(k)?.length || 0) > 0 || calendarItems.some(ci => ci.date === k && !ci.startTime);
        });
        if (!hasAllDay) return null;
        return (
          <div className="grid grid-cols-[4rem_repeat(7,1fr)] border-b">
            <div className="border-r px-2 py-1 text-[10px] text-muted-foreground text-right">All day</div>
            {weekViewDays.map((day, i) => {
              const k = format(day, "yyyy-MM-dd");
              const evts = eventsByDate.get(k) || [];
              const cis = calendarItems.filter(ci => ci.date === k && !ci.startTime);
              const isDragOver = dragOverTarget === k;
              return (
                <div key={i} className={cn("border-r p-1 flex flex-col gap-0.5", isDragOver && "bg-primary/10")}
                  onDragOver={(e) => onDragOver(e, k)}
                  onDragLeave={onDragLeave}
                  onDrop={(e) => onWeekAllDayDrop(e, k)}
                >
                  {(() => {
                    const parentGroups = new Map<string, typeof evts>();
                    const standalone: typeof evts = [];
                    evts.forEach(event => {
                      if (event.parentEventId && parentNameMap.has(event.parentEventId)) {
                        if (!parentGroups.has(event.parentEventId)) parentGroups.set(event.parentEventId, []);
                        parentGroups.get(event.parentEventId)!.push(event);
                      } else standalone.push(event);
                    });
                    return (
                      <>
                        {standalone.map(event => {
                          const color = getEventEntityColor(event);
                          return (
                            <button key={event.id} onClick={(e) => onItemClick({ kind: "event", data: event }, e)}
                              className={cn("text-[10px] px-1 py-0.5 rounded truncate font-medium border text-left flex items-center gap-0.5", EVENT_STATUS_COLORS[event.eventStatus], "hover:opacity-80")}>
                              {color && <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />}
                              {event.artist}
                            </button>
                          );
                        })}
                        {Array.from(parentGroups.entries()).map(([pid, children]) => (
                          <div key={pid}>
                            <div className="text-[8px] text-muted-foreground font-medium truncate" title={parentNameMap.get(pid)}>🎪 {parentNameMap.get(pid)}</div>
                            {children.map(event => {
                              const color = getEventEntityColor(event);
                              return (
                                <button key={event.id} onClick={(e) => onItemClick({ kind: "event", data: event }, e)}
                                  className={cn("text-[10px] px-1 py-0.5 rounded truncate font-medium border text-left ml-1 border-l-2 flex items-center gap-0.5", EVENT_STATUS_COLORS[event.eventStatus], "hover:opacity-80")}>
                                  {color && <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />}
                                  {event.artist}
                                </button>
                              );
                            })}
                          </div>
                        ))}
                      </>
                    );
                  })()}
                  {cis.map(ci => renderCalItemChip(ci, "text-[10px] px-1 py-0.5"))}
                </div>
              );
            })}
          </div>
        );
      })()}
      {/* Hourly grid */}
      <div className="flex-1">
        {hours.map(hour => {
          const hourStr = `${hour.toString().padStart(2, "0")}:`;
          return (
            <div key={hour} className="grid grid-cols-[4rem_repeat(7,1fr)] border-b min-h-[2.5rem]">
              <div className="border-r text-[10px] text-muted-foreground py-1 px-2 text-right">
                {format(new Date(2026, 0, 1, hour), "h a")}
              </div>
              {weekViewDays.map((day, i) => {
                const k = format(day, "yyyy-MM-dd");
                const hourItems = calendarItems.filter(ci => ci.date === k && ci.startTime?.startsWith(hourStr));
                const schedItems: { eventName: string; artist: string; label: string; isParent: boolean }[] = [];
                const dropKey = `${k}-${hour}`;
                const isDragOver = dragOverTarget === dropKey;
                return (
                  <div key={i} className={cn("border-r p-0.5 hover:bg-muted/30 transition-colors cursor-pointer", isDragOver && "bg-primary/10")}
                    onClick={(e) => onHourCellClick(day, hour, e)}
                    onDragOver={(e) => onDragOver(e, dropKey)}
                    onDragLeave={onDragLeave}
                    onDrop={(e) => onDrop(e, k, hour)}
                  >
                    {hourItems.map(ci => renderCalItemChip(ci, "text-[10px] px-1 py-0.5 block w-full", true))}
                    {schedItems.map((si, idx) => (
                      <span key={`ws-${idx}`} className="text-[10px] px-1 py-0.5 block w-full rounded border border-dashed border-primary/30 bg-primary/5 text-primary/80 italic truncate">
                        {si.isParent ? si.eventName : si.artist} — {si.label}
                      </span>
                    ))}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
