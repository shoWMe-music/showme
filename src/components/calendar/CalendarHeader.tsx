import { useState } from "react";
import { ChevronLeft, ChevronRight, CalendarOff, Share2, Upload, Download, Plus, Loader2 } from "lucide-react";
import { startOfWeek } from "date-fns";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ViewMode, CalendarEntity } from "./calendarConstants";

export type CalendarTitleDisplay = "event" | "performer" | "both";

interface CalendarHeaderProps {
  headerTitle: string;
  viewMode: ViewMode;
  markingMode: boolean;
  markingEntity: string;
  calendarEntities: CalendarEntity[];
  canCreate: boolean;
  selectedDate: Date | null;
  onNavigatePrev: () => void;
  onNavigateNext: () => void;
  onNavigateToday: () => void;
  onSetViewMode: (mode: ViewMode) => void;
  onSetWeekStart: (date: Date) => void;
  onSetDayViewDate: (date: Date) => void;
  onToggleMarkingMode: () => void;
  onSetMarkingEntity: (entity: string) => void;
  onMarkRangeOpen: () => void;
  onClearUnavailable: () => void;
  onShareOpen: () => void;
  onImportOpen: () => void;
  onCreateEvent: () => void;
  onExportICS?: () => void;
  isLoading?: boolean;
  titleDisplay?: CalendarTitleDisplay;
  onTitleDisplayChange?: (display: CalendarTitleDisplay) => void;
}

export function CalendarHeader({
  headerTitle,
  viewMode,
  markingMode,
  markingEntity,
  calendarEntities,
  canCreate,
  selectedDate,
  onNavigatePrev,
  onNavigateNext,
  onNavigateToday,
  onSetViewMode,
  onSetWeekStart,
  onSetDayViewDate,
  onToggleMarkingMode,
  onSetMarkingEntity,
  onMarkRangeOpen,
  onClearUnavailable,
  onShareOpen,
  onImportOpen,
  onCreateEvent,
  onExportICS,
  isLoading,
  titleDisplay,
  onTitleDisplayChange,
}: CalendarHeaderProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <>
    <div className="mb-4 flex flex-shrink-0 flex-col gap-3">
      <h1 className="font-display text-3xl font-bold tracking-tight flex items-center gap-2">
        {headerTitle}
        {isLoading && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
      </h1>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={onNavigatePrev}><ChevronLeft className="h-4 w-4" /></Button>
            <Button variant="outline" size="sm" className="h-8 px-3 text-xs" onClick={onNavigateToday}>Today</Button>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={onNavigateNext}><ChevronRight className="h-4 w-4" /></Button>
          </div>
          <div className="flex items-center rounded-lg border bg-muted/50 p-0.5">
            <Button variant={viewMode === "month" ? "default" : "ghost"} size="sm" className="h-7 px-3 text-xs" onClick={() => onSetViewMode("month")}>Month</Button>
            <Button variant={viewMode === "week" ? "default" : "ghost"} size="sm" className="h-7 px-3 text-xs" onClick={() => { onSetViewMode("week"); onSetWeekStart(startOfWeek(selectedDate || new Date(), { weekStartsOn: 1 })); }}>Week</Button>
            <Button variant={viewMode === "day" ? "default" : "ghost"} size="sm" className="h-7 px-3 text-xs" onClick={() => { onSetViewMode("day"); onSetDayViewDate(selectedDate || new Date()); }}>Day</Button>
          </div>
          {onTitleDisplayChange && (
            <div className="flex items-center rounded-lg border bg-muted/50 p-0.5">
              <Button variant={titleDisplay === "performer" ? "default" : "ghost"} size="sm" className="h-7 px-3 text-xs" onClick={() => onTitleDisplayChange("performer")}>Performer</Button>
              <Button variant={titleDisplay === "event" ? "default" : "ghost"} size="sm" className="h-7 px-3 text-xs" onClick={() => onTitleDisplayChange("event")}>Event Name</Button>
              <Button variant={titleDisplay === "both" ? "default" : "ghost"} size="sm" className="h-7 px-3 text-xs" onClick={() => onTitleDisplayChange("both")}>Both</Button>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant={markingMode ? "default" : "outline"} size="sm" className="gap-2 h-8 text-xs" onClick={onToggleMarkingMode}>
            <CalendarOff className="h-3.5 w-3.5" />{markingMode ? "Done Marking" : "Mark Unavailable"}
          </Button>
          {markingMode && (
            <>
              {calendarEntities.length > 1 && (
                <Select value={markingEntity} onValueChange={onSetMarkingEntity}>
                  <SelectTrigger className="h-8 w-40 text-xs"><SelectValue placeholder="Calendar..." /></SelectTrigger>
                  <SelectContent>
                    {calendarEntities.map(ce => (
                      <SelectItem key={ce.name} value={ce.name}>
                        <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: ce.color }} />{ce.name}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={onMarkRangeOpen}>Mark Range</Button>
              <Button variant="ghost" size="sm" className="h-8 text-xs text-destructive" onClick={() => setConfirmOpen(true)}>Clear All</Button>
            </>
          )}
          <Button variant="outline" size="sm" className="gap-2 h-8 text-xs" onClick={onShareOpen}>
            <Share2 className="h-3.5 w-3.5" /> Check & Share Availability
          </Button>
          {onExportICS && (
            <Button variant="outline" className="gap-2 h-8 text-xs" onClick={onExportICS}><Download className="h-3.5 w-3.5" /> Export ICS</Button>
          )}
          {canCreate && (
            <>
              <Button variant="outline" className="gap-2 h-8 text-xs" onClick={onImportOpen}><Upload className="h-3.5 w-3.5" /> Import</Button>
              <Button className="gap-2 h-8 text-xs" onClick={onCreateEvent}><Plus className="h-3.5 w-3.5" /> Create Event</Button>
            </>
          )}
        </div>
      </div>
    </div>

    <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Clear all unavailability?</AlertDialogTitle>
          <AlertDialogDescription>
            This will remove all marked unavailable dates for {markingEntity || "the selected calendar"}. This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={() => { onClearUnavailable(); setConfirmOpen(false); }}
          >
            Clear All
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
