import { formatCurrency, type PartyBreakdown, type DealStructure } from "@/lib/models";
import { Badge } from "@/components/ui/badge";

interface SettlementBreakdownCardsProps {
  partyBreakdowns: PartyBreakdown[];
  settlementTotal: number;
  totalRevenue: number;
  totalDeductions: number;
  netRevenue: number;
  deal?: DealStructure;
  currency?: string;
  operatorRole?: string;
  /** Map from party label ("Performer", "Promoter", "Venue") to display name */
  partyNames?: Record<string, string>;
}

function VatSuffix({ vat }: { vat?: { rate: number; mode: "included" | "on_top" } }) {
  if (!vat || vat.rate === 0) return null;
  return (
    <span className="text-[10px] text-muted-foreground ml-1">
      ({vat.mode === "included" ? `${vat.rate}% VAT incl.` : `+ ${vat.rate}% VAT`})
    </span>
  );
}


export default function SettlementBreakdownCards({
  partyBreakdowns, settlementTotal, totalRevenue, totalDeductions, netRevenue, deal, currency = "EUR", operatorRole, partyNames,
}: SettlementBreakdownCardsProps) {
  const roleToPartyLabel: Record<string, string> = { promoter: "Promoter", venue: "Venue", artist: "Performer", organizer: "Organizer" };
  const operatorPartyName = operatorRole ? roleToPartyLabel[operatorRole] : undefined;

  return (
    <div className="space-y-4">
      {/* Overview */}
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <h3 className="font-display text-lg font-semibold mb-4">Overview</h3>
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Total Revenue</span>
            <span className="font-medium">{formatCurrency(totalRevenue, currency)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Total Deductions</span>
            <span className="font-medium">- {formatCurrency(totalDeductions, currency)}</span>
          </div>
          <div className="flex justify-between border-t pt-2">
            <span className="font-semibold">Net Revenue</span>
            <span className="font-bold font-display">{formatCurrency(netRevenue, currency)}</span>
          </div>
          {deal && (
            <>
              <div className="border-t pt-2 mt-2" />
              <div className="flex justify-between">
                <span className="text-muted-foreground">Deal Type</span>
                <span className="font-medium capitalize">{deal.dealType.replace(/_/g, " ")}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Split (A / P / V{(deal.organizerSplit || 0) > 0 ? " / O" : ""})</span>
                <span className="font-medium">{deal.artistSplit}% / {deal.promoterSplit}% / {deal.venueSplit}%{(deal.organizerSplit || 0) > 0 ? ` / ${deal.organizerSplit}%` : ""}</span>
              </div>
              {deal.artistGuarantee > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Performer Guarantee</span>
                  <span className="font-medium">{formatCurrency(deal.artistGuarantee, currency)}</span>
                </div>
              )}
              {deal.venueRental > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Venue Rental</span>
                  <span className="font-medium">{formatCurrency(deal.venueRental, currency)}</span>
                </div>
              )}
            </>
          )}
          <div className="border-t pt-2 flex justify-between">
            <span className="font-semibold">Total Settlement</span>
            <span className="font-bold font-display text-lg">{formatCurrency(settlementTotal, currency)}</span>
          </div>
        </dl>
      </div>

      {/* Per-party cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {partyBreakdowns.map((pb) => {
        const isOperatorParty = operatorPartyName && pb.party === operatorPartyName;
        return (
          <div key={pb.party} className={`rounded-xl border p-6 shadow-sm ${isOperatorParty ? "bg-primary/5 border-primary/30" : "bg-card"}`}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <h4 className="font-display font-semibold">
                  {pb.party}
                  {partyNames?.[pb.party] && (
                    <span className="text-muted-foreground font-normal text-sm ml-1">({partyNames[pb.party]})</span>
                  )}
                </h4>
                {isOperatorParty && (
                  <span className="text-[10px] font-medium uppercase tracking-wider text-primary bg-primary/10 px-2 py-0.5 rounded-full">Your share (retained)</span>
                )}
              </div>
              <span className="font-bold font-display text-lg">{formatCurrency(pb.finalPayout, currency)}</span>
            </div>
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Base</span>
                <span className="font-medium">{formatCurrency(pb.baseAmount, currency)}</span>
              </div>
              {pb.adjustments.map((adj, i) => (
                <div key={i} className="flex justify-between">
                  <span className="text-muted-foreground">
                    {adj.label}
                    <VatSuffix vat={adj.vat} />
                  </span>
                  <span className={`font-medium ${adj.amount < 0 ? "text-destructive" : "text-[hsl(var(--success))]"}`}>
                    {adj.amount >= 0 ? "+" : ""}{formatCurrency(adj.amount, currency)}
                  </span>
                </div>
              ))}
              {pb.adjustments.length > 0 && (
                <div className="flex justify-between border-t pt-1.5">
                  <span className="font-semibold">Final {isOperatorParty ? "Retained" : "Payout"}</span>
                  <span className="font-bold font-display">{formatCurrency(pb.finalPayout, currency)}</span>
                </div>
              )}
            </dl>
          </div>
        );
      })}
      </div>
    </div>
  );
}
