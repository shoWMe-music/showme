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

  // Stringify safely for CSV: empty/null/undefined → fallback, embedded
  // double quotes escaped per RFC 4180. Mirrors the s() helper in
  // buildPrintHTML.ts so a missing field never serialises as "undefined".
  const s = (v: unknown, fallback = ""): string => {
    if (v === null || v === undefined || v === "") return fallback;
    return String(v).replace(/"/g, '""');
  };

  lines.push(`"Event Report - ${s(event.name)}"`);
  lines.push(`"Generated","${new Date().toLocaleDateString()}"`);
  lines.push(`"Event","${s(event.name)}"`);
  lines.push(`"Date","${s(event.date)}"`);
  lines.push(`"Venue","${s(event.venue)}"`);
  lines.push(`"Performer","${s(event.artist)}"`);
  lines.push(`"Capacity","${s(event.capacity)}"`);
  lines.push("");

  const includeSection = (sectionId: string, tabId: string) => {
    if (level === "all") return true;
    if (level === "tabs") return selectedTabIds.includes(tabId);
    return selectedSectionIds.has(sectionId);
  };

  if (includeSection("event-info", "details")) {
    lines.push(`"--- Event Information ---"`);
    lines.push(`"Field","Value"`);
    lines.push(`"Name","${s(event.name, "N/A")}"`);
    lines.push(`"Date","${s(event.date, "N/A")}"`);
    lines.push(`"Venue","${s(event.venue, "N/A")}"`);
    lines.push(`"Performer","${s(event.artist, "N/A")}"`);
    lines.push(`"Operator","${s(event.operator, "N/A")}"`);
    lines.push(`"Operator Type","${s(event.operatorType, "N/A")}"`);
    lines.push(`"Status","${s(event.eventStatus, "N/A")}"`);
    lines.push(`"Capacity","${s(event.capacity, "N/A")}"`);
    lines.push(`"Ticketing Provider","${s(event.ticketingProvider, "N/A")}"`);
    if (event.notes) lines.push(`"Notes","${s(event.notes)}"`);
    if (event.amenities && event.amenities.length > 0) {
      lines.push(`"Amenities","${s(event.amenities.join(", "))}"`);
    }
    if (event.cateringNotes) lines.push(`"Catering","${s(event.cateringNotes)}"`);
    if (event.accommodationNotes) lines.push(`"Accommodation","${s(event.accommodationNotes)}"`);
    lines.push("");
  }

  if (includeSection("ticketing", "details") && revenue?.ticketTypes?.length) {
    lines.push(`"--- Ticket Information ---"`);
    lines.push(`"Type","Price (${sym})","Expected Sold"`);
    revenue.ticketTypes.forEach(t => {
      lines.push(`"${s(t.name)}","${s(t.price, "0")}","${s(t.sold, "0")}"`);
    });
    const totalRev = revenue.ticketTypes.reduce((sum, t) => sum + (t.price ?? 0) * (t.sold ?? 0), 0);
    lines.push(`"Total Ticket Revenue","${totalRev}",""`);
    lines.push("");
  }

  if (includeSection("deal-structure", "details")) {
    lines.push(`"--- Financial Deal ---"`);
    lines.push(`"Field","Value"`);
    lines.push(`"Deal Type","${s(deal?.dealType, "N/A")}"`);
    if (deal.artistGuarantee) lines.push(`"Performer Guarantee","${formatCurrency(deal.artistGuarantee, currency)}"`);
    if (deal.venueRental) lines.push(`"Venue Rental","${formatCurrency(deal.venueRental, currency)}"`);
    if (deal.dealType !== "guarantee" && deal.dealType !== "rental" && (deal.artistSplit || deal.venueSplit)) lines.push(`"Split","Performer ${deal.artistSplit ?? 0}% / Venue ${deal.venueSplit ?? 0}%"`);
    if ((deal.artistCostSplit ?? 0) > 0 || (deal.promoterCostSplit ?? 0) > 0 || (deal.venueCostSplit ?? 0) > 0) lines.push(`"Costs Split","Performer ${deal.artistCostSplit ?? 0}% / Promoter ${deal.promoterCostSplit ?? 0}% / Venue ${deal.venueCostSplit ?? 0}%"`);
    lines.push("");
  }

  // schedule and riders are stored in subcollections — not on eventMeta directly
  const scheduleItems = (eventMeta as unknown as { schedule?: ScheduleItem[] }).schedule;
  if (includeSection("production-schedule", "details") && scheduleItems?.length) {
    lines.push(`"--- Production Schedule ---"`);
    lines.push(`"Time","Activity"`);
    scheduleItems.forEach((it: ScheduleItem) => {
      lines.push(`"${s(it.time)}","${s(it.label)}"`);
    });
    lines.push("");
  }

  const riderItems = (eventMeta as unknown as { riders?: Rider[] }).riders;
  if (includeSection("riders", "details") && riderItems?.length) {
    lines.push(`"--- Riders & Documents ---"`);
    lines.push(`"Type","Name","File","URL"`);
    riderItems.forEach((r: Rider) => {
      lines.push(`"${s(r.type)}","${s(r.name)}","${s(r.fileName)}","${s(r.fileUrl)}"`);
    });
    lines.push("");
  }

  if (includeSection("event-summary", "agreement")) {
    lines.push(`"--- Event Summary ---"`);
    lines.push(`"Field","Value"`);
    lines.push(`"Event","${s(event.name, "N/A")}"`);
    lines.push(`"Date","${s(event.date, "N/A")}"`);
    lines.push(`"Venue","${s(event.venue, "N/A")}"`);
    lines.push(`"Performer","${s(event.artist, "N/A")}"`);
    lines.push(`"Operator","${s(event.operator, "N/A")} (${s(event.operatorType, "N/A")})"`);
    if (deal) {
      lines.push(`"Deal Type","${s(deal.dealType, "N/A")}"`);
      if (deal.artistGuarantee) lines.push(`"Performer Guarantee","${formatCurrency(deal.artistGuarantee, currency)}"`);
    }
    lines.push("");
  }

  if (includeSection("agreements-docs", "agreement") || includeSection("terms", "agreement")) {
    const agreementItems = (eventMeta as unknown as { agreements?: Agreement[] }).agreements;
    if (includeSection("agreements-docs", "agreement") && agreementItems?.length) {
      lines.push(`"--- Agreements ---"`);
      lines.push(`"Type","Name","Status","File","URL"`);
      agreementItems.forEach((a: Agreement) => {
        lines.push(`"${s(a.type)}","${s(a.name)}","${s(a.status)}","${s(a.fileName)}","${s(a.fileUrl)}"`);
      });
      lines.push("");
    }
    if (includeSection("terms", "agreement") && eventMeta?.dealDescription) {
      lines.push(`"--- Terms & Conditions ---"`);
      lines.push(`"${s(eventMeta.dealDescription)}"`);
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
        budget.revenueFields.forEach(f => lines.push(`"${s(f.name)}","${formatCurrency(f.value ?? 0, currency)}"`));
      }
      if (budget.costFields?.length) {
        lines.push(`"Costs","Value (${sym})"`);
        budget.costFields.forEach(f => lines.push(`"${s(f.name)}","${formatCurrency(f.value ?? 0, currency)}"`));
      }
      if (budget.resultFields?.length) {
        lines.push(`"Result","Value"`);
        budget.resultFields.forEach(f => {
          const value = f.value ?? 0;
          const formatted = f.id === "profit_margin"
            ? `${value.toFixed(1)}%`
            : f.id === "breakeven_tickets"
            ? Math.round(value).toString()
            : formatCurrency(value, currency);
          lines.push(`"${s(f.name)}","${formatted}"`);
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
    lines.push(`"PRO","${s(p.pro)}"`);
    lines.push(`"Country","${s(p.country)}"`);
    lines.push(`"Event Type","${s(p.eventType)}"`);
    lines.push(`"Ticket Price","${formatCurrency(p.ticketPrice ?? 0, currency)}"`);
    lines.push(`"Expected Tickets","${s(p.expectedTickets, "0")}"`);
    lines.push(`"Estimated Fee","${formatCurrency(p.estimatedFee ?? 0, currency)}"`);
    lines.push("");
  }

  const crewItems = (eventMeta as unknown as { crew?: CrewMember[] }).crew;
  if (includeSection("shared-team", "crew") && crewItems?.length) {
    lines.push(`"--- Shared Team ---"`);
    lines.push(`"Name","Role","Email","Phone","Group"`);
    crewItems.forEach((c: CrewMember) => {
      lines.push(`"${s(c.name)}","${s(c.role)}","${s(c.email)}","${s(c.phone)}","${s(c.collaborator)}"`);
    });
    lines.push("");
  }

  if (includeSection("schedule", "crew") && eventMeta?.crewScheduleItems?.length) {
    lines.push(`"--- Team Schedule ---"`);
    lines.push(`"Time","Activity","Assignee"`);
    eventMeta.crewScheduleItems.forEach((it) => {
      lines.push(`"${s(it.time)}","${s(it.label)}","${s(it.assignee, "Unassigned")}"`);
    });
    lines.push("");
  }

  if (includeSection("tasks", "crew") && eventMeta?.todos?.length) {
    lines.push(`"--- Tasks ---"`);
    lines.push(`"Task","Status","Assignee"`);
    eventMeta.todos.forEach((t: Todo) => {
      lines.push(`"${s(t.title)}","${t.completed ? "Done" : "Open"}","${s(t.assignee, "Unassigned")}"`);
    });
    lines.push("");
  }

  if (includeSection("private-notes", "crew")) {
    const notes = Array.isArray(eventMeta?.privateNotes) ? eventMeta.privateNotes : [];
    if (notes.length > 0) {
      lines.push(`"--- Private Notes ---"`);
      lines.push(`"Note","Assignee"`);
      notes.forEach((n) => {
        lines.push(`"${s(n.text)}","${s(n.assignee, "Unassigned")}"`);
      });
      lines.push("");
    }
  }

  if (includeSection("settlement-overview", "settlement")) {
    lines.push(`"--- Settlement ---"`);
    lines.push(`"Field","Value"`);
    lines.push(`"Status","${s(settlement?.status, "N/A")}"`);
    if (settlement?.artistPayout) lines.push(`"Performer Payout","${formatCurrency(settlement.artistPayout, currency)}"`);
    if (settlement?.venuePayout) lines.push(`"Venue Payout","${formatCurrency(settlement.venuePayout, currency)}"`);
    if (settlement?.promoterPayout) lines.push(`"Promoter Payout","${formatCurrency(settlement.promoterPayout, currency)}"`);
    lines.push("");
  }

  return lines.join("\n");
}
