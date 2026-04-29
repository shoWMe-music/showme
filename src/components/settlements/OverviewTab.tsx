import React from "react";
import { Link } from "@tanstack/react-router";
import { FileText, Music, MapPin, Users, Ticket } from "lucide-react";
import SettlementBreakdownCards from "@/components/SettlementBreakdownCards";
import { SectionTemplateMenu } from "@/components/SectionTemplateMenu";
import { useUpdateEvent } from "@/lib/queries/useEventMutations";
import { toast } from "@/hooks/use-toast";
import {
  type Event as AppEvent, type DealStructure, type TicketRevenue, type Settlement, type PartyBreakdown,
} from "@/lib/models";

/**
 * Subset of event fields templatable from the Settlement Overview tab.
 * Identity-bearing fields (id/artist/venue/operator/date) are intentionally
 * excluded — templates here cover venue-operations defaults that recur across
 * events at the same room.
 */
type OverviewTemplateData = Pick<AppEvent, "capacity" | "ticketingProvider">;

export function OverviewTab({ event, deal, revenue, settlement, buildPayoutRows, settlementTotal, currency = "EUR", partyBreakdowns, totalRevenue, totalDeductions, netRevenue, partyNames, viewerIsPerformer = false, actingProfile }: {
  event: AppEvent; deal?: DealStructure; revenue?: TicketRevenue; settlement: Settlement;
  buildPayoutRows: () => { label: string; value: number; color: string; role: string }[];
  settlementTotal: number;
  currency?: string;
  partyBreakdowns: PartyBreakdown[];
  totalRevenue: number;
  totalDeductions: number;
  netRevenue: number;
  partyNames?: Record<string, string>;
  viewerIsPerformer?: boolean;
  actingProfile?: string;
}) {
  const updateEventMutation = useUpdateEvent();
  const overviewTemplate: OverviewTemplateData = {
    capacity: event.capacity,
    ticketingProvider: event.ticketingProvider,
  };
  return (
    <div className="space-y-6">
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display text-lg font-semibold">Event Details</h3>
          {event?.hostProfileId && (
            <SectionTemplateMenu
              profileId={event.hostProfileId}
              category="settlement-overview"
              currentData={overviewTemplate}
              onLoad={(data) => {
                const loaded = data as Partial<OverviewTemplateData>;
                const updates: Partial<AppEvent> = {};
                if (typeof loaded.capacity === "number") updates.capacity = loaded.capacity;
                if (typeof loaded.ticketingProvider === "string") updates.ticketingProvider = loaded.ticketingProvider;
                if (Object.keys(updates).length === 0) {
                  toast({ title: "Template is empty", variant: "destructive" });
                  return;
                }
                updateEventMutation.mutate(
                  { id: event.id, updates, actingProfile },
                  {
                    onSuccess: () => toast({ title: "Overview template loaded" }),
                    onError: () => toast({ title: "Failed to load template", variant: "destructive" }),
                  },
                );
              }}
            />
          )}
        </div>
        <dl className="space-y-3">
          {[
            { icon: FileText, label: "Event ID", value: event.id, isLink: true },
            { icon: Music, label: "Performer", value: event.artist },
            { icon: MapPin, label: "Venue", value: event.venue },
            { icon: Users, label: "Operator", value: `${event.operator} (${event.operatorType})` },
            { icon: Ticket, label: "Ticketing", value: event.ticketingProvider },
            { icon: Users, label: "Capacity", value: event.capacity.toLocaleString() },
          ].map(({ icon: Icon, label, value, isLink }: { icon: React.ElementType; label: string; value: string | number; isLink?: boolean }) => (
            <div key={label} className="flex items-center justify-between">
              <dt className="flex items-center gap-2 text-sm text-muted-foreground"><Icon className="h-4 w-4" /> {label}</dt>
              <dd className="text-sm font-medium">
                {isLink ? <Link to="/events/$id" params={{ id: event.id }} className="text-primary hover:underline">{value}</Link> : value}
              </dd>
            </div>
          ))}
        </dl>
      </div>
      <SettlementBreakdownCards
        partyBreakdowns={partyBreakdowns}
        settlementTotal={settlementTotal}
        totalRevenue={totalRevenue}
        totalDeductions={totalDeductions}
        netRevenue={netRevenue}
        deal={deal}
        currency={currency}
        operatorRole={event.operatorType}
        partyNames={partyNames}
        viewerIsPerformer={viewerIsPerformer}
      />
    </div>
  );
}
