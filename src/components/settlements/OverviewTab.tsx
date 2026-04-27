import React from "react";
import { Link } from "@tanstack/react-router";
import { FileText, Music, MapPin, Users, Ticket } from "lucide-react";
import SettlementBreakdownCards from "@/components/SettlementBreakdownCards";
import {
  type Event as AppEvent, type DealStructure, type TicketRevenue, type Settlement, type PartyBreakdown,
} from "@/lib/models";

export function OverviewTab({ event, deal, revenue, settlement, buildPayoutRows, settlementTotal, currency = "EUR", partyBreakdowns, totalRevenue, totalDeductions, netRevenue }: {
  event: AppEvent; deal?: DealStructure; revenue?: TicketRevenue; settlement: Settlement;
  buildPayoutRows: () => { label: string; value: number; color: string; role: string }[];
  settlementTotal: number;
  currency?: string;
  partyBreakdowns: PartyBreakdown[];
  totalRevenue: number;
  totalDeductions: number;
  netRevenue: number;
}) {
  return (
    <div className="space-y-6">
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <h3 className="font-display text-lg font-semibold mb-4">Event Details</h3>
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
      />
    </div>
  );
}
