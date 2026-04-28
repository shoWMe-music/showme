import { useState } from "react";
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
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
  ticketingProvider: string;
  setTicketingProvider: (v: string) => void;

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
  ticketingProvider, setTicketingProvider,
  selectedRole, allVenueOptions,
  defaultStatus, holdRank, setHoldRank, holdAutoPromote, setHoldAutoPromote,
  multiVenueType, setMultiVenueType,
  festivalName, setFestivalName,
  onMultiPerformerToggle,
}: EventDetailsStepProps) {
  const { profiles } = useUser();
  const [datePickerOpen, setDatePickerOpen] = useState(false);

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

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Capacity</Label>
              <NumberInput value={capacity} onChange={e => setCapacity(e.target.value)} placeholder="0" />
            </div>
            <div className="space-y-2">
              <Label>Ticketing Provider</Label>
              <ContactCombobox contactType="ticketing" value={ticketingProvider} onChange={setTicketingProvider} placeholder="Search or type provider" />
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
              onSelect={(d) => { setDate(d); setDatePickerOpen(false); }}
              initialFocus
              className="p-3 pointer-events-auto"
              modifiers={{ booked: (d: Date) => unavailableDates.has(format(d, "yyyy-MM-dd")) }}
              modifiersStyles={{ booked: { backgroundColor: "hsl(var(--destructive) / 0.15)", color: "hsl(var(--destructive))", borderRadius: "6px" } }}
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
              <Select value={String(holdRank)} onValueChange={v => setHoldRank(Number(v))}>
                <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1st Hold</SelectItem>
                  <SelectItem value="2">2nd Hold</SelectItem>
                  <SelectItem value="3">3rd Hold</SelectItem>
                  <SelectItem value="4">4th Hold</SelectItem>
                  <SelectItem value="5">5th Hold</SelectItem>
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
          ticketingProvider={ticketingProvider}
          setTicketingProvider={setTicketingProvider}
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
