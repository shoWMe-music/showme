import { cn } from "@/lib/utils";
import { formatCurrency, type DealStructure, type TicketRevenue } from "@/lib/models";

export function FinancialsDisplayView({ revenue, deal, currency, venueRentalDismissed, venueRentalVat, totalRevenue, totalDeductions, netRevenue }: {
  revenue: TicketRevenue;
  deal?: DealStructure;
  currency: string;
  venueRentalDismissed: boolean;
  venueRentalVat?: { rate: number; mode: string } | undefined;
  totalRevenue: number;
  totalDeductions: number;
  netRevenue: number;
}) {
  return (
    <>
      {/* Revenue Display */}
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <h4 className="text-sm font-semibold mb-3 text-primary">Revenue</h4>

        {revenue.ticketTypes && revenue.ticketTypes.length > 0 && (
          <div className="mb-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Ticket Sales</p>
              <span className="text-[10px] text-muted-foreground italic">Ticket VAT handled outside shoWMe</span>
            </div>
            {revenue.ticketTypes.map((t, i) => (
              <div key={i} className="flex justify-between text-sm mb-1">
                <span className="text-muted-foreground">{t.name} ({t.sold} × {formatCurrency(t.price, currency)})</span>
                <span className="font-medium">{formatCurrency(t.price * t.sold, currency)}</span>
              </div>
            ))}
            <div className="flex justify-between text-sm font-medium mt-1 pt-1 border-t border-dashed">
              <span>Ticket Sales Subtotal</span>
              <span>{formatCurrency(revenue.grossRevenue, currency)}</span>
            </div>
          </div>
        )}

        {revenue.doorSalesTypes && revenue.doorSalesTypes.length > 0 && (
          <div className="mb-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Door Sales</p>
            {revenue.doorSalesTypes.map((t, i) => (
              <div key={i} className="flex justify-between text-sm mb-1">
                <span className="text-muted-foreground">{t.name} ({t.sold} × {formatCurrency(t.price, currency)})</span>
                <span className="font-medium">{formatCurrency(t.price * t.sold, currency)}</span>
              </div>
            ))}
          </div>
        )}
        {!revenue.doorSalesTypes && revenue.doorSales > 0 && (
          <div className="flex justify-between text-sm mb-1">
            <span className="text-muted-foreground">Door Sales</span>
            <span className="font-medium">{formatCurrency(revenue.doorSales, currency)}</span>
          </div>
        )}

        {(revenue.additionalRevenue || []).length > 0 && (
          <div className="mb-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Additional Revenue</p>
            {(revenue.additionalRevenue || []).map((r, i) => (
              <div key={i} className="flex justify-between text-sm mb-1">
                <span className="text-muted-foreground">
                  {r.name}
                  {r.vat && r.vat.rate > 0 && (
                    <span className="text-[10px] ml-1">({r.vat.mode === "included" ? `${r.vat.rate}% VAT incl.` : `+ ${r.vat.rate}% VAT`})</span>
                  )}
                </span>
                <span className="font-medium">{formatCurrency(r.amount, currency)}</span>
              </div>
            ))}
          </div>
        )}

        <div className="border-t pt-2 flex justify-between font-semibold text-sm">
          <span>Total Revenue</span>
          <span className="font-display">{formatCurrency(totalRevenue, currency)}</span>
        </div>
      </div>

      {/* Deductions & Costs Display */}
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <h4 className="text-sm font-semibold mb-3 text-destructive">Deductions & Costs</h4>
        <div className="space-y-1">
          {deal && !venueRentalDismissed && (deal.venueRentalPaymentMode || "deduct_at_settlement") === "deduct_at_settlement" && deal.venueRental > 0 && (
            <div className="flex justify-between text-sm p-2 rounded bg-muted/30 border border-dashed border-muted-foreground/20 mb-2">
              <span className="text-muted-foreground">
                Venue Rental <span className="text-[10px]">(from deal)</span>
                {venueRentalVat && venueRentalVat.rate > 0 && (
                  <span className="text-[10px] ml-1">({venueRentalVat.mode === "included" ? `${venueRentalVat.rate}% VAT incl.` : `+ ${venueRentalVat.rate}% VAT`})</span>
                )}
              </span>
              <span className="font-medium">- {formatCurrency(deal.venueRental, currency)}</span>
            </div>
          )}
          {(revenue.customCosts || []).length > 0 && (
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mt-1 mb-1">Production Costs</p>
          )}
          {(revenue.customCosts || []).map((c, i) => (
            <div key={`cost-${i}`} className="flex justify-between text-sm">
              <span className="text-muted-foreground">
                {c.name}{c.fromParty ? ` (from ${c.fromParty})` : ""}
                {c.vat && c.vat.rate > 0 && (
                  <span className="text-[10px] ml-1">({c.vat.mode === "included" ? `${c.vat.rate}% VAT incl.` : `+ ${c.vat.rate}% VAT`})</span>
                )}
              </span>
              <span className="font-medium">- {formatCurrency(c.amount, currency)}</span>
            </div>
          ))}
          {(revenue.additionalDeductions || []).length > 0 && (
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mt-2 mb-1">Deductions</p>
          )}
          {(revenue.additionalDeductions || []).map((d, i) => {
            let val = d.amount;
            if (d.type === "percentage" && d.sourceField) {
              const src = d.sourceField === "ticketSales" ? revenue.grossRevenue : d.sourceField === "doorSales" ? revenue.doorSales : d.sourceField === "totalRevenue" ? totalRevenue : ((revenue.additionalRevenue || []).find(r => r.name === d.sourceField)?.amount || 0);
              val = src * d.amount / 100;
            }
            const desc = d.type === "fixed"
              ? `${d.name}${d.fromParty ? ` from ${d.fromParty}` : ""}${d.toParty ? ` → ${d.toParty}` : ""}`
              : `${d.name} (${d.amount}% of ${d.sourceField})${d.partySplits && d.partySplits.length > 0 ? ` — ${d.partySplits.filter(s => s.percentage > 0).map(s => `${s.party} ${s.percentage}%`).join(", ")}` : ""}`;
            const vatSuffix = d.vat && d.vat.rate > 0 ? ` (${d.vat.mode === "included" ? `${d.vat.rate}% VAT incl.` : `+ ${d.vat.rate}% VAT`})` : "";
            return (
              <div key={i} className="flex justify-between text-sm">
                <span className="text-muted-foreground">{desc}{vatSuffix}</span>
                <span className="font-medium">- {formatCurrency(val, currency)}</span>
              </div>
            );
          })}
        </div>
        <div className="border-t pt-2 mt-2 flex justify-between font-semibold text-sm">
          <span>Total Deductions</span>
          <span className="font-display">- {formatCurrency(totalDeductions, currency)}</span>
        </div>
      </div>

      {/* Net Revenue */}
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <div className="flex justify-between items-center">
          <span className="font-semibold text-lg">Net Revenue</span>
          <span className={cn("font-bold font-display text-xl", netRevenue < 0 ? "text-destructive" : "")}>{formatCurrency(netRevenue, currency)}</span>
        </div>
      </div>
    </>
  );
}
