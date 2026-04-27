import { formatCurrency, type DealStructure } from "@/lib/models";

export function DealTab({ deal, currency = "EUR" }: { deal: DealStructure; currency?: string }) {
  return (
    <div className="rounded-xl border bg-card p-6 shadow-sm">
      <h3 className="font-display text-lg font-semibold mb-4">Deal Structure</h3>
      <dl className="space-y-3">
        <div className="flex justify-between"><dt className="text-sm text-muted-foreground">Deal Type</dt><dd className="text-sm font-medium capitalize">{deal.dealType.replace(/_/g, " ")}</dd></div>
        {deal.artistGuarantee > 0 && <div className="flex justify-between"><dt className="text-sm text-muted-foreground">Artist Guarantee</dt><dd className="text-sm font-semibold">{formatCurrency(deal.artistGuarantee, currency)}</dd></div>}
        <div className="border-t pt-3" />
        <h4 className="text-sm font-semibold">Revenue Split</h4>
        <div className="flex justify-between"><dt className="text-sm text-muted-foreground">Artist Split</dt><dd className="text-sm font-medium">{deal.artistSplit}%</dd></div>
        <div className="flex justify-between"><dt className="text-sm text-muted-foreground">Promoter Split</dt><dd className="text-sm font-medium">{deal.promoterSplit}%</dd></div>
        <div className="flex justify-between"><dt className="text-sm text-muted-foreground">Venue Split</dt><dd className="text-sm font-medium">{deal.venueSplit}%</dd></div>
        {(deal.organizerSplit || 0) > 0 && <div className="flex justify-between"><dt className="text-sm text-muted-foreground">Organizer Split</dt><dd className="text-sm font-medium">{deal.organizerSplit}%</dd></div>}
        {(deal.artistCostSplit > 0 || deal.promoterCostSplit > 0 || deal.venueCostSplit > 0 || (deal.organizerCostSplit || 0) > 0) && (
          <>
            <div className="border-t pt-3" />
            <h4 className="text-sm font-semibold">Production Costs Split</h4>
            {deal.artistCostSplit > 0 && <div className="flex justify-between"><dt className="text-sm text-muted-foreground">Artist Cost Split</dt><dd className="text-sm font-medium">{deal.artistCostSplit}%</dd></div>}
            <div className="flex justify-between"><dt className="text-sm text-muted-foreground">Promoter Cost Split</dt><dd className="text-sm font-medium">{deal.promoterCostSplit}%</dd></div>
            <div className="flex justify-between"><dt className="text-sm text-muted-foreground">Venue Cost Split</dt><dd className="text-sm font-medium">{deal.venueCostSplit}%</dd></div>
            {(deal.organizerCostSplit || 0) > 0 && <div className="flex justify-between"><dt className="text-sm text-muted-foreground">Organizer Cost Split</dt><dd className="text-sm font-medium">{deal.organizerCostSplit}%</dd></div>}
          </>
        )}
        {deal.venueRental > 0 && <div className="flex justify-between"><dt className="text-sm text-muted-foreground">Venue Rental</dt><dd className="text-sm font-semibold">{formatCurrency(deal.venueRental, currency)}</dd></div>}
        {deal.commissions.length > 0 && (
          <>
            <div className="border-t pt-3" />
            <h4 className="text-sm font-semibold">Commissions (from Performer share)</h4>
            {deal.commissions.map((c, i) => (
              <div key={c.key} className="flex justify-between">
                <dt className="text-sm text-muted-foreground">{c.label}{c.name ? ` (${c.name})` : ""}</dt>
                <dd className="text-sm font-medium">{c.percentage}%{i > 0 ? " of remainder" : " of artist share"}</dd>
              </div>
            ))}
          </>
        )}
      </dl>
    </div>
  );
}
