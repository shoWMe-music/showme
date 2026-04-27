import { useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, FileText, X, AlertCircle, Check, Calendar } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

interface ParsedEvent {
  title: string;
  date: string; // yyyy-MM-dd
  startTime?: string;
  endTime?: string;
  location?: string;
  description?: string;
  valid: boolean;
  error?: string;
  selected: boolean;
}

interface ImportCalendarDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImportEvents: (items: { title: string; date: string; startTime?: string; endTime?: string; location?: string; description?: string }[]) => void;
  onImportCalendarItems: (items: { title: string; date: string; startTime?: string; endTime?: string; description?: string }[]) => void;
}

// Parse ICS file
function parseICS(text: string): ParsedEvent[] {
  const events: ParsedEvent[] = [];
  const blocks = text.split("BEGIN:VEVENT");

  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i].split("END:VEVENT")[0];
    const getField = (name: string): string => {
      // Handle folded lines (lines starting with space/tab are continuations)
      const unfolded = block.replace(/\r?\n[ \t]/g, "");
      const regex = new RegExp(`^${name}[;:](.*)$`, "m");
      const match = unfolded.match(regex);
      if (!match) return "";
      // Remove parameters (everything before the last colon in the match)
      const val = match[1];
      // For fields with parameters like DTSTART;TZID=...:20260405T100000
      const colonIdx = val.lastIndexOf(":");
      // Only strip if there's a parameter separator before it
      if (match[0].includes(";") && colonIdx > 0) {
        return val.substring(colonIdx + 1).trim();
      }
      return val.trim();
    };

    const summary = getField("SUMMARY");
    const dtstart = getField("DTSTART");
    const dtend = getField("DTEND");
    const location = getField("LOCATION");
    const description = getField("DESCRIPTION")?.replace(/\\n/g, "\n").replace(/\\,/g, ",");

    // Parse date/time
    let date = "";
    let startTime: string | undefined;
    let endTime: string | undefined;

    if (dtstart) {
      // Format: 20260405 or 20260405T100000 or 20260405T100000Z
      const dateMatch = dtstart.match(/^(\d{4})(\d{2})(\d{2})/);
      if (dateMatch) {
        date = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
      }
      const timeMatch = dtstart.match(/T(\d{2})(\d{2})/);
      if (timeMatch) {
        startTime = `${timeMatch[1]}:${timeMatch[2]}`;
      }
    }
    if (dtend) {
      const timeMatch = dtend.match(/T(\d{2})(\d{2})/);
      if (timeMatch) {
        endTime = `${timeMatch[1]}:${timeMatch[2]}`;
      }
    }

    const valid = !!summary && !!date;
    events.push({
      title: summary || "(No title)",
      date,
      startTime,
      endTime,
      location: location || undefined,
      description: description || undefined,
      valid,
      error: !valid ? (!summary ? "Missing title" : "Missing date") : undefined,
      selected: valid,
    });
  }
  return events;
}

// Parse CSV
function parseCSV(text: string): ParsedEvent[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];

  const headers = lines[0].split(",").map(h => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const rows: ParsedEvent[] = [];

  for (let i = 1; i < lines.length; i++) {
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
      const idx = headers.findIndex(h => h === key || h.includes(key));
      return idx >= 0 ? values[idx] || "" : "";
    };

    const title = get("title") || get("name") || get("summary") || get("subject") || get("event");
    const date = get("date") || get("start_date") || get("start");
    const startTime = get("start_time") || get("time");
    const endTime = get("end_time") || get("end");
    const location = get("location") || get("venue");
    const description = get("description") || get("notes") || get("details");

    // Try to normalize date format
    let normalizedDate = date;
    if (date) {
      // Try various formats
      const isoMatch = date.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
      const usMatch = date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      const euMatch = date.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
      if (isoMatch) {
        normalizedDate = `${isoMatch[1]}-${isoMatch[2].padStart(2, "0")}-${isoMatch[3].padStart(2, "0")}`;
      } else if (usMatch) {
        normalizedDate = `${usMatch[3]}-${usMatch[1].padStart(2, "0")}-${usMatch[2].padStart(2, "0")}`;
      } else if (euMatch) {
        normalizedDate = `${euMatch[3]}-${euMatch[2].padStart(2, "0")}-${euMatch[1].padStart(2, "0")}`;
      }
    }

    const valid = !!title && !!normalizedDate && /^\d{4}-\d{2}-\d{2}$/.test(normalizedDate);
    rows.push({
      title: title || "(No title)",
      date: normalizedDate,
      startTime: startTime || undefined,
      endTime: endTime || undefined,
      location: location || undefined,
      description: description || undefined,
      valid,
      error: !valid ? (!title ? "Missing title/name" : "Invalid or missing date") : undefined,
      selected: valid,
    });
  }
  return rows;
}

export default function ImportCalendarDialog({ open, onOpenChange, onImportEvents, onImportCalendarItems }: ImportCalendarDialogProps) {
  const [tab, setTab] = useState("ics");
  const [parsed, setParsed] = useState<ParsedEvent[]>([]);
  const [fileName, setFileName] = useState("");
  const [importAs, setImportAs] = useState<"events" | "calendar_items">("calendar_items");
  const [done, setDone] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (file: File) => {
    setFileName(file.name);
    setDone(false);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      if (file.name.endsWith(".ics") || file.name.endsWith(".ical") || tab === "ics") {
        setParsed(parseICS(text));
      } else {
        setParsed(parseCSV(text));
      }
    };
    reader.readAsText(file);
  };

  const toggleRow = (idx: number) => {
    setParsed(prev => prev.map((r, i) => i === idx ? { ...r, selected: !r.selected } : r));
  };
  const selectAll = () => setParsed(prev => prev.map(r => ({ ...r, selected: r.valid })));
  const deselectAll = () => setParsed(prev => prev.map(r => ({ ...r, selected: false })));

  const selectedCount = parsed.filter(r => r.selected).length;
  const validCount = parsed.filter(r => r.valid).length;

  const handleImport = () => {
    const items = parsed.filter(r => r.selected).map(r => ({
      title: r.title,
      date: r.date,
      startTime: r.startTime,
      endTime: r.endTime,
      location: r.location,
      description: r.description,
    }));
    if (importAs === "events") {
      onImportEvents(items);
    } else {
      onImportCalendarItems(items);
    }
    setDone(true);
    toast({ title: `${items.length} item(s) imported` });
  };

  const reset = () => {
    setParsed([]);
    setFileName("");
    setDone(false);
  };

  const handleClose = (v: boolean) => {
    if (!v) reset();
    onOpenChange(v);
  };

  const accept = tab === "csv" ? ".csv" : ".ics,.ical,.icalendar,.ifb,.vcs";

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader><DialogTitle>Import Calendar</DialogTitle></DialogHeader>

        {done ? (
          <div className="flex flex-col items-center justify-center py-10 gap-3">
            <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
              <Check className="h-6 w-6 text-primary" />
            </div>
            <p className="text-sm font-medium">Successfully imported {selectedCount} items</p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={reset}>Import More</Button>
              <Button onClick={() => handleClose(false)}>Done</Button>
            </div>
          </div>
        ) : (
          <>
            <Tabs value={tab} onValueChange={(v) => { setTab(v); reset(); }}>
              <TabsList className="w-full">
                <TabsTrigger value="ics" className="flex-1 text-xs">
                  <Calendar className="h-3.5 w-3.5 mr-1.5" />
                  iCal / Google / Outlook (.ics)
                </TabsTrigger>
                <TabsTrigger value="csv" className="flex-1 text-xs">
                  <FileText className="h-3.5 w-3.5 mr-1.5" />
                  CSV
                </TabsTrigger>
              </TabsList>

              <TabsContent value="ics" className="mt-3">
                <p className="text-xs text-muted-foreground mb-3">
                  Upload an .ics file exported from Google Calendar, Outlook, Apple Calendar, or any iCal-compatible app.
                </p>
              </TabsContent>
              <TabsContent value="csv" className="mt-3">
                <p className="text-xs text-muted-foreground mb-3">
                  Upload a CSV with columns: <span className="font-mono">title/name, date, start_time, end_time, location, description</span>
                </p>
              </TabsContent>
            </Tabs>

            {!fileName ? (
              <div
                className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-colors"
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onDrop={(e) => { e.preventDefault(); e.stopPropagation(); const file = e.dataTransfer.files[0]; if (file) handleFile(file); }}
              >
                <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">Drop file here or click to upload</p>
                <p className="text-xs text-muted-foreground mt-1">Accepts {tab === "csv" ? ".csv" : ".ics, .ical"} files</p>
                <input ref={fileRef} type="file" accept={accept} className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) handleFile(file); }} />
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">{fileName}</span>
                    <Badge variant="secondary" className="text-[10px]">{parsed.length} items found</Badge>
                    {validCount < parsed.length && (
                      <Badge variant="destructive" className="text-[10px]">{parsed.length - validCount} invalid</Badge>
                    )}
                  </div>
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={reset}>
                    <X className="h-3 w-3 mr-1" /> Change File
                  </Button>
                </div>

                {parsed.length > 0 && (
                  <>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">{selectedCount} of {validCount} selected</span>
                        <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2" onClick={selectAll}>Select All</Button>
                        <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2" onClick={deselectAll}>Deselect All</Button>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">Import as:</span>
                        <Select value={importAs} onValueChange={(v) => setImportAs(v as "events" | "calendar_items")}>
                          <SelectTrigger className="h-7 w-36 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="calendar_items">Calendar Items</SelectItem>
                            <SelectItem value="events">Events</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="overflow-auto max-h-[40vh] border rounded-lg">
                      <table className="w-full text-xs">
                        <thead className="bg-muted/50 sticky top-0">
                          <tr>
                            <th className="px-2 py-1.5 text-left w-8"></th>
                            <th className="px-2 py-1.5 text-left">Title</th>
                            <th className="px-2 py-1.5 text-left">Date</th>
                            <th className="px-2 py-1.5 text-left">Time</th>
                            <th className="px-2 py-1.5 text-left">Location</th>
                            <th className="px-2 py-1.5 text-left w-16">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {parsed.map((row, i) => (
                            <tr key={i} className={cn("border-t", !row.valid && "opacity-50 bg-destructive/5")}>
                              <td className="px-2 py-1.5">
                                <Checkbox
                                  checked={row.selected}
                                  disabled={!row.valid}
                                  onCheckedChange={() => toggleRow(i)}
                                  className="h-3.5 w-3.5"
                                />
                              </td>
                              <td className="px-2 py-1.5 font-medium truncate max-w-[160px]">{row.title}</td>
                              <td className="px-2 py-1.5 whitespace-nowrap">{row.date}</td>
                              <td className="px-2 py-1.5 whitespace-nowrap text-muted-foreground">
                                {row.startTime}{row.endTime ? ` – ${row.endTime}` : ""}
                              </td>
                              <td className="px-2 py-1.5 truncate max-w-[120px] text-muted-foreground">{row.location || "—"}</td>
                              <td className="px-2 py-1.5">
                                {row.valid ? (
                                  <Check className="h-3.5 w-3.5 text-primary" />
                                ) : (
                                  <span className="flex items-center gap-1 text-destructive" title={row.error}>
                                    <AlertCircle className="h-3.5 w-3.5" />
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => handleClose(false)}>Cancel</Button>
              <Button onClick={handleImport} disabled={selectedCount === 0}>
                Import {selectedCount} Item{selectedCount !== 1 ? "s" : ""}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
