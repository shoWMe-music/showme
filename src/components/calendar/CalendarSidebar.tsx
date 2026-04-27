import { ChevronRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { CalendarEntity } from "./calendarConstants";

interface CalendarSidebarProps {
  calendarEntities: CalendarEntity[];
  visibleCalendars: Set<string>;
  collapsedGroups: Set<string>;
  entitiesByType: Record<string, CalendarEntity[]>;
  roomsByVenue: Record<string, CalendarEntity[]>;
  onClose: () => void;
  onToggleCalendar: (name: string) => void;
  onShowAll: () => void;
  onHideAll: () => void;
  onToggleGroup: (type: string) => void;
  onToggleVenueRooms: (venueName: string) => void;
}

const TYPE_LABELS: Record<string, string> = {
  venue: "Venues",
  artist: "Performers",
  festival: "Festivals",
};

export function CalendarSidebar({
  calendarEntities,
  visibleCalendars,
  collapsedGroups,
  entitiesByType,
  roomsByVenue,
  onClose,
  onToggleCalendar,
  onShowAll,
  onHideAll,
  onToggleGroup,
  onToggleVenueRooms,
}: CalendarSidebarProps) {
  return (
    <div className="w-48 shrink-0 rounded-xl border bg-card shadow-sm p-3 overflow-y-auto flex flex-col gap-2">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">My Calendars</h3>
        <Button variant="ghost" size="icon" className="h-5 w-5" onClick={onClose}>
          <X className="h-3 w-3" />
        </Button>
      </div>
      {/* Select all profiles */}
      <label className="flex items-center gap-2 rounded px-1 py-1 text-xs hover:bg-accent cursor-pointer border-b pb-2">
        <Checkbox
          checked={visibleCalendars.size === calendarEntities.length}
          onCheckedChange={() => {
            if (visibleCalendars.size === calendarEntities.length) onHideAll();
            else onShowAll();
          }}
          className="h-3.5 w-3.5"
        />
        <span className="font-medium">Select all</span>
      </label>
      {Object.entries(entitiesByType).map(([type, entities]) => {
        const isCollapsed = collapsedGroups.has(type);
        return (
          <div key={type}>
            <button
              type="button"
              onClick={() => onToggleGroup(type)}
              className="flex items-center gap-1 w-full text-[10px] uppercase font-medium text-muted-foreground px-1 py-1 hover:text-foreground transition-colors"
            >
              <ChevronRight className={cn("h-3 w-3 transition-transform", !isCollapsed && "rotate-90")} />
              {TYPE_LABELS[type] || type}
            </button>
            {!isCollapsed && entities.map(ce => {
              const venueRooms = ce.type === "venue" ? (roomsByVenue[ce.name] || []) : [];
              const isVenueCollapsed = collapsedGroups.has(`venue-rooms::${ce.name}`);
              return (
                <div key={ce.name}>
                  <label className="flex items-center gap-2 rounded px-1 py-1 text-xs hover:bg-accent cursor-pointer pl-4">
                    <Checkbox
                      checked={visibleCalendars.has(ce.name)}
                      onCheckedChange={() => onToggleCalendar(ce.name)}
                      className="h-3.5 w-3.5"
                      style={{ borderColor: ce.color, backgroundColor: visibleCalendars.has(ce.name) ? ce.color : undefined }}
                    />
                    <span className="truncate">{ce.displayName || ce.name}</span>
                    {venueRooms.length > 0 && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          onToggleVenueRooms(ce.name);
                        }}
                        className="ml-auto"
                      >
                        <ChevronRight className={cn("h-3 w-3 text-muted-foreground transition-transform", !isVenueCollapsed && "rotate-90")} />
                      </button>
                    )}
                  </label>
                  {venueRooms.length > 0 && !isVenueCollapsed && venueRooms.map(room => (
                    <label key={room.name} className="flex items-center gap-2 rounded px-1 py-1 text-xs hover:bg-accent cursor-pointer pl-7">
                      <Checkbox
                        checked={visibleCalendars.has(room.name)}
                        onCheckedChange={() => onToggleCalendar(room.name)}
                        className="h-3.5 w-3.5"
                        style={{ borderColor: room.color, backgroundColor: visibleCalendars.has(room.name) ? room.color : undefined }}
                      />
                      <span className="truncate">{room.displayName || room.name}</span>
                    </label>
                  ))}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
