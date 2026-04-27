import { FileText, Music, MapPin, Users, Ticket } from "lucide-react";
import SettlementBreakdownCards from "@/components/SettlementBreakdownCards";
import type { Event, PartyBreakdown, DealStructure } from "@/lib/models";

interface EventOverviewTabProps {
  event: Event;
  settlement?: unknown;
  partyBreakdowns: PartyBreakdown[];
  settlementTotal: number;
  totalRevenue: number;
  totalDeductions: number;
  netRevenue: number;
  deal?: DealStructure;
}

export function EventOverviewTab({
  event,
  settlement,
  partyBreakdowns,
  settlementTotal,
  totalRevenue,
  totalDeductions,
  netRevenue,
  deal,
}: EventOverviewTabProps) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <h3 className="font-display text-lg font-semibold mb-4">Event Details</h3>
        <dl className="space-y-3">
          {[
            { icon: FileText, label: "Event ID", value: event.id },
            { icon: Music, label: "Performer", value: event.artist },
            { icon: MapPin, label: "Venue", value: event.venue },
            ...(event.roomStage ? [{ icon: MapPin, label: "Room / Stage", value: event.roomStage }] : []),
            { icon: Users, label: "Operator", value: `${event.operator} (${event.operatorType})` },
            { icon: Ticket, label: "Ticketing", value: event.ticketingProvider },
            { icon: Users, label: "Capacity", value: event.capacity.toLocaleString() },
          ].map(({ icon: Icon, label, value }) => (
            <div key={label} className="flex items-center justify-between">
              <dt className="flex items-center gap-2 text-sm text-muted-foreground">
                <Icon className="h-4 w-4" /> {label}
              </dt>
              <dd className="text-sm font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      </div>

      {settlement && (
        <SettlementBreakdownCards
          partyBreakdowns={partyBreakdowns}
          settlementTotal={settlementTotal}
          totalRevenue={totalRevenue}
          totalDeductions={totalDeductions}
          netRevenue={netRevenue}
          deal={deal}
        />
      )}
    </div>
  );
}
