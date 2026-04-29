import { useState, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { FileText, FileSpreadsheet, Share2, Link2, Check, Copy, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import type { BudgetField } from "@/lib/budget-types";
import type { Event as AppEvent } from "@/lib/models";
import { formatCurrency, getCurrencySymbol } from "@/lib/models";
import { insertShareTokenRow } from "@/lib/db";

interface BudgetExportActionsProps {
  event: AppEvent;
  revenueFields: BudgetField[];
  costFields: BudgetField[];
  resultFields: BudgetField[];
  getFieldValue: (id: string) => number;
  currency?: string;
}

// Exclude "input-only" fields from revenue totals
const EXCLUDED_REVENUE_IDS = ["ticket_price", "expected_tickets", "capacity", "avg_bar_spend"];

// PDF footer layout — stack disclaimer above the page counter so the two cannot
// overlap, even when the disclaimer text is long or the page counter is centered.
// Exported so tests can assert the y-coordinates remain visually separated.
export const PDF_FOOTER_DISCLAIMER_Y_MM = 18; // mm from page bottom
export const PDF_FOOTER_PAGE_COUNTER_Y_MM = 8; // mm from page bottom

export default function BudgetExportActions({ event, revenueFields, costFields, resultFields, getFieldValue, currency = "EUR" }: BudgetExportActionsProps) {
  const [copied, setCopied] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [pdfGenerating, setPdfGenerating] = useState(false);

  const totalRevenue = getFieldValue("total_revenue");
  const totalCosts = getFieldValue("total_costs");
  const profitLoss = totalRevenue - totalCosts;

  const shareMutation = useMutation({
    mutationFn: async () => {
      const budgetData = {
        eventName: event.name,
        eventVenue: event.venue,
        eventDate: event.date,
        revenueFields: revenueFields.map(f => ({ id: f.id, name: f.name, value: f.value })),
        costFields: costFields.map(f => ({ id: f.id, name: f.name, value: f.value })),
        resultFields: resultFields.map(f => ({ id: f.id, name: f.name, value: f.value })),
        generatedAt: new Date().toISOString(),
      };
      const token = crypto.randomUUID();
      await insertShareTokenRow({
        token,
        event_id: event.id,
        parties: budgetData,
      });
      return token;
    },
    onSuccess: async (token) => {
      const url = `${window.location.origin}/shared/budget/${token}`;
      setShareUrl(url);
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success("Share link copied to clipboard", { icon: <Copy className="h-4 w-4" /> });
    },
    onError: (err) => {
      console.error("Share error:", err);
      toast.error("Failed to generate share link");
    },
  });

  // ── CSV Export ──
  const handleCSV = useCallback(() => {
    if (!event || !revenueFields.length || !costFields.length) {
      toast.error("Please wait for data to load");
      return;
    }
    const rows: string[][] = [
      ["Category", "Field", `Value (${getCurrencySymbol(currency)})`],
      [],
      ["— REVENUE —", "", ""],
      ...revenueFields.map(f => ["Revenue", f.name, f.value.toFixed(2)]),
      [],
      ["— COSTS —", "", ""],
      ...costFields.map(f => ["Cost", f.name, f.value.toFixed(2)]),
      [],
      ["— RESULTS —", "", ""],
      ...resultFields.map(f => [
        "Result",
        f.name,
        f.id === "profit_margin" ? `${f.value.toFixed(1)}%` : f.id === "breakeven_tickets" ? Math.round(f.value).toString() : f.value.toFixed(2),
      ]),
    ];

    const csvContent = rows.map(r => r.map(c => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `budget-${event.name.replace(/\s+/g, "_")}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("CSV downloaded");
  }, [event, revenueFields, costFields, resultFields]);

  // ── PDF Export with infographics ──
  const handlePDF = useCallback(async () => {
    setPdfGenerating(true);
    try {
    if (!event || !revenueFields.length || !costFields.length) {
      toast.error("Please wait for data to load");
      setPdfGenerating(false);
      return;
    }

    const { default: jsPDF } = await import("jspdf");
    const { default: autoTable } = await import("jspdf-autotable");
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 14;
    const footerZone = 20; // reserve 20mm at bottom for footer
    const contentBottom = pageHeight - footerZone; // max Y before needing a new page
    let y = 16;

    /** Add a new page if content would exceed the safe area. Returns updated y. */
    const ensureSpace = (needed: number): number => {
      if (y + needed > contentBottom) {
        doc.addPage();
        return 16;
      }
      return y;
    };

    // Header
    doc.setFillColor(30, 30, 40);
    doc.rect(0, 0, pageWidth, 38, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(18);
    doc.setFont("helvetica", "bold");
    doc.text("Budget Report", margin, y + 4);
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(event.name, margin, y + 12);
    doc.setFontSize(8);
    doc.text(`${event.venue}  •  ${event.date}  •  Generated ${new Date().toLocaleDateString()}`, margin, y + 18);
    y = 46;

    // ── Summary infographic cards ──
    doc.setTextColor(60, 60, 60);
    const cardW = (pageWidth - margin * 2 - 6 * 3) / 4;
    const cards = [
      { label: "Total Revenue", value: formatCurrency(totalRevenue), color: [34, 197, 94] as [number, number, number] },
      { label: "Total Costs", value: formatCurrency(totalCosts), color: [239, 68, 68] as [number, number, number] },
      { label: "Profit / Loss", value: formatCurrency(profitLoss), color: profitLoss >= 0 ? [34, 197, 94] as [number, number, number] : [239, 68, 68] as [number, number, number] },
      { label: "Break-even", value: `${Math.round(getFieldValue("breakeven_tickets"))} tickets`, color: [234, 179, 8] as [number, number, number] },
    ];

    cards.forEach((card, i) => {
      const x = margin + i * (cardW + 6);
      doc.setFillColor(card.color[0], card.color[1], card.color[2]);
      doc.roundedRect(x, y, cardW, 22, 2, 2, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(7);
      doc.setFont("helvetica", "normal");
      doc.text(card.label, x + 4, y + 7);
      doc.setFontSize(12);
      doc.setFont("helvetica", "bold");
      doc.text(card.value, x + 4, y + 16);
    });
    y += 30;

    // ── Profit Margin gauge ──
    const profitMargin = getFieldValue("profit_margin");
    doc.setTextColor(60, 60, 60);
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.text("Profit Margin", margin, y + 4);
    
    const gaugeX = margin;
    const gaugeW = pageWidth - margin * 2;
    const gaugeH = 6;
    const gaugeY = y + 7;
    
    // Background
    doc.setFillColor(230, 230, 230);
    doc.roundedRect(gaugeX, gaugeY, gaugeW, gaugeH, 2, 2, "F");
    
    // Fill
    const fillW = Math.min(Math.max(profitMargin, 0), 100) / 100 * gaugeW;
    if (fillW > 0) {
      const gaugeColor: [number, number, number] = profitMargin >= 20 ? [34, 197, 94] : profitMargin >= 10 ? [234, 179, 8] : [239, 68, 68];
      doc.setFillColor(gaugeColor[0], gaugeColor[1], gaugeColor[2]);
      doc.roundedRect(gaugeX, gaugeY, fillW, gaugeH, 2, 2, "F");
    }
    
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100, 100, 100);
    doc.text(`${profitMargin.toFixed(1)}%`, gaugeX + gaugeW + 2, gaugeY + 4.5);
    y = gaugeY + 14;

    // ── Revenue vs Costs bar comparison ──
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(60, 60, 60);
    doc.text("Revenue vs Costs", margin, y + 4);
    y += 8;

    const maxVal = Math.max(totalRevenue, totalCosts, 1);
    const barMaxW = pageWidth - margin * 2 - 40;

    // Revenue bar
    doc.setFillColor(34, 197, 94);
    const revBarW = Math.max((totalRevenue / maxVal) * barMaxW, 2);
    doc.roundedRect(margin, y, revBarW, 7, 1.5, 1.5, "F");
    doc.setFontSize(7);
    doc.setTextColor(34, 197, 94);
    doc.text(formatCurrency(totalRevenue), margin + revBarW + 3, y + 5);
    doc.setTextColor(100, 100, 100);
    doc.text("Revenue", margin + barMaxW + 20, y + 5);
    y += 10;

    // Costs bar
    doc.setFillColor(239, 68, 68);
    const costBarW = Math.max((totalCosts / maxVal) * barMaxW, 2);
    doc.roundedRect(margin, y, costBarW, 7, 1.5, 1.5, "F");
    doc.setFontSize(7);
    doc.setTextColor(239, 68, 68);
    doc.text(formatCurrency(totalCosts), margin + costBarW + 3, y + 5);
    doc.setTextColor(100, 100, 100);
    doc.text("Costs", margin + barMaxW + 20, y + 5);
    y += 16;

    // ── Cost Distribution mini bars ──
    const activeCosts = costFields.filter(f => f.value > 0);
    if (activeCosts.length > 0) {
      doc.setFontSize(9);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(60, 60, 60);
      doc.text("Cost Distribution", margin, y + 4);
      y += 8;

      const costMax = Math.max(...activeCosts.map(f => f.value));
      const costColors: [number, number, number][] = [
        [239, 68, 68], [249, 115, 22], [234, 179, 8], [168, 85, 247],
        [59, 130, 246], [236, 72, 153], [107, 114, 128], [20, 184, 166],
      ];

      activeCosts.forEach((f, i) => {
        y = ensureSpace(10);
        const bw = Math.max((f.value / costMax) * (barMaxW * 0.7), 2);
        const c = costColors[i % costColors.length];
        doc.setFillColor(c[0], c[1], c[2]);
        doc.roundedRect(margin + 40, y, bw, 5, 1, 1, "F");
        doc.setFontSize(6.5);
        doc.setTextColor(80, 80, 80);
        doc.text(f.name, margin, y + 3.8);
        doc.setTextColor(c[0], c[1], c[2]);
        doc.text(formatCurrency(f.value), margin + 40 + bw + 3, y + 3.8);
        y += 8;
      });
      y += 4;
    }

    // ── Revenue Table ──
    y = ensureSpace(30);
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(60, 60, 60);
    doc.text("Revenue Details", margin, y + 4);
    y += 6;

    autoTable(doc, {
      startY: y,
      head: [["Field", "Value"]],
      body: revenueFields.map(f => [f.name, formatCurrency(f.value)]),
      margin: { left: margin, right: margin, bottom: footerZone },
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [34, 197, 94], textColor: 255, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [245, 250, 245] },
      theme: "grid",
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;

    // ── Costs Table ──
    y = ensureSpace(30);
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(60, 60, 60);
    doc.text("Cost Details", margin, y + 4);
    y += 6;

    autoTable(doc, {
      startY: y,
      head: [["Field", "Value"]],
      body: costFields.map(f => [f.name, formatCurrency(f.value)]),
      margin: { left: margin, right: margin, bottom: footerZone },
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [239, 68, 68], textColor: 255, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [255, 245, 245] },
      theme: "grid",
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;

    // ── Results Table ──
    y = ensureSpace(30);
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(60, 60, 60);
    doc.text("Summary Results", margin, y + 4);
    y += 6;

    autoTable(doc, {
      startY: y,
      head: [["Metric", "Value"]],
      body: resultFields.map(f => [
        f.name,
        f.id === "profit_margin" ? `${f.value.toFixed(1)}%` : f.id === "breakeven_tickets" ? Math.round(f.value).toLocaleString() : formatCurrency(f.value),
      ]),
      margin: { left: margin, right: margin, bottom: footerZone },
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [59, 130, 246], textColor: 255, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [240, 245, 255] },
      theme: "grid",
    });

    // ── Footer on every page ──
    // Disclaimer stacks above the page counter so the two cannot overlap; see
    // PDF_FOOTER_*_Y_MM module constants for the exact y-coordinates.
    const pageCount = doc.getNumberOfPages();
    for (let p = 1; p <= pageCount; p++) {
      doc.setPage(p);
      doc.setFontSize(7);
      doc.setTextColor(160, 160, 160);
      doc.text("Estimate only \u2014 review before final decisions", margin, pageHeight - PDF_FOOTER_DISCLAIMER_Y_MM);
      doc.text(`Page ${p} of ${pageCount}`, pageWidth / 2, pageHeight - PDF_FOOTER_PAGE_COUNTER_Y_MM, { align: "center" });
    }

    doc.save(`budget-${event.name.replace(/\s+/g, "_")}-${new Date().toISOString().slice(0, 10)}.pdf`);
    toast.success("PDF downloaded");
    } finally {
      setPdfGenerating(false);
    }
  }, [event, revenueFields, costFields, resultFields, totalRevenue, totalCosts, profitLoss, getFieldValue]);

  // ── Share Link ──
  const handleShare = useCallback(() => {
    shareMutation.mutate();
  }, [shareMutation]);

  const copyUrl = useCallback(async () => {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success("Copied!", { icon: <Copy className="h-4 w-4" /> });
  }, [shareUrl]);

  return (
    <div className="flex items-center gap-1.5">
      <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={handleCSV}>
        <FileSpreadsheet className="h-3.5 w-3.5" /> CSV
      </Button>
      <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={handlePDF} disabled={pdfGenerating}>
        {pdfGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />} {pdfGenerating ? "Generating..." : "PDF"}
      </Button>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1.5 text-xs">
            <Share2 className="h-3.5 w-3.5" /> Share
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-3" align="end">
          <div className="space-y-3">
            <div>
              <p className="text-sm font-medium mb-1">Share Budget Report</p>
              <p className="text-xs text-muted-foreground">Generate a shareable link with a snapshot of this budget.</p>
            </div>
            {shareUrl ? (
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0 rounded-md border bg-muted/50 px-2 py-1.5">
                  <p className="text-xs truncate text-muted-foreground">{shareUrl}</p>
                </div>
                <Button size="icon" variant="outline" className="h-8 w-8 shrink-0" onClick={copyUrl}>
                  {copied ? <Check className="h-3.5 w-3.5 text-[hsl(var(--success))]" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </div>
            ) : (
              <Button size="sm" className="w-full gap-1.5 text-xs" onClick={handleShare} disabled={shareMutation.isPending}>
                <Link2 className="h-3.5 w-3.5" /> {shareMutation.isPending ? "Generating..." : "Generate Share Link"}
              </Button>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
