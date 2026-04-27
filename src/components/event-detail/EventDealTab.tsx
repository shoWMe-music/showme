import { formatCurrency } from "@/lib/models";
import type { DealStructure } from "@/lib/models";

interface EventDealTabProps {
  deal: DealStructure;
}

export function EventDealTab({ deal }: EventDealTabProps) {
  return (
    <div className="rounded-xl border bg-card p-6 shadow-sm max-w-2xl">
      <h3 className="font-display text-lg font-semibold mb-4">Deal Structure</h3>
      <dl className="space-y-3">
        <div className="flex justify-between">
          <dt className="text-sm text-muted-foreground">Deal Type</dt>
          <dd className="text-sm font-medium capitalize">{deal.dealType.replace(/_/g, " ")}</dd>
        </div>
        {deal.artistGuarantee > 0 && (
          <div className="flex justify-between">
            <dt className="text-sm text-muted-foreground">Performer Guarantee</dt>
            <dd className="text-sm font-semibold">{formatCurrency(deal.artistGuarantee)}</dd>
          </div>
        )}
        <div className="border-t pt-3" />
        <h4 className="text-sm font-semibold">Revenue Split</h4>
        <div className="flex justify-between">
          <dt className="text-sm text-muted-foreground">Performer Split</dt>
          <dd className="text-sm font-medium">{deal.artistSplit}%</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-sm text-muted-foreground">Promoter Split</dt>
          <dd className="text-sm font-medium">{deal.promoterSplit}%</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-sm text-muted-foreground">Venue Split</dt>
          <dd className="text-sm font-medium">{deal.venueSplit}%</dd>
        </div>
        {deal.venueRental > 0 && (
          <div className="flex justify-between">
            <dt className="text-sm text-muted-foreground">Venue Rental</dt>
            <dd className="text-sm font-semibold">{formatCurrency(deal.venueRental)}</dd>
          </div>
        )}
        {deal.commissions.length > 0 && (
          <>
            <div className="border-t pt-3" />
            <h4 className="text-sm font-semibold">Commissions (from Performer share, in order)</h4>
            {deal.commissions.map((c, i) => (
              <div key={c.key} className="flex justify-between">
                <dt className="text-sm text-muted-foreground">
                  {c.label}{c.name ? ` (${c.name})` : ""}
                </dt>
                <dd className="text-sm font-medium">
                  {c.percentage}%{i > 0 ? " of remainder" : " of artist share"}
                </dd>
              </div>
            ))}
          </>
        )}
      </dl>
    </div>
  );
}
