import { formatCurrency, getCurrencySymbol, type ScheduleItem, type Rider, type Agreement, type CrewMember } from "@/lib/models";
import { type SelectionLevel, type EventExportData } from "./types";
import { type Todo } from "@/lib/db";

export function buildCSVContent(
  selectedTabIds: string[],
  selectedSectionIds: Set<string>,
  level: SelectionLevel,
  data: EventExportData
): string {
  const { event, deal, revenue, settlement, eventMeta, currency } = data;
  const sym = getCurrencySymbol(currency);
  const lines: string[] = [];

  lines.push(`"Event Report - ${event.name}"`);
  lines.push(`"Generated","${new Date().toLocaleDateString()}"`);
  lines.push(`"Event","${event.name}"`);
  lines.push(`"Date","${event.date}"`);
  lines.push(`"Venue","${event.venue}"`);
  lines.push(`"Performer","${event.artist}"`);
  lines.push(`"Capacity","${event.capacity}"`);
  lines.push("");

  const includeSection = (sectionId: string, tabId: string) => {
    if (level === "all") return true;
    if (level === "tabs") return selectedTabIds.includes(tabId);
    return selectedSectionIds.has(sectionId);
  };

  if (includeSection("event-info", "details")) {
    lines.push(`"--- Event Information ---"`);
    lines.push(`"Field","Value"`);
    lines.push(`"Name","${event.name}"`);
    lines.push(`"Date","${event.date}"`);
    lines.push(`"Venue","${event.venue}"`);
    lines.push(`"Performer","${event.artist}"`);
    lines.push(`"Operator","${event.operator}"`);
    lines.push(`"Operator Type","${event.operatorType}"`);
    lines.push(`"Status","${event.eventStatus}"`);
    lines.push(`"Capacity","${event.capacity}"`);
    lines.push(`"Ticketing Provider","${event.ticketingProvider || "N/A"}"`);
    lines.push("");
  }

  if (includeSection("ticketing", "details") && revenue?.ticketTypes?.length) {
    lines.push(`"--- Ticket Information ---"`);
    lines.push(`"Type","Price (${sym})","Expected Sold"`);
    revenue.ticketTypes.forEach(t => {
      lines.push(`"${t.name}","${t.price}","${t.sold}"`);
    });
    const totalRev = revenue.ticketTypes.reduce((s, t) => s + t.price * t.sold, 0);
    lines.push(`"Total Ticket Revenue","${totalRev}",""`);
    lines.push("");
  }

  if (includeSection("deal-structure", "details")) {
    lines.push(`"--- Financial Deal ---"`);
    lines.push(`"Field","Value"`);
    lines.push(`"Deal Type","${deal.dealType}"`);
    if (deal.artistGuarantee) lines.push(`"Performer Guarantee","${formatCurrency(deal.artistGuarantee, currency)}"`);
    if (deal.venueRental) lines.push(`"Venue Rental","${formatCurrency(deal.venueRental, currency)}"`);
    if (deal.dealType !== "guarantee" && deal.dealType !== "rental" && (deal.artistSplit || deal.venueSplit)) lines.push(`"Split","Performer ${deal.artistSplit}% / Venue ${deal.venueSplit}%"`);
    if (deal.artistCostSplit > 0 || deal.promoterCostSplit > 0 || deal.venueCostSplit > 0) lines.push(`"Costs Split","Performer ${deal.artistCostSplit || 0}% / Promoter ${deal.promoterCostSplit}% / Venue ${deal.venueCostSplit}%"`);
    lines.push("");
  }

  // schedule and riders are stored in subcollections — not on eventMeta directly
  const scheduleItems = (eventMeta as unknown as { schedule?: ScheduleItem[] }).schedule;
  if (includeSection("production-schedule", "details") && scheduleItems?.length) {
    lines.push(`"--- Production Schedule ---"`);
    lines.push(`"Time","Activity"`);
    scheduleItems.forEach((s: ScheduleItem) => {
      lines.push(`"${s.time || ""}","${s.label}"`);
    });
    lines.push("");
  }

  const riderItems = (eventMeta as unknown as { riders?: Rider[] }).riders;
  if (includeSection("riders", "details") && riderItems?.length) {
    lines.push(`"--- Riders & Documents ---"`);
    lines.push(`"Type","Name"`);
    riderItems.forEach((r: Rider) => {
      lines.push(`"${r.type}","${r.name}"`);
    });
    lines.push("");
  }

  if (includeSection("event-summary", "agreement")) {
    lines.push(`"--- Event Summary ---"`);
    lines.push(`"Field","Value"`);
    lines.push(`"Event","${event.name}"`);
    lines.push(`"Date","${event.date}"`);
    lines.push(`"Venue","${event.venue}"`);
    lines.push(`"Performer","${event.artist}"`);
    lines.push(`"Operator","${event.operator} (${event.operatorType})"`);
    if (deal) {
      lines.push(`"Deal Type","${deal.dealType}"`);
      if (deal.artistGuarantee) lines.push(`"Performer Guarantee","${formatCurrency(deal.artistGuarantee, currency)}"`);
    }
    lines.push("");
  }

  if (includeSection("agreements-docs", "agreement") || includeSection("terms", "agreement")) {
    const agreementItems = (eventMeta as unknown as { agreements?: Agreement[] }).agreements;
    if (includeSection("agreements-docs", "agreement") && agreementItems?.length) {
      lines.push(`"--- Agreements ---"`);
      lines.push(`"Type","Name","Status"`);
      agreementItems.forEach((a: Agreement) => {
        lines.push(`"${a.type}","${a.name}","${a.status}"`);
      });
      lines.push("");
    }
    if (includeSection("terms", "agreement") && eventMeta?.dealDescription) {
      lines.push(`"--- Terms & Conditions ---"`);
      lines.push(`"${String(eventMeta.dealDescription).replace(/"/g, '""')}"`);
      lines.push("");
    }
  }

  // Budget tab — same structure as buildPrintHTML.
  const budget = (eventMeta as unknown as { budget?: { revenueFields?: { name: string; value: number }[]; costFields?: { name: string; value: number }[]; resultFields?: { id?: string; name: string; value: number }[] } }).budget;
  if (includeSection("budget-calculator", "budget")) {
    if (budget && (budget.revenueFields?.length || budget.costFields?.length)) {
      lines.push(`"--- Budget Calculator ---"`);
      if (budget.revenueFields?.length) {
        lines.push(`"Revenue","Value (${sym})"`);
        budget.revenueFields.forEach(f => lines.push(`"${f.name}","${formatCurrency(f.value, currency)}"`));
      }
      if (budget.costFields?.length) {
        lines.push(`"Costs","Value (${sym})"`);
        budget.costFields.forEach(f => lines.push(`"${f.name}","${formatCurrency(f.value, currency)}"`));
      }
      if (budget.resultFields?.length) {
        lines.push(`"Result","Value"`);
        budget.resultFields.forEach(f => {
          const formatted = f.id === "profit_margin"
            ? `${f.value.toFixed(1)}%`
            : f.id === "breakeven_tickets"
            ? Math.round(f.value).toString()
            : formatCurrency(f.value, currency);
          lines.push(`"${f.name}","${formatted}"`);
        });
      }
      lines.push("");
    } else {
      lines.push(`"--- Budget Calculator ---"`);
      lines.push(`"No budget calculator data captured for this event."`);
      lines.push("");
    }
  }

  if (includeSection("budget-charts", "budget") && budget?.resultFields?.length) {
    const profitLoss = budget.resultFields.find(f => f.id === "profit_loss")?.value ?? 0;
    const breakeven = budget.resultFields.find(f => f.id === "breakeven_tickets")?.value ?? 0;
    lines.push(`"--- Break-even Analysis ---"`);
    lines.push(`"Metric","Value"`);
    lines.push(`"Profit / Loss","${formatCurrency(profitLoss, currency)}"`);
    lines.push(`"Break-even Ticket Count","${Math.round(breakeven)}"`);
    lines.push("");
  }

  if (includeSection("pro-estimator", "budget") && eventMeta?.proEstimate) {
    const p = eventMeta.proEstimate;
    lines.push(`"--- PRO Fee Estimate ---"`);
    lines.push(`"Field","Value"`);
    lines.push(`"PRO","${p.pro}"`);
    lines.push(`"Country","${p.country}"`);
    lines.push(`"Event Type","${p.eventType}"`);
    lines.push(`"Ticket Price","${formatCurrency(p.ticketPrice, currency)}"`);
    lines.push(`"Expected Tickets","${p.expectedTickets}"`);
    lines.push(`"Estimated Fee","${formatCurrency(p.estimatedFee, currency)}"`);
    lines.push("");
  }

  const crewItems = (eventMeta as unknown as { crew?: CrewMember[] }).crew;
  if (includeSection("shared-team", "crew") && crewItems?.length) {
    lines.push(`"--- Shared Team ---"`);
    lines.push(`"Name","Role","Email","Phone","Group"`);
    crewItems.forEach((c: CrewMember) => {
      lines.push(`"${c.name}","${c.role}","${c.email || ""}","${c.phone || ""}","${c.collaborator || ""}"`);
    });
    lines.push("");
  }

  if (includeSection("schedule", "crew") && eventMeta?.crewScheduleItems?.length) {
    lines.push(`"--- Team Schedule ---"`);
    lines.push(`"Time","Activity","Assignee"`);
    eventMeta.crewScheduleItems.forEach((s) => {
      lines.push(`"${s.time || ""}","${s.label}","${s.assignee || "Unassigned"}"`);
    });
    lines.push("");
  }

  if (includeSection("tasks", "crew") && eventMeta?.todos?.length) {
    lines.push(`"--- Tasks ---"`);
    lines.push(`"Task","Status","Assignee"`);
    eventMeta.todos.forEach((t: Todo) => {
      lines.push(`"${t.title}","${t.completed ? "Done" : "Open"}","${t.assignee || "Unassigned"}"`);
    });
    lines.push("");
  }

  if (includeSection("private-notes", "crew")) {
    const notes = Array.isArray(eventMeta?.privateNotes) ? eventMeta.privateNotes : [];
    if (notes.length > 0) {
      lines.push(`"--- Private Notes ---"`);
      lines.push(`"Note","Assignee"`);
      notes.forEach((n) => {
        lines.push(`"${String(n.text).replace(/"/g, '""')}","${n.assignee || "Unassigned"}"`);
      });
      lines.push("");
    }
  }

  if (includeSection("settlement-overview", "settlement")) {
    lines.push(`"--- Settlement ---"`);
    lines.push(`"Field","Value"`);
    lines.push(`"Status","${settlement.status}"`);
    if (settlement.artistPayout) lines.push(`"Performer Payout","${formatCurrency(settlement.artistPayout, currency)}"`);
    if (settlement.venuePayout) lines.push(`"Venue Payout","${formatCurrency(settlement.venuePayout, currency)}"`);
    if (settlement.promoterPayout) lines.push(`"Promoter Payout","${formatCurrency(settlement.promoterPayout, currency)}"`);
    lines.push("");
  }

  return lines.join("\n");
}
