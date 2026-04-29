import { useParams } from "@tanstack/react-router";
import AppLayout from "@/components/AppLayout";
import { calculateSettlement, type Rider } from "@/lib/models";
import { useState, useEffect, useMemo } from "react";
import { Loader2 } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Skeleton } from "@/components/ui/skeleton";
import { useUser } from "@/lib/user-context";
import { fetchRiders } from "@/lib/db";
import { userIsEventPerformer } from "@/lib/eventPermissions";

import { EventDetailHeader } from "@/components/event-detail/EventDetailHeader";
import { EventDetailTabs, type EventDetailTab } from "@/components/event-detail/EventDetailTabs";
import { EventOverviewTab } from "@/components/event-detail/EventOverviewTab";
import { EventDealTab } from "@/components/event-detail/EventDealTab";
import { RevenueTab } from "@/components/event-detail/RevenueTab";
import { SettlementTab } from "@/components/event-detail/SettlementTab";
import { PayoutTab } from "@/components/event-detail/PayoutTab";

import {
  useEvent,
  usePrimaryLoaded,
  useEventEconomics,
  useUpdateRevenue,
  useUpdateSettlementStatus,
  useAddComment,
  useChildEvents,
} from "@/lib/queries";
import { upsertShareToken } from "@/lib/db";

export default function EventDetailPage() {
  const { id } = useParams({ from: "/events/$id" });
  const [activeTab, setActiveTab] = useState<EventDetailTab>("overview");
  const { currentUser, profiles } = useUser();

  const primaryLoaded = usePrimaryLoaded();
  const event = useEvent(id ?? "");
  const { deal, revenue, settlement, isLoaded: economicsLoaded } = useEventEconomics(id ?? "");
  const childEvents = useChildEvents(id ?? "");
  const viewerIsPerformer = useMemo(
    () => userIsEventPerformer(event, profiles, childEvents.map((c) => c.performerProfileId).filter(Boolean) as string[]),
    [event, profiles, childEvents],
  );

  const [riders, setRiders] = useState<Rider[]>([]);
  useEffect(() => {
    if (id) {
      fetchRiders(id).then(setRiders).catch(() => {});
    }
  }, [id]);

  const updateRevenueMutation = useUpdateRevenue();
  const updateSettlementStatusMutation = useUpdateSettlementStatus();
  const addCommentMutation = useAddComment();

  const updateRevenue = (eventId: string, newRevenue: typeof revenue) => {
    if (!newRevenue) return;
    updateRevenueMutation.mutate({ eventId, newRevenue });
  };

  const updateSettlementStatus = (eventId: string, status: Parameters<typeof updateSettlementStatusMutation.mutate>[0]["status"]) => {
    updateSettlementStatusMutation.mutate({ eventId, status });
  };

  const addComment = (eventId: string, party: string, message: string, attachments?: { name: string; size: number; type: string; fileUrl: string }[]) => {
    addCommentMutation.mutate({
      eventId,
      party,
      message,
      attachments,
      date: new Date().toISOString().slice(0, 10),
    });
  };

  const generateShareLink = (eventId: string, parties: string[]): string => {
    const token = `review-${eventId}`;
    const snapshot = event && deal && revenue && settlement ? { event, deal, revenue, settlement } : undefined;
    void upsertShareToken(token, eventId, parties, snapshot);
    return `${window.location.origin}/review/${token}`;
  };

  if (!primaryLoaded) {
    return (
      <AppLayout>
        <div className="flex flex-col items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  if (!event) {
    return (
      <AppLayout>
        <div className="flex flex-col items-center justify-center py-20">
          <p className="text-lg text-muted-foreground">Event not found</p>
          <Link to="/events" className="mt-4 text-primary hover:underline">Back to events</Link>
        </div>
      </AppLayout>
    );
  }

  const recalculated = deal && revenue ? calculateSettlement(deal, revenue) : null;
  const partyBreakdowns = recalculated?.partyBreakdowns || [];

  // Compute financial totals
  const totalAdditionalRevenue = revenue ? (revenue.additionalRevenue || []).reduce((s, r) => s + r.amount, 0) : 0;
  const totalRevenue = revenue ? revenue.grossRevenue + revenue.doorSales + totalAdditionalRevenue : 0;
  const totalCustomDeductions = revenue ? (revenue.additionalDeductions || []).reduce((s, d) => {
    if (d.type === "percentage" && d.sourceField) {
      const src = d.sourceField === "ticketSales" ? revenue.grossRevenue : d.sourceField === "doorSales" ? revenue.doorSales : d.sourceField === "totalRevenue" ? totalRevenue : ((revenue.additionalRevenue || []).find(r => r.name === d.sourceField)?.amount || 0);
      return s + src * d.amount / 100;
    }
    return s + d.amount;
  }, 0) : 0;
  const totalCustomCosts = revenue ? (revenue.customCosts || []).reduce((s, c) => s + c.amount, 0) : 0;
  const totalDeductions = revenue ? revenue.ticketFees + revenue.tax + revenue.refunds + revenue.productionExpenses + revenue.additionalCosts + totalCustomDeductions + totalCustomCosts : 0;
  const netRevenue = totalRevenue - totalDeductions;

  const settlementTotal = settlement
    ? settlement.artistPayout + settlement.promoterPayout + settlement.venuePayout + settlement.commissionPayouts.reduce((sum, c) => sum + c.payout, 0)
    : 0;

  const buildPayoutRows = () => {
    if (!settlement) return [];
    const rows: { label: string; value: number; color: string }[] = [
      { label: `Performer Payout (${event.artist})`, value: settlement.artistPayout, color: "bg-primary" },
      { label: `Promoter Payout (${event.operator})`, value: settlement.promoterPayout, color: "bg-foreground" },
      { label: `Venue Payout (${event.venue})`, value: settlement.venuePayout, color: "bg-muted-foreground" },
    ];
    for (const c of settlement.commissionPayouts) {
      if (c.payout > 0) {
        rows.push({ label: `${c.label}${c.name ? ` (${c.name})` : ""} Payout`, value: c.payout, color: "bg-accent-foreground/50" });
      }
    }
    return rows.filter(r => r.value > 0);
  };

  return (
    <AppLayout>
      <div className="animate-fade-in">
        <EventDetailHeader event={event} deal={deal} revenue={revenue} settlement={settlement} />

        <EventDetailTabs activeTab={activeTab} onTabChange={setActiveTab} />

        {activeTab === "overview" && (
          <EventOverviewTab
            event={event}
            settlement={settlement}
            partyBreakdowns={partyBreakdowns}
            settlementTotal={settlementTotal}
            totalRevenue={totalRevenue}
            totalDeductions={totalDeductions}
            netRevenue={netRevenue}
            deal={deal}
            riders={riders}
            viewerIsPerformer={viewerIsPerformer}
          />
        )}

        {activeTab === "deal" && deal && (
          <EventDealTab deal={deal} />
        )}

        {activeTab === "revenue" && revenue && (
          <RevenueTab event={event} revenue={revenue} updateRevenue={updateRevenue} />
        )}

        {activeTab === "settlement" && !economicsLoaded && (
          <div className="space-y-4">
            {/* Summary row skeletons */}
            <div className="grid grid-cols-3 gap-4">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="rounded-xl border bg-card p-5 shadow-sm space-y-2">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-7 w-32" />
                  <Skeleton className="h-3 w-16" />
                </div>
              ))}
            </div>
            {/* Breakdown card skeletons */}
            <div className="rounded-xl border bg-card p-6 shadow-sm space-y-3">
              <Skeleton className="h-5 w-40" />
              {[...Array(4)].map((_, i) => (
                <div key={i} className="flex items-center justify-between">
                  <Skeleton className="h-4 w-36" />
                  <Skeleton className="h-4 w-20" />
                </div>
              ))}
              <div className="border-t pt-3 flex items-center justify-between">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-5 w-24" />
              </div>
            </div>
            {/* Status / actions row */}
            <div className="rounded-xl border bg-card p-6 shadow-sm flex items-center gap-4">
              <Skeleton className="h-8 w-32 rounded-full" />
              <Skeleton className="h-8 w-28" />
              <Skeleton className="h-8 w-28" />
            </div>
          </div>
        )}

        {activeTab === "settlement" && economicsLoaded && settlement && (
          <SettlementTab
            event={event}
            settlement={settlement}
            buildPayoutRows={buildPayoutRows}
            settlementTotal={settlementTotal}
            updateSettlementStatus={updateSettlementStatus}
            addComment={addComment}
            generateShareLink={generateShareLink}
            currentUser={currentUser}
            partyBreakdowns={partyBreakdowns}
            totalRevenue={totalRevenue}
            totalDeductions={totalDeductions}
            netRevenue={netRevenue}
            deal={deal}
            partyNames={{ Performer: event.artist, Venue: event.venue, Promoter: event.operator }}
            viewerIsPerformer={viewerIsPerformer}
          />
        )}

        {activeTab === "payout" && settlement && (
          <PayoutTab event={event} settlement={settlement} buildPayoutRows={buildPayoutRows} deal={deal} revenue={revenue} />
        )}
      </div>
    </AppLayout>
  );
}
