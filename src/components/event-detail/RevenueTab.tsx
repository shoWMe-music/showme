import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { PenLine, RefreshCw, Plus, X, Search, List, Loader2 } from "lucide-react";
import { formatCurrency, type Event, type TicketRevenue, type TicketType, type ProviderEvent } from "@/lib/models";

interface RevenueTabProps {
  event: Event;
  revenue: TicketRevenue;
  updateRevenue: (eventId: string, revenue: TicketRevenue) => void;
}

export function RevenueTab({ event, revenue, updateRevenue }: RevenueTabProps) {
  const isEmpty = revenue.grossRevenue === 0 && revenue.ticketsSold === 0 && revenue.doorSales === 0;
  const [mode, setMode] = useState<"choose" | "manual" | "display">(isEmpty ? "choose" : "display");
  const [syncOpen, setSyncOpen] = useState(false);

  const [ticketTypes, setTicketTypes] = useState<TicketType[]>(
    revenue.ticketTypes?.length ? [...revenue.ticketTypes] : [{ name: "General Admission", price: 0, sold: 0 }]
  );
  const [fees, setFees] = useState(String(revenue.ticketFees || ""));
  const [tax, setTax] = useState(String(revenue.tax || ""));
  const [refunds, setRefunds] = useState(String(revenue.refunds || ""));
  const [doorSales, setDoorSales] = useState(String(revenue.doorSales || ""));
  const [prodExpenses, setProdExpenses] = useState(String(revenue.productionExpenses || ""));
  const [addlCosts, setAddlCosts] = useState(String(revenue.additionalCosts || ""));

  const [syncTab, setSyncTab] = useState<"search" | "browse">("browse");
  const [searchEventId, setSearchEventId] = useState("");
  const [selectedProvider, setSelectedProvider] = useState<ProviderEvent | null>(null);
  const [syncing, setSyncing] = useState(false);

  const providerEvents: ProviderEvent[] = [];

  const calcGross = ticketTypes.reduce((sum, t) => sum + t.price * t.sold, 0);
  const calcSold = ticketTypes.reduce((sum, t) => sum + t.sold, 0);

  const addTicketType = () => setTicketTypes(prev => [...prev, { name: "", price: 0, sold: 0 }]);
  const removeTicketType = (i: number) => setTicketTypes(prev => prev.filter((_, idx) => idx !== i));
  const updateTicketType = (i: number, field: keyof TicketType, value: string) => {
    setTicketTypes(prev => prev.map((t, idx) =>
      idx === i ? { ...t, [field]: field === "name" ? value : parseFloat(value) || 0 } : t
    ));
  };

  const handleManualSave = () => {
    const newRevenue: TicketRevenue = {
      eventId: event.id, ticketsSold: calcSold, grossRevenue: calcGross,
      ticketFees: parseFloat(fees) || 0, tax: parseFloat(tax) || 0,
      refunds: parseFloat(refunds) || 0, doorSales: parseFloat(doorSales) || 0,
      productionExpenses: parseFloat(prodExpenses) || 0, additionalCosts: parseFloat(addlCosts) || 0,
      ticketTypes,
    };
    updateRevenue(event.id, newRevenue);
    setMode("display");
  };

  const handleSync = () => {
    if (!selectedProvider) return;
    setSyncing(true);
    setTimeout(() => {
      const p = selectedProvider;
      const gross = p.ticketTypes.reduce((s, t) => s + t.price * t.sold, 0);
      const sold = p.ticketTypes.reduce((s, t) => s + t.sold, 0);
      const newRevenue: TicketRevenue = {
        eventId: event.id, ticketsSold: sold, grossRevenue: gross,
        ticketFees: p.ticketFees, tax: p.tax, refunds: p.refunds, doorSales: p.doorSales,
        productionExpenses: revenue.productionExpenses, additionalCosts: revenue.additionalCosts,
        ticketTypes: p.ticketTypes,
      };
      updateRevenue(event.id, newRevenue);
      setSyncing(false);
      setSyncOpen(false);
      setMode("display");
    }, 1500);
  };

  const netRevenue = revenue.grossRevenue + revenue.doorSales - revenue.ticketFees - revenue.tax - revenue.refunds - revenue.productionExpenses - revenue.additionalCosts;

  const SyncDialog = () => (
    <Dialog open={syncOpen} onOpenChange={setSyncOpen}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Sync from {event.ticketingProvider}</DialogTitle>
          <DialogDescription>Match this event with your ticketing provider data</DialogDescription>
        </DialogHeader>
        <div className="flex gap-1 border-b mb-4">
          {(["browse", "search"] as const).map(t => (
            <button key={t} onClick={() => setSyncTab(t)} className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${syncTab === t ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
              {t === "browse" ? <><List className="h-4 w-4 inline mr-1.5" />Active Events</> : <><Search className="h-4 w-4 inline mr-1.5" />Search by ID</>}
            </button>
          ))}
        </div>
        {syncTab === "browse" && (
          providerEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">No events are available from this provider yet. Use manual entry, or connect your ticketing integration when it is configured.</p>
          ) : (
            <RadioGroup value={selectedProvider?.providerId || ""} onValueChange={v => setSelectedProvider(providerEvents.find(e => e.providerId === v) || null)}>
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {providerEvents.map(pe => (
                  <label key={pe.providerId} className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer hover:bg-muted/50 transition-colors">
                    <RadioGroupItem value={pe.providerId} className="mt-1" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{pe.name}</p>
                      <p className="text-xs text-muted-foreground">{pe.artist} · {pe.venue} · {pe.date}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">ID: {pe.providerId} · {pe.ticketTypes.reduce((s, t) => s + t.sold, 0)} tickets sold</p>
                    </div>
                  </label>
                ))}
              </div>
            </RadioGroup>
          )
        )}
        {syncTab === "search" && (
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Event ID from {event.ticketingProvider}</Label>
              <Input placeholder="e.g. TM-88421" value={searchEventId} onChange={e => setSearchEventId(e.target.value)} />
            </div>
            {searchEventId && (() => {
              const match = providerEvents.find(e => e.providerId.toLowerCase() === searchEventId.toLowerCase());
              if (match) return (
                <div className="rounded-lg border p-3 bg-muted/30">
                  <p className="text-sm font-medium">{match.name}</p>
                  <p className="text-xs text-muted-foreground">{match.artist} · {match.venue} · {match.date}</p>
                  <Button size="sm" className="mt-2" onClick={() => { setSelectedProvider(match); setSyncTab("browse"); }}>Select</Button>
                </div>
              );
              return <p className="text-sm text-muted-foreground">No event found with that ID</p>;
            })()}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => setSyncOpen(false)}>Cancel</Button>
          <Button onClick={handleSync} disabled={!selectedProvider || syncing}>
            {syncing ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Syncing…</> : "Sync Data"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );

  if (mode === "choose") {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
        <button onClick={() => setMode("manual")} className="rounded-xl border-2 p-6 text-left transition-colors hover:border-primary">
          <PenLine className="h-7 w-7 mb-3 text-primary" />
          <h4 className="font-display font-semibold text-lg">Manual Entry</h4>
          <p className="mt-1 text-sm text-muted-foreground">Enter ticket types, prices, and revenue data manually</p>
        </button>
        <button onClick={() => setSyncOpen(true)} className="rounded-xl border-2 p-6 text-left transition-colors hover:border-primary">
          <RefreshCw className="h-7 w-7 mb-3 text-primary" />
          <h4 className="font-display font-semibold text-lg">Sync from {event.ticketingProvider}</h4>
          <p className="mt-1 text-sm text-muted-foreground">Import ticket data from your ticketing provider's API</p>
        </button>
        <SyncDialog />
      </div>
    );
  }

  if (mode === "manual") {
    return (
      <div className="rounded-xl border bg-card p-6 shadow-sm max-w-2xl space-y-5">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-lg font-semibold">Manual Revenue Entry</h3>
          <Button variant="ghost" size="sm" onClick={() => setMode(isEmpty ? "choose" : "display")}>Cancel</Button>
        </div>
        <div className="space-y-3">
          <Label className="text-sm font-semibold">Ticket Types</Label>
          {ticketTypes.map((tt, i) => (
            <div key={i} className="grid grid-cols-[1fr_80px_80px_32px] gap-2 items-end">
              <div className="space-y-1">
                {i === 0 && <Label className="text-xs text-muted-foreground">Name</Label>}
                <Input value={tt.name} onChange={e => updateTicketType(i, "name", e.target.value)} placeholder="Ticket name" />
              </div>
              <div className="space-y-1">
                {i === 0 && <Label className="text-xs text-muted-foreground">Price</Label>}
                <Input type="number" value={tt.price || ""} onChange={e => updateTicketType(i, "price", e.target.value)} placeholder="0" />
              </div>
              <div className="space-y-1">
                {i === 0 && <Label className="text-xs text-muted-foreground">Sold</Label>}
                <Input type="number" value={tt.sold || ""} onChange={e => updateTicketType(i, "sold", e.target.value)} placeholder="0" />
              </div>
              <Button variant="ghost" size="icon" className="h-10 w-8" onClick={() => removeTicketType(i)} disabled={ticketTypes.length <= 1}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={addTicketType}>
            <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Ticket Type
          </Button>
          <div className="flex justify-between text-sm rounded-lg bg-muted/50 px-3 py-2">
            <span className="text-muted-foreground">Auto-calculated: {calcSold} tickets · Gross Revenue</span>
            <span className="font-semibold font-display">{formatCurrency(calcGross)}</span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1"><Label className="text-xs text-muted-foreground">Ticket Fees</Label><Input type="number" value={fees} onChange={e => setFees(e.target.value)} placeholder="0" /></div>
          <div className="space-y-1"><Label className="text-xs text-muted-foreground">Tax</Label><Input type="number" value={tax} onChange={e => setTax(e.target.value)} placeholder="0" /></div>
          <div className="space-y-1"><Label className="text-xs text-muted-foreground">Refunds</Label><Input type="number" value={refunds} onChange={e => setRefunds(e.target.value)} placeholder="0" /></div>
          <div className="space-y-1"><Label className="text-xs text-muted-foreground">Door Sales</Label><Input type="number" value={doorSales} onChange={e => setDoorSales(e.target.value)} placeholder="0" /></div>
          <div className="space-y-1"><Label className="text-xs text-muted-foreground">Production Expenses</Label><Input type="number" value={prodExpenses} onChange={e => setProdExpenses(e.target.value)} placeholder="0" /></div>
          <div className="space-y-1"><Label className="text-xs text-muted-foreground">Additional Costs</Label><Input type="number" value={addlCosts} onChange={e => setAddlCosts(e.target.value)} placeholder="0" /></div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => setMode(isEmpty ? "choose" : "display")}>Cancel</Button>
          <Button onClick={handleManualSave}>Save Revenue Data</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display text-lg font-semibold">Ticket Revenue</h3>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setMode("manual")}><PenLine className="h-3.5 w-3.5 mr-1.5" /> Edit</Button>
            <Button variant="outline" size="sm" onClick={() => setSyncOpen(true)}><RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Re-sync</Button>
          </div>
        </div>
        {revenue.ticketTypes && revenue.ticketTypes.length > 0 && (
          <div className="mb-4">
            <h4 className="text-sm font-semibold mb-2">Ticket Breakdown</h4>
            <div className="rounded-lg border overflow-hidden">
              <div className="grid grid-cols-4 gap-2 bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground">
                <span>Type</span><span className="text-right">Price</span><span className="text-right">Sold</span><span className="text-right">Revenue</span>
              </div>
              {revenue.ticketTypes.map((tt, i) => (
                <div key={i} className="grid grid-cols-4 gap-2 px-3 py-2 text-sm border-t">
                  <span>{tt.name}</span>
                  <span className="text-right">{formatCurrency(tt.price)}</span>
                  <span className="text-right">{tt.sold.toLocaleString()}</span>
                  <span className="text-right font-medium">{formatCurrency(tt.price * tt.sold)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <dl className="space-y-3">
          {[
            { label: "Tickets Sold", value: revenue.ticketsSold.toLocaleString() },
            { label: "Gross Revenue", value: formatCurrency(revenue.grossRevenue) },
            { label: "Ticket Fees", value: `- ${formatCurrency(revenue.ticketFees)}` },
            { label: "Tax", value: `- ${formatCurrency(revenue.tax)}` },
            { label: "Refunds", value: `- ${formatCurrency(revenue.refunds)}` },
          ].map(({ label, value }) => (
            <div key={label} className="flex justify-between">
              <dt className="text-sm text-muted-foreground">{label}</dt>
              <dd className="text-sm font-medium">{value}</dd>
            </div>
          ))}
          <div className="border-t pt-3" />
          <h4 className="font-display font-semibold text-sm">Additional Revenue & Costs</h4>
          {[
            { label: "Door Sales", value: formatCurrency(revenue.doorSales) },
            { label: "Production Expenses", value: `- ${formatCurrency(revenue.productionExpenses)}` },
            { label: "Additional Costs", value: `- ${formatCurrency(revenue.additionalCosts)}` },
          ].map(({ label, value }) => (
            <div key={label} className="flex justify-between">
              <dt className="text-sm text-muted-foreground">{label}</dt>
              <dd className="text-sm font-medium">{value}</dd>
            </div>
          ))}
          <div className="border-t pt-3 flex justify-between">
            <span className="font-semibold">Net Revenue</span>
            <span className="font-bold font-display">{formatCurrency(netRevenue)}</span>
          </div>
        </dl>
      </div>
      <SyncDialog />
    </div>
  );
}
