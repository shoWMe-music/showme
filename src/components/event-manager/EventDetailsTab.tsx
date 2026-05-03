import NumberInput from "@/components/NumberInput";
import { PerformerSearch } from "@/components/PerformerSearch";
import { type StageOption } from "@/components/StageRoomSelect";
import { PerformerFormFields, PERFORMER_ROLE_TAG_LABELS } from "@/components/PerformerFormFields";
import DocumentPreviewDialog from "@/components/DocumentPreviewDialog";
import { SectionTemplateMenu } from "@/components/SectionTemplateMenu";
import { ProfilePreviewPopover } from "@/components/ProfilePreviewPopover";
import { useState, useRef, useEffect, useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import { format, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import { toast, copyToast } from "@/hooks/use-toast";
import { useUser, type SharedProfile, type ProfileDocument } from "@/lib/user-context";
import {
  useAddChildEvent,
  useRemoveChildEvent,
  useConvertToMultiPerformer,
  useHoldRankMutations,
  getDateChangeParties,
} from "@/lib/queries/useEventMutations";
import { useEvents } from "@/lib/queries";
import ContactCombobox from "@/components/ContactCombobox";
import { EditableSection, FileUploadButton } from "./EditableSection";
import { ScheduleTimeInput } from "./ScheduleTimeInput";
import {
  formatCurrency, getCurrencySymbol,
  type Event as AppEvent, type EventStatus, type SettlementStatus, type DealType, type DealStructure, type TicketRevenue, type TicketType, type Rider,
  type ScheduleItem, type AmenityKey, type ExpenseItem, type RiderType, type CommissionParty, type EventCollaborator,
  amenityLabels, riderTypeLabels, eventStatusLabels,
} from "@/lib/models";
import {
  fetchRiders, upsertRider, deleteRider,
  fetchSchedule, upsertScheduleItem, deleteScheduleItem, appendEventActivity, fetchProfileOwnerUid, addEventCollaborator, type EventMeta,
} from "@/lib/db";
import { getAuthClient } from "@/lib/firebaseAuth";
import { uploadUserBinary } from "@/lib/firebaseStorageUpload";
import {
  Music, MapPin, FileText, Clock, Plus, Trash2, Ticket, DollarSign,
  Calendar, Shield, Paperclip, Share2, Copy, Download, ArrowUp, ArrowDown,
  Users, UserPlus, X, ChevronDown, CreditCard, CheckCircle2, ExternalLink,
} from "lucide-react";

/** Look up a profile from the user's loaded profiles by its Firestore document ID. */
function findProfileById(profiles: Record<string, SharedProfile>, profileId: string | undefined): SharedProfile | undefined {
  if (!profileId) return undefined;
  return Object.values(profiles).find(p => p.id === profileId);
}

/**
 * C5 — Derive a default event capacity from the selected Room/Stage names.
 *
 * Sums the capacities of matching sub-venues across all loaded venue
 * profiles. Returns 0 when no rooms are selected or none have a capacity.
 * Pure so it can be unit-tested without mounting the component.
 *
 * @param roomNames Array of selected room/stage display names (e.g.
 *                  `editEvent.roomStage.split(", ")`).
 * @param subVenues Flat list of `{name, capacity}` derived from the user's
 *                  venue profile sub-venues.
 */
export function deriveDefaultCapacityForRooms(
  roomNames: string[],
  subVenues: { name: string; capacity?: number }[],
): number {
  if (!roomNames.length) return 0;
  const byName = new Map<string, number | undefined>();
  for (const sv of subVenues) byName.set(sv.name, sv.capacity);
  let total = 0;
  for (const name of roomNames) {
    const cap = byName.get(name);
    if (typeof cap === "number" && cap > 0) total += cap;
  }
  return total;
}

/**
 * C2 — Visibility gate for the "Commissions from Performer Share" section.
 *
 * Wave 7 tightened the previous `isPerformerOperator` gate. The block is now
 * visible only when the user's role on this specific event is performer.
 * That means one of:
 *   1. A user-controlled profile is the event's performer profile
 *      (event.performerProfileId === one of the user's profile ids).
 *   2. A user-controlled profile appears as an `eventRole === "performer"`
 *      collaborator on the event (covers multi-performer / invited cases).
 *   3. The user is the event host AND the host is also the performer on a
 *      single-performer event (host-as-performer self-booking).
 *
 * Venue, promoter, organizer, agent and staff roles do NOT see this section,
 * even if they happen to also own a performer profile that's unrelated to
 * the event.
 */
export function canSeePerformerCommissions(args: {
  userProfileIds: string[];
  performerProfileId?: string;
  hostProfileId?: string;
  isMultiPerformer?: boolean;
  collaborators?: EventCollaborator[];
}): boolean {
  const { userProfileIds, performerProfileId, hostProfileId, isMultiPerformer, collaborators } = args;
  if (userProfileIds.length === 0) return false;
  const userIdSet = new Set(userProfileIds);

  // Case 1: user controls the performer profile on this event.
  if (performerProfileId && userIdSet.has(performerProfileId)) return true;

  // Case 2: user controls a profile listed as a performer collaborator.
  if (collaborators?.some(c => c.eventRole === "performer" && c.profileId && userIdSet.has(c.profileId))) {
    return true;
  }

  // Case 3: host-as-performer on a single-performer event.
  if (
    !isMultiPerformer &&
    hostProfileId &&
    performerProfileId &&
    hostProfileId === performerProfileId &&
    userIdSet.has(hostProfileId)
  ) {
    return true;
  }

  return false;
}

/**
 * C5 — Add a custom (free-text) amenity string to the existing list.
 * Trims whitespace, ignores empty input, and de-duplicates against both
 * standard AmenityKey entries and existing custom strings (case-sensitive,
 * exact match).
 *
 * Pure helper exported for unit testing.
 */
export function addCustomAmenity(amenities: string[], raw: string): string[] {
  const v = raw.trim();
  if (!v) return amenities;
  if (amenities.includes(v)) return amenities;
  return [...amenities, v];
}

/** C5 — True iff `key` is one of the standard AmenityKey enum values. */
export function isStandardAmenityKey(key: string): key is AmenityKey {
  return Object.prototype.hasOwnProperty.call(amenityLabels, key);
}

/**
 * C5 — Split a heterogeneous amenity list (typed keys + custom strings) into
 * the two buckets so the UI can render the standard ones with translated
 * labels and the custom ones verbatim.
 */
export function partitionAmenities(all: string[]): { standard: AmenityKey[]; custom: string[] } {
  const standard: AmenityKey[] = [];
  const custom: string[] = [];
  for (const a of all) {
    if (isStandardAmenityKey(a)) standard.push(a);
    else custom.push(a);
  }
  return { standard, custom };
}

/** Map profile documents to event Rider entries, also including catering/accommodation notes. */
function profileDocumentsToRiders(profile: SharedProfile): Rider[] {
  const riders: Rider[] = [];
  const typeMap: Record<ProfileDocument["type"], RiderType> = {
    tech_rider: "technical",
    hospitality_rider: "hospitality",
    other: "custom",
  };
  if (profile.documents?.length) {
    for (const doc of profile.documents) {
      riders.push({
        id: `R-profile-${doc.id}`,
        name: doc.name,
        type: typeMap[doc.type] || "custom",
        fileUrl: doc.url,
        fileName: doc.name,
      });
    }
  }
  if (profile.cateringNotes) {
    riders.push({
      id: `R-catering-${Date.now()}`,
      name: "Catering Requirements",
      type: "catering",
      description: profile.cateringNotes,
    });
  }
  if (profile.accommodationNotes) {
    riders.push({
      id: `R-accommodation-${Date.now()}`,
      name: "Accommodation Requirements",
      type: "hospitality",
      description: profile.accommodationNotes,
    });
  }
  return riders;
}

/** Build merged stage options from venue rooms + child events for the Add Performer dialog. */
function usePerformerStageOptions(
  venueRooms?: { name: string; capacity?: number }[],
  childEvents?: AppEvent[],
): StageOption[] {
  return useMemo(() => {
    const map = new Map<string, string>();
    venueRooms?.forEach((r) => {
      map.set(r.name, r.capacity ? String(r.capacity) : "");
    });
    childEvents?.forEach((child) => {
      if (child.roomStage) {
        const existing = parseInt(map.get(child.roomStage) || "0") || 0;
        const childCap = child.stageCapacity || child.capacity || 0;
        map.set(child.roomStage, String(Math.max(existing, childCap)));
      }
    });
    return Array.from(map.entries()).map(([name, capacity]) => ({ name, capacity }));
  }, [venueRooms, childEvents]);
}

interface GuestEntry {
  id: string;
  name: string;
  tickets: number;
  invitingParty: string;
}
interface GuestListConfig {
  totalTicketLimit: number;
  perGuestTicketLimit: number;
  guests: GuestEntry[];
}

export function EventDetailsTab({ event, deal, revenue, eventMeta, updateEvent, updateDeal, updateRevenue, currency = "EUR", onSave, childEvents, actingProfile, collaborators, readOnly, onInvitePerformer }: {
  event: AppEvent; deal: DealStructure | null | undefined; revenue: TicketRevenue | undefined; eventMeta: EventMeta;
  updateEvent: (id: string, updates: Partial<AppEvent>) => void;
  updateDeal: (id: string, deal: DealStructure) => void;
  updateRevenue: (eventId: string, revenue: TicketRevenue) => void;
  currency?: string; onSave?: (d: Partial<EventMeta>) => void;
  childEvents?: AppEvent[];
  actingProfile?: string;
  collaborators?: EventCollaborator[];
  readOnly?: boolean;
  onInvitePerformer?: (name: string, childEventId?: string) => void;
}) {
  const { currentUser, profiles } = useUser();
  const allEvents = useEvents();
  const { promoteHoldsOnDate, resolveHoldRankConflicts } = useHoldRankMutations();
  const addChildEventMutation = useAddChildEvent();
  const removeChildEventMutation = useRemoveChildEvent();
  const convertToMultiPerformerMutation = useConvertToMultiPerformer();

  const addChildEvent = (parentId: string, event: AppEvent, deal: import("@/lib/models").DealStructure) =>
    addChildEventMutation.mutateAsync({ parentId, event, deal });
  const removeChildEvent = (parentId: string, childId: string) =>
    removeChildEventMutation.mutate({ parentId, childId });
  const convertToMultiPerformer = (eventId: string) =>
    convertToMultiPerformerMutation.mutateAsync({ eventId });
  // C2 — Visibility gate for "Commissions from Performer Share". The previous
  // `isPerformerOperator` check returned true whenever the user owned a
  // performer profile that was attached to the event. That accidentally
  // showed commissions to venue/promoter operators who happened to also own
  // a performer profile. The new gate (canSeePerformerCommissions) requires
  // that the user's role on THIS event is performer.
  const userControlledProfileIds = useMemo(
    () => Object.values(profiles).filter(p => p.id).map(p => p.id as string),
    [profiles],
  );
  const isPerformerOperator = canSeePerformerCommissions({
    userProfileIds: userControlledProfileIds,
    performerProfileId: event.performerProfileId,
    hostProfileId: event.hostProfileId,
    isMultiPerformer: event.isMultiPerformer,
    collaborators,
  });
  const [childRidersMap, setChildRidersMap] = useState<Record<string, Rider[]>>({});

  useEffect(() => {
    if (!event.isMultiPerformer || !event.childEventIds?.length) return;
    (event.childEventIds as string[]).forEach(cid => {
      fetchRiders(cid).then(fetched => {
        if (fetched.length > 0) setChildRidersMap(prev => ({ ...prev, [cid]: fetched }));
      }).catch(() => { /* permission denied for child events is expected in some cases */ });
    });
  }, [event.id, event.childEventIds]);
  const [addPerformerOpen, setAddPerformerOpen] = useState(false);
  const [removePerformerId, setRemovePerformerId] = useState<string | null>(null);
  const [newPerformerName, setNewPerformerName] = useState("");
  const [newPerformerProfileId, setNewPerformerProfileId] = useState("");
  const [newPerformerRoleTag, setNewPerformerRoleTag] = useState<import("@/components/PerformerFormFields").PerformerRoleTag | undefined>();
  const [newPerformerStage, setNewPerformerStage] = useState("");
  const [newPerformerCapacity, setNewPerformerCapacity] = useState("");
  const [newPerformerDealType, setNewPerformerDealType] = useState<DealType>("guarantee");
  const [newPerformerGuarantee, setNewPerformerGuarantee] = useState("");
  const [newPerformerArtistSplit, setNewPerformerArtistSplit] = useState("70");
  const [newPerformerPromoterSplit, setNewPerformerPromoterSplit] = useState("20");
  const [newPerformerVenueSplit, setNewPerformerVenueSplit] = useState("10");
  // Venue rooms from profile sub-venues (rooms/stages)
  const venueRooms = useMemo(() => {
    const venueProfiles = Object.entries(profiles).filter(([k, p]) => k.startsWith("venue") && p.created);
    return venueProfiles.flatMap(([, p]) =>
      (p.subVenues || []).filter(sv => sv.type === "room" || sv.type === "stage").map(sv => ({ name: sv.name, capacity: sv.capacity }))
    );
  }, [profiles]);
  const performerStageOptions = usePerformerStageOptions(venueRooms, childEvents);

  // riders and schedule are stored in Firestore subcollections, not on eventMeta
  const legacyRiders = ((eventMeta as unknown as { riders?: Rider[] }).riders) || [];
  const legacySchedule = ((eventMeta as unknown as { schedule?: ScheduleItem[] }).schedule) || [];
  const [riders, setRiders] = useState<Rider[]>([...legacyRiders]);
  const [schedule, setSchedule] = useState<ScheduleItem[]>([...legacySchedule]);
  const [amenities, setAmenities] = useState<string[]>([...(event.amenities || [])]);
  const [cateringNotes, setCateringNotes] = useState<string>(event.cateringNotes || "");
  const [accommodationNotes, setAccommodationNotes] = useState<string>(event.accommodationNotes || "");
  const [expenses, setExpenses] = useState<ExpenseItem[]>([...(eventMeta.expenses || [])]);
  const [guestList, setGuestList] = useState<GuestListConfig | null>(eventMeta.guestList || null);

  // Document preview state
  const [previewDoc, setPreviewDoc] = useState<{ fileName: string; fileUrl: string } | null>(null);

  // Double booking confirmation state
  const [doubleBookingOpen, setDoubleBookingOpen] = useState(false);
  const [pendingEditEvent, setPendingEditEvent] = useState<typeof editEvent | null>(null);
  const [doubleBookingConflicts, setDoubleBookingConflicts] = useState<string[]>([]);

  // Date change confirmation state
  const [dateChangeConfirmOpen, setDateChangeConfirmOpen] = useState(false);
  const [dateChangePartyNames, setDateChangePartyNames] = useState<string[]>([]);
  const [pendingDateEditEvent, setPendingDateEditEvent] = useState<typeof editEvent | null>(null);

  // ── Riders subcollection sync ──────────────────────────────────────────────
  const ridersLoaded = useRef<string | null>(null);
  const prevRiderIds = useRef(new Set<string>(legacyRiders.map((r: Rider) => r.id)));

  useEffect(() => {
    ridersLoaded.current = null;
    fetchRiders(event.id).then(fetched => {
      if (fetched.length > 0) {
        prevRiderIds.current = new Set(fetched.map(r => r.id));
        setRiders(fetched);
      }
      ridersLoaded.current = event.id;
    });
  }, [event.id]);

  useEffect(() => {
    if (ridersLoaded.current !== event.id) return;
    const currentIds = new Set(riders.map(r => r.id));
    const removed = [...prevRiderIds.current].filter(rid => !currentIds.has(rid));
    const added = riders.filter(r => (r.name || r.fileName) && !prevRiderIds.current.has(r.id));
    removed.forEach(rid => deleteRider(event.id, rid));
    riders.forEach(r => { if (r.name || r.fileName) upsertRider(event.id, r); });
    if (removed.length > 0 || added.length > 0) {
      const u = getAuthClient().currentUser;
      const by = u?.displayName || u?.email || "Unknown";
      const details: Record<string, string> = {};
      if (added.length > 0) details.added = added.map(r => `${riderTypeLabels[r.type] ?? r.type}${r.name ? ` "${r.name}"` : ""}`).join(", ");
      if (removed.length > 0) details.removed = `${removed.length} rider(s)`;
      appendEventActivity(event.id, "rider_updated", by, details, undefined, actingProfile);
      toast({ title: (<span className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-500" />Riders saved</span>), duration: 1000 });
    }
    prevRiderIds.current = currentIds;
  }, [event.id, riders, actingProfile]);

  // ── Schedule subcollection sync ────────────────────────────────────────────
  const scheduleLoaded = useRef<string | null>(null);
  const prevScheduleIds = useRef(new Set<string>(legacySchedule.map((s: ScheduleItem) => s.id)));

  useEffect(() => {
    scheduleLoaded.current = null;
    fetchSchedule(event.id).then(fetched => {
      if (fetched.length > 0) {
        prevScheduleIds.current = new Set(fetched.map(s => s.id));
        setSchedule(fetched);
      }
      scheduleLoaded.current = event.id;
    });
  }, [event.id]);

  useEffect(() => {
    if (scheduleLoaded.current !== event.id) return;
    const currentIds = new Set(schedule.map(s => s.id));
    const removed = [...prevScheduleIds.current].filter(sid => !currentIds.has(sid));
    const added = schedule.filter(s => (s.label || s.time) && !prevScheduleIds.current.has(s.id));
    removed.forEach(sid => deleteScheduleItem(event.id, sid));
    schedule.forEach(s => { if (s.label || s.time) upsertScheduleItem(event.id, s); });
    if (removed.length > 0 || added.length > 0) {
      const u = getAuthClient().currentUser;
      const by = u?.displayName || u?.email || "Unknown";
      const details: Record<string, string> = {};
      if (added.length > 0) details.added = added.map(s => s.label || s.time).join(", ");
      if (removed.length > 0) details.removed = `${removed.length} item(s)`;
      appendEventActivity(event.id, "schedule_updated", by, details, undefined, actingProfile);
      toast({ title: (<span className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-500" />Schedule saved</span>), duration: 1000 });
    }
    prevScheduleIds.current = currentIds;
  }, [event.id, schedule, actingProfile]);

  // Re-sync amenities / catering / accommodation when navigating between events
  // in the same EventDetailsTab instance — useState only reads its initial value
  // once, so without this effect local state would stay on the previous event.
  // These fields live on the Event document, so they're available synchronously.
  const eventFieldsSyncedFor = useRef<string | null>(null);
  useEffect(() => {
    if (eventFieldsSyncedFor.current === event.id) return;
    eventFieldsSyncedFor.current = event.id;
    setAmenities([...(event.amenities || [])]);
    setCateringNotes(event.cateringNotes || "");
    setAccommodationNotes(event.accommodationNotes || "");
  }, [event.id, event.amenities, event.cateringNotes, event.accommodationNotes]);

  // Expenses / guestList still live in eventMeta (subcollection, lazy-loaded),
  // so re-hydrate once the meta query resolves for this event.id.
  const metaHydratedFor = useRef<string | null>(null);
  useEffect(() => {
    if (metaHydratedFor.current === event.id) return;
    const hasMeta =
      (eventMeta.expenses && eventMeta.expenses.length > 0) ||
      !!eventMeta.guestList;
    if (!hasMeta) return;
    metaHydratedFor.current = event.id;
    setExpenses([...(eventMeta.expenses || [])]);
    setGuestList(eventMeta.guestList || null);
  }, [event.id, eventMeta]);

  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const updateEventRef = useRef(updateEvent);
  updateEventRef.current = updateEvent;
  /** Skip one effect run per `event.id` so opening Details does not write the same payload and race Firestore streams. */
  const eventAutosavePrimed = useRef<string | null>(null);
  const metaAutosavePrimed = useRef<string | null>(null);

  useEffect(() => {
    if (eventAutosavePrimed.current !== event.id) {
      eventAutosavePrimed.current = event.id;
      return;
    }
    updateEventRef.current(event.id, { amenities, cateringNotes, accommodationNotes });
  }, [event.id, amenities, cateringNotes, accommodationNotes]);

  useEffect(() => {
    if (metaAutosavePrimed.current !== event.id) {
      metaAutosavePrimed.current = event.id;
      return;
    }
    onSaveRef.current?.({ expenses, guestList });
  }, [event.id, expenses, guestList]);

  const [editRiders, setEditRiders] = useState<Rider[]>([]);
  const [editSchedule, setEditSchedule] = useState<ScheduleItem[]>([]);
  const [editExpenses, setEditExpenses] = useState<ExpenseItem[]>([]);
  const [editAmenities, setEditAmenities] = useState<string[]>([]);
  const [editCateringNotes, setEditCateringNotes] = useState<string>("");
  const [editAccommodationNotes, setEditAccommodationNotes] = useState<string>("");
  const [newCustomAmenity, setNewCustomAmenity] = useState<string>("");
  const [editEvent, setEditEvent] = useState({ name: event.name, date: event.date, venue: event.venue, artist: event.artist, capacity: event.capacity, ticketingProvider: event.ticketingProvider, eventStatus: event.eventStatus, roomStage: event.roomStage || "", ticketUrls: event.ticketUrls || [] as string[], holdRank: event.holdRank || 1 as number, holdAutoPromote: event.holdAutoPromote !== false as boolean });
  const [editDatePickerOpen, setEditDatePickerOpen] = useState(false);
  // C5 — Track whether the user has manually edited the capacity field.
  // Once set, room/stage changes no longer auto-overwrite capacity.
  const capacityManuallyEdited = useRef(false);

  const venueRoomOptions = useMemo(() => {
    const hostProfile = event.hostProfileId ? Object.values(profiles).find(p => p.id === event.hostProfileId) : undefined;
    const venueProfile = hostProfile?.role === "venue" ? hostProfile : Object.values(profiles).find(p => p.role === "venue" && p.name === event.venue);
    const subVenueNames = (venueProfile?.subVenues || []).filter(sv => sv.type === "room" || sv.type === "stage").map(sv => sv.name);
    // Also include rooms from the event's roomStage field (comma-separated)
    const eventRooms = event.roomStage ? event.roomStage.split(",").map(r => r.trim()).filter(Boolean) : [];
    return [...new Set([...subVenueNames, ...eventRooms])];
  }, [profiles, event.venue, event.hostProfileId, event.roomStage]);

  const commitEventSave = (ev: typeof editEvent) => {
    if (event.eventStatus === "on_hold" && ev.eventStatus !== "on_hold") {
      promoteHoldsOnDate(event.date, event.venue, event.roomStage || "", event.holdRank || 1);
    }
    const holdRank = ev.holdRank || 1;
    const holdAutoPromote = ev.holdAutoPromote !== false;
    updateEvent(event.id, { ...ev, holdRank, holdAutoPromote });
    if (ev.eventStatus === "on_hold") {
      resolveHoldRankConflicts(event.id, ev.date, ev.venue, ev.roomStage || "", holdRank);
    }
  };

  const handleSaveEventInfo = () => {
    const changingFromDraft = event.eventStatus === "draft" && editEvent.eventStatus !== "draft";
    if (changingFromDraft) {
      const conflicts = allEvents.filter(e =>
        e.date === editEvent.date &&
        e.id !== event.id &&
        e.eventStatus !== "draft" &&
        !e.archived &&
        !e.parentEventId
      );
      if (conflicts.length > 0) {
        setPendingEditEvent({ ...editEvent });
        setDoubleBookingConflicts(conflicts.map(e => e.name));
        setDoubleBookingOpen(true);
        return;
      }
    }

    // Check if date/time fields changed and there are parties that need to confirm
    const dateFields = ["date", "startTime", "endTime"] as const;
    const hasDateChange = dateFields.some(f => f in editEvent && (editEvent as Record<string, unknown>)[f] !== (event as Record<string, unknown>)[f]);
    if (hasDateChange && collaborators) {
      const myProfileIds = Object.values(profiles).map((p) => p.id).filter(Boolean) as string[];
      const parties = getDateChangeParties(event, collaborators, myProfileIds, childEvents);
      if (parties.length > 0) {
        setPendingDateEditEvent({ ...editEvent });
        setDateChangePartyNames(parties.map(p => `${p.profileName} (${p.role})`));
        setDateChangeConfirmOpen(true);
        return;
      }
    }

    commitEventSave(editEvent);
  };
  const [newTicketUrl, setNewTicketUrl] = useState("");
  const [editDeal, setEditDeal] = useState<DealStructure | null>(deal ? { ...deal } : null);
  const [editTicketTypes, setEditTicketTypes] = useState<TicketType[]>(revenue?.ticketTypes ? [...revenue.ticketTypes] : []);

  const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
  const grossRev = revenue?.grossRevenue || 0;
  const netRev = grossRev + (revenue?.doorSales || 0) - (revenue?.ticketFees || 0) - (revenue?.tax || 0) - (revenue?.refunds || 0);

  const expenseCategories = ["Performer Fee", "Production", "Travel", "Accommodation", "Marketing", "Staffing", "Ticketing Fees", "Payment Fees", "Venue Rental"];

  const moveScheduleItem = (index: number, direction: "up" | "down") => {
    const newSchedule = [...editSchedule];
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newSchedule.length) return;
    [newSchedule[index], newSchedule[targetIndex]] = [newSchedule[targetIndex], newSchedule[index]];
    setEditSchedule(newSchedule);
  };

  return (
    <div className="space-y-6">
      {/* Editable Event Information */}
      <EditableSection
        title="Event Information"
        icon={<Calendar className="h-5 w-5 text-primary" />}
        readOnly={readOnly}
        onEditStart={() => { setEditEvent({ name: event.name, date: event.date, venue: event.venue, artist: event.artist, capacity: event.capacity, ticketingProvider: event.ticketingProvider, eventStatus: event.eventStatus, roomStage: event.roomStage || "", ticketUrls: event.ticketUrls || [], holdRank: event.holdRank || 1, holdAutoPromote: event.holdAutoPromote !== false }); setNewTicketUrl(""); capacityManuallyEdited.current = false; }}
        onSave={handleSaveEventInfo}
        editContent={
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div><Label>Event Name</Label><Input value={editEvent.name} onChange={(e) => setEditEvent(p => ({...p, name: e.target.value}))} className="mt-1" /></div>
              <div>
                <Label>Date</Label>
                <Popover open={editDatePickerOpen} onOpenChange={setEditDatePickerOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={cn("w-full mt-1 justify-start text-left font-normal", !editEvent.date && "text-muted-foreground")}>
                      <Calendar className="mr-2 h-4 w-4" />
                      {editEvent.date ? format(parseISO(editEvent.date), "PPP") : "Pick a date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <CalendarPicker
                      mode="single"
                      selected={editEvent.date ? parseISO(editEvent.date) : undefined}
                      onSelect={(d) => {
                        if (d) setEditEvent(p => ({ ...p, date: format(d, "yyyy-MM-dd") }));
                        setEditDatePickerOpen(false);
                      }}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <div><Label>Venue</Label><ContactCombobox contactType="venue" value={editEvent.venue} onChange={(v) => setEditEvent(p => ({...p, venue: v}))} placeholder="Search or type venue name" /></div>
              {!event.isMultiPerformer && (() => {
                const performerLocked = event.eventStatus !== "draft";
                return (
                  <div>
                    <Label>Performer</Label>
                    {performerLocked ? (
                      <div className="mt-1 flex items-center gap-2 h-10 px-3 rounded-md border bg-muted text-sm">
                        <Music className="h-4 w-4 text-muted-foreground shrink-0" />
                        <ProfilePreviewPopover name={event.artist} profileId={event.performerProfileId} />
                        <Badge variant="outline" className="text-[10px] ml-auto">Linked</Badge>
                      </div>
                    ) : (
                      <PerformerSearch value={editEvent.artist} onChange={(name) => setEditEvent(p => ({...p, artist: name}))} placeholder="Search or type artist name" className="mt-1" />
                    )}
                  </div>
                );
              })()}
              <div>
                <Label>Room / Stage</Label>
                {(() => {
                  const venueProfiles = Object.entries(profiles).filter(([k, p]) => k.startsWith("venue") && p.created);
                  const allSubVenues = venueProfiles.flatMap(([, p]) => (p.subVenues || []).filter(sv => sv.type === "room" || sv.type === "stage"));
                  const selectedRooms = editEvent.roomStage ? editEvent.roomStage.split(", ").filter(Boolean) : [];
                  if (allSubVenues.length > 0) {
                    return (
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="outline" className="w-full mt-1 justify-between font-normal">
                            {selectedRooms.length > 0 ? selectedRooms.join(", ") : "Select rooms/stages…"}
                            <ChevronDown className="h-4 w-4 opacity-50" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-[--radix-popover-trigger-width] p-2" align="start">
                          {allSubVenues.map((sv) => (
                            <label key={sv.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer">
                              <Checkbox
                                checked={selectedRooms.includes(sv.name)}
                                onCheckedChange={(checked) => {
                                  const updated = checked
                                    ? [...selectedRooms, sv.name]
                                    : selectedRooms.filter((r: string) => r !== sv.name);
                                  setEditEvent(p => {
                                    // C5 — When user has not manually edited
                                    // capacity, default it from the selected
                                    // rooms' summed capacities. Manual edits
                                    // take precedence (capacityManuallyEdited).
                                    const derived = deriveDefaultCapacityForRooms(updated, allSubVenues);
                                    const nextCapacity = capacityManuallyEdited.current
                                      ? p.capacity
                                      : (derived > 0 ? derived : p.capacity);
                                    return { ...p, roomStage: updated.join(", "), capacity: nextCapacity };
                                  });
                                }}
                              />
                              <span className="text-sm">{sv.name}</span>
                              {sv.capacity && <span className="text-xs text-muted-foreground ml-auto">({sv.capacity})</span>}
                            </label>
                          ))}
                        </PopoverContent>
                      </Popover>
                    );
                  }
                  return <Input value={editEvent.roomStage} onChange={(e) => setEditEvent(p => ({...p, roomStage: e.target.value}))} placeholder="e.g. Main Stage" className="mt-1" />;
                })()}
              </div>
              <div><Label>Capacity</Label><NumberInput value={editEvent.capacity} onChange={(e) => { capacityManuallyEdited.current = true; setEditEvent(p => ({...p, capacity: parseInt(e.target.value) || 0})); }} className="mt-1" /></div>
              <div><Label>Ticketing Provider</Label><Input value={editEvent.ticketingProvider} onChange={(e) => setEditEvent(p => ({...p, ticketingProvider: e.target.value}))} className="mt-1" /></div>
              <div>
                <Label>Status</Label>
                <Select value={editEvent.eventStatus} onValueChange={(v) => setEditEvent(p => ({...p, eventStatus: v as EventStatus}))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.entries(eventStatusLabels) as [EventStatus, string][]).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {editEvent.eventStatus === "on_hold" && (
                <div className="space-y-3 p-3 rounded-lg border bg-muted/30">
                  <span className="text-sm font-semibold">Hold Settings</span>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Hold Priority</Label>
                      <Select value={String(editEvent.holdRank || 1)} onValueChange={v => setEditEvent(p => ({ ...p, holdRank: Number(v) }))}>
                        <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
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
                      <input type="checkbox" checked={editEvent.holdAutoPromote !== false} onChange={e => setEditEvent(p => ({ ...p, holdAutoPromote: e.target.checked }))} className="accent-primary" />
                      <Label className="text-xs">Auto-promote</Label>
                    </div>
                  </div>
                </div>
              )}
            </div>
            {/* Ticket URLs */}
            <div>
              <Label>Ticket URLs</Label>
              <div className="space-y-2 mt-1">
                {(editEvent.ticketUrls || []).map((url: string, i: number) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input value={url} onChange={(e) => setEditEvent(p => ({ ...p, ticketUrls: p.ticketUrls.map((u: string, j: number) => j === i ? e.target.value : u) }))} className="flex-1" />
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditEvent(p => ({ ...p, ticketUrls: p.ticketUrls.filter((_: string, j: number) => j !== i) }))}><X className="h-3.5 w-3.5 text-destructive" /></Button>
                  </div>
                ))}
                <div className="flex gap-2">
                  <Input value={newTicketUrl} onChange={(e) => setNewTicketUrl(e.target.value)} placeholder="https://tickets.example.com/..." className="flex-1" onKeyDown={(e) => { if (e.key === "Enter" && newTicketUrl.trim()) { setEditEvent(p => ({ ...p, ticketUrls: [...(p.ticketUrls || []), newTicketUrl.trim()] })); setNewTicketUrl(""); }}} />
                  <Button variant="outline" size="sm" onClick={() => { if (newTicketUrl.trim()) { setEditEvent(p => ({ ...p, ticketUrls: [...(p.ticketUrls || []), newTicketUrl.trim()] })); setNewTicketUrl(""); }}}><Plus className="h-3.5 w-3.5 mr-1" /> Add</Button>
                </div>
              </div>
            </div>
          </div>
        }
      >
        <div className="space-y-0">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              { label: "Event Name", value: event.name },
              { label: "Date", value: event.date },
              { label: "Venue", value: event.venue ? <ProfilePreviewPopover name={event.venue} /> : event.venue },
              ...(event.roomStage && !event.isMultiPerformer ? [{ label: "Room / Stage", value: event.roomStage }] : []),
              ...(!event.isMultiPerformer ? [{ label: "Performer", value: event.artist ? <ProfilePreviewPopover name={event.artist} profileId={event.performerProfileId} onInvite={!event.performerProfileId && onInvitePerformer ? () => onInvitePerformer(event.artist) : undefined} /> : event.artist }] : []),
              { label: "Capacity", value: (event.capacity ?? 0).toLocaleString() },
              { label: "Ticketing Provider", value: event.ticketingProvider },
              { label: "Operator", value: `${event.operator} (${event.operatorType})` },
              { label: "Status", value: eventStatusLabels[event.eventStatus] },
              ...(event.eventStatus === "on_hold" ? [
                { label: "Hold Priority", value: `${event.holdRank || 1}${event.holdRank === 1 ? "st" : event.holdRank === 2 ? "nd" : event.holdRank === 3 ? "rd" : "th"} Hold` },
                { label: "Auto-promote", value: event.holdAutoPromote !== false ? "Enabled" : "Disabled" },
              ] : []),
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between items-center py-1.5">
                <span className="text-sm text-muted-foreground">{label}</span>
                <span className="text-sm font-medium">{value}</span>
              </div>
            ))}
          </div>
          {(event.ticketUrls?.length ?? 0) > 0 && (
            <div className="mt-3 pt-3 border-t">
              <span className="text-sm text-muted-foreground font-medium">Ticket URLs</span>
              <div className="space-y-1 mt-1">
                {event.ticketUrls!.map((url: string, i: number) => (
                  <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-sm text-primary hover:underline">
                    <Ticket className="h-3.5 w-3.5" /> {url}
                  </a>
                ))}
              </div>
            </div>
          )}
          {/* Performers section — shown on all events */}
          {!event.parentEventId && (
            <div className="mt-3 pt-3 border-t">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold">Performers</span>
                {!readOnly && (
                  <Button variant="outline" size="sm" className="text-xs h-7 gap-1" onClick={() => setAddPerformerOpen(true)}>
                    <Plus className="h-3 w-3" /> Add Performer
                  </Button>
                )}
              </div>
              <div className="space-y-2">
                {/* Show existing single artist as a performer row (before conversion) */}
                {!event.isMultiPerformer && event.artist && (
                  <div className="rounded-lg border p-3 flex items-center justify-between bg-muted/30">
                    <div className="flex items-center gap-3">
                      <Music className="h-4 w-4 text-primary" />
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium">
                            <ProfilePreviewPopover name={event.artist} profileId={event.performerProfileId} onInvite={!event.performerProfileId && onInvitePerformer ? () => onInvitePerformer(event.artist) : undefined} />
                          </p>
                          {event.performerRoleTag && (
                            <Badge variant="secondary" className="text-[10px]">
                              {PERFORMER_ROLE_TAG_LABELS[event.performerRoleTag]}
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          <ProfilePreviewPopover name={event.venue} size="sm" className="text-muted-foreground" />{event.roomStage ? ` — ${event.roomStage}` : ""}
                          {event.capacity ? ` (${event.capacity} cap.)` : ""}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {!readOnly && (
                        <Select value={event.performerRoleTag || "_none"} onValueChange={v => updateEvent(event.id, { performerRoleTag: v === "_none" ? undefined : v as AppEvent["performerRoleTag"] })}>
                          <SelectTrigger className="h-7 w-28 text-xs"><SelectValue placeholder="Role" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="_none">No role</SelectItem>
                            {(Object.entries(PERFORMER_ROLE_TAG_LABELS) as [string, string][]).map(([k, v]) => (
                              <SelectItem key={k} value={k}>{v}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                      {!event.performerProfileId && onInvitePerformer ? (
                        <Button variant="outline" size="sm" className="text-xs h-7 gap-1.5" onClick={() => onInvitePerformer(event.artist)}>
                          <UserPlus className="h-3 w-3" /> Invite to Platform
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {event.performerProfileId ? "Connected" : "Current artist"}
                        </span>
                      )}
                    </div>
                  </div>
                )}
                {!event.isMultiPerformer && !readOnly && (
                  <Button variant="outline" size="sm" className="text-xs gap-1.5" onClick={() => setAddPerformerOpen(true)}>
                    <Plus className="h-3 w-3" /> Add Support Act
                  </Button>
                )}
                {event.isMultiPerformer && childEvents && childEvents.map((child) => (
                  <div key={child.id} className="rounded-lg border p-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Music className="h-4 w-4 text-primary" />
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium">
                            <ProfilePreviewPopover name={child.artist} profileId={child.performerProfileId} onInvite={!child.performerProfileId && onInvitePerformer ? () => onInvitePerformer(child.artist, child.id) : undefined} />
                          </p>
                          {child.performerRoleTag && (
                            <Badge variant="secondary" className="text-[10px]">
                              {PERFORMER_ROLE_TAG_LABELS[child.performerRoleTag]}
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          <ProfilePreviewPopover name={child.venue} size="sm" className="text-muted-foreground" />{child.roomStage ? ` — ${child.roomStage}` : ""}
                          {child.capacity ? ` (${child.capacity} cap.)` : ""}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {!child.performerProfileId && onInvitePerformer && (
                        <Button variant="outline" size="sm" className="text-xs h-7 gap-1.5" onClick={() => onInvitePerformer(child.artist, child.id)}>
                          <UserPlus className="h-3 w-3" /> Invite
                        </Button>
                      )}
                      <Link to="/events/$id" params={{ id: child.id }} className="text-xs text-primary hover:underline">View →</Link>
                      {!readOnly && (
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setRemovePerformerId(child.id)}>
                          <X className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
                {event.isMultiPerformer && (!childEvents || childEvents.length === 0) && (
                  <p className="text-xs text-muted-foreground py-2">No performers added yet.</p>
                )}
              </div>
            </div>
          )}
        </div>
      </EditableSection>

      {/* Riders & Documents */}
      {(() => {
        // Aggregate child event riders for parent multi-performer events
        const childRiders: { performer: string; childId: string; riders: Rider[] }[] = [];
        const isParentMulti = event.isMultiPerformer && (event.childEventIds?.length ?? 0) > 0;
        if (isParentMulti) {
          (event.childEventIds as string[]).forEach((cid: string) => {
            const child = allEvents.find(e => e.id === cid);
            if (!child) return;
            const childRiderList = childRidersMap[cid] || [];
            if (childRiderList.length) {
              childRiders.push({ performer: child.artist || child.name, childId: cid, riders: childRiderList.filter((r: Rider) => r.name || r.fileName) });
            }
          });
        }

        if (isParentMulti) {
          // Build list of all child performers including those with profile rider data
          const allChildPerformers: { performer: string; childId: string; performerProfileId?: string; riders: Rider[]; profileRiders: Rider[]; profileSlug?: string }[] = [];
          (event.childEventIds as string[]).forEach((cid: string) => {
            const child = allEvents.find(e => e.id === cid);
            if (!child) return;
            const childRiderList = (childRidersMap[cid] || []).filter((r: Rider) => r.name || r.fileName);
            const performerProfile = findProfileById(profiles, child.performerProfileId);
            const profileRiderList = performerProfile ? profileDocumentsToRiders(performerProfile) : [];
            allChildPerformers.push({
              performer: child.artist || child.name,
              childId: cid,
              performerProfileId: child.performerProfileId,
              riders: childRiderList,
              profileRiders: profileRiderList,
              profileSlug: performerProfile?.slug,
            });
          });

          // Read-only aggregated view for parent events
          return (
            <EditableSection
              title="Riders & Documents"
              icon={<FileText className="h-5 w-5 text-primary" />}
              onEditStart={() => {}}
              onSave={() => {}}
              editContent={
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground mb-2">Navigate to each performer's event page to edit their riders.</p>
                  {allChildPerformers.map(({ performer, childId, profileSlug }) => (
                    <div key={childId} className="flex gap-2">
                      <Button variant="outline" size="sm" asChild>
                        <Link to="/events/$id" params={{ id: childId }}>
                          <Music className="h-3.5 w-3.5 mr-1.5" /> Edit {performer}'s Riders
                        </Link>
                      </Button>
                      {profileSlug && (
                        <Button variant="ghost" size="sm" className="gap-1.5 text-xs" asChild>
                          <Link to="/p/$slug" params={{ slug: profileSlug }}>
                            <ExternalLink className="h-3 w-3" /> View Profile
                          </Link>
                        </Button>
                      )}
                    </div>
                  ))}
                  {allChildPerformers.length === 0 && <p className="text-sm text-muted-foreground">No performers with riders yet.</p>}
                </div>
              }
            >
              {allChildPerformers.every(cp => cp.riders.length === 0 && cp.profileRiders.length === 0) ? (
                <p className="text-sm text-muted-foreground">No riders added yet. Add them on each performer's page.</p>
              ) : (
                <div className="space-y-4">
                  {allChildPerformers.map(({ performer, childId, riders: cRiders, profileRiders: pRiders, profileSlug, performerProfileId: childPerfId }) => {
                    if (cRiders.length === 0 && pRiders.length === 0) return null;
                    return (
                      <div key={childId}>
                        <div className="flex items-center gap-2 mb-2">
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                            <Music className="h-3 w-3" /> {performer}
                          </p>
                          {profileSlug && (
                            <Link to="/p/$slug" params={{ slug: profileSlug }} className="text-xs text-primary hover:underline flex items-center gap-1">
                              <ExternalLink className="h-3 w-3" /> Profile
                            </Link>
                          )}
                        </div>
                        <div className="space-y-2 pl-3 border-l-2 border-muted">
                          {cRiders.map((rider) => (
                            <div key={rider.id} className="rounded-lg border p-3">
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-sm font-medium">{rider.name}</span>
                                <div className="flex items-center gap-2">
                                  {rider.fileName && (
                                    <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => { if (rider.fileUrl && rider.fileName) setPreviewDoc({ fileName: rider.fileName, fileUrl: rider.fileUrl }); }}>
                                      <Download className="h-3 w-3" /> {rider.fileName}
                                    </Button>
                                  )}
                                  <Badge variant="outline" className="text-xs">{riderTypeLabels[rider.type]}</Badge>
                                </div>
                              </div>
                              {rider.description && <p className="text-xs text-muted-foreground">{rider.description}</p>}
                            </div>
                          ))}
                          {cRiders.length === 0 && pRiders.length > 0 && (
                            <div className="space-y-2">
                              <p className="text-xs text-muted-foreground italic">No event riders yet. Profile rider data available:</p>
                              {pRiders.map((rider) => (
                                <div key={rider.id} className="rounded-lg border border-dashed p-3 bg-muted/20">
                                  <div className="flex items-center justify-between mb-1">
                                    <span className="text-sm font-medium">{rider.name}</span>
                                    <div className="flex items-center gap-2">
                                      {rider.fileName && (
                                        <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => { if (rider.fileUrl && rider.fileName) setPreviewDoc({ fileName: rider.fileName, fileUrl: rider.fileUrl }); }}>
                                          <Download className="h-3 w-3" /> {rider.fileName}
                                        </Button>
                                      )}
                                      <Badge variant="secondary" className="text-xs">From profile</Badge>
                                    </div>
                                  </div>
                                  {rider.description && <p className="text-xs text-muted-foreground">{rider.description}</p>}
                                </div>
                              ))}
                              <Button variant="outline" size="sm" className="gap-1.5" asChild>
                                <Link to="/events/$id" params={{ id: childId }}>
                                  <FileText className="h-3.5 w-3.5" /> Edit {performer}'s event to add riders
                                </Link>
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </EditableSection>
          );
        }

        // Single event or child event: normal editable riders
        const filteredRiders = riders.filter((r: Rider) => r.name || r.fileName);
        return (
          <EditableSection
            title="Riders & Documents"
            icon={<FileText className="h-5 w-5 text-primary" />}
            onEditStart={() => setEditRiders([...riders])}
            onSave={() => setRiders([...editRiders])}
            editContent={
              <div className="space-y-3">
                {editRiders.map((rider, i) => (
                  <div key={rider.id} className="rounded-lg border p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <Input value={rider.name} onChange={(e) => { const r = [...editRiders]; r[i] = {...r[i], name: e.target.value}; setEditRiders(r); }} placeholder="Rider name" className="flex-1" />
                      <Select value={rider.type} onValueChange={(v) => { const r = [...editRiders]; r[i] = {...r[i], type: v as RiderType}; setEditRiders(r); }}>
                        <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Object.entries(riderTypeLabels).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Button variant="ghost" size="icon" onClick={() => setEditRiders(editRiders.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                    </div>
                    <Textarea value={rider.description || ""} onChange={(e) => { const r = [...editRiders]; r[i] = {...r[i], description: e.target.value}; setEditRiders(r); }} placeholder="Description" rows={2} />
                    <div className="flex items-center gap-2">
                      {rider.fileName ? (
                        <div className="flex items-center gap-2 text-xs">
                          <Paperclip className="h-3 w-3" />
                          <span>{rider.fileName}</span>
                          <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => { if (rider.fileUrl && rider.fileName) setPreviewDoc({ fileName: rider.fileName, fileUrl: rider.fileUrl }); }}><Download className="h-3 w-3" /></Button>
                          <Button variant="ghost" size="sm" className="h-6 text-xs text-destructive" onClick={() => { const r = [...editRiders]; r[i] = {...r[i], fileUrl: undefined, fileName: undefined}; setEditRiders(r); }}><X className="h-3 w-3" /></Button>
                        </div>
                      ) : (
                        <FileUploadButton onFile={(name, url) => { const r = [...editRiders]; r[i] = {...r[i], fileName: name, fileUrl: url}; setEditRiders(r); }} />
                      )}
                    </div>
                  </div>
                ))}
                <div className="flex gap-2 flex-wrap">
                  <Button variant="outline" size="sm" onClick={() => setEditRiders([...editRiders, { id: `R-${Date.now()}`, name: "", type: "technical", description: "" }])}>
                    <Plus className="h-3.5 w-3.5 mr-1" /> Add Rider
                  </Button>
                  {(() => {
                    const performerProfile = findProfileById(profiles, event.performerProfileId);
                    if (!performerProfile) return null;
                    const profileRiders = profileDocumentsToRiders(performerProfile);
                    if (profileRiders.length === 0) {
                      return performerProfile.slug ? (
                        <Button variant="outline" size="sm" className="gap-1.5" asChild>
                          <Link to="/p/$slug" params={{ slug: performerProfile.slug }}>
                            <ExternalLink className="h-3.5 w-3.5" /> View {performerProfile.name}'s Profile
                          </Link>
                        </Button>
                      ) : null;
                    }
                    return (
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        onClick={() => {
                          const existingFileUrls = new Set(editRiders.map(r => r.fileUrl).filter(Boolean));
                          const existingDescs = new Set(editRiders.map(r => r.description).filter(Boolean));
                          const newRiders = profileRiders.filter(
                            r => !(r.fileUrl && existingFileUrls.has(r.fileUrl)) && !(r.description && existingDescs.has(r.description))
                          );
                          if (newRiders.length === 0) {
                            toast({ title: "All profile riders already added" });
                            return;
                          }
                          setEditRiders([...editRiders, ...newRiders]);
                          toast({ title: `${newRiders.length} rider(s) added from profile`, duration: 2000 });
                        }}
                      >
                        <FileText className="h-3.5 w-3.5" /> Autofill from Profile
                      </Button>
                    );
                  })()}
                </div>
              </div>
            }
          >
            {filteredRiders.length === 0 ? (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">No riders added yet.</p>
                {(() => {
                  if (!event.performerProfileId) return null;
                  const performerProfile = findProfileById(profiles, event.performerProfileId);
                  if (performerProfile?.slug) {
                    const hasProfileRiderData = (performerProfile.documents?.length ?? 0) > 0 || !!performerProfile.cateringNotes || !!performerProfile.accommodationNotes;
                    if (hasProfileRiderData) {
                      return (
                        <p className="text-xs text-muted-foreground">
                          Rider data available on {performerProfile.name}'s profile. Click Edit to autofill.
                        </p>
                      );
                    }
                  }
                  return null;
                })()}
              </div>
            ) : (
              <div className="space-y-3">
                {filteredRiders.map((rider) => (
                  <div key={rider.id} className="rounded-lg border p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium">{rider.name}</span>
                      <div className="flex items-center gap-2">
                        {rider.fileName && (
                          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => { if (rider.fileUrl && rider.fileName) setPreviewDoc({ fileName: rider.fileName, fileUrl: rider.fileUrl }); }}>
                            <Download className="h-3 w-3" /> {rider.fileName}
                          </Button>
                        )}
                        <Badge variant="outline" className="text-xs">{riderTypeLabels[rider.type]}</Badge>
                      </div>
                    </div>
                    {rider.description && <p className="text-xs text-muted-foreground">{rider.description}</p>}
                  </div>
                ))}
              </div>
            )}
          </EditableSection>
        );
      })()}

      {/* Event Schedule */}
      <EditableSection
        title="Event Schedule"
        icon={<Clock className="h-5 w-5 text-primary" />}
        readOnly={readOnly}
        onEditStart={() => setEditSchedule([...schedule])}
        onSave={() => setSchedule([...editSchedule])}
        editContent={
          <div className="space-y-3">
            {editSchedule.map((item, i) => (
              <div key={item.id} className="flex items-start gap-2">
                <div className="flex flex-col gap-1">
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => moveScheduleItem(i, "up")} disabled={i === 0}><ArrowUp className="h-3 w-3" /></Button>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => moveScheduleItem(i, "down")} disabled={i === editSchedule.length - 1}><ArrowDown className="h-3 w-3" /></Button>
                </div>
                <ScheduleTimeInput
                  value={item.time || ""}
                  onChange={(next) => { const s = [...editSchedule]; s[i] = {...s[i], time: next}; setEditSchedule(s); }}
                />
                <Input value={item.label} onChange={(e) => { const s = [...editSchedule]; s[i] = {...s[i], label: e.target.value}; setEditSchedule(s); }} placeholder="Activity" className="flex-1" />
                <Input value={item.description || ""} onChange={(e) => { const s = [...editSchedule]; s[i] = {...s[i], description: e.target.value}; setEditSchedule(s); }} placeholder="Notes" className="flex-1" />
                {venueRoomOptions.length > 0 && (
                  <Select value={item.roomStage || "_all"} onValueChange={v => { const s = [...editSchedule]; s[i] = {...s[i], roomStage: v === "_all" ? undefined : v}; setEditSchedule(s); }}>
                    <SelectTrigger className="w-28"><SelectValue placeholder="Room" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_all">All</SelectItem>
                      {venueRoomOptions.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
                <Button variant="ghost" size="icon" onClick={() => setEditSchedule(editSchedule.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4 text-destructive" /></Button>
              </div>
            ))}
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setEditSchedule([...editSchedule, { id: `SC-${Date.now()}`, time: "", label: "" }])}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Add Item
              </Button>
              {editSchedule.length === 0 && (
                <Button variant="outline" size="sm" onClick={() => setEditSchedule([
                  { id: `SC-${Date.now()}-1`, time: "15:00", label: "Get-in" },
                  { id: `SC-${Date.now()}-2`, time: "16:00", label: "Soundcheck" },
                  { id: `SC-${Date.now()}-3`, time: "19:00", label: "Doors" },
                  { id: `SC-${Date.now()}-4`, time: "20:00", label: "Show" },
                  { id: `SC-${Date.now()}-5`, time: "23:00", label: "Curfew" },
                ])}>
                  Load Defaults
                </Button>
              )}
              {event.hostProfileId && (
                <SectionTemplateMenu
                  profileId={event.hostProfileId}
                  category="schedules"
                  currentData={editSchedule.map(s => ({ time: s.time, label: s.label, description: s.description }))}
                  onLoad={(data) => {
                    const items = (data as { time: string; label: string; description?: string }[]).map((s, i) => ({
                      id: `SC-${Date.now()}-${i}`, time: s.time, label: s.label, description: s.description,
                    }));
                    setEditSchedule(items);
                  }}
                />
              )}
            </div>
          </div>
        }
      >
        {schedule.length === 0 ? (
          <p className="text-sm text-muted-foreground">No schedule added yet.</p>
        ) : (() => {
          const hasRooms = schedule.some(s => s.roomStage);
          if (!hasRooms) {
            return (
              <div className="relative">
                <div className="absolute left-[52px] top-2 bottom-2 w-px bg-border" />
                <div className="space-y-3">
                  {schedule.map((item) => (
                    <div key={item.id} className="flex items-start gap-4">
                      <span className="text-sm font-mono font-semibold text-muted-foreground w-12 text-right shrink-0">{item.time || "—"}</span>
                      <div className="h-2.5 w-2.5 rounded-full bg-primary mt-1.5 shrink-0 relative z-10" />
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium">{item.label}</p>
                          {item.roomStage && <Badge variant="outline" className="text-[10px] px-1.5 py-0">{item.roomStage}</Badge>}
                        </div>
                        {item.description && <p className="text-xs text-muted-foreground">{item.description}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          }
          const rooms = [...new Set(schedule.map(s => s.roomStage || "General"))];
          return (
            <div className="space-y-4">
              {rooms.map(room => (
                <div key={room}>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{room}</p>
                  <div className="relative pl-1">
                    <div className="absolute left-[52px] top-2 bottom-2 w-px bg-border" />
                    <div className="space-y-3">
                      {schedule.filter(s => (s.roomStage || "General") === room).map((item) => (
                        <div key={item.id} className="flex items-start gap-4">
                          <span className="text-sm font-mono font-semibold text-muted-foreground w-12 text-right shrink-0">{item.time || "—"}</span>
                          <div className="h-2.5 w-2.5 rounded-full bg-primary mt-1.5 shrink-0 relative z-10" />
                          <div>
                            <p className="text-sm font-medium">{item.label}</p>
                            {item.description && <p className="text-xs text-muted-foreground">{item.description}</p>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          );
        })()}
      </EditableSection>

      {/* Amenities */}
      <EditableSection
        title="Amenities"
        icon={<Shield className="h-5 w-5 text-primary" />}
        readOnly={readOnly}
        onEditStart={() => {
          setEditAmenities([...amenities]);
          setEditCateringNotes(cateringNotes);
          setEditAccommodationNotes(accommodationNotes);
          setNewCustomAmenity("");
          // Autofill from venue profile if empty
          if (amenities.length === 0) {
            const hostProfile = event.hostProfileId ? Object.values(profiles).find(p => p.id === event.hostProfileId) : undefined;
            const venueProfile = hostProfile?.role === "venue" ? hostProfile : Object.values(profiles).find(p => p.role === "venue" && p.name === event.venue);
            if (venueProfile?.amenities && venueProfile.amenities.length > 0) {
              setEditAmenities(venueProfile.amenities);
            }
            if (!cateringNotes && venueProfile?.cateringNotes) {
              setEditCateringNotes(venueProfile.cateringNotes);
            }
            if (!accommodationNotes && venueProfile?.accommodationNotes) {
              setEditAccommodationNotes(venueProfile.accommodationNotes);
            }
          }
        }}
        onSave={() => {
          setAmenities([...editAmenities]);
          setCateringNotes(editCateringNotes);
          setAccommodationNotes(editAccommodationNotes);
        }}
        editContent={
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {(Object.entries(amenityLabels) as [AmenityKey, string][]).map(([key, label]) => {
                const checked = editAmenities.includes(key);
                return (
                  <div key={key} className="space-y-1">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <Checkbox checked={checked} onCheckedChange={(c) => {
                        if (c) setEditAmenities([...editAmenities, key]);
                        else setEditAmenities(editAmenities.filter(a => a !== key));
                      }} />
                      <span className="text-sm">{label}</span>
                    </label>
                    {key === "catering" && checked && (
                      <Textarea
                        value={editCateringNotes}
                        onChange={(e) => setEditCateringNotes(e.target.value)}
                        placeholder="Catering details (e.g. dietary restrictions, meal times)..."
                        rows={2}
                        className="ml-6 text-xs"
                      />
                    )}
                    {key === "accommodation" && checked && (
                      <Textarea
                        value={editAccommodationNotes}
                        onChange={(e) => setEditAccommodationNotes(e.target.value)}
                        placeholder="Accommodation details (e.g. hotel, room counts)..."
                        rows={2}
                        className="ml-6 text-xs"
                      />
                    )}
                  </div>
                );
              })}
            </div>
            {/* Custom amenities */}
            <div>
              <div className="flex gap-2">
                <Input
                  value={newCustomAmenity}
                  onChange={(e) => setNewCustomAmenity(e.target.value)}
                  placeholder="Add custom amenity"
                  className="max-w-xs"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newCustomAmenity.trim()) {
                      e.preventDefault();
                      setEditAmenities(addCustomAmenity(editAmenities, newCustomAmenity));
                      setNewCustomAmenity("");
                    }
                  }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (!newCustomAmenity.trim()) return;
                    setEditAmenities(addCustomAmenity(editAmenities, newCustomAmenity));
                    setNewCustomAmenity("");
                  }}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              {(() => {
                const { custom } = partitionAmenities(editAmenities);
                if (custom.length === 0) return null;
                return (
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {custom.map((am) => (
                      <Badge key={am} variant="outline" className="text-xs gap-1">
                        {am}
                        <button
                          type="button"
                          onClick={() => setEditAmenities(editAmenities.filter(a => a !== am))}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>
        }
      >
        {amenities.length === 0 && !cateringNotes && !accommodationNotes ? (
          <p className="text-sm text-muted-foreground">No amenities specified.</p>
        ) : (
          <div className="space-y-3">
            {amenities.length > 0 && (() => {
              const { standard, custom } = partitionAmenities(amenities);
              return (
                <div className="flex flex-wrap gap-2">
                  {standard.map((a) => (
                    <Badge key={a} variant="secondary" className="text-sm py-1 px-3">{amenityLabels[a]}</Badge>
                  ))}
                  {custom.map((a) => (
                    <Badge key={a} variant="outline" className="text-sm py-1 px-3">{a}</Badge>
                  ))}
                </div>
              );
            })()}
            {cateringNotes && (
              <div className="text-sm">
                <span className="font-medium">Catering: </span>
                <span className="text-muted-foreground whitespace-pre-wrap">{cateringNotes}</span>
              </div>
            )}
            {accommodationNotes && (
              <div className="text-sm">
                <span className="font-medium">Accommodation: </span>
                <span className="text-muted-foreground whitespace-pre-wrap">{accommodationNotes}</span>
              </div>
            )}
          </div>
        )}
      </EditableSection>

      {/* Guest List */}
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display text-lg font-semibold flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" /> Guest List
          </h3>
          {!readOnly && guestList && guestList.guests.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5">
                  <Share2 className="h-3.5 w-3.5" /> Share / Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => {
                  const totalTickets = guestList.guests.reduce((s, g) => s + g.tickets, 0);
                  const lines = [
                    `Guest List — ${event.name}`,
                    `Date: ${event.date} | Venue: ${event.venue}`,
                    `Total: ${guestList.guests.length} guests, ${totalTickets} tickets${guestList.totalTicketLimit > 0 ? ` / ${guestList.totalTicketLimit} limit` : ""}`,
                    "",
                    "Name,Tickets,Inviting Party",
                    ...guestList.guests.map(g => `${g.name},${g.tickets},${g.invitingParty}`),
                  ];
                  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url; a.download = `guest-list-${event.id}.csv`; a.click();
                  URL.revokeObjectURL(url);
                  toast({ title: "Guest list exported as CSV" });
                }}>
                  <Download className="h-4 w-4 mr-2" /> Export CSV
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => {
                  const totalTickets = guestList.guests.reduce((s, g) => s + g.tickets, 0);
                  const lines = [
                    `Guest List — ${event.name}`,
                    `Date: ${event.date} | Venue: ${event.venue}`,
                    `Total: ${guestList.guests.length} guests, ${totalTickets} tickets${guestList.totalTicketLimit > 0 ? ` / ${guestList.totalTicketLimit} limit` : ""}`,
                    "",
                    ...guestList.guests.map((g, i) => `${i + 1}. ${g.name} — ${g.tickets} ticket${g.tickets !== 1 ? "s" : ""} (${g.invitingParty})`),
                  ];
                  navigator.clipboard.writeText(lines.join("\n"));
                  copyToast("Guest list copied to clipboard");
                }}>
                  <Copy className="h-4 w-4 mr-2" /> Copy to Clipboard
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => {
                  const totalTickets = guestList.guests.reduce((s, g) => s + g.tickets, 0);
                  const printWin = window.open("", "_blank");
                  if (!printWin) return;
                  printWin.document.write(`
                    <html><head><title>Guest List — ${event.name}</title>
                    <style>
                      body { font-family: Arial, sans-serif; padding: 40px; color: #222; }
                      h1 { font-size: 20px; margin-bottom: 4px; }
                      .meta { font-size: 13px; color: #666; margin-bottom: 20px; }
                      table { width: 100%; border-collapse: collapse; }
                      th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #ddd; font-size: 14px; }
                      th { background: #f5f5f5; font-weight: 600; }
                      .summary { margin-top: 16px; font-size: 13px; color: #666; }
                    </style></head><body>
                    <h1>Guest List — ${event.name}</h1>
                    <div class="meta">${event.date} · ${event.venue}</div>
                    <table>
                      <thead><tr><th>#</th><th>Guest Name</th><th>Tickets</th><th>Inviting Party</th></tr></thead>
                      <tbody>
                        ${guestList.guests.map((g, i) => `<tr><td>${i + 1}</td><td>${g.name}</td><td>${g.tickets}</td><td>${g.invitingParty}</td></tr>`).join("")}
                      </tbody>
                    </table>
                    <div class="summary">${guestList.guests.length} guests · ${totalTickets} tickets${guestList.totalTicketLimit > 0 ? ` / ${guestList.totalTicketLimit} limit` : ""}</div>
                    </body></html>
                  `);
                  printWin.document.close();
                  printWin.print();
                }}>
                  <FileText className="h-4 w-4 mr-2" /> Print
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        {!guestList ? (
          readOnly ? (
            <p className="text-sm text-muted-foreground">No guest list added yet.</p>
          ) : (
            <Button variant="outline" onClick={() => setGuestList({ totalTicketLimit: 0, perGuestTicketLimit: 0, guests: [] })}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Add Guest List
            </Button>
          )
        ) : readOnly ? (
          <div className="space-y-3">
            <div className="text-xs text-muted-foreground font-medium">
              {guestList.guests.length} guest{guestList.guests.length !== 1 ? "s" : ""}, {guestList.guests.reduce((s, g) => s + g.tickets, 0)} ticket{guestList.guests.reduce((s, g) => s + g.tickets, 0) !== 1 ? "s" : ""} total
              {guestList.totalTicketLimit > 0 && ` / ${guestList.totalTicketLimit} limit`}
            </div>
            {guestList.guests.length > 0 && (
              <div className="space-y-2">
                {guestList.guests.map((guest) => (
                  <div key={guest.id} className="flex items-center justify-between rounded-lg border p-2 text-sm">
                    <span className="font-medium">{guest.name}</span>
                    <span className="text-muted-foreground">{guest.tickets} ticket{guest.tickets !== 1 ? "s" : ""} ({guest.invitingParty})</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (() => {
          const totalTickets = guestList.guests.reduce((s, g) => s + g.tickets, 0);
          const INVITING_PARTIES = ["Performer", "Venue", "Promoter", "Agent", "Other"];
          return (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label className="text-xs">Limit list to total tickets</Label>
                  <NumberInput value={guestList.totalTicketLimit || ""} onChange={e => setGuestList({ ...guestList, totalTicketLimit: parseInt(e.target.value) || 0 })} placeholder="0 = no limit" className="h-9" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Limit tickets per guest</Label>
                  <NumberInput value={guestList.perGuestTicketLimit || ""} onChange={e => setGuestList({ ...guestList, perGuestTicketLimit: parseInt(e.target.value) || 0 })} placeholder="0 = no limit" className="h-9" />
                </div>
              </div>
              <div className="text-xs text-muted-foreground font-medium">
                {guestList.guests.length} guest{guestList.guests.length !== 1 ? "s" : ""}, {totalTickets} ticket{totalTickets !== 1 ? "s" : ""} total
                {guestList.totalTicketLimit > 0 && ` / ${guestList.totalTicketLimit} limit`}
                {guestList.totalTicketLimit > 0 && totalTickets > guestList.totalTicketLimit && (
                  <span className="text-destructive ml-2">⚠ Over limit!</span>
                )}
              </div>
              <div className="space-y-2">
                {guestList.guests.map((guest, i) => (
                  <div key={guest.id} className="flex items-center gap-2 rounded-lg border p-2">
                    <Input
                      value={guest.name}
                      onChange={e => {
                        const g = [...guestList.guests]; g[i] = { ...g[i], name: e.target.value };
                        setGuestList({ ...guestList, guests: g });
                      }}
                      placeholder="Guest name"
                      className="flex-1 h-8 text-sm"
                    />
                    <div className="flex items-center gap-1">
                      <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => {
                        const newVal = Math.max(0, guest.tickets - 1);
                        const g = [...guestList.guests]; g[i] = { ...g[i], tickets: newVal };
                        setGuestList({ ...guestList, guests: g });
                      }}>-</Button>
                      <NumberInput
                        value={guest.tickets}
                        onChange={e => {
                          let val = parseInt(e.target.value) || 0;
                          if (guestList.perGuestTicketLimit > 0) val = Math.min(val, guestList.perGuestTicketLimit);
                          const g = [...guestList.guests]; g[i] = { ...g[i], tickets: val };
                          setGuestList({ ...guestList, guests: g });
                        }}
                        className="w-14 h-8 text-sm text-center"
                      />
                      <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => {
                        let newVal = guest.tickets + 1;
                        if (guestList.perGuestTicketLimit > 0) newVal = Math.min(newVal, guestList.perGuestTicketLimit);
                        const g = [...guestList.guests]; g[i] = { ...g[i], tickets: newVal };
                        setGuestList({ ...guestList, guests: g });
                      }}>+</Button>
                    </div>
                    <Select value={guest.invitingParty} onValueChange={v => {
                      const g = [...guestList.guests]; g[i] = { ...g[i], invitingParty: v };
                      setGuestList({ ...guestList, guests: g });
                    }}>
                      <SelectTrigger className="w-28 h-8 text-xs"><SelectValue placeholder="Party" /></SelectTrigger>
                      <SelectContent>
                        {INVITING_PARTIES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => {
                      setGuestList({ ...guestList, guests: guestList.guests.filter((_, j) => j !== i) });
                    }}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
              <Button variant="outline" size="sm" onClick={() => {
                const newGuest: GuestEntry = { id: `G-${Date.now()}`, name: "", tickets: 1, invitingParty: "Promoter" };
                setGuestList({ ...guestList, guests: [...guestList.guests, newGuest] });
              }}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Add Guest
              </Button>
            </div>
          );
        })()}
      </div>

      {deal && !event.isMultiPerformer && (
        <EditableSection
          title="Financial Deal"
          icon={<DollarSign className="h-5 w-5 text-primary" />}
          readOnly={readOnly}
          onEditStart={() => setEditDeal({ ...deal })}
          onSave={() => {
            if (editDeal) {
              updateDeal(event.id, editDeal);
              // Reset agreement confirmations when deal terms change
              if (eventMeta.agreementConfirmations?.length) {
                onSave?.({ agreementConfirmations: [], agreementLastChangedAt: new Date().toISOString() });
                toast({ title: "Approvals reset", description: "The financial deal was changed — all parties need to re-confirm the agreement." });
              }
            }
          }}
          saveDisabled={editDeal ? (() => {
            const revSplitApplies = editDeal.dealType !== "guarantee" && editDeal.dealType !== "rental";
            const revSplitBad = revSplitApplies && (editDeal.artistSplit + editDeal.promoterSplit + editDeal.venueSplit + (editDeal.organizerSplit || 0)) !== 100;
            const costSplitActive = (editDeal.artistCostSplit || 0) > 0 || editDeal.promoterCostSplit > 0 || editDeal.venueCostSplit > 0 || (editDeal.organizerCostSplit || 0) > 0;
            const costSplitBad = costSplitActive && ((editDeal.artistCostSplit || 0) + editDeal.promoterCostSplit + editDeal.venueCostSplit + (editDeal.organizerCostSplit || 0)) !== 100;
            return revSplitBad || costSplitBad;
          })() : false}
          editContent={editDeal ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-3">
                <div>
                  <Label className={cn(event.eventStatus === "confirmed" && "text-muted-foreground")}>Deal Type</Label>
                  <Select value={editDeal.dealType} onValueChange={(v) => setEditDeal({...editDeal, dealType: v as DealType})} disabled={event.eventStatus === "confirmed"}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="guarantee">Guarantee</SelectItem>
                      <SelectItem value="door_split">Door Split</SelectItem>
                      <SelectItem value="guarantee_vs_door">Guarantee vs Door</SelectItem>
                      <SelectItem value="rental">Rental</SelectItem>
                    </SelectContent>
                  </Select>
                  {event.eventStatus === "confirmed" && (
                    <p className="text-xs text-muted-foreground mt-1">Locked because the event is confirmed. Re-open the agreement to change deal type.</p>
                  )}
                </div>
                <div>
                  <Label className={cn(!(editDeal.dealType === "guarantee" || editDeal.dealType === "guarantee_vs_door") && "text-muted-foreground")}>Performer Guarantee ({getCurrencySymbol(currency)})</Label>
                  <Input
                    type="number"
                    value={editDeal.artistGuarantee}
                    onChange={(e) => setEditDeal({...editDeal, artistGuarantee: parseFloat(e.target.value) || 0})}
                    className="mt-1"
                    disabled={!(editDeal.dealType === "guarantee" || editDeal.dealType === "guarantee_vs_door")}
                  />
                  {!(editDeal.dealType === "guarantee" || editDeal.dealType === "guarantee_vs_door") && (
                    <p className="text-xs text-muted-foreground mt-1">Only for Guarantee or Guarantee vs Door deals</p>
                  )}
                </div>
                <div>
                  <Label className={cn((editDeal.dealType === "guarantee" || editDeal.dealType === "rental") && "text-muted-foreground")}>Revenue Split (must total 100%)</Label>
                  {(editDeal.dealType === "guarantee" || editDeal.dealType === "rental") && (
                    <p className="text-xs text-muted-foreground mt-0.5">Revenue split is not applicable for {editDeal.dealType === "guarantee" ? "Guarantee" : "Rental"} deals</p>
                  )}
                  <div className="grid grid-cols-4 gap-2 mt-1">
                    <div><Label className="text-xs text-muted-foreground">Performer %</Label><NumberInput value={editDeal.artistSplit} onChange={(e) => setEditDeal({...editDeal, artistSplit: parseFloat(e.target.value) || 0})} className="mt-1" disabled={editDeal.dealType === "guarantee" || editDeal.dealType === "rental"} /></div>
                    <div><Label className="text-xs text-muted-foreground">Promoter %</Label><NumberInput value={editDeal.promoterSplit} onChange={(e) => setEditDeal({...editDeal, promoterSplit: parseFloat(e.target.value) || 0})} className="mt-1" disabled={editDeal.dealType === "guarantee" || editDeal.dealType === "rental"} /></div>
                    <div><Label className="text-xs text-muted-foreground">Venue %</Label><NumberInput value={editDeal.venueSplit} onChange={(e) => setEditDeal({...editDeal, venueSplit: parseFloat(e.target.value) || 0})} className="mt-1" disabled={editDeal.dealType === "guarantee" || editDeal.dealType === "rental"} /></div>
                    <div><Label className="text-xs text-muted-foreground">Organizer %</Label><NumberInput value={editDeal.organizerSplit || 0} onChange={(e) => setEditDeal({...editDeal, organizerSplit: parseFloat(e.target.value) || 0})} className="mt-1" disabled={editDeal.dealType === "guarantee" || editDeal.dealType === "rental"} /></div>
                  </div>
                  {!(editDeal.dealType === "guarantee" || editDeal.dealType === "rental") && (editDeal.artistSplit + editDeal.promoterSplit + editDeal.venueSplit + (editDeal.organizerSplit || 0)) !== 100 && (
                    <p className="text-xs text-destructive mt-1">Split total: {editDeal.artistSplit + editDeal.promoterSplit + editDeal.venueSplit + (editDeal.organizerSplit || 0)}% — must equal 100%</p>
                  )}
                </div>
                <div>
                  {(editDeal.artistCostSplit || 0) === 0 && editDeal.promoterCostSplit === 0 && editDeal.venueCostSplit === 0 && (editDeal.organizerCostSplit || 0) === 0 ? (
                    <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setEditDeal({...editDeal, artistCostSplit: 0, promoterCostSplit: 50, venueCostSplit: 50, organizerCostSplit: 0})}>
                      <Plus className="h-3.5 w-3.5" /> Add Production Costs Split
                    </Button>
                  ) : (
                    <>
                      <div className="flex items-center justify-between">
                        <Label>Production Costs Split — Performer / Promoter / Venue / Organizer (must total 100%)</Label>
                        <Button variant="ghost" size="sm" className="h-6 text-xs text-destructive" onClick={() => setEditDeal({...editDeal, artistCostSplit: 0, promoterCostSplit: 0, venueCostSplit: 0, organizerCostSplit: 0})}>
                          <X className="h-3 w-3 mr-1" /> Remove
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">How agreed upon production costs are shared. Additional costs (if any) are to be agreed upon and settled in the settlement stage.</p>
                      <div className="grid grid-cols-4 gap-2 mt-1">
                        <div><Label className="text-xs text-muted-foreground">Performer %</Label><NumberInput value={editDeal.artistCostSplit || 0} onChange={(e) => setEditDeal({...editDeal, artistCostSplit: parseFloat(e.target.value) || 0})} className="mt-1" /></div>
                        <div><Label className="text-xs text-muted-foreground">Promoter %</Label><NumberInput value={editDeal.promoterCostSplit} onChange={(e) => setEditDeal({...editDeal, promoterCostSplit: parseFloat(e.target.value) || 0})} className="mt-1" /></div>
                        <div><Label className="text-xs text-muted-foreground">Venue %</Label><NumberInput value={editDeal.venueCostSplit} onChange={(e) => setEditDeal({...editDeal, venueCostSplit: parseFloat(e.target.value) || 0})} className="mt-1" /></div>
                        <div><Label className="text-xs text-muted-foreground">Organizer %</Label><NumberInput value={editDeal.organizerCostSplit || 0} onChange={(e) => setEditDeal({...editDeal, organizerCostSplit: parseFloat(e.target.value) || 0})} className="mt-1" /></div>
                      </div>
                      {((editDeal.artistCostSplit || 0) + editDeal.promoterCostSplit + editDeal.venueCostSplit + (editDeal.organizerCostSplit || 0)) !== 100 && (
                        <p className="text-xs text-destructive mt-1">Cost split total: {(editDeal.artistCostSplit || 0) + editDeal.promoterCostSplit + editDeal.venueCostSplit + (editDeal.organizerCostSplit || 0)}% — must equal 100%</p>
                      )}
                    </>
                  )}
                </div>
                <div>
                  <Label>Venue Rental ({getCurrencySymbol(currency)})</Label>
                  <NumberInput value={editDeal.venueRental} onChange={(e) => setEditDeal({...editDeal, venueRental: parseFloat(e.target.value) || 0})} className="mt-1" />
                </div>
                <div>
                  <Label>Venue Rental Paid By</Label>
                  <Select value={editDeal.venueRentalPaidBy || "promoter"} onValueChange={v => setEditDeal({...editDeal, venueRentalPaidBy: v})}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="promoter">Promoter</SelectItem>
                      <SelectItem value="performer">Performer</SelectItem>
                      <SelectItem value="organizer">Organizer</SelectItem>
                      <SelectItem value="split">Split (by prod cost split)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {editDeal.venueRental > 0 && (
                  <div className="col-span-2 space-y-2">
                    <Label className="text-xs font-semibold text-muted-foreground">Venue Rental Payment</Label>
                    <div className="flex flex-col gap-2">
                      <label className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="radio"
                          name="venueRentalPaymentMode"
                          checked={(editDeal.venueRentalPaymentMode || "deduct_at_settlement") === "deduct_at_settlement"}
                          onChange={() => setEditDeal({...editDeal, venueRentalPaymentMode: "deduct_at_settlement"})}
                          className="accent-primary"
                        />
                        Deduct rental fee at settlement
                        <span className="text-xs text-muted-foreground">(auto-added as deduction)</span>
                      </label>
                      <label className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="radio"
                          name="venueRentalPaymentMode"
                          checked={editDeal.venueRentalPaymentMode === "request_now"}
                          onChange={() => setEditDeal({...editDeal, venueRentalPaymentMode: "request_now"})}
                          className="accent-primary"
                        />
                        Request payment now
                        <span className="text-xs text-muted-foreground">(via Mollie)</span>
                      </label>
                      {editDeal.venueRentalPaymentMode === "request_now" && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-fit mt-1 gap-1.5"
                          onClick={() => toast({ title: "Payment request sent", description: `Mollie payment request for ${formatCurrency(editDeal.venueRental, currency)} has been sent to the paying party.` })}
                        >
                          <CreditCard className="h-3.5 w-3.5" /> Send Payment Request via Mollie
                        </Button>
                      )}
                    </div>
                  </div>
                )}

                {/* Performance Bonus — only for split deals */}
                {(editDeal.dealType === "door_split" || editDeal.dealType === "guarantee_vs_door") && (
                  <div className="space-y-2 pt-2 border-t">
                    <Label className="font-semibold">Performance Bonus</Label>
                    <p className="text-xs text-muted-foreground -mt-1">Additional bonus paid to performer when total revenue exceeds a threshold</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs">Revenue Threshold ({currency})</Label>
                        <NumberInput value={editDeal.performanceBonusThreshold || 0} onChange={(e) => setEditDeal({...editDeal, performanceBonusThreshold: parseFloat(e.target.value) || 0})} className="mt-1" />
                      </div>
                      <div>
                        <Label className="text-xs">Bonus Amount ({currency})</Label>
                        <NumberInput value={editDeal.performanceBonusAmount || 0} onChange={(e) => setEditDeal({...editDeal, performanceBonusAmount: parseFloat(e.target.value) || 0})} className="mt-1" />
                      </div>
                    </div>
                  </div>
                )}
              </div>
              {readOnly && isPerformerOperator && (
              <div className="space-y-3">
                <Label className="font-semibold">Commissions from Performer Share</Label>
                <p className="text-xs text-muted-foreground -mt-1">Booker/Agent fee always deducted from artist revenue</p>
                {editDeal.commissions.map((c, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input value={c.label} onChange={(e) => { const comms = [...editDeal.commissions]; comms[i] = {...comms[i], label: e.target.value}; setEditDeal({...editDeal, commissions: comms}); }} placeholder="Label" className="flex-1" />
                    <Input value={c.name} onChange={(e) => { const comms = [...editDeal.commissions]; comms[i] = {...comms[i], name: e.target.value}; setEditDeal({...editDeal, commissions: comms}); }} placeholder="Name" className="flex-1" />
                    <NumberInput value={c.percentage} onChange={(e) => { const comms = [...editDeal.commissions]; comms[i] = {...comms[i], percentage: parseFloat(e.target.value) || 0}; setEditDeal({...editDeal, commissions: comms}); }} className="w-20" />
                    <span className="text-sm text-muted-foreground">%</span>
                    <Button variant="ghost" size="icon" onClick={() => setEditDeal({...editDeal, commissions: editDeal.commissions.filter((_, j) => j !== i)})}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={() => setEditDeal({...editDeal, commissions: [...editDeal.commissions, { key: `comm-${Date.now()}`, label: "", name: "", percentage: 0 }]})}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add Commission
                </Button>
              </div>
              )}
            </div>
          ) : null}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h4 className="text-sm font-semibold mb-2">Deal Structure</h4>
              <div className="space-y-2">
                <div className="flex justify-between text-sm"><span className="text-muted-foreground">Deal Type</span><span className="font-medium capitalize">{deal.dealType.replace(/_/g, " ")}</span></div>
                {(deal.dealType === "guarantee" || deal.dealType === "guarantee_vs_door") && deal.artistGuarantee > 0 && (
                  <div className="flex justify-between text-sm"><span className="text-muted-foreground">Performer Guarantee</span><span className="font-semibold">{formatCurrency(deal.artistGuarantee, currency)}</span></div>
                )}
                {deal.dealType !== "guarantee" && deal.dealType !== "rental" && (
                  <div className="flex justify-between text-sm"><span className="text-muted-foreground">Revenue Split (A/P/V/O)</span><span className="font-medium">{deal.artistSplit}% / {deal.promoterSplit}% / {deal.venueSplit}%{(deal.organizerSplit || 0) > 0 ? ` / ${deal.organizerSplit}%` : ""}</span></div>
                )}
                {(deal.artistCostSplit > 0 || deal.promoterCostSplit > 0 || deal.venueCostSplit > 0 || (deal.organizerCostSplit || 0) > 0) && (
                  <div className="flex justify-between text-sm"><span className="text-muted-foreground">Production Costs Split (A/P/V/O)</span><span className="font-medium">{deal.artistCostSplit || 0}% / {deal.promoterCostSplit}% / {deal.venueCostSplit}%{(deal.organizerCostSplit || 0) > 0 ? ` / ${deal.organizerCostSplit}%` : ""}</span></div>
                )}
                {deal.venueRental > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Venue Rental</span>
                    <span className="font-semibold">
                      {formatCurrency(deal.venueRental, currency)}
                      <span className="text-xs text-muted-foreground ml-1">
                        (paid by {(deal.venueRentalPaidBy || "promoter").replace("split", "split by prod cost")})
                      </span>
                      <span className="text-xs ml-1">
                        {deal.venueRentalPaymentMode === "request_now"
                          ? <Badge variant="outline" className="text-[10px] py-0 px-1 ml-1">Mollie request</Badge>
                          : <Badge variant="secondary" className="text-[10px] py-0 px-1 ml-1">Deducted at settlement</Badge>
                        }
                      </span>
                    </span>
                  </div>
                )}
                {deal.performanceBonusThreshold && deal.performanceBonusAmount ? (
                  <div className="flex justify-between text-sm"><span className="text-muted-foreground">Performance Bonus</span><span className="font-medium">{formatCurrency(deal.performanceBonusAmount, currency)} when revenue exceeds {formatCurrency(deal.performanceBonusThreshold, currency)}</span></div>
                ) : null}
              </div>
            </div>
            {readOnly && isPerformerOperator && (
            <div>
              <h4 className="text-sm font-semibold mb-2">Commissions from Performer Share</h4>
              {deal.commissions.length === 0 ? (
                <p className="text-sm text-muted-foreground">No commissions configured.</p>
              ) : (
                <div className="space-y-2">
                  {deal.commissions.map((c: CommissionParty) => (
                    <div key={c.key} className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{c.label} ({c.name})</span>
                      <span className="font-medium">{c.percentage}%</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            )}
          </div>
        </EditableSection>
      )}

      {/* Editable Ticket Information */}
      {revenue && (
        <EditableSection
          title="Ticket Information"
          icon={<Ticket className="h-5 w-5 text-primary" />}
          readOnly={readOnly}
          onEditStart={() => setEditTicketTypes(revenue.ticketTypes ? [...revenue.ticketTypes] : [])}
          onSave={() => {
            const totalSold = editTicketTypes.reduce((s, t) => s + t.sold, 0);
            const totalRev = editTicketTypes.reduce((s, t) => s + t.price * t.sold, 0);
            updateRevenue(event.id, { ...revenue, ticketTypes: editTicketTypes, ticketsSold: totalSold, grossRevenue: totalRev });
          }}
          editContent={
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                <span className="flex-1">Type name</span>
                <span className="w-28 text-center">Price</span>
                <span className="w-24 text-center">Expected sold</span>
                <span className="w-8" />
              </div>
              {editTicketTypes.map((tt, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input value={tt.name} onChange={(e) => { const t = [...editTicketTypes]; t[i] = {...t[i], name: e.target.value}; setEditTicketTypes(t); }} placeholder="Type name" className="flex-1" />
                  <NumberInput value={tt.price} onChange={(e) => { const t = [...editTicketTypes]; t[i] = {...t[i], price: parseFloat(e.target.value) || 0}; setEditTicketTypes(t); }} placeholder="Price" className="w-28" />
                  <NumberInput value={tt.sold} onChange={(e) => { const t = [...editTicketTypes]; t[i] = {...t[i], sold: parseInt(e.target.value) || 0}; setEditTicketTypes(t); }} placeholder="Expected sold" className="w-24" />
                  <Button variant="ghost" size="icon" onClick={() => setEditTicketTypes(editTicketTypes.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={() => setEditTicketTypes([...editTicketTypes, { name: "", price: 0, sold: 0 }])}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Add Ticket Type
              </Button>
            </div>
          }
        >
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <div className="rounded-lg bg-muted/50 p-3"><p className="text-xs text-muted-foreground">Tickets Sold</p><p className="text-lg font-bold font-display">{(revenue?.ticketsSold ?? 0).toLocaleString()}</p></div>
            <div className="rounded-lg bg-muted/50 p-3"><p className="text-xs text-muted-foreground">Gross Revenue</p><p className="text-lg font-bold font-display">{formatCurrency(revenue.grossRevenue, currency)}</p></div>
            <div className="rounded-lg bg-muted/50 p-3"><p className="text-xs text-muted-foreground">Door Sales</p><p className="text-lg font-bold font-display">{formatCurrency(revenue.doorSales, currency)}</p></div>
            <div className="rounded-lg bg-muted/50 p-3"><p className="text-xs text-muted-foreground">Net Revenue</p><p className="text-lg font-bold font-display">{formatCurrency(netRev, currency)}</p></div>
          </div>
          {revenue.ticketTypes && revenue.ticketTypes.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold mb-2">Ticket Types</h4>
              <div className="rounded-lg border overflow-hidden">
                <table className="w-full text-sm">
                  <thead><tr className="bg-muted/30 border-b"><th className="px-4 py-2 text-left text-xs font-semibold text-muted-foreground">Type</th><th className="px-4 py-2 text-right text-xs font-semibold text-muted-foreground">Price</th><th className="px-4 py-2 text-right text-xs font-semibold text-muted-foreground">Expected sold</th><th className="px-4 py-2 text-right text-xs font-semibold text-muted-foreground">Revenue</th></tr></thead>
                  <tbody className="divide-y">
                    {revenue.ticketTypes.map((tt: TicketType) => (
                      <tr key={tt.name}><td className="px-4 py-2 font-medium">{tt.name}</td><td className="px-4 py-2 text-right">{formatCurrency(tt.price, currency)}</td><td className="px-4 py-2 text-right">{tt.sold.toLocaleString()}</td><td className="px-4 py-2 text-right font-semibold">{formatCurrency(tt.price * tt.sold, currency)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </EditableSection>
      )}

      {/* Double Booking Confirmation */}
      <AlertDialog open={doubleBookingOpen} onOpenChange={setDoubleBookingOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>⚠️ Double Booking Warning</AlertDialogTitle>
            <AlertDialogDescription>
              {doubleBookingConflicts.length === 1
                ? `"${doubleBookingConflicts[0]}" is already scheduled on this date.`
                : `${doubleBookingConflicts.map(n => `"${n}"`).join(", ")} are already scheduled on this date.`}
              {" "}Are you sure you want to proceed?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              if (pendingEditEvent) updateEvent(event.id, pendingEditEvent);
              setDoubleBookingOpen(false);
              setPendingEditEvent(null);
            }}>Proceed Anyway</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Date Change Confirmation */}
      <AlertDialog open={dateChangeConfirmOpen} onOpenChange={setDateChangeConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Propose date change?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  Changing the date, start time, or end time requires confirmation from the other parties on this event. The current date will remain active until all parties have confirmed.
                </p>
                <div className="rounded-lg border bg-muted/30 p-3 space-y-1">
                  <p className="text-xs font-medium text-foreground">Confirmation needed from:</p>
                  {dateChangePartyNames.map((name) => (
                    <p key={name} className="text-sm text-foreground">{name}</p>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  The other parties will see a banner in the event and an action item in their task list. If they decline, you will be notified.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              if (pendingDateEditEvent) commitEventSave(pendingDateEditEvent);
              setDateChangeConfirmOpen(false);
              setPendingDateEditEvent(null);
            }}>Propose change</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Add Performer Dialog */}
      <Dialog open={addPerformerOpen} onOpenChange={setAddPerformerOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Performer</DialogTitle>
            <DialogDescription>
              Creates a child event for this performer and links it to the multi-performer parent.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <PerformerFormFields
              values={{
                artistName: newPerformerName,
                performerProfileId: newPerformerProfileId,
                performerRoleTag: newPerformerRoleTag,
                stageRoom: newPerformerStage,
                stageCapacity: newPerformerCapacity,
                dealType: newPerformerDealType,
                artistGuarantee: newPerformerGuarantee,
                artistSplit: newPerformerArtistSplit,
                promoterSplit: newPerformerPromoterSplit,
                venueSplit: newPerformerVenueSplit,
              }}
              onChange={(updates) => {
                if (updates.performerProfileId !== undefined && updates.performerProfileId.trim()) {
                  const alreadyInChildren = childEvents?.some(c => c.performerProfileId === updates.performerProfileId);
                  const matchesParent = event.performerProfileId === updates.performerProfileId;
                  if (alreadyInChildren || matchesParent) {
                    toast({ title: "Performer already added", variant: "destructive" });
                    return;
                  }
                }
                if (updates.artistName !== undefined) setNewPerformerName(updates.artistName);
                if (updates.performerProfileId !== undefined) setNewPerformerProfileId(updates.performerProfileId);
                if (updates.performerRoleTag !== undefined) setNewPerformerRoleTag(updates.performerRoleTag);
                if (updates.stageRoom !== undefined) setNewPerformerStage(updates.stageRoom);
                if (updates.stageCapacity !== undefined) setNewPerformerCapacity(updates.stageCapacity);
                if (updates.dealType !== undefined) setNewPerformerDealType(updates.dealType);
                if (updates.artistGuarantee !== undefined) setNewPerformerGuarantee(updates.artistGuarantee);
                if (updates.artistSplit !== undefined) setNewPerformerArtistSplit(updates.artistSplit);
                if (updates.promoterSplit !== undefined) setNewPerformerPromoterSplit(updates.promoterSplit);
                if (updates.venueSplit !== undefined) setNewPerformerVenueSplit(updates.venueSplit);
              }}
              stageOptions={performerStageOptions}
              currency={currency}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddPerformerOpen(false)}>Cancel</Button>
            <Button
              disabled={!newPerformerName.trim()}
              onClick={async () => {
                const name = newPerformerName.trim();
                // Guard against duplicate performer by name
                const nameMatchesParent = event.artist && event.artist.toLowerCase() === name.toLowerCase();
                const nameMatchesChild = childEvents?.some(c => c.artist?.toLowerCase() === name.toLowerCase());
                if (nameMatchesParent || nameMatchesChild) {
                  toast({ title: "Performer already added", variant: "destructive" });
                  return;
                }
                // Guard against duplicate performer by profile ID
                if (newPerformerProfileId) {
                  const profileMatchesParent = event.performerProfileId === newPerformerProfileId;
                  const profileMatchesChild = childEvents?.some(c => c.performerProfileId === newPerformerProfileId);
                  if (profileMatchesParent || profileMatchesChild) {
                    toast({ title: "Performer already added", variant: "destructive" });
                    return;
                  }
                }
                try {
                  if (!event.isMultiPerformer) {
                    await convertToMultiPerformer(event.id);
                  }
                  const childId = `EVT-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
                  const childAccessUids = [...(event.accessUids || [])];
                  const childAccessProfileIds = [...(event.accessProfileIds || [])];
                  if (newPerformerProfileId) {
                    if (!childAccessProfileIds.includes(newPerformerProfileId)) childAccessProfileIds.push(newPerformerProfileId);
                    try {
                      const performerUid = await fetchProfileOwnerUid(newPerformerProfileId);
                      if (performerUid && !childAccessUids.includes(performerUid)) childAccessUids.push(performerUid);
                    } catch { /* non-critical */ }
                  }
                  const childEvent: AppEvent = {
                    id: childId,
                    name: `${event.name} — ${name}`,
                    date: event.date,
                    venue: event.venue,
                    artist: name,
                    operator: event.operator,
                    operatorType: event.operatorType,
                    capacity: parseInt(newPerformerCapacity) || 0,
                    ticketingProvider: event.ticketingProvider,
                    eventStatus: "suggested",
                    status: "open" as SettlementStatus,
                    parentEventId: event.id,
                    childEventIds: [],
                    isMultiPerformer: false,
                    archived: false,
                    published: false,
                    roomStage: newPerformerStage.trim() || undefined,
                    hostProfileId: event.hostProfileId,
                    performerProfileId: newPerformerProfileId || undefined,
                    performerRoleTag: newPerformerRoleTag || undefined,
                    accessUids: childAccessUids,
                    accessProfileIds: childAccessProfileIds,
                  };
                  const childDeal: DealStructure = {
                    eventId: childId,
                    dealType: newPerformerDealType,
                    artistGuarantee: parseInt(newPerformerGuarantee) || 0,
                    artistSplit: parseFloat(newPerformerArtistSplit) || 0,
                    promoterSplit: parseFloat(newPerformerPromoterSplit) || 0,
                    venueSplit: parseFloat(newPerformerVenueSplit) || 0,
                    organizerSplit: 0,
                    artistCostSplit: 0,
                    promoterCostSplit: 0,
                    venueCostSplit: 0,
                    organizerCostSplit: 0,
                    venueRental: 0,
                    commissions: [],
                  };
                  await addChildEvent(event.id, childEvent, childDeal);

                  // Add performer as collaborator on the child event
                  const performerCollaborator: EventCollaborator = {
                    id: `collab-${childId}-performer`,
                    email: "",
                    name,
                    eventRole: "performer",
                    status: "active",
                    invitedAt: new Date().toISOString(),
                    profileId: newPerformerProfileId || undefined,
                  };
                  await addEventCollaborator(childId, performerCollaborator);
                  // Also add to parent event collaborators
                  await addEventCollaborator(event.id, performerCollaborator);

                  const u = getAuthClient().currentUser;
                  const by = u?.displayName || u?.email || "Unknown";
                  appendEventActivity(event.id, "performer_added", by, {
                    performer: name,
                    ...(newPerformerStage.trim() ? { stage: newPerformerStage.trim() } : {}),
                  }, undefined, actingProfile, "operator_only");
                  // Log on the child event so the performer can see it in their changelog
                  appendEventActivity(childId, "status_changed", "System", {
                    from: "—",
                    to: "Suggested",
                  });
                  setNewPerformerName("");
                  setNewPerformerProfileId("");
                  setNewPerformerStage("");
                  setNewPerformerCapacity("");
                  setNewPerformerDealType("guarantee");
                  setNewPerformerGuarantee("");
                  setNewPerformerArtistSplit("70");
                  setNewPerformerPromoterSplit("20");
                  setNewPerformerVenueSplit("10");
                  setAddPerformerOpen(false);
                  toast({ title: "Performer added", description: `${childEvent.artist} has been added to the event.` });
                } catch (err) {
                  console.error(err);
                  toast({
                    title: "Could not add performer",
                    description: err instanceof Error ? err.message : "Firestore write failed. Check rules and your connection.",
                    variant: "destructive",
                  });
                }
              }}
            >
              Add Performer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove Performer Confirmation */}
      <AlertDialog open={!!removePerformerId} onOpenChange={(open) => { if (!open) setRemovePerformerId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Performer</AlertDialogTitle>
            <AlertDialogDescription>Are you sure you want to remove this performer? This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => {
              if (removePerformerId) {
                const removedChild = childEvents?.find(c => c.id === removePerformerId);
                removeChildEvent(event.id, removePerformerId);
                const u = getAuthClient().currentUser;
                const by = u?.displayName || u?.email || "Unknown";
                appendEventActivity(event.id, "performer_removed", by, {
                  performer: removedChild?.artist || "Unknown",
                }, undefined, actingProfile, "operator_only");
                toast({ title: "Performer removed" });
                setRemovePerformerId(null);
              }
            }}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <DocumentPreviewDialog
        open={!!previewDoc}
        onOpenChange={(open) => { if (!open) setPreviewDoc(null); }}
        fileName={previewDoc?.fileName}
        fileUrl={previewDoc?.fileUrl}
      />
    </div>
  );
}
