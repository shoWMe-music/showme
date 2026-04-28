import { Button } from "@/components/ui/button";
import { Printer, FileSpreadsheet, Copy, Check } from "lucide-react";

interface ExportActionsProps {
  hasSelection: boolean;
  recipients?: string[];
  sharing: boolean;
  copied: boolean;
  onPrint: () => void;
  onCSV: () => void;
  onShareLink: () => void;
}

export function ExportActions({
  hasSelection,
  sharing,
  copied,
  onPrint,
  onCSV,
  onShareLink,
}: ExportActionsProps) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Export as</p>
      <div className="grid grid-cols-3 gap-2">
        <Button variant="outline" onClick={onPrint} disabled={!hasSelection} className="gap-1.5 h-auto py-3 flex-col">
          <Printer className="h-4 w-4" />
          <span className="text-xs">Print / PDF</span>
        </Button>
        <Button variant="outline" onClick={onCSV} disabled={!hasSelection} className="gap-1.5 h-auto py-3 flex-col">
          <FileSpreadsheet className="h-4 w-4" />
          <span className="text-xs">CSV</span>
        </Button>
        <Button
          variant="outline"
          onClick={onShareLink}
          disabled={!hasSelection || sharing}
          className="gap-1.5 h-auto py-3 flex-col"
        >
          {copied ? <Check className="h-4 w-4 text-[hsl(var(--success))]" /> : <Copy className="h-4 w-4" />}
          <span className="text-xs">{sharing ? "Creating..." : copied ? "Copied!" : "Share Link"}</span>
        </Button>
      </div>
    </div>
  );
}
