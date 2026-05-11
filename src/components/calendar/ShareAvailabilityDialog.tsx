import { useState, useMemo } from "react";
import { format, addDays, parseISO, isToday, eachDayOfInterval } from "date-fns";
import { type Event as AppEvent } from "@/lib/models";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Copy, ClipboardList } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast, copyToast } from "@/hooks/use-toast";
import { CalendarEntity } from "./calendarConstants";

// ── Share Availability Dialog ──

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const DAY_INDICES = [1, 2, 3, 4, 5, 6, 0]; // JS getDay(): Mon=1..Sat=6, Sun=0

export function ShareAvailabilityDialog({ open, onOpenChange, unavailableDates, profileSlug, profileId, profileRole, ownerUid, calendarEntities, selectedEntity, onEntityChange, events }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  unavailableDates: Record<string, Set<string>>;
  profileSlug?: string;
  profileId?: string;
  profileRole?: string;
  /** Firebase auth uid of the operator sharing availability (routes booking requests). */
  ownerUid: string;
  calendarEntities: CalendarEntity[];
  selectedEntity: string;
  onEntityChange: (entity: string) => void;
  events: AppEvent[];
}) {
  const [fromDate, setFromDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [toDate, setToDate] = useState(format(addDays(new Date(), 30), "yyyy-MM-dd"));
  const [allAvailability, setAllAvailability] = useState(false);
  const [excludeConfirms, setExcludeConfirms] = useState(true);
  const [excludeHolds, setExcludeHolds] = useState(false);
  const [allowedDays, setAllowedDays] = useState<boolean[]>([true, true, true, true, true, true, true]);
  const timestamp = format(new Date(), "PPpp");

  const allFrom = format(new Date(), "yyyy-MM-dd");
  const allTo = format(addDays(new Date(), 365), "yyyy-MM-dd");

  const effectiveFrom = allAvailability ? allFrom : fromDate;
  const effectiveTo = allAvailability ? allTo : toDate;

  // Get unavailable dates for the selected entity
  const entityUnavailable = unavailableDates[selectedEntity] || new Set<string>();

  // Build event-based exclusion set
  const eventExcludedDates = useMemo(() => {
    const excluded = new Set<string>();
    const entityEvents = events.filter(e => !e.archived && (e.venue === selectedEntity || e.artist === selectedEntity));
    entityEvents.forEach(e => {
      if (excludeConfirms && e.eventStatus === "confirmed") excluded.add(e.date);
      if (excludeHolds && e.eventStatus === "on_hold") excluded.add(e.date);
    });
    return excluded;
  }, [events, selectedEntity, excludeConfirms, excludeHolds]);

  // Compute available dates
  const availableDates = useMemo(() => {
    if (!effectiveFrom || !effectiveTo || effectiveFrom > effectiveTo) return [];
    const from = parseISO(effectiveFrom);
    const to = parseISO(effectiveTo);
    const days = eachDayOfInterval({ start: from, end: to });
    return days.filter(d => {
      const dateStr = format(d, "yyyy-MM-dd");
      const jsDay = d.getDay(); // 0=Sun
      const dayIdx = DAY_INDICES.indexOf(jsDay);
      if (dayIdx >= 0 && !allowedDays[dayIdx]) return false;
      if (entityUnavailable.has(dateStr)) return false;
      if (eventExcludedDates.has(dateStr)) return false;
      return true;
    });
  }, [effectiveFrom, effectiveTo, allowedDays, entityUnavailable, eventExcludedDates]);

  // Combine all unavailable for share link
  const allUnavailable = useMemo(() => {
    const set = new Set(entityUnavailable);
    eventExcludedDates.forEach(d => set.add(d));
    // Add filtered-out weekdays
    if (effectiveFrom && effectiveTo && effectiveFrom <= effectiveTo) {
      const days = eachDayOfInterval({ start: parseISO(effectiveFrom), end: parseISO(effectiveTo) });
      days.forEach(d => {
        const jsDay = d.getDay();
        const dayIdx = DAY_INDICES.indexOf(jsDay);
        if (dayIdx >= 0 && !allowedDays[dayIdx]) {
          set.add(format(d, "yyyy-MM-dd"));
        }
      });
    }
    return set;
  }, [entityUnavailable, eventExcludedDates, effectiveFrom, effectiveTo, allowedDays]);

  const shareId = btoa(JSON.stringify({
    from: effectiveFrom,
    to: effectiveTo,
    unavailable: Array.from(allUnavailable),
    generated: new Date().toISOString(),
    profileSlug: profileSlug || null,
    profileId: profileId || null,
    profileRole: profileRole || null,
    calendarEntity: selectedEntity || null,
    ownerUid: ownerUid || null,
  }));

  const shareUrl = `${window.location.origin}/availability/${encodeURIComponent(shareId)}`;

  const toggleDay = (idx: number) => {
    setAllowedDays(prev => {
      const next = [...prev];
      next[idx] = !next[idx];
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader><DialogTitle>Check & Share Availability</DialogTitle></DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 py-2">
          {/* Left: Controls */}
          <div className="space-y-4">
            {calendarEntities.length > 1 && (
              <div>
                <Label>Calendar</Label>
                <Select value={selectedEntity} onValueChange={onEntityChange}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Select calendar" />
                  </SelectTrigger>
                  <SelectContent>
                    {calendarEntities.map(ce => (
                      <SelectItem key={ce.name} value={ce.name}>
                        <span className="flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: ce.color }} />
                          {ce.name}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="flex items-center gap-3">
              <Switch checked={allAvailability} onCheckedChange={setAllAvailability} />
              <Label className="text-sm">All availability (12 months)</Label>
            </div>
            {!allAvailability && (
              <div className="grid grid-cols-2 gap-3">
                <div><Label>From</Label><Input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="mt-1" /></div>
                <div><Label>To</Label><Input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="mt-1" /></div>
              </div>
            )}

            {/* Exclude filters */}
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground font-medium">Show as unavailable</Label>
              <div className="flex items-center gap-2">
                <Checkbox id="excl-confirms" checked={excludeConfirms} onCheckedChange={(v) => setExcludeConfirms(!!v)} />
                <label htmlFor="excl-confirms" className="text-sm cursor-pointer">Confirmed events</label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="excl-holds" checked={excludeHolds} onCheckedChange={(v) => setExcludeHolds(!!v)} />
                <label htmlFor="excl-holds" className="text-sm cursor-pointer">Held events</label>
              </div>
            </div>

            {/* Day-of-week selector */}
            <div>
              <Label className="text-xs text-muted-foreground font-medium">Days of the week</Label>
              <div className="flex gap-1 mt-1.5">
                {DAY_NAMES.map((day, idx) => (
                  <button
                    key={day}
                    onClick={() => toggleDay(idx)}
                    className={cn(
                      "h-8 w-9 rounded text-xs font-medium transition-colors border",
                      allowedDays[idx]
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-muted text-muted-foreground border-border hover:bg-accent"
                    )}
                  >
                    {day}
                  </button>
                ))}
              </div>
            </div>

            {/* Shareable link */}
            <div>
              <Label>Shareable Link</Label>
              <div className="mt-1 flex gap-2">
                <Input readOnly value={shareUrl} className="text-xs" />
                <Button variant="outline" size="icon" onClick={() => { navigator.clipboard.writeText(shareUrl); copyToast("Link copied!"); }}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="rounded-lg border bg-muted/50 p-3 text-xs text-muted-foreground">
              <p className="font-medium">Generated on {timestamp}</p>
              <p className="mt-1">Calendar: <strong>{selectedEntity || "All"}</strong></p>
              <p className="mt-1">Availabilities may change. This link reflects availability as of the timestamp above.</p>
            </div>
          </div>

          {/* Right: Available dates preview */}
          <div className="flex flex-col">
            <div className="flex items-center justify-between mb-2">
              <Label className="font-semibold">{availableDates.length} available date{availableDates.length !== 1 ? "s" : ""}</Label>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs gap-1"
                onClick={() => {
                  const text = availableDates.map(d => format(d, "EEEE, MMMM d, yyyy")).join("\n");
                  navigator.clipboard.writeText(text);
                  copyToast("Dates copied to clipboard!");
                }}
              >
                <ClipboardList className="h-3.5 w-3.5" /> Copy dates
              </Button>
            </div>
            <div className="border rounded-lg flex-1 min-h-0 max-h-[340px] overflow-y-auto" style={{ backgroundColor: "hsl(6 78% 57% / 0.04)" }}>
              {availableDates.length === 0 ? (
                <div className="flex items-center justify-center h-full py-8 text-sm text-muted-foreground">
                  No available dates in this range
                </div>
              ) : (
                <div className="divide-y">
                  {availableDates.map(d => (
                    <div key={format(d, "yyyy-MM-dd")} className="px-3 py-2 text-sm flex items-center justify-between">
                      <span>{format(d, "EEEE, MMM d, yyyy")}</span>
                      {isToday(d) && <Badge variant="outline" className="text-[10px] h-5">Today</Badge>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
