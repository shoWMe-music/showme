import { Button } from "@/components/ui/button";
import { Printer, FileSpreadsheet, Check, Globe, Lock } from "lucide-react";

export type ShareAccess = "public" | "protected";

interface ExportActionsProps {
  hasSelection: boolean;
  access: ShareAccess;
  recipients: string[];
  sharing: boolean;
  copied: boolean;
  onPrint: () => void;
  onCSV: () => void;
  onShareLink: () => void;
}

export function ExportActions({
  hasSelection,
  access,
  recipients,
  sharing,
  copied,
  onPrint,
  onCSV,
  onShareLink,
}: ExportActionsProps) {
  const protectedNeedsRecipients = access === "protected" && recipients.length === 0;
  const shareDisabled = !hasSelection || sharing || protectedNeedsRecipients;
  const isPublic = access === "public";
  const ShareIcon = copied ? Check : isPublic ? Globe : Lock;
  const idleLabel = isPublic ? "Create Public Link" : "Create Protected Link";
  const label = sharing ? "Creating..." : copied ? "Copied!" : idleLabel;

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
          disabled={shareDisabled}
          className="gap-1.5 h-auto py-3 flex-col"
        >
          {copied ? (
            <Check className="h-4 w-4 text-[hsl(var(--success))]" />
          ) : (
            <ShareIcon className="h-4 w-4" />
          )}
          <span className="text-xs text-center">{label}</span>
        </Button>
      </div>
      {protectedNeedsRecipients && (
        <p className="text-[11px] text-muted-foreground">
          Add at least one recipient email to create a protected link.
        </p>
      )}
    </div>
  );
}
