import { cn } from "@/lib/utils";
import { EventStatus, CalendarItemType } from "@/lib/models";
import { EVENT_STATUS_DOT, CALENDAR_ITEM_DOT } from "./calendarConstants";

const EVENT_LEGEND: [EventStatus, string][] = [
  ["suggested", "Suggested"], ["pending", "Pending"], ["confirmed", "Confirmed"],
  ["on_hold", "On Hold"], ["concluded", "Concluded"], ["cancelled", "Cancelled"],
];

const CAL_ITEM_LEGEND: [CalendarItemType, string][] = [
  ["task", "Task"], ["appointment", "Appointment"], ["note", "Note"],
];

export function CalendarLegend() {
  return (
    <div className="mb-2 flex items-center gap-2 text-[10px] text-muted-foreground flex-shrink-0 flex-wrap">
      {EVENT_LEGEND.map(([status, label]) => (
        <span key={status} className="flex items-center gap-1">
          <span className={cn("h-2 w-2 rounded-full", EVENT_STATUS_DOT[status])} />{label}
        </span>
      ))}
      <span className="text-border">|</span>
      {CAL_ITEM_LEGEND.map(([type, label]) => (
        <span key={type} className="flex items-center gap-1">
          <span className={cn("h-2 w-2 rounded-full", CALENDAR_ITEM_DOT[type])} />{label}
        </span>
      ))}
    </div>
  );
}
