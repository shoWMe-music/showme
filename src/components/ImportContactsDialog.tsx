import { useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, Check, AlertCircle } from "lucide-react";
import { Contact, ContactType, contactTypeLabels } from "@/lib/models";

interface ImportContactsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (contacts: Contact[]) => void;
}

type Step = "upload" | "mapping" | "preview" | "done";

const FIELDS = [
  { key: "name", label: "Name", required: true },
  { key: "type", label: "Type" },
  { key: "contact_name", label: "Contact Name" },
  { key: "contact_email", label: "Contact Email" },
  { key: "contact_phone", label: "Contact Phone" },
  { key: "iban", label: "IBAN" },
  { key: "bank_name", label: "Bank Name" },
  { key: "vat_id", label: "VAT ID" },
  { key: "address", label: "Address" },
  { key: "notes", label: "Notes" },
] as const;

type FieldKey = typeof FIELDS[number]["key"];

// Alias dictionary for auto-detection
const ALIASES: Record<string, FieldKey> = {
  name: "name", company: "name", organization: "name", organisation: "name",
  type: "type", category: "type", role: "type",
  contact_name: "contact_name", contact: "contact_name", person: "contact_name", "contact name": "contact_name",
  contact_email: "contact_email", email: "contact_email", "e-mail": "contact_email",
  contact_phone: "contact_phone", phone: "contact_phone", tel: "contact_phone", telephone: "contact_phone",
  iban: "iban",
  bank_name: "bank_name", bank: "bank_name",
  vat_id: "vat_id", vat: "vat_id", "tax id": "vat_id", tax_id: "vat_id",
  address: "address", street: "address",
  notes: "notes", note: "notes", comment: "notes", comments: "notes",
};

function parseCSVRaw(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return { headers: [], rows: [] };

  const parseLine = (line: string) => {
    const values: string[] = [];
    let current = "";
    let inQuotes = false;
    for (const char of line) {
      if (char === '"') { inQuotes = !inQuotes; continue; }
      if (char === "," && !inQuotes) { values.push(current.trim()); current = ""; continue; }
      current += char;
    }
    values.push(current.trim());
    return values;
  };

  const headers = parseLine(lines[0]);
  const rows = lines.slice(1).map(parseLine);
  return { headers, rows };
}

function autoDetectMapping(headers: string[]): Record<number, FieldKey> {
  const mapping: Record<number, FieldKey> = {};
  const usedFields = new Set<FieldKey>();
  headers.forEach((h, i) => {
    const normalized = h.trim().toLowerCase().replace(/\s+/g, "_");
    const field = ALIASES[normalized];
    if (field && !usedFields.has(field)) {
      mapping[i] = field;
      usedFields.add(field);
    }
  });
  return mapping;
}

export default function ImportContactsDialog({ open, onOpenChange, onImport }: ImportContactsDialogProps) {
  const [step, setStep] = useState<Step>("upload");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<number, FieldKey>>({});
  const [importCount, setImportCount] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const { headers: h, rows: r } = parseCSVRaw(text);
      setHeaders(h);
      setRawRows(r);
      const autoMap = autoDetectMapping(h);
      setMapping(autoMap);
      setStep("mapping");
    };
    reader.readAsText(file);
  };

  const getMappedValue = (row: string[], field: FieldKey): string => {
    const colIdx = Object.entries(mapping).find(([, f]) => f === field)?.[0];
    return colIdx !== undefined ? (row[parseInt(colIdx)] || "") : "";
  };

  const mappedContacts = rawRows.map((row, i) => {
    const name = getMappedValue(row, "name");
    const type = getMappedValue(row, "type").toLowerCase();
    const valid = !!name.trim();
    return {
      id: `P-IMP-${Date.now()}-${i}`,
      name,
      type: type || "promoter",
      contact_name: getMappedValue(row, "contact_name"),
      contact_email: getMappedValue(row, "contact_email"),
      contact_phone: getMappedValue(row, "contact_phone"),
      iban: getMappedValue(row, "iban"),
      bank_name: getMappedValue(row, "bank_name"),
      vat_id: getMappedValue(row, "vat_id"),
      address: getMappedValue(row, "address"),
      notes: getMappedValue(row, "notes"),
      valid,
    };
  });

  const handleImport = () => {
    const validContacts = mappedContacts.filter(r => r.valid);
    const contacts: Contact[] = validContacts.map(r => ({
      id: r.id,
      name: r.name,
      type: r.type as ContactType,
      contacts: r.contact_name ? [{ name: r.contact_name, email: r.contact_email, phone: r.contact_phone }] : [],
      iban: r.iban,
      bankName: r.bank_name,
      vatId: r.vat_id,
      address: r.address,
      notes: r.notes,
    }));
    onImport(contacts);
    setImportCount(contacts.length);
    setStep("done");
  };

  const handleClose = (o: boolean) => {
    if (!o) { setStep("upload"); setHeaders([]); setRawRows([]); setMapping({}); }
    onOpenChange(o);
  };

  const hasNameMapping = Object.values(mapping).includes("name");
  const validCount = mappedContacts.filter(r => r.valid).length;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Import Contacts from CSV
            {step !== "upload" && step !== "done" && (
              <span className="text-xs text-muted-foreground ml-2 font-normal">
                Step {step === "mapping" ? "2/3" : "3/3"}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        {step === "done" ? (
          <div className="py-8 text-center space-y-3">
            <Check className="h-12 w-12 mx-auto text-primary" />
            <p className="text-lg font-semibold">{importCount} {importCount === 1 ? "contact" : "contacts"} imported successfully</p>
            <Button variant="outline" onClick={() => handleClose(false)}>Close</Button>
          </div>
        ) : step === "upload" ? (
          <div className="py-8 space-y-4">
            <div
              className="border-2 border-dashed rounded-xl p-8 text-center cursor-pointer hover:border-primary transition-colors"
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
              <p className="font-medium">Click to upload a CSV file</p>
              <p className="text-xs text-muted-foreground mt-1">Any CSV with a header row will work — you'll map columns next</p>
            </div>
            <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFile} />
          </div>
        ) : step === "mapping" ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Map your CSV columns to contact fields. We auto-detected what we could.</p>
            <div className="border rounded-lg divide-y max-h-[50vh] overflow-auto">
              {headers.map((h, i) => (
                <div key={i} className="flex items-center gap-4 px-4 py-2">
                  <span className="text-sm font-medium w-40 truncate" title={h}>{h}</span>
                  <span className="text-xs text-muted-foreground">→</span>
                  <Select
                    value={mapping[i] || "_skip"}
                    onValueChange={v => {
                      setMapping(prev => {
                        const updated = { ...prev };
                        if (v === "_skip") { delete updated[i]; } else { updated[i] = v as FieldKey; }
                        return updated;
                      });
                    }}
                  >
                    <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_skip">— Skip —</SelectItem>
                      {FIELDS.map(f => (
                        <SelectItem key={f.key} value={f.key}>{f.label}{f.required ? " *" : ""}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span className="text-xs text-muted-foreground truncate flex-1">
                    e.g. "{rawRows[0]?.[i] || ""}"
                  </span>
                </div>
              ))}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setStep("upload"); setHeaders([]); setRawRows([]); }}>Back</Button>
              <Button onClick={() => setStep("preview")} disabled={!hasNameMapping}>
                Preview ({rawRows.length} rows)
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground">
              {rawRows.length} rows · {validCount} valid (have a name)
            </div>
            <div className="border rounded-lg overflow-auto max-h-[50vh]">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 sticky top-0">
                  <tr>
                    <th className="p-2 text-left">Name</th>
                    <th className="p-2 text-left">Type</th>
                    <th className="p-2 text-left">Contact</th>
                    <th className="p-2 text-left">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {mappedContacts.slice(0, 50).map((r, i) => (
                    <tr key={i} className={!r.valid ? "opacity-50" : ""}>
                      <td className="p-2 font-medium">{r.name || "—"}</td>
                      <td className="p-2">{contactTypeLabels[r.type] || r.type || "—"}</td>
                      <td className="p-2 text-muted-foreground">{r.contact_name || r.contact_email || "—"}</td>
                      <td className="p-2">
                        {r.valid ? (
                          <span className="text-xs text-primary font-medium">Ready</span>
                        ) : (
                          <span className="text-xs text-destructive flex items-center gap-1">
                            <AlertCircle className="h-3 w-3" /> Missing name
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rawRows.length > 50 && <p className="text-xs text-muted-foreground p-2 text-center">Showing first 50 of {rawRows.length} rows</p>}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep("mapping")}>Back to Mapping</Button>
              <Button onClick={handleImport} disabled={validCount === 0}>
                Import {validCount} {validCount === 1 ? "Contact" : "Contacts"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
