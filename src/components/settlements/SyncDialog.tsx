import { List, Search, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { type ProviderEvent } from "@/lib/models";

export function SyncDialog({ open, onOpenChange, provider, providerEvents, syncTab, setSyncTab, searchEventId, setSearchEventId, selectedProvider, setSelectedProvider, syncing, onSync }: {
  open: boolean; onOpenChange: (o: boolean) => void;
  provider: string; providerEvents: ProviderEvent[];
  syncTab: "search" | "browse"; setSyncTab: (t: "search" | "browse") => void;
  searchEventId: string; setSearchEventId: (s: string) => void;
  selectedProvider: ProviderEvent | null; setSelectedProvider: (p: ProviderEvent | null) => void;
  syncing: boolean; onSync: () => void;
}) {
  const searchResult = searchEventId ? providerEvents.find(pe => pe.providerId.toLowerCase() === searchEventId.toLowerCase()) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Sync from {provider}</DialogTitle>
          <DialogDescription>Import ticketing data from {provider}</DialogDescription>
        </DialogHeader>
        <div className="flex gap-1 border-b mb-4">
          <button onClick={() => setSyncTab("browse")} className={cn("px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors", syncTab === "browse" ? "border-primary text-primary" : "border-transparent text-muted-foreground")}>
            <List className="h-3.5 w-3.5 inline mr-1.5" />Browse Events
          </button>
          <button onClick={() => setSyncTab("search")} className={cn("px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors", syncTab === "search" ? "border-primary text-primary" : "border-transparent text-muted-foreground")}>
            <Search className="h-3.5 w-3.5 inline mr-1.5" />Search by ID
          </button>
        </div>

        {syncTab === "browse" ? (
          providerEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">No events are available from this provider yet. Use manual entry, or connect your ticketing integration when it is configured.</p>
          ) : (
            <RadioGroup value={selectedProvider?.providerId || ""} onValueChange={v => setSelectedProvider(providerEvents.find(pe => pe.providerId === v) || null)}>
              <div className="space-y-2">
                {providerEvents.map(pe => (
                  <label key={pe.providerId} className={cn("flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors", selectedProvider?.providerId === pe.providerId ? "border-primary bg-primary/5" : "hover:bg-muted/50")}>
                    <RadioGroupItem value={pe.providerId} className="mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{pe.name}</p>
                      <p className="text-xs text-muted-foreground">{pe.artist} · {pe.venue} · {pe.date}</p>
                      <p className="text-xs text-muted-foreground mt-1">ID: {pe.providerId} · {pe.ticketTypes.reduce((s, t) => s + t.sold, 0)} tickets</p>
                    </div>
                  </label>
                ))}
              </div>
            </RadioGroup>
          )
        ) : (
          <div className="space-y-3">
            <div><Label className="text-xs">Provider Event ID</Label><Input value={searchEventId} onChange={e => setSearchEventId(e.target.value)} placeholder={`e.g. ${providerEvents[0]?.providerId || "EV-001"}`} className="mt-1 font-mono" /></div>
            {searchResult && (
              <div className="rounded-lg border p-3 bg-primary/5">
                <p className="text-sm font-medium">{searchResult.name}</p>
                <p className="text-xs text-muted-foreground">{searchResult.artist} · {searchResult.venue}</p>
                <Button size="sm" className="mt-2" onClick={() => { setSelectedProvider(searchResult); setSyncTab("browse"); }}>Select</Button>
              </div>
            )}
            {searchEventId && !searchResult && <p className="text-xs text-muted-foreground">No event found with this ID</p>}
          </div>
        )}

        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={onSync} disabled={!selectedProvider || syncing}>
            {syncing ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Syncing…</> : "Import Data"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
