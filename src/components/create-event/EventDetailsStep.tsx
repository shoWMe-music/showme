import { useEffect, useRef, useState } from "react";
import { format, isToday } from "date-fns";
import { CalendarIcon, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import NumberInput from "@/components/NumberInput";
import ContactCombobox from "@/components/ContactCombobox";
import { PerformerSearch } from "@/components/PerformerSearch";
import { useUser, type OperatorRole } from "@/lib/user-context";
import type { Event } from "@/lib/models";
import { toast } from "@/hooks/use-toast";
import { useEvents } from "@/lib/queries";
import { getMaxHoldRank } from "@/lib/holdMaxRank";
import { MultiPerformerVenueSection } from "./MultiPerformerVenueSection";

interface VenueOption {
  name: string;
  capacity?: number;
  rooms?: { name: string; capacity?: number }[];
}

interface EventDetailsStepProps {
  onBack: () => void;
  onNext: () => void;
  step1Valid: boolean;
  isMultiPerformer: boolean;
  nextLabel: string;

  eventName: string;
  setEventName: (v: string) => void;
  date: Date | undefined;
  setDate: (d: Date | undefined) => void;
  doubleBookingEvents: Event[];
  unavailableDates: Set<string>;

  artistName: string;
  setArtistName: (v: string) => void;
  performerProfileId: string;
  setPerformerProfileId: (v: string) => void;
  venueName: string;
  setVenueName: (v: string) => void;
  roomStage: string;
  setRoomStage: (v: string) => void;
  capacity: string;
  setCapacity: (v: string) => void;
  tickets: { provider: string; url: string }[];
  setTickets: (t: { provider: string; url: string }[]) => void;

  selectedRole: OperatorRole | null;
  allVenueOptions: VenueOption[];

  defaultStatus?: string;
  holdRank: number;
  setHoldRank: (v: number) => void;
  holdAutoPromote: boolean;
  setHoldAutoPromote: (v: boolean) => void;

  multiVenueType: "festival" | "venue" | null;
  setMultiVenueType: (v: "festival" | "venue" | null) => void;
  festivalName: string;
  setFestivalName: (v: string) => void;
  onMultiPerformerToggle: (v: boolean) => void;
}

export function EventDetailsStep({
  onBack, onNext, step1Valid, isMultiPerformer, nextLabel,
  eventName, setEventName,
  date, setDate,
  doubleBookingEvents, unavailableDates,
  artistName, setArtistName,
  performerProfileId, setPerformerProfileId,
  venueName, setVenueName,
  roomStage, setRoomStage,
  capacity, setCapacity,
  tickets, setTickets,
  selectedRole, allVenueOptions,
  defaultStatus, holdRank, setHoldRank, holdAutoPromote, setHoldAutoPromote,
  multiVenueType, setMultiVenueType,
  festivalName, setFestivalName,
  onMultiPerformerToggle,
}: EventDetailsStepProps) {
  const { profiles } = useUser();
  const allEvents = useEvents();
  const [datePickerOpen, setDatePickerOpen] = useState(false);

  // Cap rank options at the slot's current population + 1 (this event will
  // join the pool). User-facing rule: you can never pick a rank with a gap
  // beneath it — if no rank 1 exists, you can only pick rank 1; if ranks 1
  // and 2 exist, options are 1–3; and so on.
  const maxHoldRank = getMaxHoldRank({
    events: allEvents,
    date: date ? format(date, "yyyy-MM-dd") : "",
    venue: venueName,
    roomStage: roomStage || "",
    // Create flow: no excludeId; the new event isn't in `allEvents` yet.
  });

  // Track whether the user has explicitly picked a rank in this dialog
  // session. Until they do, the rank should follow the slot's max
  // (highest available = "the new one goes at the end of the queue"). After
  // an explicit pick we respect their choice and only clamp if it goes
  // out of range (e.g. they pick 4 on a 3-hold slot, then change date to
  // a 1-hold slot — drop to 2).
  const userPickedRankRef = useRef(false);
  useEffect(() => {
    if (userPickedRankRef.current) {
      if (holdRank > maxHoldRank) setHoldRank(maxHoldRank);
    } else {
      if (holdRank !== maxHoldRank) setHoldRank(maxHoldRank);
    }
    // Intentionally NOT depending on holdRank: this effect's job is to react
    // to slot changes (which move maxHoldRank), not to the user's own picks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxHoldRank]);

  return (
    <div className="space-y-4 mt-2">
      <div className="space-y-2">
        <Label>Event Name</Label>
        <Input value={eventName} onChange={e => setEventName(e.target.value)} placeholder="e.g. Neon Nights Festival" />
      </div>

      <div className="flex items-center justify-between rounded-lg border p-3">
        <div>
          <Label className="text-sm font-medium">Multi-Performer Event</Label>
          <p className="text-xs text-muted-foreground">Festival or event with multiple artists</p>
        </div>
        <Switch checked={isMultiPerformer} onCheckedChange={onMultiPerformerToggle} />
      </div>

      {!isMultiPerformer && (
        <>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Performer</Label>
              <PerformerSearch value={artistName} onChange={(name, profile) => { setArtistName(name); setPerformerProfileId(profile?.id || ""); }} placeholder={selectedRole === "performer" ? "Your performer name" : "Search or type performer name"} />
            </div>
            <div className="space-y-2">
              <Label>Venue</Label>
              {selectedRole === "venue" && allVenueOptions.length > 0 ? (
                <Select value={venueName} onValueChange={v => {
                  setVenueName(v);
                  setRoomStage("");
                  const match = allVenueOptions.find(o => o.name === v);
                  if (match?.capacity) setCapacity(String(match.capacity));
                }}>
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
          </div>

          {selectedRole === "venue" && venueName && (() => {
            const matchedVenue = allVenueOptions.find(o => o.name === venueName);
            const roomStages = matchedVenue?.rooms || [];
            if (roomStages.length === 0) return null;
            return (
              <div className="space-y-2">
                <Label>Room / Stage</Label>
                <Select value={roomStage} onValueChange={v => {
                  setRoomStage(v);
                  const match = roomStages.find(sv => sv.name === v);
                  if (match?.capacity) setCapacity(String(match.capacity));
                }}>
                  <SelectTrigger><SelectValue placeholder="Select room/stage (optional)" /></SelectTrigger>
                  <SelectContent>
                    {roomStages.map((sv, i) => (
                      <SelectItem key={i} value={sv.name}>
                        {sv.name}{sv.capacity ? ` (${sv.capacity} cap.)` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            );
          })()}

          <div className="space-y-2">
            <Label>Capacity</Label>
            <NumberInput value={capacity} onChange={e => setCapacity(e.target.value)} placeholder="0" />
          </div>
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
      )}

      <div className="space-y-2">
        <Label>Date</Label>
        <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !date && "text-muted-foreground")}>
              <CalendarIcon className="mr-2 h-4 w-4" />
              {date ? format(date, "PPP") : "Pick a date"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={date}
              onSelect={(d) => {
                setDate(d);
                setDatePickerOpen(false);
                if (d && unavailableDates.has(format(d, "yyyy-MM-dd"))) {
                  toast({ title: "Date has existing events", description: "This date already has confirmed events at this venue.", variant: "destructive" });
                }
              }}
              initialFocus
              className="p-3 pointer-events-auto"
              modifiers={{
                booked: (d: Date) => unavailableDates.has(format(d, "yyyy-MM-dd")),
                today: (d: Date) => isToday(d),
                hasConfirmed: (d: Date) => unavailableDates.has(format(d, "yyyy-MM-dd")),
              }}
              modifiersStyles={{
                booked: { backgroundColor: "hsl(var(--destructive) / 0.15)", color: "hsl(var(--destructive))", borderRadius: "6px" },
                today: { backgroundColor: "#FF6B6B", color: "white", borderRadius: "9999px", fontWeight: "bold" },
              }}
              modifiersClassNames={{
                hasConfirmed: "relative after:absolute after:bottom-0.5 after:left-1/2 after:-translate-x-1/2 after:h-1 after:w-1 after:rounded-full after:bg-destructive",
              }}
            />
          </PopoverContent>
        </Popover>
        {doubleBookingEvents.length > 0 && (
          <div className="flex items-start gap-2 rounded-md border border-yellow-300 bg-yellow-50 dark:bg-yellow-950/30 dark:border-yellow-700 p-2.5 text-xs text-yellow-800 dark:text-yellow-300">
            <span className="text-base leading-none mt-0.5">⚠️</span>
            <span>
              <strong>Double Booking:</strong>{" "}
              {doubleBookingEvents.map(e => `"${e.name}"`).join(", ")} already scheduled on this date.
            </span>
          </div>
        )}
      </div>

      {defaultStatus === "on_hold" && (
        <div className="rounded-lg border border-orange-200 bg-orange-50 dark:bg-orange-950/20 dark:border-orange-800 p-3 space-y-3">
          <div className="text-sm font-medium text-orange-800 dark:text-orange-300">Hold Priority</div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Rank</Label>
              <Select value={String(holdRank)} onValueChange={v => {
                userPickedRankRef.current = true;
                setHoldRank(Number(v));
              }}>
                <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Array.from({ length: maxHoldRank }, (_, i) => i + 1).map(n => (
                    <SelectItem key={n} value={String(n)}>
                      {n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`} Hold
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end gap-2 pb-0.5">
              <div className="space-y-1.5 flex-1">
                <Label className="text-xs">Auto-promote</Label>
                <div className="flex items-center gap-2">
                  <Switch checked={holdAutoPromote} onCheckedChange={setHoldAutoPromote} />
                  <span className="text-xs text-muted-foreground">{holdAutoPromote ? "On" : "Off"}</span>
                </div>
              </div>
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground">When auto-promote is on, this hold moves up when a higher-priority hold is removed.</p>
        </div>
      )}

      {isMultiPerformer && (
        <MultiPerformerVenueSection
          multiVenueType={multiVenueType}
          setMultiVenueType={setMultiVenueType}
          festivalName={festivalName}
          setFestivalName={setFestivalName}
          venueName={venueName}
          setVenueName={setVenueName}
          tickets={tickets}
          setTickets={setTickets}
          selectedRole={selectedRole}
          allVenueOptions={allVenueOptions}
          profiles={profiles}
        />
      )}

      <div className="flex justify-between pt-2">
        <Button variant="outline" onClick={onBack}>Back</Button>
        <Button onClick={onNext} disabled={!step1Valid}>
          {nextLabel}
        </Button>
      </div>
    </div>
  );
}
