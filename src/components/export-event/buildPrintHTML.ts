import { formatCurrency, getCurrencySymbol, type ScheduleItem, type Rider, type Agreement, type CrewMember } from "@/lib/models";
import { type SelectionLevel, type EventExportData } from "./types";
import { type Todo } from "@/lib/db";

export function buildPrintHTML(
  selectedTabs: Set<string>,
  selectedSections: Set<string>,
  level: SelectionLevel,
  data: EventExportData
): string {
  const { event, deal, revenue, settlement, eventMeta: md, currency } = data;
  const sym = getCurrencySymbol(currency);

  /** Safely render a value — replaces null/undefined with fallback text. */
  const s = (v: unknown, fallback = "N/A"): string =>
    v === null || v === undefined || v === "" ? fallback : String(v);

  const includeSection = (sectionId: string, tabId: string) => {
    if (level === "all") return true;
    if (level === "tabs") return selectedTabs.has(tabId);
    return selectedSections.has(sectionId);
  };

  let html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${event.name} - Report</title>
<style>
body{font-family:system-ui,-apple-system,sans-serif;padding:40px;color:#1a1a1a;max-width:800px;margin:0 auto}
h1{font-size:24px;margin-bottom:4px}
h2{font-size:16px;margin-top:24px;margin-bottom:8px;padding-bottom:4px;border-bottom:1px solid #ddd;color:#444}
table{width:100%;border-collapse:collapse;margin-bottom:12px;font-size:13px}
th,td{padding:6px 10px;text-align:left;border:1px solid #e0e0e0}
th{background:#f5f5f5;font-weight:600}
.meta{color:#666;font-size:13px;margin-bottom:20px}
.badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;background:#e8e8e8;margin-left:8px}
@media print{body{padding:20px}}
</style></head><body>`;

  const logoUrl = `${window.location.origin}/images/showme-logo.png`;
  html += `<img src="${logoUrl}" style="height:50px;margin-bottom:12px" alt="shoWMe" />`;
  html += `<h1>${s(event.name, "Untitled Event")}</h1>`;
  html += `<p class="meta">${s(event.artist, "N/A")} · ${s(event.venue, "N/A")} · ${s(event.date, "N/A")} · Currency: ${currency} (${sym})</p>`;

  if (includeSection("event-info", "details")) {
    html += `<h2>Event Information</h2><table>
      <tr><th>Field</th><th>Value</th></tr>
      <tr><td>Name</td><td>${s(event.name)}</td></tr>
      <tr><td>Date</td><td>${s(event.date)}</td></tr>
      <tr><td>Venue</td><td>${s(event.venue)}</td></tr>
      <tr><td>Performer</td><td>${s(event.artist)}</td></tr>
      <tr><td>Operator</td><td>${s(event.operator)}</td></tr>
      <tr><td>Operator Type</td><td>${s(event.operatorType)}</td></tr>
      <tr><td>Status</td><td>${s(event.eventStatus)}</td></tr>
      <tr><td>Capacity</td><td>${s(event.capacity)}</td></tr>
      <tr><td>Ticketing Provider</td><td>${s(event.ticketingProvider)}</td></tr>
    </table>`;
  }

  if (includeSection("ticketing", "details") && revenue?.ticketTypes?.length) {
    html += `<h2>Ticket Information</h2><table>
      <tr><th>Type</th><th>Price (${sym})</th><th>Expected Sold</th></tr>`;
    revenue.ticketTypes.forEach(t => {
      html += `<tr><td>${t.name}</td><td>${formatCurrency(t.price, currency)}</td><td>${t.sold}</td></tr>`;
    });
    const totalRev = revenue.ticketTypes.reduce((s, t) => s + t.price * t.sold, 0);
    html += `<tr><th>Total</th><th>${formatCurrency(totalRev, currency)}</th><th></th></tr></table>`;
  }

  if (includeSection("deal-structure", "details")) {
    if (!deal) {
      html += `<h2>Financial Deal</h2><p>No deal data available.</p>`;
    } else {
      html += `<h2>Financial Deal</h2><table>
        <tr><th>Field</th><th>Value</th></tr>
        <tr><td>Deal Type</td><td>${s(deal.dealType)}</td></tr>`;
      if (deal.artistGuarantee) html += `<tr><td>Performer Guarantee</td><td>${formatCurrency(deal.artistGuarantee, currency)}</td></tr>`;
      if (deal.venueRental) html += `<tr><td>Venue Rental</td><td>${formatCurrency(deal.venueRental, currency)}</td></tr>`;
      if (deal.dealType !== "guarantee" && deal.dealType !== "rental" && (deal.artistSplit || deal.venueSplit)) html += `<tr><td>Split</td><td>Performer ${deal.artistSplit ?? 0}% / Venue ${deal.venueSplit ?? 0}%</td></tr>`;
      if ((deal.artistCostSplit ?? 0) > 0 || (deal.promoterCostSplit ?? 0) > 0 || (deal.venueCostSplit ?? 0) > 0) html += `<tr><td>Costs Split</td><td>Performer ${deal.artistCostSplit ?? 0}% / Promoter ${deal.promoterCostSplit ?? 0}% / Venue ${deal.venueCostSplit ?? 0}%</td></tr>`;
      html += `</table>`;
    }
  }

  // schedule and riders are stored in subcollections — merged onto eventMeta in ExportEventDialog
  const scheduleItems = md ? (md as unknown as { schedule?: ScheduleItem[] }).schedule : undefined;
  if (includeSection("production-schedule", "details") && scheduleItems?.length) {
    html += `<h2>Production Schedule</h2><table>
      <tr><th>Time</th><th>Activity</th></tr>`;
    scheduleItems.forEach((item: ScheduleItem) => {
      html += `<tr><td>${item.time || ""}</td><td>${s(item.label)}</td></tr>`;
    });
    html += `</table>`;
  }

  const riderItems = md ? (md as unknown as { riders?: Rider[] }).riders : undefined;
  if (includeSection("riders", "details") && riderItems?.length) {
    html += `<h2>Riders & Documents</h2><table>
      <tr><th>Type</th><th>Name</th></tr>`;
    riderItems.forEach((r: Rider) => {
      html += `<tr><td>${s(r.type)}</td><td>${s(r.name)}</td></tr>`;
    });
    html += `</table>`;
  }

  const agreementItems = md ? (md as unknown as { agreements?: Agreement[] }).agreements : undefined;
  if (includeSection("agreements-docs", "agreement") && agreementItems?.length) {
    html += `<h2>Agreements & Documents</h2><table>
      <tr><th>Type</th><th>Name</th><th>Status</th></tr>`;
    agreementItems.forEach((a: Agreement) => {
      html += `<tr><td>${s(a.type)}</td><td>${s(a.name)}</td><td>${s(a.status)}</td></tr>`;
    });
    html += `</table>`;
  }

  if (includeSection("terms", "agreement") && md?.dealDescription) {
    html += `<h2>Terms & Conditions</h2><div style="border:1px solid #e0e0e0;padding:12px;border-radius:6px;font-size:13px;white-space:pre-wrap">${md.dealDescription}</div>`;
  }

  const crewItems = md ? (md as unknown as { crew?: CrewMember[] }).crew : undefined;
  if (includeSection("shared-team", "crew") && crewItems?.length) {
    html += `<h2>Shared Team</h2><table>
      <tr><th>Name</th><th>Role</th><th>Email</th><th>Phone</th><th>Group</th></tr>`;
    crewItems.forEach((c: CrewMember) => {
      html += `<tr><td>${s(c.name)}</td><td>${s(c.role)}</td><td>${c.email || ""}</td><td>${c.phone || ""}</td><td>${c.collaborator || ""}</td></tr>`;
    });
    html += `</table>`;
  }

  if (includeSection("schedule", "crew") && md?.crewScheduleItems?.length) {
    html += `<h2>Team Schedule</h2><table>
      <tr><th>Time</th><th>Activity</th><th>Assignee</th></tr>`;
    md.crewScheduleItems.forEach((s) => {
      html += `<tr><td>${s.time || ""}</td><td>${s.label}</td><td>${s.assignee || "Unassigned"}</td></tr>`;
    });
    html += `</table>`;
  }

  if (includeSection("tasks", "crew") && md?.todos?.length) {
    html += `<h2>Tasks</h2><table>
      <tr><th>Task</th><th>Status</th><th>Assignee</th></tr>`;
    md.todos.forEach((t: Todo) => {
      html += `<tr><td>${t.title}</td><td>${t.completed ? "Done" : "Open"}</td><td>${t.assignee || "Unassigned"}</td></tr>`;
    });
    html += `</table>`;
  }

  if (includeSection("private-notes", "crew")) {
    const notes = Array.isArray(md?.privateNotes) ? md.privateNotes : [];
    if (notes.length > 0) {
      html += `<h2>Private Notes</h2><table>
        <tr><th>Note</th><th>Assignee</th></tr>`;
      notes.forEach((n) => {
        html += `<tr><td>${n.text}</td><td>${n.assignee || "Unassigned"}</td></tr>`;
      });
      html += `</table>`;
    }
  }

  if (includeSection("settlement-overview", "settlement")) {
    if (!settlement) {
      html += `<h2>Settlement</h2><p>No settlement data available.</p>`;
    } else {
      html += `<h2>Settlement</h2><table>
        <tr><th>Field</th><th>Value</th></tr>
        <tr><td>Status</td><td>${s(settlement.status)}</td></tr>`;
      if (settlement.artistPayout) html += `<tr><td>Performer Payout</td><td>${formatCurrency(settlement.artistPayout, currency)}</td></tr>`;
      if (settlement.venuePayout) html += `<tr><td>Venue Payout</td><td>${formatCurrency(settlement.venuePayout, currency)}</td></tr>`;
      if (settlement.promoterPayout) html += `<tr><td>Promoter Payout</td><td>${formatCurrency(settlement.promoterPayout, currency)}</td></tr>`;
      html += `</table>`;
    }
  }

  html += `<p style="text-align:center;color:#888;font-size:11px;margin-top:40px">Generated by shoWMe</p></body></html>`;
  return html;
}
