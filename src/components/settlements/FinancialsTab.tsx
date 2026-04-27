import { useState } from "react";
import { Plus, X, PenLine } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import VatSelector from "@/components/VatSelector";
import { FinancialsDisplayView } from "./FinancialsDisplayView";
import {
  formatCurrency, getCurrencySymbol,
  type Event as AppEvent, type DealStructure, type TicketRevenue, type TicketType,
  type AdditionalRevenueField, type CustomDeductionField, type CustomCostField, type VatInfo,
} from "@/lib/models";

export function FinancialsTab({ event, revenue, deal, updateRevenue, currency = "EUR" }: {
  event: AppEvent; revenue: TicketRevenue; deal?: DealStructure;
  updateRevenue: (eventId: string, rev: TicketRevenue) => void; currency?: string;
}) {
  const isEmpty = revenue.grossRevenue === 0 && revenue.ticketsSold === 0 && revenue.doorSales === 0;
  const storageKey = `financialsMode-${event.id}`;
  const [mode, setMode] = useState<"edit" | "display">(() => {
    const saved = localStorage.getItem(storageKey);
    if (saved === "edit" || saved === "display") return saved;
    return isEmpty ? "edit" : "display";
  });

  const [ticketTypes, setTicketTypes] = useState<TicketType[]>(revenue.ticketTypes?.length ? [...revenue.ticketTypes] : [{ name: "General Admission", price: 0, sold: 0 }]);
  const [doorSalesTypes, setDoorSalesTypes] = useState<TicketType[]>(revenue.doorSalesTypes?.length ? [...revenue.doorSalesTypes] : [{ name: "Door", price: 0, sold: 0 }]);
  const [additionalRevenue, setAdditionalRevenue] = useState<AdditionalRevenueField[]>(revenue.additionalRevenue || []);
  const [customDeductions, setCustomDeductions] = useState<CustomDeductionField[]>(revenue.additionalDeductions || []);
  const [customCosts, setCustomCosts] = useState<CustomCostField[]>(revenue.customCosts || []);
  const [venueRentalDismissed, setVenueRentalDismissed] = useState(false);
  const [venueRentalVat, setVenueRentalVat] = useState<VatInfo | undefined>(undefined);
  const [showVenueRentalDeleteWarning, setShowVenueRentalDeleteWarning] = useState(false);

  const calcGross = ticketTypes.reduce((sum, t) => sum + t.price * t.sold, 0);
  const calcSold = ticketTypes.reduce((sum, t) => sum + t.sold, 0);
  const calcDoorGross = doorSalesTypes.reduce((sum, t) => sum + t.price * t.sold, 0);

  const revenueSourceOptions = [
    { value: "ticketSales", label: "Ticket Sales" },
    { value: "doorSales", label: "Door Sales" },
    { value: "totalRevenue", label: "Total Revenue" },
    ...additionalRevenue.filter(r => r.name).map(r => ({ value: r.name, label: r.name })),
  ];

  const handleSave = () => {
    updateRevenue(event.id, {
      eventId: event.id, ticketsSold: calcSold, grossRevenue: calcGross,
      ticketFees: 0, tax: 0, refunds: 0,
      doorSales: calcDoorGross, productionExpenses: 0,
      additionalCosts: 0, ticketTypes, doorSalesTypes,
      additionalRevenue, additionalDeductions: customDeductions, customCosts,
    });
    setMode("display");
    localStorage.setItem(storageKey, "display");
    toast({ title: "Financials saved", description: "Revenue and deduction data has been updated." });
  };

  const totalRevenue = revenue.grossRevenue + revenue.doorSales + (revenue.additionalRevenue || []).reduce((s, r) => s + r.amount, 0);
  const venueRentalDeduction = deal && !venueRentalDismissed && (deal.venueRentalPaymentMode || "deduct_at_settlement") === "deduct_at_settlement" && deal.venueRental > 0 ? deal.venueRental : 0;
  const totalDeductions = (revenue.additionalDeductions || []).reduce((s, d) => {
      if (d.type === "percentage" && d.sourceField) {
        const src = d.sourceField === "ticketSales" ? revenue.grossRevenue : d.sourceField === "doorSales" ? revenue.doorSales : d.sourceField === "totalRevenue" ? totalRevenue : ((revenue.additionalRevenue || []).find(r => r.name === d.sourceField)?.amount || 0);
        return s + src * d.amount / 100;
      }
      return s + d.amount;
    }, 0) +
    (revenue.customCosts || []).reduce((s, c) => s + c.amount, 0) +
    venueRentalDeduction;
  const netRevenue = totalRevenue - totalDeductions;

  if (mode === "edit") {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-lg font-semibold">Edit Financials</h3>
        </div>

        {/* Revenue Area */}
        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <h4 className="text-sm font-semibold mb-4 text-primary">Revenue</h4>

          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <div>
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Ticket Sales</Label>
                <p className="text-[10px] text-muted-foreground mt-0.5">Ticket VAT is handled outside shoWMe by the event operator or ticket seller.</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => setTicketTypes(prev => [...prev, { name: "", price: 0, sold: 0 }])} className="gap-1 text-xs h-7"><Plus className="h-3 w-3" /> Add Type</Button>
            </div>
            <div className="space-y-2">
              <div className="grid grid-cols-[1fr_80px_80px_80px_32px] gap-2 text-xs text-muted-foreground font-medium">
                <span>Type</span><span>Price</span><span>Sold</span><span>Total</span><span />
              </div>
              {ticketTypes.map((t, i) => (
                <div key={i} className="grid grid-cols-[1fr_80px_80px_80px_32px] gap-2 items-center">
                  <Input value={t.name} onChange={e => setTicketTypes(prev => prev.map((tt, idx) => idx === i ? { ...tt, name: e.target.value } : tt))} placeholder="Ticket name" className="text-sm" />
                  <Input type="number" value={t.price || ""} onChange={e => setTicketTypes(prev => prev.map((tt, idx) => idx === i ? { ...tt, price: parseFloat(e.target.value) || 0 } : tt))} placeholder="Price" className="text-sm" />
                  <Input type="number" value={t.sold || ""} onChange={e => setTicketTypes(prev => prev.map((tt, idx) => idx === i ? { ...tt, sold: parseFloat(e.target.value) || 0 } : tt))} placeholder="Sold" className="text-sm" />
                  <span className="text-sm text-muted-foreground">{formatCurrency(t.price * t.sold, currency)}</span>
                  <button onClick={() => setTicketTypes(prev => prev.filter((_, idx) => idx !== i))} className="text-destructive hover:text-destructive/80"><X className="h-4 w-4" /></button>
                </div>
              ))}
              <div className="text-sm text-muted-foreground mt-1">Subtotal: {calcSold} tickets · {formatCurrency(calcGross, currency)}</div>
            </div>
          </div>

          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Door Sales</Label>
              <Button variant="outline" size="sm" onClick={() => setDoorSalesTypes(prev => [...prev, { name: "", price: 0, sold: 0 }])} className="gap-1 text-xs h-7"><Plus className="h-3 w-3" /> Add Type</Button>
            </div>
            <div className="space-y-2">
              <div className="grid grid-cols-[1fr_80px_80px_80px_32px] gap-2 text-xs text-muted-foreground font-medium">
                <span>Type</span><span>Price</span><span>Sold</span><span>Total</span><span />
              </div>
              {doorSalesTypes.map((t, i) => (
                <div key={i} className="grid grid-cols-[1fr_80px_80px_80px_32px] gap-2 items-center">
                  <Input value={t.name} onChange={e => setDoorSalesTypes(prev => prev.map((tt, idx) => idx === i ? { ...tt, name: e.target.value } : tt))} placeholder="Door type" className="text-sm" />
                  <Input type="number" value={t.price || ""} onChange={e => setDoorSalesTypes(prev => prev.map((tt, idx) => idx === i ? { ...tt, price: parseFloat(e.target.value) || 0 } : tt))} placeholder="Price" className="text-sm" />
                  <Input type="number" value={t.sold || ""} onChange={e => setDoorSalesTypes(prev => prev.map((tt, idx) => idx === i ? { ...tt, sold: parseFloat(e.target.value) || 0 } : tt))} placeholder="Sold" className="text-sm" />
                  <span className="text-sm text-muted-foreground">{formatCurrency(t.price * t.sold, currency)}</span>
                  <button onClick={() => setDoorSalesTypes(prev => prev.filter((_, idx) => idx !== i))} className="text-destructive hover:text-destructive/80"><X className="h-4 w-4" /></button>
                </div>
              ))}
              <div className="text-sm text-muted-foreground mt-1">Subtotal: {formatCurrency(calcDoorGross, currency)}</div>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Additional Revenue</Label>
              <Button variant="outline" size="sm" onClick={() => setAdditionalRevenue(prev => [...prev, { name: "", amount: 0 }])} className="gap-1 text-xs h-7"><Plus className="h-3 w-3" /> Add Field</Button>
            </div>
            {additionalRevenue.map((r, i) => (
              <div key={i} className="flex gap-2 items-center mb-2">
                <Input value={r.name} onChange={e => setAdditionalRevenue(prev => prev.map((rr, idx) => idx === i ? { ...rr, name: e.target.value } : rr))} placeholder="e.g. Merchandise" className="flex-1 text-sm" />
                <Input type="number" value={r.amount || ""} onChange={e => setAdditionalRevenue(prev => prev.map((rr, idx) => idx === i ? { ...rr, amount: parseFloat(e.target.value) || 0 } : rr))} placeholder="Amount" className="w-28 text-sm" />
                <VatSelector value={r.vat} onChange={vat => setAdditionalRevenue(prev => prev.map((rr, idx) => idx === i ? { ...rr, vat } : rr))} />
                <button onClick={() => setAdditionalRevenue(prev => prev.filter((_, idx) => idx !== i))} className="text-destructive hover:text-destructive/80"><X className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
        </div>

        {/* Deductions & Costs Area */}
        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <h4 className="text-sm font-semibold mb-4 text-destructive">Deductions & Costs</h4>

          {deal && !venueRentalDismissed && (deal.venueRentalPaymentMode || "deduct_at_settlement") === "deduct_at_settlement" && deal.venueRental > 0 && (
            <div className="mb-4 p-3 rounded-lg border border-dashed border-muted-foreground/30 bg-muted/30">
              <div className="flex justify-between items-center text-sm">
                <span className="font-medium flex items-center gap-2">Venue Rental <VatSelector value={venueRentalVat} onChange={setVenueRentalVat} /></span>
                <span className="flex items-center gap-2">
                  <span className="font-semibold">- {formatCurrency(deal.venueRental, currency)}</span>
                  {venueRentalVat && venueRentalVat.rate > 0 && (
                    <span className="text-[10px] text-muted-foreground">({venueRentalVat.mode === "included" ? `${venueRentalVat.rate}% VAT incl.` : `+ ${venueRentalVat.rate}% VAT`})</span>
                  )}
                  <button onClick={() => setShowVenueRentalDeleteWarning(true)} className="text-destructive hover:text-destructive/80"><X className="h-4 w-4" /></button>
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground mt-0.5">Auto-populated from deal structure</p>
            </div>
          )}
          <AlertDialog open={showVenueRentalDeleteWarning} onOpenChange={setShowVenueRentalDeleteWarning}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove Venue Rental from Settlement?</AlertDialogTitle>
                <AlertDialogDescription>This will permanently remove the venue rental deduction from this settlement's calculations. You can still manually add it back as a production cost or custom deduction if needed.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => setVenueRentalDismissed(true)}>Remove</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Production Costs</Label>
              <Button variant="outline" size="sm" onClick={() => setCustomCosts(prev => [...prev, { name: "", amount: 0, fromParty: "" }])} className="gap-1 text-xs h-7"><Plus className="h-3 w-3" /> Add Cost</Button>
            </div>
            {customCosts.map((c, i) => (
              <div key={i} className="flex gap-2 items-center mb-2">
                <Input value={c.name} onChange={e => setCustomCosts(prev => prev.map((cc, idx) => idx === i ? { ...cc, name: e.target.value } : cc))} placeholder="Cost name" className="flex-1 text-sm" />
                <Input type="number" value={c.amount || ""} onChange={e => setCustomCosts(prev => prev.map((cc, idx) => idx === i ? { ...cc, amount: parseFloat(e.target.value) || 0 } : cc))} placeholder="Amount" className="w-28 text-sm" />
                <Select value={c.fromParty || "__none__"} onValueChange={v => setCustomCosts(prev => prev.map((cc, idx) => idx === i ? { ...cc, fromParty: v === "__none__" ? "" : v } : cc))}>
                  <SelectTrigger className="w-32 text-sm"><SelectValue placeholder="Split by deal" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Split by deal structure</SelectItem>
                    <SelectItem value="promoter">Promoter</SelectItem>
                    <SelectItem value="venue">Venue</SelectItem>
                    <SelectItem value="artist">Performer</SelectItem>
                    <SelectItem value="organizer">Organizer</SelectItem>
                  </SelectContent>
                </Select>
                <VatSelector value={c.vat} onChange={vat => setCustomCosts(prev => prev.map((cc, idx) => idx === i ? { ...cc, vat } : cc))} />
                <button onClick={() => setCustomCosts(prev => prev.filter((_, idx) => idx !== i))} className="text-destructive hover:text-destructive/80"><X className="h-4 w-4" /></button>
              </div>
            ))}
          </div>

          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Deductions</Label>
              <Button variant="outline" size="sm" onClick={() => setCustomDeductions(prev => [...prev, { name: "", type: "fixed", amount: 0, sourceField: "", fromParty: "", toParty: "", partySplits: [{ party: "artist", percentage: 0 }, { party: "venue", percentage: 0 }, { party: "promoter", percentage: 0 }, { party: "organizer", percentage: 0 }] }])} className="gap-1 text-xs h-7"><Plus className="h-3 w-3" /> Add Deduction</Button>
            </div>
            {customDeductions.map((d, i) => (
              <div key={i} className="rounded-lg border p-3 mb-2 space-y-2">
                <div className="flex gap-2 items-center">
                  <Input value={d.name} onChange={e => setCustomDeductions(prev => prev.map((dd, idx) => idx === i ? { ...dd, name: e.target.value } : dd))} placeholder="Deduction name" className="flex-1 text-sm" />
                  <VatSelector value={d.vat} onChange={vat => setCustomDeductions(prev => prev.map((dd, idx) => idx === i ? { ...dd, vat } : dd))} />
                  <button onClick={() => setCustomDeductions(prev => prev.filter((_, idx) => idx !== i))} className="text-destructive hover:text-destructive/80"><X className="h-4 w-4" /></button>
                </div>
                <div className="flex gap-2 items-center">
                  <Select value={d.type} onValueChange={v => { const newType = v as "fixed" | "percentage"; setCustomDeductions(prev => prev.map((dd, idx) => idx === i ? { ...dd, type: newType, amount: newType === "percentage" ? 100 : 0 } : dd)); }}>
                    <SelectTrigger className="w-28 text-xs h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="fixed">Fixed</SelectItem>
                      <SelectItem value="percentage">Percentage</SelectItem>
                    </SelectContent>
                  </Select>
                  {d.type === "fixed" ? (
                    <div className="relative w-24">
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">{getCurrencySymbol(currency)}</span>
                      <Input type="number" value={d.amount || ""} onChange={e => setCustomDeductions(prev => prev.map((dd, idx) => idx === i ? { ...dd, amount: parseFloat(e.target.value) || 0 } : dd))} placeholder="0" className="pl-6 text-sm" />
                    </div>
                  ) : (
                    <>
                      <div className="relative w-20">
                        <Input type="number" value={d.amount || ""} onChange={e => setCustomDeductions(prev => prev.map((dd, idx) => idx === i ? { ...dd, amount: parseFloat(e.target.value) || 0 } : dd))} placeholder="0" className="pr-6 text-sm" />
                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">%</span>
                      </div>
                      <Select value={d.sourceField || ""} onValueChange={v => setCustomDeductions(prev => prev.map((dd, idx) => idx === i ? { ...dd, sourceField: v } : dd))}>
                        <SelectTrigger className="w-36 text-xs h-8"><SelectValue placeholder="Source field" /></SelectTrigger>
                        <SelectContent>
                          {revenueSourceOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </>
                  )}
                </div>
                {d.type === "fixed" ? (
                  <div className="flex gap-2 items-center">
                    <div className="flex-1">
                      <Label className="text-[10px] text-muted-foreground">From (who pays)</Label>
                      <Select value={d.fromParty || ""} onValueChange={v => setCustomDeductions(prev => prev.map((dd, idx) => idx === i ? { ...dd, fromParty: v } : dd))}>
                        <SelectTrigger className="text-sm mt-0.5"><SelectValue placeholder="Select party" /></SelectTrigger>
                         <SelectContent>
                          <SelectItem value="promoter">Promoter</SelectItem>
                          <SelectItem value="venue">Venue</SelectItem>
                          <SelectItem value="artist">Performer</SelectItem>
                          <SelectItem value="organizer">Organizer</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex-1">
                      <Label className="text-[10px] text-muted-foreground">To (who receives)</Label>
                      <Select value={d.toParty || ""} onValueChange={v => setCustomDeductions(prev => prev.map((dd, idx) => idx === i ? { ...dd, toParty: v } : dd))}>
                        <SelectTrigger className="text-sm mt-0.5"><SelectValue placeholder="Select party" /></SelectTrigger>
                         <SelectContent>
                          <SelectItem value="promoter">Promoter</SelectItem>
                          <SelectItem value="venue">Venue</SelectItem>
                          <SelectItem value="artist">Performer</SelectItem>
                          <SelectItem value="organizer">Organizer</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">Party Split (must total 100%)</Label>
                    <div className="flex gap-2">
                       {(d.partySplits || [{ party: "artist", percentage: 0 }, { party: "venue", percentage: 0 }, { party: "promoter", percentage: 0 }, { party: "organizer", percentage: 0 }]).map((split, si) => (
                        <div key={split.party} className="flex-1">
                          <Label className="text-[10px] text-muted-foreground capitalize">{split.party} %</Label>
                          <Input
                            type="number"
                            value={split.percentage || ""}
                            onChange={e => {
                              const val = parseFloat(e.target.value) || 0;
                              setCustomDeductions(prev => prev.map((dd, idx) => {
                                if (idx !== i) return dd;
                                const splits = [...(dd.partySplits || [{ party: "artist", percentage: 0 }, { party: "venue", percentage: 0 }, { party: "promoter", percentage: 0 }, { party: "organizer", percentage: 0 }])];
                                splits[si] = { ...splits[si], percentage: val };
                                return { ...dd, partySplits: splits };
                              }));
                            }}
                            className="text-sm mt-0.5"
                            placeholder="0"
                          />
                        </div>
                      ))}
                    </div>
                    {(() => {
                      const total = (d.partySplits || []).reduce((s, sp) => s + sp.percentage, 0);
                      return total > 0 && total !== 100 ? (
                        <p className="text-[10px] text-destructive">Split totals {total}% — must equal 100%</p>
                      ) : null;
                    })()}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => { setMode("display"); localStorage.setItem(storageKey, "display"); }}>Cancel</Button>
          <Button onClick={handleSave}>Save Financials</Button>
        </div>
      </div>
    );
  }

  // Display mode
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-lg font-semibold">Financials</h3>
        <Button variant="outline" size="sm" onClick={() => { setMode("edit"); localStorage.setItem(storageKey, "edit"); }} className="gap-1.5"><PenLine className="h-3.5 w-3.5" /> Edit</Button>
      </div>

      <FinancialsDisplayView
        revenue={revenue}
        deal={deal}
        currency={currency}
        venueRentalDismissed={venueRentalDismissed}
        venueRentalVat={venueRentalVat}
        totalRevenue={totalRevenue}
        totalDeductions={totalDeductions}
        netRevenue={netRevenue}
      />

    </div>
  );
}
