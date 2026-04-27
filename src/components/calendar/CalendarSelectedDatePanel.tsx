import { format, parseISO, isSameDay } from "date-fns";
import { CalendarOff, Eye } from "lucide-react";
import { type Event as AppEvent, CalendarItem } from "@/lib/models";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { EVENT_STATUS_DOT, CALENDAR_ITEM_DOT, PopupItemType } from "./calendarConstants";

interface CalendarSelectedDatePanelProps {
  selectedDate: Date;
  activeEvents: AppEvent[];
  calendarItems: CalendarItem[];
  flatCombinedUnavailable: Set<string>;
  getEventEntityColor: (event: AppEvent) => string | undefined;
  onItemClick: (item: PopupItemType, e: React.MouseEvent) => void;
  onDayView: () => void;
  onClose: () => void;
}

export function CalendarSelectedDatePanel({
  selectedDate,
  activeEvents,
  calendarItems,
  flatCombinedUnavailable,
  getEventEntityColor,
  onItemClick,
  onDayView,
  onClose,
}: CalendarSelectedDatePanelProps) {
  const selEvents = activeEvents.filter(e => { try { return isSameDay(parseISO(e.date), selectedDate); } catch { return false; } });
  const selCalItems = calendarItems.filter(ci => ci.date === format(selectedDate, "yyyy-MM-dd"));

  return (
    <div className="mt-3 shrink-0">
      <div className="rounded-xl border bg-card shadow-sm p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <h2 className="font-display text-sm font-semibold">{format(selectedDate, "EEEE, MMMM d, yyyy")}</h2>
            {flatCombinedUnavailable.has(format(selectedDate, "yyyy-MM-dd")) && (
              <Badge variant="destructive" className="text-[10px]"><CalendarOff className="h-3 w-3 mr-1" />Unavailable</Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="text-xs h-7" onClick={onDayView}>
              <Eye className="h-3 w-3 mr-1" /> Day View
            </Button>
            <Button variant="ghost" size="sm" className="text-xs h-7" onClick={onClose}>Close</Button>
          </div>
        </div>
        {selEvents.length === 0 && selCalItems.length === 0 ? (
          <p className="text-sm text-muted-foreground">No items on this date</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {selEvents.map(event => {
              const color = getEventEntityColor(event);
              return (
                <button key={event.id} onClick={(e) => onItemClick({ kind: "event", data: event }, e)}
                  className="flex items-center gap-2 rounded-lg border bg-background p-2 pr-4 hover:bg-muted/50 transition-colors text-left">
                  {color ? (
                    <span className="h-8 w-1 rounded-full" style={{ backgroundColor: color }} />
                  ) : (
                    <span className={cn("h-8 w-1 rounded-full", EVENT_STATUS_DOT[event.eventStatus])} />
                  )}
                  <div>
                    <p className="text-sm font-medium">{event.name}</p>
                    <p className="text-xs text-muted-foreground">{event.artist} · {event.venue}</p>
                  </div>
                </button>
              );
            })}
            {selCalItems.map(ci => (
              <button key={ci.id} onClick={(e) => onItemClick({ kind: "calItem", data: ci }, e)}
                className="flex items-center gap-2 rounded-lg border bg-background p-2 pr-4 hover:bg-muted/50 transition-colors text-left">
                <span className={cn("h-8 w-1 rounded-full", CALENDAR_ITEM_DOT[ci.type])} />
                <div>
                  <p className="text-sm font-medium">{ci.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {ci.startTime && ` · ${ci.startTime}`}
                    {ci.endTime && ` – ${ci.endTime}`}
                    {ci.description ? ` · ${ci.description}` : ""}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
