import { useState } from "react";
import { format, addDays } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { CalendarEntity } from "./calendarConstants";

// ── Mark Range Dialog ──

export function MarkRangeDialog({ open, onOpenChange, onApply, calendarEntities, selectedEntity, onEntityChange }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onApply: (from: string, to: string, entity: string) => void;
  calendarEntities: CalendarEntity[];
  selectedEntity: string;
  onEntityChange: (entity: string) => void;
}) {
  const [from, setFrom] = useState(format(new Date(), "yyyy-MM-dd"));
  const [to, setTo] = useState(format(addDays(new Date(), 7), "yyyy-MM-dd"));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>Mark Date Range Unavailable</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
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
          <div><Label>From</Label><Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="mt-1" /></div>
          <div><Label>To</Label><Input type="date" value={to} onChange={e => setTo(e.target.value)} className="mt-1" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => { onApply(from, to, selectedEntity); onOpenChange(false); }}>Mark Unavailable</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
