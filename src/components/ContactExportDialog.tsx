/**
 * Contacts CSV export dialog (Wave 7 B4).
 *
 * Two modes:
 *   - "Export all"      → all loaded contacts.
 *   - "Export selected" → only the contacts whose ids are in `selectedIds`.
 *     Disabled when nothing is selected.
 *
 * Triggers a Blob + URL.createObjectURL download (mirrors
 * `BudgetExportActions.tsx`'s native pattern — no extra library).
 */

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Download } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { Contact } from "@/lib/models";
import { buildContactsCsv, buildContactsCsvFilename } from "@/lib/contacts/exportContacts";

export interface ContactExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** All loaded contacts (used by the "Export all" option). */
  allContacts: Contact[];
  /** Ids of currently checkbox-selected contacts on the parent page. */
  selectedIds: Set<string>;
}

type Mode = "all" | "selected";

export default function ContactExportDialog({ open, onOpenChange, allContacts, selectedIds }: ContactExportDialogProps) {
  const selectedCount = selectedIds.size;
  const initialMode: Mode = selectedCount > 0 ? "selected" : "all";
  const [mode, setMode] = useState<Mode>(initialMode);

  const handleDownload = () => {
    const target =
      mode === "selected"
        ? allContacts.filter(c => selectedIds.has(c.id))
        : allContacts;
    if (target.length === 0) {
      toast({
        title: "Nothing to export",
        description: mode === "selected"
          ? "Select at least one contact to export."
          : "You don't have any contacts yet.",
        variant: "destructive",
      });
      return;
    }

    const csv = buildContactsCsv(target);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = buildContactsCsvFilename();
    a.click();
    URL.revokeObjectURL(url);
    toast({
      title: `Exported ${target.length} contact${target.length === 1 ? "" : "s"}`,
      description: "CSV downloaded.",
    });
    onOpenChange(false);
  };

  const ModeOption = ({ value, label, count, disabled }: { value: Mode; label: string; count: number; disabled?: boolean }) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => setMode(value)}
      className={cn(
        "w-full rounded-lg border px-4 py-3 text-left transition-colors",
        mode === value && !disabled ? "border-primary bg-primary/5" : "hover:bg-muted/40",
        disabled && "opacity-50 cursor-not-allowed",
      )}
      data-testid={`contact-export-option-${value}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs text-muted-foreground">{count} contact{count === 1 ? "" : "s"}</span>
      </div>
    </button>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Export Contacts</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <Label>Choose what to export</Label>
          <ModeOption value="all" label="Export all loaded contacts" count={allContacts.length} />
          <ModeOption
            value="selected"
            label="Export selected contacts"
            count={selectedCount}
            disabled={selectedCount === 0}
          />
          <p className="text-xs text-muted-foreground pt-1">
            CSV format. Includes name, type(s), emails, phones, IBAN, bank, VAT, address, notes.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleDownload}>
            <Download className="h-4 w-4 mr-2" />
            Download CSV
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
