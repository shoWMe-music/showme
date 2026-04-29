import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { format, parse } from "date-fns";
import { Plus } from "lucide-react";
import { useUser, type OperatorRole, type SubVenue } from "@/lib/user-context";
import { useEvents } from "@/lib/queries";
import type { DealType } from "@/lib/models";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RoleSelectionStep } from "@/components/create-event/RoleSelectionStep";
import { EventDetailsStep } from "@/components/create-event/EventDetailsStep";
import { DealStructureStep } from "@/components/create-event/DealStructureStep";
import { PerformersStep } from "@/components/create-event/PerformersStep";
import { useCreateEventSubmit } from "@/components/create-event/useCreateEventSubmit";
import type { PartyState, PerformerEntry, CreateEventDialogProps } from "@/components/create-event/types";
import { AVAILABLE_PARTIES } from "@/components/create-event/types";

export default function CreateEventDialog({ trigger, defaultDate, externalOpen, onExternalOpenChange, prefillData, onEventCreated, defaultStatus }: CreateEventDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = externalOpen !== undefined ? externalOpen : internalOpen;
  const setOpen = onExternalOpenChange || setInternalOpen;
  const [step, setStep] = useState(0);
  const { currentUser, profiles } = useUser();
  const allEvents = useEvents();
  const { handleSubmit } = useCreateEventSubmit();

  const [selectedRole, setSelectedRole] = useState<OperatorRole | null>(
    currentUser.defaultRole || (currentUser.roles.length === 1 ? currentUser.roles[0] : null)
  );

  // Step 1 fields
  const [eventName, setEventName] = useState("");
  const [date, setDate] = useState<Date | undefined>(defaultDate);

  useEffect(() => {
    if (open) {
      if (defaultDate) setDate(defaultDate);
      const role = currentUser.defaultRole || (currentUser.roles.length === 1 ? currentUser.roles[0] : null);
      if (role && !selectedRole) setSelectedRole(role);
    }
  }, [open, defaultDate, currentUser.defaultRole, currentUser.roles]);

  const [artistName, setArtistName] = useState("");
  const [performerProfileId, setPerformerProfileId] = useState("");
  const [venueName, setVenueName] = useState("");
  const [capacity, setCapacity] = useState("");
  const [ticketingProvider, setTicketingProvider] = useState("");
  const [roomStage, setRoomStage] = useState("");

  const doubleBookingEvents = date && venueName.trim()
    ? allEvents.filter(e =>
        e.date === format(date, "yyyy-MM-dd") &&
        e.venue.toLowerCase() === venueName.trim().toLowerCase() &&
        e.eventStatus !== "draft" &&
        !e.archived &&
        !e.parentEventId
      )
    : [];

  const unavailableDates = useMemo(() => {
    if (!venueName.trim()) return new Set<string>();
    const dates = new Set<string>();
    allEvents.forEach(e => {
      if (e.archived || e.eventStatus === "draft" || e.eventStatus === "cancelled" || e.parentEventId) return;
      if (e.venue.toLowerCase() !== venueName.trim().toLowerCase()) return;
      if (roomStage.trim()) {
        const eventRoom = e.roomStage || "";
        if (eventRoom) {
          const selectedRooms = roomStage.split(", ").filter(Boolean);
          const eventRooms = eventRoom.split(", ").filter(Boolean);
          if (!selectedRooms.some((r: string) => eventRooms.includes(r))) return;
        }
        if (!eventRoom) return;
      }
      if (e.date) dates.add(e.date);
    });
    return dates;
  }, [allEvents, venueName, roomStage]);

  const [holdRank, setHoldRank] = useState(1);
  const [holdAutoPromote, setHoldAutoPromote] = useState(true);
  const [isMultiPerformer, setIsMultiPerformer] = useState(false);
  const [multiVenueType, setMultiVenueType] = useState<"festival" | "venue" | null>(null);
  const [festivalName, setFestivalName] = useState("");
  const [performers, setPerformers] = useState<PerformerEntry[]>([]);
  const [createdStages, setCreatedStages] = useState<{ name: string; capacity: string }[]>([]);

  useEffect(() => {
    if (prefillData && open) {
      if (prefillData.artistName) setArtistName(prefillData.artistName);
      if (prefillData.venueName) setVenueName(prefillData.venueName);
      if (prefillData.fee) setArtistGuarantee(String(prefillData.fee));
      if (prefillData.date) {
        try {
          const parts = prefillData.date.split("/");
          if (parts.length === 3) {
            const parsed = parse(prefillData.date, "dd/MM/yy", new Date());
            if (!isNaN(parsed.getTime())) setDate(parsed);
          } else if (parts.length === 2) {
            const parsed = parse(`01/${prefillData.date}`, "dd/MM/yy", new Date());
            if (!isNaN(parsed.getTime())) setDate(parsed);
          }
        } catch {}
      }
      if (prefillData.dealType) setDealType(prefillData.dealType);
      if (prefillData.artistGuarantee) setArtistGuarantee(prefillData.artistGuarantee);
      if (prefillData.artistSplit) setArtistSplit(prefillData.artistSplit);
      if (prefillData.promoterSplit) setPromoterSplit(prefillData.promoterSplit);
      if (prefillData.venueSplit) setVenueSplit(prefillData.venueSplit);
    }
  }, [prefillData, open]);

  const addPerformer = () => setPerformers(prev => [...prev, {
    id: `perf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    artistName: "", performerProfileId: "", dealType: "guarantee", artistGuarantee: "",
    artistSplit: "70", promoterSplit: "20", venueSplit: "10",
    stageRoom: "", stageCapacity: "", performerVenue: "",
  }]);
  const updatePerformer = (index: number, updates: Partial<PerformerEntry>) =>
    setPerformers(prev => prev.map((p, i) => i === index ? { ...p, ...updates } : p));
  const removePerformer = (index: number) =>
    setPerformers(prev => prev.filter((_, i) => i !== index));

  // Step 2 fields
  const [dealType, setDealType] = useState<DealType>("guarantee");
  const [artistGuarantee, setArtistGuarantee] = useState("");
  const [artistSplit, setArtistSplit] = useState("70");
  const [promoterSplit, setPromoterSplit] = useState("20");
  const [venueSplit, setVenueSplit] = useState("10");
  const [promoterCostSplit, setPromoterCostSplit] = useState("50");
  const [venueCostSplit, setVenueCostSplit] = useState("30");
  const [artistCostSplit, setArtistCostSplit] = useState("20");
  const [venueRental, setVenueRental] = useState("");
  const [venueRentalPaymentMode, setVenueRentalPaymentMode] = useState<"request_now" | "deduct_at_settlement">("deduct_at_settlement");
  const [costResponsibility, setCostResponsibility] = useState<"none" | "split" | "me">("none");
  const [parties, setParties] = useState<PartyState[]>([]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const isPromoter = selectedRole === "promoter" || selectedRole === "organizer";

  const allVenueOptions = Object.entries(profiles)
    .filter(([, p]) => p.role === "venue" && p.created)
    .map(([, p]) => ({
      name: p.name,
      capacity: p.capacity,
      rooms: (p.subVenues || []).filter((sv: SubVenue) => sv.type === "room" || sv.type === "stage"),
    }));

  const resetForm = () => {
    setStep(0);
    setSelectedRole(currentUser.defaultRole || (currentUser.roles.length === 1 ? currentUser.roles[0] : null));
    setEventName(""); setDate(defaultDate); setArtistName(""); setPerformerProfileId(""); setVenueName("");
    setCapacity(""); setTicketingProvider(""); setDealType("guarantee");
    setArtistGuarantee(""); setArtistSplit("70"); setPromoterSplit("20"); setVenueSplit("10");
    setPromoterCostSplit("50"); setVenueCostSplit("30"); setArtistCostSplit("20");
    setVenueRental(""); setVenueRentalPaymentMode("deduct_at_settlement"); setRoomStage(""); setCostResponsibility("none");
    setParties([]); setDragIndex(null); setHoldRank(1); setHoldAutoPromote(true);
    setIsMultiPerformer(false); setMultiVenueType(null); setFestivalName("");
    setPerformers([]); setCreatedStages([]);
  };

  const handleRoleSelect = (role: OperatorRole) => {
    setSelectedRole(role);
    if (role === "performer" && profiles["performer"]?.name) setArtistName(profiles["performer"].name);
    if (role === "venue" && allVenueOptions.length === 1) {
      setVenueName(allVenueOptions[0].name);
      if (allVenueOptions[0].capacity) setCapacity(String(allVenueOptions[0].capacity));
    }
    if (role === "venue") setRoomStage("");
  };

  const addParty = (key: string) => {
    const def = AVAILABLE_PARTIES.find(p => p.key === key);
    if (!def) return;
    setParties(prev => [...prev, { key: def.key, label: def.label, name: "", percentage: def.defaultPct }]);
  };
  const removeParty = (index: number) => setParties(prev => prev.filter((_, i) => i !== index));
  const updateParty = (index: number, field: "name" | "percentage", value: string) =>
    setParties(prev => prev.map((p, i) => i === index ? { ...p, [field]: value } : p));

  const handleDragStart = useCallback((index: number) => setDragIndex(index), []);
  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === index) return;
    setParties(prev => { const next = [...prev]; const [moved] = next.splice(dragIndex, 1); next.splice(index, 0, moved); return next; });
    setDragIndex(index);
  }, [dragIndex]);
  const handleDragEnd = useCallback(() => setDragIndex(null), []);

  const handleSplitChange = (field: "artist" | "promoter" | "venue", value: string) => {
    const num = parseFloat(value) || 0;
    if (field === "artist") { setArtistSplit(value); setVenueSplit(String(Math.max(0, 100 - num - (parseFloat(promoterSplit) || 0)))); }
    else if (field === "promoter") { setPromoterSplit(value); setVenueSplit(String(Math.max(0, 100 - (parseFloat(artistSplit) || 0) - num))); }
    else { setVenueSplit(value); setPromoterSplit(String(Math.max(0, 100 - (parseFloat(artistSplit) || 0) - num))); }
  };

  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  const onSubmit = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      await handleSubmit({
        selectedRole, eventName, date, venueName, artistName, performerProfileId, capacity,
        ticketingProvider, roomStage, holdRank, defaultStatus,
        isMultiPerformer, multiVenueType, festivalName, performers,
        promoterCostSplit, venueCostSplit, venueRental, venueRentalPaymentMode,
        dealType, artistGuarantee, artistSplit, promoterSplit, venueSplit, artistCostSplit,
        parties, prefillData, onEventCreated,
        setOpen, resetForm,
      });
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const venueRequired = selectedRole === "venue" && !isMultiPerformer;
  const step1Valid = !!eventName && !!date && (!venueRequired || !!venueName.trim()) && (!isMultiPerformer || (multiVenueType === "festival" ? !!festivalName.trim() : multiVenueType === "venue" ? !!venueName.trim() : false));
  const stepTitles = isMultiPerformer
    ? ["Choose Your Role", "Event Details", "Add Performers"]
    : ["Choose Your Role", "Event Details", "Deal Structure"];

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
      {externalOpen === undefined && (
        <DialogTrigger asChild>
          {trigger || (
            <Button className="gap-2">
              <Plus className="h-4 w-4" /> New Event
            </Button>
          )}
        </DialogTrigger>
      )}
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{stepTitles[step]}</DialogTitle>
          <DialogDescription>
            Step {step + 1} of 3 — {step === 0 ? "Select your role for this event" : step === 1 ? "Enter event information" : "Define the financial deal"}
          </DialogDescription>
        </DialogHeader>

        {step === 0 && (
          <RoleSelectionStep
            selectedRole={selectedRole}
            onRoleSelect={handleRoleSelect}
            onNext={() => setStep(1)}
          />
        )}

        {step === 1 && (
          <EventDetailsStep
            onBack={() => setStep(0)} onNext={() => setStep(2)}
            step1Valid={step1Valid} isMultiPerformer={isMultiPerformer}
            nextLabel={isMultiPerformer ? "Next: Add Performers" : "Next: Deal Structure"}
            eventName={eventName} setEventName={setEventName}
            date={date} setDate={setDate}
            doubleBookingEvents={doubleBookingEvents} unavailableDates={unavailableDates}
            artistName={artistName} setArtistName={setArtistName}
            performerProfileId={performerProfileId} setPerformerProfileId={setPerformerProfileId}
            venueName={venueName} setVenueName={setVenueName}
            roomStage={roomStage} setRoomStage={setRoomStage}
            capacity={capacity} setCapacity={setCapacity}
            ticketingProvider={ticketingProvider} setTicketingProvider={setTicketingProvider}
            selectedRole={selectedRole} allVenueOptions={allVenueOptions}
            defaultStatus={defaultStatus}
            holdRank={holdRank} setHoldRank={setHoldRank}
            holdAutoPromote={holdAutoPromote} setHoldAutoPromote={setHoldAutoPromote}
            multiVenueType={multiVenueType} setMultiVenueType={setMultiVenueType}
            festivalName={festivalName} setFestivalName={setFestivalName}
            onMultiPerformerToggle={(v) => {
              setIsMultiPerformer(v);
              if (v) { setArtistName(""); setCapacity(""); setVenueName(""); setRoomStage(""); setMultiVenueType(null); setFestivalName(""); if (performers.length === 0) addPerformer(); }
              else { setMultiVenueType(null); setFestivalName(""); }
            }}
          />
        )}

        {step === 2 && !isMultiPerformer && (
          <DealStructureStep
            onBack={() => setStep(1)} onSubmit={onSubmit} isSubmitting={submitting}
            dealType={dealType} setDealType={setDealType}
            artistGuarantee={artistGuarantee} setArtistGuarantee={setArtistGuarantee}
            artistSplit={artistSplit} promoterSplit={promoterSplit} venueSplit={venueSplit}
            handleSplitChange={handleSplitChange}
            costResponsibility={costResponsibility} setCostResponsibility={setCostResponsibility}
            artistCostSplit={artistCostSplit} setArtistCostSplit={setArtistCostSplit}
            promoterCostSplit={promoterCostSplit} setPromoterCostSplit={setPromoterCostSplit}
            venueCostSplit={venueCostSplit} setVenueCostSplit={setVenueCostSplit}
            venueRental={venueRental} setVenueRental={setVenueRental}
            venueRentalPaymentMode={venueRentalPaymentMode} setVenueRentalPaymentMode={setVenueRentalPaymentMode}
            parties={parties} dragIndex={dragIndex}
            handleDragStart={handleDragStart} handleDragOver={handleDragOver} handleDragEnd={handleDragEnd}
            addParty={addParty} removeParty={removeParty} updateParty={updateParty}
            isPromoter={isPromoter}
            isPerformer={selectedRole === "performer"}
          />
        )}

        {step === 2 && isMultiPerformer && (
          <PerformersStep
            performers={performers} createdStages={createdStages} setCreatedStages={setCreatedStages}
            addPerformer={addPerformer} removePerformer={removePerformer} updatePerformer={updatePerformer}
            onBack={() => setStep(1)} onSubmit={onSubmit} isSubmitting={submitting}
            venueRooms={allVenueOptions.find(v => v.name === venueName)?.rooms}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
