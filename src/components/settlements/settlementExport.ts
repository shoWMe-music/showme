import { formatCurrency, getCurrencySymbol, settlementStatusLabels, type Event as AppEvent, type DealStructure, type TicketRevenue, type Settlement, type PartyBreakdown } from "@/lib/models";
import { toast } from "@/hooks/use-toast";

export function exportSettlementCSV({
  event, deal, revenue, settlement, currency, partyBreakdowns, buildPayoutRows, totalRevenue, totalDeductions, netRevenue,
}: {
  event: AppEvent; deal?: DealStructure; revenue?: TicketRevenue; settlement: Settlement;
  currency: string; partyBreakdowns: PartyBreakdown[];
  buildPayoutRows: () => { label: string; value: number; color: string; role: string }[];
  totalRevenue: number; totalDeductions: number; netRevenue: number;
}) {
  const fc = (v: number) => formatCurrency(v, currency);
  const now = new Date();
  const rows: string[][] = [
    ["shoWMe Settlement Report", ""],
    ["Generated", now.toLocaleString()],
    ["", ""],
    ["--- EVENT DETAILS ---", ""],
    ["Event", event.name],
    ["Date", event.date],
    ["Performer", event.artist],
    ["Venue", event.venue],
    ["Operator", `${event.operator} (${event.operatorType})`],
    ["Settlement Status", settlementStatusLabels[settlement.status] || settlement.status],
    ["", ""],
  ];

  if (deal) {
    rows.push(["--- DEAL STRUCTURE ---", ""]);
    rows.push(["Deal Type", deal.dealType.replace(/_/g, " ")]);
    if (deal.artistGuarantee > 0) rows.push(["Artist Guarantee", fc(deal.artistGuarantee)]);
    if (deal.artistSplit > 0) rows.push(["Artist Split", `${deal.artistSplit}%`]);
    if (deal.promoterSplit > 0) rows.push(["Promoter Split", `${deal.promoterSplit}%`]);
    if (deal.venueSplit > 0) rows.push(["Venue Split", `${deal.venueSplit}%`]);
    if ((deal.organizerSplit || 0) > 0) rows.push(["Organizer Split", `${deal.organizerSplit}%`]);
    if (deal.venueRental > 0) rows.push(["Venue Rental", fc(deal.venueRental)]);
    if (deal.venueRentalPaidBy) rows.push(["Venue Rental Paid By", deal.venueRentalPaidBy]);
    if (deal.promoterCostSplit > 0 || deal.venueCostSplit > 0) {
      rows.push(["Production Cost Split", `Promoter ${deal.promoterCostSplit}%, Venue ${deal.venueCostSplit}%${(deal.artistCostSplit || 0) > 0 ? `, Artist ${deal.artistCostSplit}%` : ""}${(deal.organizerCostSplit || 0) > 0 ? `, Organizer ${deal.organizerCostSplit}%` : ""}`]);
    }
    for (const c of deal.commissions) rows.push([`Commission: ${c.label}`, `${c.name} — ${c.percentage}%`]);
    rows.push(["", ""]);
  }

  if (revenue) {
    rows.push(["--- REVENUE ---", ""]);
    if (revenue.ticketTypes && revenue.ticketTypes.length > 0) {
      rows.push(["Ticket Sales", ""]);
      for (const t of revenue.ticketTypes) rows.push([`  ${t.name} (${t.sold} × ${fc(t.price)})`, fc(t.sold * t.price)]);
    }
    rows.push(["Gross Ticket Revenue", fc(revenue.grossRevenue)]);
    if (revenue.doorSales > 0) {
      rows.push(["Door Sales", fc(revenue.doorSales)]);
      if (revenue.doorSalesTypes && revenue.doorSalesTypes.length > 0) {
        for (const t of revenue.doorSalesTypes) rows.push([`  ${t.name} (${t.sold} × ${fc(t.price)})`, fc(t.sold * t.price)]);
      }
    }
    if (revenue.additionalRevenue && revenue.additionalRevenue.length > 0) {
      for (const r of revenue.additionalRevenue) {
        const vatStr = r.vat && r.vat.rate > 0 ? ` (${r.vat.mode === "included" ? `${r.vat.rate}% VAT incl.` : `+ ${r.vat.rate}% VAT`})` : "";
        rows.push([r.name + vatStr, fc(r.amount)]);
      }
    }
    rows.push(["Total Revenue", fc(totalRevenue)]);
    rows.push(["", ""]);

    rows.push(["--- DEDUCTIONS ---", ""]);
    if (revenue.ticketFees > 0) rows.push(["Ticket Fees", fc(revenue.ticketFees)]);
    if (revenue.tax > 0) rows.push(["Tax", fc(revenue.tax)]);
    if (revenue.refunds > 0) rows.push(["Refunds", fc(revenue.refunds)]);
    if (revenue.productionExpenses > 0) rows.push(["Production Costs", fc(revenue.productionExpenses)]);
    if (revenue.additionalCosts > 0) rows.push(["Additional Costs", fc(revenue.additionalCosts)]);
    if (revenue.additionalDeductions && revenue.additionalDeductions.length > 0) {
      for (const d of revenue.additionalDeductions) {
        const label = d.type === "percentage" ? `${d.name} (${d.amount}% of ${d.sourceField})` : d.name;
        const vatStr = d.vat && d.vat.rate > 0 ? ` (${d.vat.mode === "included" ? `${d.vat.rate}% VAT incl.` : `+ ${d.vat.rate}% VAT`})` : "";
        rows.push([label + vatStr, d.type === "fixed" ? fc(d.amount) : ""]);
      }
    }
    if (revenue.customCosts && revenue.customCosts.length > 0) {
      for (const c of revenue.customCosts) {
        const vatStr = c.vat && c.vat.rate > 0 ? ` (${c.vat.mode === "included" ? `${c.vat.rate}% VAT incl.` : `+ ${c.vat.rate}% VAT`})` : "";
        rows.push([`${c.name}${c.fromParty ? ` (${c.fromParty})` : ""}${vatStr}`, fc(c.amount)]);
      }
    }
    rows.push(["Total Deductions", fc(totalDeductions)]);
    rows.push(["Net Revenue", fc(netRevenue)]);
    rows.push(["", ""]);
  }

  rows.push(["--- PARTY BREAKDOWNS ---", ""]);
  for (const pb of partyBreakdowns) {
    rows.push([`${pb.party}`, ""]);
    rows.push(["  Base Amount", fc(pb.baseAmount)]);
    for (const adj of pb.adjustments) rows.push([`  ${adj.label}`, fc(adj.amount)]);
    rows.push(["  Final Payout", fc(pb.finalPayout)]);
    rows.push(["", ""]);
  }

  rows.push(["--- TOTAL PAYOUTS ---", ""]);
  const payoutRows = buildPayoutRows();
  for (const pr of payoutRows) rows.push([pr.label, fc(pr.value)]);
  rows.push(["Total", fc(payoutRows.reduce((s, r) => s + r.value, 0))]);

  const csv = rows.map(r => r.map(c => `"${c}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${event.name.replace(/\s+/g, "_")}_settlement_${now.toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast({ title: "CSV exported" });
}

export function exportSettlementPDF({
  event, deal, revenue, settlement, currency, partyBreakdowns, buildPayoutRows, totalRevenue, totalDeductions, netRevenue,
}: {
  event: AppEvent; deal?: DealStructure; revenue?: TicketRevenue; settlement: Settlement;
  currency: string; partyBreakdowns: PartyBreakdown[];
  buildPayoutRows: () => { label: string; value: number; color: string; role: string }[];
  totalRevenue: number; totalDeductions: number; netRevenue: number;
}) {
  import("jspdf").then(({ default: jsPDF }) => {
    import("jspdf-autotable").then((autoTableModule) => {
      const autoTable = (autoTableModule as Record<string, unknown>).default as typeof import("jspdf-autotable");
      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pageWidth = doc.internal.pageSize.getWidth();
      const margin = 14;
      const fc = (v: number) => formatCurrency(v, currency);
      const now = new Date();
      let y = 16;

      doc.setFillColor(30, 30, 40);
      doc.rect(0, 0, pageWidth, 36, "F");

      try {
        const logoImg = new Image();
        logoImg.src = "/images/showme-logo.png";
        doc.addImage(logoImg, "PNG", margin, 6, 24, 24);
      } catch { /* logo not available */ }

      doc.setTextColor(255, 255, 255);
      doc.setFontSize(16);
      doc.setFont("helvetica", "bold");
      doc.text("Settlement Report", margin + 36, 14);
      doc.setFontSize(9);
      doc.setFont("helvetica", "normal");
      doc.text(event.name, margin + 36, 20);
      doc.setFontSize(7);
      doc.text(`${event.venue}  •  ${event.date}  •  Generated: ${now.toLocaleString()}`, margin + 36, 26);
      doc.text(`Operator: ${event.operator} (${event.operatorType})  •  Status: ${settlementStatusLabels[settlement.status] || settlement.status}`, margin + 36, 31);
      y = 42;

      const checkPage = (needed: number) => { if (y + needed > 280) { doc.addPage(); y = 16; } };

      if (deal) {
        checkPage(30);
        doc.setTextColor(60, 60, 60);
        doc.setFontSize(11);
        doc.setFont("helvetica", "bold");
        doc.text("Deal Structure", margin, y);
        y += 5;

        const dealRows: string[][] = [
          ["Deal Type", deal.dealType.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase())],
        ];
        if (deal.artistGuarantee > 0) dealRows.push(["Artist Guarantee", fc(deal.artistGuarantee)]);
        if (deal.artistSplit > 0) dealRows.push(["Artist Split", `${deal.artistSplit}%`]);
        if (deal.promoterSplit > 0) dealRows.push(["Promoter Split", `${deal.promoterSplit}%`]);
        if (deal.venueSplit > 0) dealRows.push(["Venue Split", `${deal.venueSplit}%`]);
        if ((deal.organizerSplit || 0) > 0) dealRows.push(["Organizer Split", `${deal.organizerSplit}%`]);
        if (deal.venueRental > 0) dealRows.push(["Venue Rental", `${fc(deal.venueRental)} (paid by ${deal.venueRentalPaidBy || "promoter"})`]);
        if (deal.promoterCostSplit > 0 || deal.venueCostSplit > 0) {
          dealRows.push(["Production Cost Split", `P: ${deal.promoterCostSplit}% / V: ${deal.venueCostSplit}%${(deal.artistCostSplit || 0) > 0 ? ` / A: ${deal.artistCostSplit}%` : ""}${(deal.organizerCostSplit || 0) > 0 ? ` / O: ${deal.organizerCostSplit}%` : ""}`]);
        }
        for (const c of deal.commissions) dealRows.push([`${c.label}`, `${c.name} — ${c.percentage}%`]);

        autoTable(doc, {
          startY: y, head: [["", ""]], body: dealRows, showHead: false,
          margin: { left: margin, right: margin }, styles: { fontSize: 8, cellPadding: 1.5 },
          columnStyles: { 0: { fontStyle: "bold", cellWidth: 50 } }, theme: "plain",
        });
        y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
      }

      if (revenue) {
        checkPage(30);
        doc.setFontSize(11);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(60, 60, 60);
        doc.text("Revenue", margin, y);
        y += 5;

        const revRows: string[][] = [];
        if (revenue.ticketTypes && revenue.ticketTypes.length > 0) {
          for (const t of revenue.ticketTypes) revRows.push([`${t.name} (${t.sold} × ${fc(t.price)})`, fc(t.sold * t.price)]);
        }
        revRows.push(["Gross Ticket Revenue", fc(revenue.grossRevenue)]);
        if (revenue.doorSales > 0) revRows.push(["Door Sales", fc(revenue.doorSales)]);
        if (revenue.additionalRevenue && revenue.additionalRevenue.length > 0) {
          for (const r of revenue.additionalRevenue) {
            const vatStr = r.vat && r.vat.rate > 0 ? ` (${r.vat.mode === "included" ? `${r.vat.rate}% VAT incl.` : `+ ${r.vat.rate}% VAT`})` : "";
            revRows.push([r.name + vatStr, fc(r.amount)]);
          }
        }
        revRows.push(["Total Revenue", fc(totalRevenue)]);

        autoTable(doc, {
          startY: y, head: [["Revenue Item", "Amount"]], body: revRows,
          margin: { left: margin, right: margin }, styles: { fontSize: 8, cellPadding: 2 },
          headStyles: { fillColor: [34, 197, 94], textColor: 255, fontStyle: "bold" },
          alternateRowStyles: { fillColor: [245, 250, 245] }, theme: "grid",
        });
        y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;

        checkPage(20);
        doc.setFontSize(11);
        doc.setFont("helvetica", "bold");
        doc.text("Deductions", margin, y);
        y += 5;

        const dedRows: string[][] = [];
        if (revenue.ticketFees > 0) dedRows.push(["Ticket Fees", fc(revenue.ticketFees)]);
        if (revenue.tax > 0) dedRows.push(["Tax", fc(revenue.tax)]);
        if (revenue.refunds > 0) dedRows.push(["Refunds", fc(revenue.refunds)]);
        if (revenue.productionExpenses > 0) dedRows.push(["Production Costs", fc(revenue.productionExpenses)]);
        if (revenue.additionalCosts > 0) dedRows.push(["Additional Costs", fc(revenue.additionalCosts)]);
        if (revenue.additionalDeductions && revenue.additionalDeductions.length > 0) {
          for (const d of revenue.additionalDeductions) {
            const label = d.type === "percentage" ? `${d.name} (${d.amount}% of ${d.sourceField})` : d.name;
            const vatStr = d.vat && d.vat.rate > 0 ? ` (${d.vat.mode === "included" ? `${d.vat.rate}% VAT incl.` : `+ ${d.vat.rate}% VAT`})` : "";
            if (d.type === "percentage" && d.sourceField) {
              const srcAmt = d.sourceField === "ticketSales" ? revenue.grossRevenue : d.sourceField === "doorSales" ? revenue.doorSales : d.sourceField === "totalRevenue" ? totalRevenue : ((revenue.additionalRevenue || []).find(r => r.name === d.sourceField)?.amount || 0);
              dedRows.push([label + vatStr, fc(srcAmt * d.amount / 100)]);
            } else {
              dedRows.push([label + vatStr, fc(d.amount)]);
            }
          }
        }
        if (revenue.customCosts && revenue.customCosts.length > 0) {
          for (const c of revenue.customCosts) {
            const vatStr = c.vat && c.vat.rate > 0 ? ` (${c.vat.mode === "included" ? `${c.vat.rate}% VAT incl.` : `+ ${c.vat.rate}% VAT`})` : "";
            dedRows.push([`${c.name}${c.fromParty ? ` (${c.fromParty})` : ""}${vatStr}`, fc(c.amount)]);
          }
        }
        dedRows.push(["Total Deductions", fc(totalDeductions)]);
        dedRows.push(["Net Revenue", fc(netRevenue)]);

        autoTable(doc, {
          startY: y, head: [["Deduction", "Amount"]], body: dedRows,
          margin: { left: margin, right: margin }, styles: { fontSize: 8, cellPadding: 2 },
          headStyles: { fillColor: [239, 68, 68], textColor: 255, fontStyle: "bold" },
          alternateRowStyles: { fillColor: [255, 245, 245] }, theme: "grid",
        });
        y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
      }

      checkPage(20);
      doc.setFontSize(11);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(60, 60, 60);
      doc.text("Party Breakdowns", margin, y);
      y += 5;

      for (const pb of partyBreakdowns) {
        checkPage(15);
        const pbRows: string[][] = [
          ["Base Amount", fc(pb.baseAmount)],
          ...pb.adjustments.map(a => [a.label, fc(a.amount)]),
          ["Final Payout", fc(pb.finalPayout)],
        ];
        autoTable(doc, {
          startY: y, head: [[pb.party, "Amount"]], body: pbRows,
          margin: { left: margin, right: margin }, styles: { fontSize: 8, cellPadding: 1.5 },
          headStyles: { fillColor: [59, 130, 246], textColor: 255, fontStyle: "bold" },
          alternateRowStyles: { fillColor: [240, 245, 255] }, theme: "grid",
        });
        y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4;
      }

      checkPage(20);
      doc.setFontSize(11);
      doc.setFont("helvetica", "bold");
      doc.text("Total Payouts", margin, y);
      y += 5;

      const payoutRows = buildPayoutRows();
      const payoutBody = [
        ...payoutRows.map(pr => [pr.label, fc(pr.value)]),
        ["Total", fc(payoutRows.reduce((s, r) => s + r.value, 0))],
      ];
      autoTable(doc, {
        startY: y, head: [["Party", "Payout"]], body: payoutBody,
        margin: { left: margin, right: margin }, styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: [30, 30, 40], textColor: 255, fontStyle: "bold" },
        theme: "grid",
      });

      const pageCount = doc.getNumberOfPages();
      for (let p = 1; p <= pageCount; p++) {
        doc.setPage(p);
        doc.setFontSize(7);
        doc.setTextColor(160, 160, 160);
        doc.text(`Page ${p} of ${pageCount}`, pageWidth / 2, 290, { align: "center" });
        doc.text("shoWMe — Settlement Report", margin, 290);
        doc.text(`Generated: ${now.toLocaleString()}`, pageWidth - margin, 290, { align: "right" });
      }

      doc.save(`${event.name.replace(/\s+/g, "_")}_settlement_${now.toISOString().slice(0, 10)}.pdf`);
      toast({ title: "PDF exported" });
    });
  });
}
