import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { CalendarEntity } from "./calendarConstants";

// ── Entity Selector for Marking Mode ──

export function EntitySelectorDialog({ open, onOpenChange, entities, onSelect }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  entities: CalendarEntity[];
  onSelect: (entity: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xs">
        <DialogHeader><DialogTitle>Which calendar?</DialogTitle></DialogHeader>
        <div className="space-y-1 py-2">
          {entities.map(ce => (
            <button
              key={ce.name}
              className="flex items-center gap-2 w-full rounded-md px-3 py-2 text-sm hover:bg-accent transition-colors text-left"
              onClick={() => { onSelect(ce.name); onOpenChange(false); }}
            >
              <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: ce.color }} />
              {ce.name}
              <span className="text-xs text-muted-foreground ml-auto capitalize">{ce.type}</span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
