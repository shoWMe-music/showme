import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Printer } from "lucide-react";

const PRINT_TABS = [
  { id: "details", label: "Event Details" },
  { id: "agreement", label: "Agreement" },
  { id: "crew", label: "Team / Crew" },
  { id: "settlement", label: "Settlement" },
] as const;

type PrintTab = typeof PRINT_TABS[number]["id"];

interface PrintEventDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  eventName: string;
  eventId: string;
}

export default function PrintEventDialog({ open, onOpenChange, eventName, eventId }: PrintEventDialogProps) {
  const [selected, setSelected] = useState<Set<PrintTab>>(new Set(["details", "agreement", "crew", "settlement"]));

  const toggle = (tab: PrintTab) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(tab)) next.delete(tab); else next.add(tab);
      return next;
    });
  };

  const handlePrint = () => {
    const tabs = Array.from(selected).join(",");
    const url = `/events/${eventId}?print=true&tabs=${tabs}`;
    const win = window.open(url, "_blank");
    if (win) {
      win.addEventListener("afterprint", () => win.close());
      win.addEventListener("load", () => {
        setTimeout(() => win.print(), 500);
      });
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Printer className="h-5 w-5 text-primary" /> Print Event
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{eventName}</p>
        <div className="space-y-3 py-2">
          <Label className="text-sm font-medium">Select sections to print:</Label>
          {PRINT_TABS.map(tab => (
            <div key={tab.id} className="flex items-center gap-3">
              <Checkbox
                id={`print-${tab.id}`}
                checked={selected.has(tab.id)}
                onCheckedChange={() => toggle(tab.id)}
              />
              <Label htmlFor={`print-${tab.id}`} className="text-sm cursor-pointer">{tab.label}</Label>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handlePrint} disabled={selected.size === 0} className="gap-2">
            <Printer className="h-4 w-4" /> Print
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
