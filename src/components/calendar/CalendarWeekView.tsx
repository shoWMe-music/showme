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
  parentEventMap,
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
                    const childGroups = new Map<string, typeof evts>();
                    const standalone: typeof evts = [];
                    evts.forEach(event => {
                      if (event.parentEventId && parentEventMap.has(event.parentEventId)) {
                        if (!childGroups.has(event.parentEventId)) childGroups.set(event.parentEventId, []);
                        childGroups.get(event.parentEventId)!.push(event);
                      } else standalone.push(event);
                    });
                    const finalStandalone = standalone.filter(e => !childGroups.has(e.id));
                    const renderEventButton = (event: typeof evts[number], labelOverride?: string) => {
                      const color = getEventEntityColor(event);
                      const label = labelOverride ?? (event.artist || event.name);
                      return (
                        <button key={event.id} onClick={(e) => onItemClick({ kind: "event", data: event }, e)}
                          className={cn("text-[10px] px-1 py-0.5 rounded truncate font-medium border text-left flex items-center gap-0.5 w-full", EVENT_STATUS_COLORS[event.eventStatus], "hover:opacity-80")}>
                          {color && <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />}
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
                            <div key={pid} className="bg-muted/30 rounded-lg p-0.5 flex flex-col gap-0.5">
                              {renderEventButton(parent, parent.name)}
                              <div className="ml-2 pl-2 flex flex-col gap-0.5
                                [&>*]:relative
                                [&>*]:before:absolute [&>*]:before:-left-2 [&>*]:before:top-0 [&>*]:before:h-1/2 [&>*]:before:w-2
                                [&>*]:before:border-l [&>*]:before:border-b [&>*]:before:border-muted-foreground/30
                                [&>*:not(:last-child)]:after:absolute [&>*:not(:last-child)]:after:-left-2 [&>*:not(:last-child)]:after:top-1/2 [&>*:not(:last-child)]:after:bottom-[-2px] [&>*:not(:last-child)]:after:w-px [&>*:not(:last-child)]:after:bg-muted-foreground/30">
                                {children.map(event => (
                                  <div key={event.id}>{renderEventButton(event)}</div>
                                ))}
                              </div>
                            </div>
                          );
                        })}
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
