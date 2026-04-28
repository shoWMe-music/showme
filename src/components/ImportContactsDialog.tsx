import { useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Upload, FileText, X, AlertCircle, Check } from "lucide-react";
import { Contact, ContactType, contactTypeLabels } from "@/lib/models";

interface ImportContactsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (contacts: Contact[]) => void;
}

interface ParsedRow {
  name: string;
  type: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  iban: string;
  bank_name: string;
  vat_id: string;
  address: string;
  notes: string;
  valid: boolean;
  error?: string;
  selected: boolean;
}

const validTypes: ContactType[] = ["promoter", "venue", "performer", "ticketing", "agent", "manager", "production"];

function parseCSV(text: string): ParsedRow[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];

  const headers = lines[0].split(",").map(h => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const rows: ParsedRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    // Simple CSV parse (handles basic quoting)
    const values: string[] = [];
    let current = "";
    let inQuotes = false;
    for (const char of lines[i]) {
      if (char === '"') { inQuotes = !inQuotes; continue; }
      if (char === "," && !inQuotes) { values.push(current.trim()); current = ""; continue; }
      current += char;
    }
    values.push(current.trim());

    const get = (key: string) => {
      const idx = headers.indexOf(key);
      return idx >= 0 ? (values[idx] || "") : "";
    };

    const name = get("name");
    const type = get("type").toLowerCase();
    const valid = !!name && validTypes.includes(type as ContactType);
    const error = !name ? "Missing name" : !validTypes.includes(type as ContactType) ? `Invalid type: "${get("type")}"` : undefined;

    rows.push({
      name,
      type,
      contact_name: get("contact_name"),
      contact_email: get("contact_email"),
      contact_phone: get("contact_phone"),
      iban: get("iban"),
      bank_name: get("bank_name"),
      vat_id: get("vat_id"),
      address: get("address"),
      notes: get("notes"),
      valid,
      error,
      selected: valid,
    });
  }
  return rows;
}

export default function ImportContactsDialog({ open, onOpenChange, onImport }: ImportContactsDialogProps) {
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [imported, setImported] = useState(false);
  const [importCount, setImportCount] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setRows(parseCSV(text));
      setImported(false);
    };
    reader.readAsText(file);
  };

  const toggleRow = (idx: number) => {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, selected: !r.selected } : r));
  };

  const handleImport = () => {
    const selected = rows.filter(r => r.selected && r.valid);
    const contacts: Contact[] = selected.map((r, i) => ({
      id: `P-IMP-${Date.now()}-${i}`,
      name: r.name,
      type: r.type as ContactType,
      contacts: r.contact_name ? [{ name: r.contact_name, email: r.contact_email, phone: r.contact_phone }] : [],
      iban: r.type === "ticketing" ? "" : r.iban,
      bankName: r.type === "ticketing" ? "" : r.bank_name,
      vatId: r.vat_id,
      address: r.address,
      notes: r.notes,
    }));
    onImport(contacts);
    setImportCount(contacts.length);
    setImported(true);
  };

  const validSelected = rows.filter(r => r.selected && r.valid).length;

  const handleClose = (o: boolean) => {
    if (!o) { setRows([]); setImported(false); }
    onOpenChange(o);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import Contacts from CSV</DialogTitle>
        </DialogHeader>

        {imported ? (
          <div className="py-8 text-center space-y-3">
            <Check className="h-12 w-12 mx-auto text-primary" />
            <p className="text-lg font-semibold">{importCount} {importCount === 1 ? "contact" : "contacts"} imported successfully</p>
            <Button variant="outline" onClick={() => handleClose(false)}>Close</Button>
          </div>
        ) : rows.length === 0 ? (
          <div className="py-8 space-y-4">
            <div
              className="border-2 border-dashed rounded-xl p-8 text-center cursor-pointer hover:border-primary transition-colors"
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
              <p className="font-medium">Click to upload a CSV file</p>
              <p className="text-xs text-muted-foreground mt-1">
                Expected columns: name, type, contact_name, contact_email, contact_phone, iban, bank_name, vat_id, address, notes
              </p>
            </div>
            <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFile} />
            <div className="text-xs text-muted-foreground">
              <p className="font-medium mb-1">Valid types:</p>
              <p>{validTypes.map(t => contactTypeLabels[t]).join(", ")}</p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground">
              {rows.length} rows found · {rows.filter(r => r.valid).length} valid · {validSelected} selected
            </div>
            <div className="border rounded-lg overflow-auto max-h-[50vh]">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 sticky top-0">
                  <tr>
                    <th className="p-2 text-left w-8"></th>
                    <th className="p-2 text-left">Name</th>
                    <th className="p-2 text-left">Type</th>
                    <th className="p-2 text-left">Contact</th>
                    <th className="p-2 text-left">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((r, i) => (
                    <tr key={i} className={!r.valid ? "opacity-50" : ""}>
                      <td className="p-2">
                        <input
                          type="checkbox"
                          checked={r.selected}
                          disabled={!r.valid}
                          onChange={() => toggleRow(i)}
                          className="rounded"
                        />
                      </td>
                      <td className="p-2 font-medium">{r.name || "—"}</td>
                      <td className="p-2">{r.valid ? contactTypeLabels[r.type as ContactType] : r.type || "—"}</td>
                      <td className="p-2 text-muted-foreground">{r.contact_name || "—"}</td>
                      <td className="p-2">
                        {r.valid ? (
                          <span className="text-xs text-primary font-medium">Ready</span>
                        ) : (
                          <span className="text-xs text-destructive flex items-center gap-1">
                            <AlertCircle className="h-3 w-3" /> {r.error}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setRows([]); }}>Choose Different File</Button>
              <Button onClick={handleImport} disabled={validSelected === 0}>
                Import {validSelected} {validSelected === 1 ? "Contact" : "Contacts"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
