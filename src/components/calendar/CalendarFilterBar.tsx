import { parseISO, startOfWeek } from "date-fns";
import { Eye, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { EVENT_STATUS_DOT } from "./calendarConstants";
import { ViewMode, CalendarEntity } from "./calendarConstants";

interface CalendarFilterBarProps {
  calendarEntities: CalendarEntity[];
  visibleCalendars: Set<string>;
  isSidebarOpen: boolean;
  filterStatus: string[];
  filterArtist: string;
  filterVenue: string;
  jumpDate: string;
  viewMode: ViewMode;
  onToggleSidebar: () => void;
  onSetFilterStatus: (fn: (prev: string[]) => string[]) => void;
  onSetFilterArtist: (v: string) => void;
  onSetFilterVenue: (v: string) => void;
  onSetJumpDate: (v: string) => void;
  onSetCurrentMonth: (d: Date) => void;
  onSetSelectedDate: (d: Date) => void;
  onSetWeekStart: (d: Date) => void;
  onSetDayViewDate: (d: Date) => void;
}

export function CalendarFilterBar({
  calendarEntities,
  visibleCalendars,
  isSidebarOpen,
  filterStatus,
  filterArtist,
  filterVenue,
  jumpDate,
  viewMode,
  onToggleSidebar,
  onSetFilterStatus,
  onSetFilterArtist,
  onSetFilterVenue,
  onSetJumpDate,
  onSetCurrentMonth,
  onSetSelectedDate,
  onSetWeekStart,
  onSetDayViewDate,
}: CalendarFilterBarProps) {
  const handleJump = () => {
    try {
      const d = parseISO(jumpDate);
      if (viewMode === "month") { onSetCurrentMonth(d); onSetSelectedDate(d); }
      else if (viewMode === "week") onSetWeekStart(startOfWeek(d, { weekStartsOn: 1 }));
      else onSetDayViewDate(d);
    } catch {}
  };

  return (
    <div className="mb-3 flex items-center gap-3 flex-wrap flex-shrink-0">
      {calendarEntities.length > 0 && (
        <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={onToggleSidebar}>
          <Layers className="h-3.5 w-3.5" />Calendars
          {visibleCalendars.size < calendarEntities.length && (
            <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">{visibleCalendars.size}/{calendarEntities.length}</Badge>
          )}
        </Button>
      )}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5">
            <Eye className="h-3.5 w-3.5" />Status
            {filterStatus.length > 0 && <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">{filterStatus.length}</Badge>}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-48 p-2" align="start">
          <div className="space-y-1">
            {(["draft", "suggested", "pending", "confirmed", "on_hold", "concluded", "cancelled"] as const).map(status => (
              <label key={status} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent cursor-pointer">
                <input
                  type="checkbox"
                  checked={filterStatus.includes(status)}
                  onChange={() => onSetFilterStatus(prev => prev.includes(status) ? prev.filter(s => s !== status) : [...prev, status])}
                  className="rounded border-input"
                />
                <span className={cn("h-2 w-2 rounded-full", EVENT_STATUS_DOT[status])} />
                <span className="capitalize">{status.replace("_", " ")}</span>
              </label>
            ))}
            {filterStatus.length > 0 && (
              <Button variant="ghost" size="sm" className="w-full h-7 text-xs mt-1" onClick={() => onSetFilterStatus(() => [])}>Clear</Button>
            )}
          </div>
        </PopoverContent>
      </Popover>
      <Input placeholder="Performer..." value={filterArtist} onChange={e => onSetFilterArtist(e.target.value)} className="h-8 w-36 text-xs" />
      <Input placeholder="Venue / Room..." value={filterVenue} onChange={e => onSetFilterVenue(e.target.value)} className="h-8 w-40 text-xs" />
      <div className="flex items-center gap-1.5">
        <Input type="date" value={jumpDate} onChange={e => onSetJumpDate(e.target.value)} className="h-8 w-36 text-xs" />
        {jumpDate && <Button variant="outline" size="sm" className="h-8 text-xs" onClick={handleJump}>Jump</Button>}
      </div>
      {(filterStatus.length > 0 || filterArtist || filterVenue) && (
        <Button variant="ghost" size="sm" className="h-8 text-xs text-destructive" onClick={() => { onSetFilterStatus(() => []); onSetFilterArtist(""); onSetFilterVenue(""); }}>
          Clear Filters
        </Button>
      )}
    </div>
  );
}
