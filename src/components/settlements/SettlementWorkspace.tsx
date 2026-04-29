import { useState, useEffect } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import StatusBadge from "@/components/StatusBadge";
import { useUser } from "@/lib/user-context";
import {
  calculateSettlement, SettlementStatus,
  type Event as AppEvent, type DealStructure, type TicketRevenue, type Settlement, type PartyBreakdown,
} from "@/lib/models";
import { OverviewTab } from "./OverviewTab";
import { DealTab } from "./DealTab";
import { FinancialsTab } from "./FinancialsTab";
import { SettlementTab } from "./SettlementTab";
import { PayoutTab } from "./PayoutTab";
import { ChangeLogTab } from "./ChangeLogTab";

type WorkspaceTab = "overview" | "deal" | "financials" | "settlement" | "payout" | "changelog";

export function SettlementWorkspace({ event, deal, revenue, settlement, initialTab, onTabChange, updateSettlementStatus, updateRevenue, addComment, generateShareLink, currentUser, onBack }: {
  event: AppEvent; deal?: DealStructure; revenue?: TicketRevenue; settlement: Settlement;
  initialTab?: string;
  onTabChange?: (tab: string) => void;
  updateSettlementStatus: (eventId: string, status: SettlementStatus) => void;
  updateRevenue: (eventId: string, revenue: TicketRevenue) => void;
  addComment: (eventId: string, party: string, message: string, attachments?: { name: string; size: number; type: string; fileUrl: string }[]) => void;
  generateShareLink: (eventId: string, parties: string[]) => string;
  currentUser: { name: string; roles: string[] };
  onBack?: () => void;
}) {
  const { currentUser: settingsUser } = useUser();
  const [currency, setCurrency] = useState(settingsUser.currency || "EUR");
  const [activeTab, setActiveTab] = useState<WorkspaceTab>(
    () => (initialTab as WorkspaceTab) || "overview"
  );
  const handleTabChange = (tab: WorkspaceTab) => {
    setActiveTab(tab);
    onTabChange?.(tab);
  };

  useEffect(() => {
    if (window.location.hash === "#comments" && activeTab === "settlement") {
      setTimeout(() => {
        document.getElementById("settlement-comments")?.scrollIntoView({ behavior: "smooth" });
      }, 300);
    }
  }, [activeTab]);

  const tabs: { id: WorkspaceTab; label: string; comingSoon?: boolean }[] = [
    { id: "overview", label: "Overview" },
    { id: "deal", label: "Deal Structure" },
    { id: "financials", label: "Financials" },
    { id: "settlement", label: "Settlement" },
    { id: "payout", label: "Payout", comingSoon: true },
    { id: "changelog", label: "Change Log" },
  ];

  const settlementTotal = settlement.artistPayout + settlement.promoterPayout + settlement.venuePayout + settlement.commissionPayouts.reduce((sum, c) => sum + c.payout, 0);

  const recalc = deal && revenue ? calculateSettlement(deal, revenue) : null;
  const partyBreakdowns: PartyBreakdown[] = recalc?.partyBreakdowns || [];

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
  const overviewVenueRentalDeduction = deal && (deal.venueRentalPaymentMode || "deduct_at_settlement") === "deduct_at_settlement" && deal.venueRental > 0 ? deal.venueRental : 0;
  const totalDeductions = revenue ? revenue.ticketFees + revenue.tax + revenue.refunds + revenue.productionExpenses + revenue.additionalCosts + totalCustomDeductions + totalCustomCosts + overviewVenueRentalDeduction : 0;
  const netRevenue = totalRevenue - totalDeductions;

  const operatorRole = event.operatorType;

  const partyNames: Record<string, string> = {
    Performer: event.artist,
    Venue: event.venue,
    Promoter: event.operator,
  };

  const buildPayoutRows = () => {
    const allRows: { label: string; value: number; color: string; role: string }[] = [
      { label: `Performer Payout (${event.artist})`, value: settlement.artistPayout, role: "artist", color: "bg-primary" },
      { label: `Promoter Payout (${event.operator})`, value: settlement.promoterPayout, role: "promoter", color: "bg-foreground" },
      { label: `Venue Payout (${event.venue})`, value: settlement.venuePayout, role: "venue", color: "bg-muted-foreground" },
    ];
    const orgBreakdown = partyBreakdowns.find(pb => pb.party === "Organizer");
    if (orgBreakdown) {
      allRows.push({ label: "Organizer Payout", value: orgBreakdown.finalPayout, role: "organizer", color: "bg-accent" });
    }
    for (const c of settlement.commissionPayouts) {
      if (c.payout > 0) allRows.push({ label: `${c.label}${c.name ? ` (${c.name})` : ""}`, value: c.payout, role: c.key, color: "bg-accent-foreground/50" });
    }
    return allRows.filter(r => r.role !== operatorRole);
  };

  return (
    <>
      <div className="sticky top-[60px] z-20 bg-background -mx-6 px-6 pb-0">
        {onBack && (
          <button onClick={onBack} className="mt-4 mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="h-4 w-4" /> Back to settlements
          </button>
        )}
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold tracking-tight">{event.name}</h1>
              <StatusBadge status={settlement.status} />
              <Link to="/events/$id" params={{ id: event.id }} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                <ExternalLink className="h-3.5 w-3.5" /> View event
              </Link>
            </div>
            <p className="mt-1 text-muted-foreground">{event.artist} · {event.venue} · {event.date}</p>
          </div>
        </div>
        <div className="flex items-center justify-between border-b">
        <div className="flex gap-1">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => !tab.comingSoon && handleTabChange(tab.id)}
              disabled={tab.comingSoon}
              className={cn(
                "px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px",
                tab.comingSoon
                  ? "border-transparent text-muted-foreground/40 cursor-not-allowed"
                  : activeTab === tab.id
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
              {tab.comingSoon && <span className="ml-1.5 text-[10px] font-normal">(coming soon)</span>}
            </button>
          ))}
        </div>
        <Select value={currency} onValueChange={setCurrency}>
          <SelectTrigger className="w-28 h-8 text-xs mb-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="EUR">EUR (€)</SelectItem>
            <SelectItem value="USD">USD ($)</SelectItem>
            <SelectItem value="GBP">GBP (£)</SelectItem>
            <SelectItem value="SEK">SEK (kr)</SelectItem>
          </SelectContent>
        </Select>
        </div>
      </div>

      <div className="pt-6">
        {activeTab === "overview" && (
          <OverviewTab event={event} deal={deal} revenue={revenue} settlement={settlement} buildPayoutRows={buildPayoutRows} settlementTotal={settlementTotal} currency={currency} partyBreakdowns={partyBreakdowns} totalRevenue={totalRevenue} totalDeductions={totalDeductions} netRevenue={netRevenue} partyNames={partyNames} />
        )}
        {activeTab === "deal" && deal && <DealTab deal={deal} currency={currency} />}
        {activeTab === "financials" && revenue && <FinancialsTab event={event} revenue={revenue} deal={deal} updateRevenue={updateRevenue} currency={currency} />}
        {activeTab === "settlement" && (
          <SettlementTab event={event} deal={deal} revenue={revenue} settlement={settlement} buildPayoutRows={buildPayoutRows} settlementTotal={settlementTotal} updateSettlementStatus={updateSettlementStatus} addComment={addComment} generateShareLink={generateShareLink} currentUser={currentUser} currency={currency} updateRevenue={updateRevenue} partyBreakdowns={partyBreakdowns} totalRevenue={totalRevenue} totalDeductions={totalDeductions} netRevenue={netRevenue} partyNames={partyNames} />
        )}
        {activeTab === "payout" && <PayoutTab event={event} settlement={settlement} buildPayoutRows={buildPayoutRows} deal={deal} revenue={revenue} currency={currency} />}
        {activeTab === "changelog" && <ChangeLogTab eventId={event.id} />}
      </div>
    </>
  );
}
