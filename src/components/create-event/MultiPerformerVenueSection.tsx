import { cn } from "@/lib/utils";
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
  ticketingProvider: string;
  setTicketingProvider: (v: string) => void;
  selectedRole: OperatorRole | null;
  allVenueOptions: VenueOption[];
  profiles: Record<string, any>;
}

export function MultiPerformerVenueSection({
  multiVenueType, setMultiVenueType,
  festivalName, setFestivalName,
  venueName, setVenueName,
  ticketingProvider, setTicketingProvider,
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
        <Label>Ticketing Provider</Label>
        <ContactCombobox contactType="ticketing" value={ticketingProvider} onChange={setTicketingProvider} placeholder="Search or type provider" />
      </div>
    </>
  );
}
