import { formatCurrency, type DealStructure, type Event as AppEvent } from "@/lib/models";
import { SectionTemplateMenu } from "@/components/SectionTemplateMenu";
import { useUpdateDeal } from "@/lib/queries";
import { toast } from "@/hooks/use-toast";

export function DealTab({ event, deal, currency = "EUR", actingProfile }: {
  event?: AppEvent;
  deal: DealStructure;
  currency?: string;
  actingProfile?: string;
}) {
  const updateDealMutation = useUpdateDeal();
  return (
    <div className="rounded-xl border bg-card p-6 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-display text-lg font-semibold">Deal Structure</h3>
        {event?.hostProfileId && (
          <SectionTemplateMenu
            profileId={event.hostProfileId}
            category="settlement-deal"
            currentData={deal}
            onLoad={(data) => {
              const loaded = data as DealStructure;
              // Merge into the live deal: preserve event-specific identifiers
              // (commission ids stay stable when keys/labels match), but override
              // every templatable field. We only ship a load if we have an event.
              updateDealMutation.mutate(
                { eventId: event.id, deal: { ...deal, ...loaded }, actingProfile },
                {
                  onSuccess: () => toast({ title: "Deal template loaded" }),
                  onError: () => toast({ title: "Failed to load template", variant: "destructive" }),
                },
              );
            }}
          />
        )}
      </div>
      <dl className="space-y-3">
        <div className="flex justify-between"><dt className="text-sm text-muted-foreground">Deal Type</dt><dd className="text-sm font-medium capitalize">{deal.dealType.replace(/_/g, " ")}</dd></div>
        {deal.artistGuarantee > 0 && <div className="flex justify-between"><dt className="text-sm text-muted-foreground">Performer Guarantee</dt><dd className="text-sm font-semibold">{formatCurrency(deal.artistGuarantee, currency)}</dd></div>}
        <div className="border-t pt-3" />
        <h4 className="text-sm font-semibold">Revenue Split</h4>
        <div className="flex justify-between"><dt className="text-sm text-muted-foreground">Performer Split</dt><dd className="text-sm font-medium">{deal.artistSplit}%</dd></div>
        <div className="flex justify-between"><dt className="text-sm text-muted-foreground">Promoter Split</dt><dd className="text-sm font-medium">{deal.promoterSplit}%</dd></div>
        <div className="flex justify-between"><dt className="text-sm text-muted-foreground">Venue Split</dt><dd className="text-sm font-medium">{deal.venueSplit}%</dd></div>
        {(deal.organizerSplit || 0) > 0 && <div className="flex justify-between"><dt className="text-sm text-muted-foreground">Organizer Split</dt><dd className="text-sm font-medium">{deal.organizerSplit}%</dd></div>}
        {(deal.artistCostSplit > 0 || deal.promoterCostSplit > 0 || deal.venueCostSplit > 0 || (deal.organizerCostSplit || 0) > 0) && (
          <>
            <div className="border-t pt-3" />
            <h4 className="text-sm font-semibold">Production Costs Split</h4>
            {deal.artistCostSplit > 0 && <div className="flex justify-between"><dt className="text-sm text-muted-foreground">Performer Cost Split</dt><dd className="text-sm font-medium">{deal.artistCostSplit}%</dd></div>}
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
