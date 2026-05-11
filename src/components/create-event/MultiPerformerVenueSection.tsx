import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import ContactCombobox from "@/components/ContactCombobox";
import type { OperatorRole } from "@/lib/user-context";

interface VenueOption {
  name: string;
  capacity?: number;
  rooms?: { name: string; capacity?: number }[];
}

interface MultiPerformerVenueSectionProps {
  multiVenueType: "festival" | "venue" | null;
  setMultiVenueType: (v: "festival" | "venue" | null) => void;
  festivalName: string;
  setFestivalName: (v: string) => void;
  venueName: string;
  setVenueName: (v: string) => void;
  tickets: { provider: string; url: string }[];
  setTickets: (t: { provider: string; url: string }[]) => void;
  selectedRole: OperatorRole | null;
  allVenueOptions: VenueOption[];
  profiles: Record<string, any>;
}

export function MultiPerformerVenueSection({
  multiVenueType, setMultiVenueType,
  festivalName, setFestivalName,
  venueName, setVenueName,
  tickets, setTickets,
  selectedRole, allVenueOptions,
  profiles,
}: MultiPerformerVenueSectionProps) {
  return (
    <>
      <div className="space-y-2">
        <Label>Event Type</Label>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => { setMultiVenueType("festival"); setVenueName(""); }}
            className={cn(
              "rounded-lg border p-3 text-left transition-all hover:border-primary/50",
              multiVenueType === "festival" ? "border-primary bg-primary/5 ring-1 ring-primary/30" : "border-border"
            )}
          >
            <div className="text-sm font-medium">🎪 Festival</div>
            <p className="text-[10px] text-muted-foreground mt-0.5">Outdoor/custom festival location</p>
          </button>
          <button
            type="button"
            onClick={() => { setMultiVenueType("venue"); setFestivalName(""); }}
            className={cn(
              "rounded-lg border p-3 text-left transition-all hover:border-primary/50",
              multiVenueType === "venue" ? "border-primary bg-primary/5 ring-1 ring-primary/30" : "border-border"
            )}
          >
            <div className="text-sm font-medium">🏛️ Venue</div>
            <p className="text-[10px] text-muted-foreground mt-0.5">Existing venue with rooms/stages</p>
          </button>
        </div>
      </div>

      {multiVenueType === "festival" && (
        <div className="space-y-2">
          <Label>Festival Profile</Label>
          {(() => {
            const festivalProfiles = Object.entries(profiles).filter(([k, p]) => k.startsWith("festival") && p.created && p.name);
            if (festivalProfiles.length > 0) {
              return (
                <Select value={festivalName} onValueChange={v => setFestivalName(v)}>
                  <SelectTrigger><SelectValue placeholder="Select festival profile" /></SelectTrigger>
                  <SelectContent>
                    {festivalProfiles.map(([key, p]) => (
                      <SelectItem key={key} value={p.name}>{p.name}{p.capacity ? ` (${p.capacity} cap.)` : ""}</SelectItem>
                    ))}
                    <SelectItem value="__custom__">✏️ Custom name...</SelectItem>
                  </SelectContent>
                </Select>
              );
            }
            return <Input value={festivalName} onChange={e => setFestivalName(e.target.value)} placeholder="e.g. Sunrise Fields, Central Park" />;
          })()}
          {festivalName === "__custom__" && (
            <Input value="" onChange={e => setFestivalName(e.target.value)} placeholder="Enter festival name" className="mt-2" />
          )}
        </div>
      )}

      {multiVenueType === "venue" && (
        <div className="space-y-2">
          <Label>Venue</Label>
          {selectedRole === "venue" && allVenueOptions.length > 0 ? (
            <Select value={venueName} onValueChange={v => { setVenueName(v); }}>
              <SelectTrigger><SelectValue placeholder="Select venue" /></SelectTrigger>
              <SelectContent>
                {allVenueOptions.map((vo, i) => (
                  <SelectItem key={i} value={vo.name}>
                    {vo.name}{vo.capacity ? ` (${vo.capacity} cap.)` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <ContactCombobox contactType="venue" value={venueName} onChange={setVenueName} placeholder="Search or type venue name" />
          )}
        </div>
      )}

      <div className="space-y-2">
        <Label>Ticket links</Label>
        <div className="space-y-2">
          {tickets.map((t, i) => (
            <div key={i} className="flex gap-2">
              <div className="flex-1">
                <ContactCombobox
                  contactType="ticketing"
                  value={t.provider}
                  onChange={(v) => setTickets(tickets.map((row, j) => j === i ? { ...row, provider: v } : row))}
                  placeholder="Provider"
                />
              </div>
              <Input
                value={t.url}
                onChange={(e) => setTickets(tickets.map((row, j) => j === i ? { ...row, url: e.target.value } : row))}
                placeholder="https://tickets.example.com/..."
                className="flex-1"
              />
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setTickets(tickets.filter((_, j) => j !== i))}>
                <X className="h-3.5 w-3.5 text-destructive" />
              </Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => setTickets([...tickets, { provider: "", url: "" }])}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Add ticket link
          </Button>
        </div>
      </div>
    </>
  );
}
