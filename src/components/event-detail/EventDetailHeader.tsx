import { Link } from "@tanstack/react-router";
import StatusBadge from "@/components/StatusBadge";
import { ArrowLeft, Download } from "lucide-react";
import { formatCurrency, type Event } from "@/lib/models";
import type { DealStructure } from "@/lib/models";
import type { TicketRevenue } from "@/lib/models";

interface EventDetailHeaderProps {
  event: Event;
  deal?: DealStructure;
  revenue?: TicketRevenue;
  settlement?: {
    artistPayout: number;
    promoterPayout: number;
    venuePayout: number;
    commissionPayouts: { label: string; name?: string; payout: number }[];
  };
}

export function EventDetailHeader({ event, deal, revenue, settlement }: EventDetailHeaderProps) {
  const handleExport = () => {
    if (!event || !deal || !revenue || !settlement) return;
    const netRev = revenue.grossRevenue + revenue.doorSales - revenue.ticketFees - revenue.tax - revenue.refunds - revenue.productionExpenses - revenue.additionalCosts;
    const rows = [
      ["Settlement Report", ""],
      ["Event", event.name],
      ["Date", event.date],
      ["Performer", event.artist],
      ["Venue", event.venue],
      ["Operator", `${event.operator} (${event.operatorType})`],
      ["Ticketing", Array.from(new Set((event.tickets ?? []).map(t => t.provider).filter(Boolean))).join(", ")],
      ["Status", event.status],
      ["", ""],
      ["Deal Structure", ""],
      ["Deal Type", deal.dealType.replace(/_/g, " ")],
      ["Performer Guarantee", `${formatCurrency(deal.artistGuarantee)}`],
      ["Performer Split", `${deal.artistSplit}%`],
      ["Promoter Split", `${deal.promoterSplit}%`],
      ["Venue Split", `${deal.venueSplit}%`],
      ["Venue Rental", `${formatCurrency(deal.venueRental)}`],
      ["", ""],
      ["Revenue", ""],
      ["Gross Revenue", `${formatCurrency(revenue.grossRevenue)}`],
      ["Door Sales", `${formatCurrency(revenue.doorSales)}`],
      ["Ticket Fees", `${formatCurrency(revenue.ticketFees)}`],
      ["Tax", `${formatCurrency(revenue.tax)}`],
      ["Refunds", `${formatCurrency(revenue.refunds)}`],
      ["Production Expenses", `${formatCurrency(revenue.productionExpenses)}`],
      ["Additional Costs", `${formatCurrency(revenue.additionalCosts)}`],
      ["Net Revenue", `${formatCurrency(netRev)}`],
      ["", ""],
      ["Payouts", ""],
      [`Performer Payout (${event.artist})`, `${formatCurrency(settlement.artistPayout)}`],
      [`Promoter Payout (${event.operator})`, `${formatCurrency(settlement.promoterPayout)}`],
      [`Venue Payout (${event.venue})`, `${formatCurrency(settlement.venuePayout)}`],
      ...settlement.commissionPayouts.filter(c => c.payout > 0).map(c => [`${c.label} (${c.name})`, `${formatCurrency(c.payout)}`]),
    ];
    const csv = rows.map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${event.name.replace(/\s+/g, "_")}_settlement.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <Link to="/events" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="h-4 w-4" /> Back to events
      </Link>

      <div className="mb-6 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight">{event.name}</h1>
            <StatusBadge status={event.status} />
          </div>
          <p className="mt-1 text-muted-foreground">
            {event.artist} · {event.venue} ·{" "}
            <Link to="/calendar" search={{ date: event.date }} className="hover:underline hover:text-foreground cursor-pointer transition-colors">
              {event.date}
            </Link>
          </p>
        </div>
        <div className="flex gap-2">
          <button
            className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
            onClick={handleExport}
          >
            <Download className="h-4 w-4" /> Export
          </button>
        </div>
      </div>
    </>
  );
}
