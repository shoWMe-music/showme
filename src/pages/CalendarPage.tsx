import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import {
  format, startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  addDays, addMonths, subMonths, subDays, addWeeks, subWeeks,
  isSameDay, parseISO, eachDayOfInterval,
} from "date-fns";
import { useSearch } from "@tanstack/react-router";
import AppLayout from "@/components/AppLayout";
import { useUpdateEvent, useHoldRankMutations } from "@/lib/queries/useEventMutations";
import { useCalendarEvents } from "@/lib/queries";

import { useUser } from "@/lib/user-context";
import {
  CalendarItem, CalendarItemType,
  type Event as AppEvent,
} from "@/lib/models";
import CreateEventDialog from "@/components/CreateEventDialog";
import ImportCalendarDialog from "@/components/ImportCalendarDialog";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { trySetPublished } from "@/lib/eventPermissions";
import { fetchProfileUnavailability, saveProfileUnavailability, fetchCalendarItems, fetchProfileCalendarItems, upsertCalendarItem, deleteCalendarItemFromDb } from "@/lib/db";
import InviteCollaboratorDialog from "@/components/InviteCollaboratorDialog";
import ExportEventDialog from "@/components/ExportEventDialog";

import {
  EVENT_STATUS_COLORS,
  CALENDAR_ITEM_COLORS,
  CALENDAR_ENTITY_COLORS,
  ViewMode, PopupItemType, CalendarEntity,
} from "@/components/calendar/calendarConstants";
import type { CalendarTitleDisplay } from "@/components/calendar/CalendarHeader";
import { CalendarItemFormDialog, type ProfileOption, type MemberOption } from "@/components/calendar/CalendarItemFormDialog";
import { CalendarItemPopup } from "@/components/calendar/CalendarItemPopup";
import { ShareAvailabilityDialog } from "@/components/calendar/ShareAvailabilityDialog";
import { MarkRangeDialog } from "@/components/calendar/MarkRangeDialog";
import { EntitySelectorDialog } from "@/components/calendar/EntitySelectorDialog";
import { CalendarMonthView } from "@/components/calendar/CalendarMonthView";
import { CalendarWeekView } from "@/components/calendar/CalendarWeekView";
import { CalendarDayView } from "@/components/calendar/CalendarDayView";
import { CalendarSelectedDatePanel } from "@/components/calendar/CalendarSelectedDatePanel";
import { CalendarQuickCreateMenu } from "@/components/calendar/CalendarQuickCreateMenu";
import { CalendarSidebar } from "@/components/calendar/CalendarSidebar";
import { CalendarHeader } from "@/components/calendar/CalendarHeader";
import { CalendarFilterBar } from "@/components/calendar/CalendarFilterBar";
import { CalendarLegend } from "@/components/calendar/CalendarLegend";

// ── Main Page ──

/**
 * Find sibling on-hold events that should be cancelled when one hold on a
 * date+venue+room is accepted. Pure helper exported for unit testing.
 */
export function findCompetingHolds(events: AppEvent[], accepted: AppEvent): AppEvent[] {
  return events.filter(s =>
    s.id !== accepted.id &&
    s.eventStatus === "on_hold" &&
    s.date === accepted.date &&
    s.venue === accepted.venue &&
    (s.roomStage || "") === (accepted.roomStage || "") &&
    !s.archived,
  );
}

/**
 * Status that an accepted hold should transition to. Bug 1: was previously
 * "confirmed", must be "pending" so the host still confirms.
 */
export const ACCEPTED_HOLD_STATUS = "pending" as const;

export default function CalendarPage() {
  const { date: searchDate } = useSearch({ from: "/calendar" });
  const initialDate = searchDate ? parseISO(searchDate) : new Date();

  const [currentMonth, setCurrentMonth] = useState(initialDate);
  const [selectedDate, setSelectedDate] = useState<Date | null>(searchDate ? initialDate : null);
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const [weekStartDate, setWeekStartDate] = useState(startOfWeek(initialDate, { weekStartsOn: 1 }));
  const [dayViewDate, setDayViewDate] = useState(initialDate);

  // Load events for current month ± 1 month
  const dateFrom = useMemo(() => format(startOfMonth(subMonths(currentMonth, 1)), "yyyy-MM-dd"), [currentMonth]);
  const dateTo = useMemo(() => format(endOfMonth(addMonths(currentMonth, 1)), "yyyy-MM-dd"), [currentMonth]);
  const { data: events = [], isFetching: eventsFetching } = useCalendarEvents(dateFrom, dateTo);
  const updateEventMutation = useUpdateEvent();
  const updateEvent = (id: string, updates: Partial<typeof events[0]>) => updateEventMutation.mutate({ id, updates });
  const { promoteHoldsOnDate, resolveHoldRankConflicts, normalizeAllHoldRanks } = useHoldRankMutations();

  // Self-heal duplicate hold ranks. Any (date, venue, room) group where two
  // events share the same holdRank gets renumbered 1..N. Catches data created
  // by paths that bypassed resolveHoldRankConflicts (e.g. multi-performer
  // create, legacy data).
  useEffect(() => {
    if (events.length === 0) return;
    normalizeAllHoldRanks(events);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events]);
  const { canCreate, profiles, currentUser, teamMembers } = useUser();
  const [calendarItems, setCalendarItems] = useState<CalendarItem[]>([]);
  const calendarLoaded = useRef(false);
  const [createEventOpen, setCreateEventOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  // Title display preference: "performer" (default) or "event"
  const [titleDisplay, setTitleDisplay] = useState<CalendarTitleDisplay>(() => {
    const stored = localStorage.getItem("calendar-title-mode") || localStorage.getItem("calendar_title_display");
    return (stored === "event" || stored === "performer" || stored === "both") ? stored : "both";
  });
  const handleTitleDisplayChange = (display: CalendarTitleDisplay) => {
    setTitleDisplay(display);
    localStorage.setItem("calendar-title-mode", display);
  };

  // Sidebar
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  // Filters
  const [filterStatus, setFilterStatus] = useState<string[]>([]);
  const [filterArtist, setFilterArtist] = useState("");
  const [filterVenue, setFilterVenue] = useState("");
  const [jumpDate, setJumpDate] = useState("");

  // Quick-create
  const [quickCreateDate, setQuickCreateDate] = useState<Date | null>(null);
  const [quickCreatePos, setQuickCreatePos] = useState<{ x: number; y: number } | null>(null);
  const [quickCreateTime, setQuickCreateTime] = useState<string | undefined>(undefined);

  // Item create dialogs
  const [createItemType, setCreateItemType] = useState<CalendarItemType | null>(null);
  const [createItemDate, setCreateItemDate] = useState(new Date());
  const [createItemTime, setCreateItemTime] = useState<string | undefined>(undefined);

  // Popup
  const [popupItem, setPopupItem] = useState<PopupItemType | null>(null);
  const [popupPos, setPopupPos] = useState({ x: 0, y: 0 });
  const [editingItem, setEditingItem] = useState<CalendarItem | null>(null);

  // Profile + member options for calendar item form
  const profileOptions = useMemo<ProfileOption[]>(() =>
    Object.entries(profiles)
      .filter(([, p]) => p.created && p.id && p.name)
      .map(([, p]) => ({ id: p.id!, name: p.name })),
    [profiles],
  );

  const memberOptions = useMemo<MemberOption[]>(() => {
    const opts: MemberOption[] = [];
    const seen = new Set<string>();
    // Always include the current user first
    if (currentUser.id && currentUser.name) {
      opts.push({ uid: currentUser.id, name: currentUser.name });
      seen.add(currentUser.id);
    }
    teamMembers.forEach(m => {
      if (m.id && m.name && !seen.has(m.id)) {
        seen.add(m.id);
        opts.push({ uid: m.id, name: m.name });
      }
    });
    return opts;
  }, [currentUser, teamMembers]);

  // Maps entity name → Firestore profile document ID for unavailability persistence
  const entityProfileIdMap = useMemo(() => {
    const map = new Map<string, string>();
    Object.entries(profiles).forEach(([, profile]) => {
      if (profile.id && profile.name) map.set(profile.name, profile.id);
    });
    return map;
  }, [profiles]);

  // Unavailability
  const [unavailableDates, setUnavailableDates] = useState<Record<string, Set<string>>>({});
  const [manualOverrides, setManualOverrides] = useState<Record<string, Set<string>>>({});
  const unavailabilityLoaded = useRef(false);
  useEffect(() => {
    if (unavailabilityLoaded.current || entityProfileIdMap.size === 0) return;
    unavailabilityLoaded.current = true;
    Promise.all(
      [...entityProfileIdMap.entries()].map(async ([entityName, profileId]) => {
        const dates = await fetchProfileUnavailability(profileId);
        return [entityName, dates] as [string, string[]];
      })
    ).then(results => {
      const initial: Record<string, Set<string>> = {};
      results.forEach(([entityName, dates]) => {
        if (dates.length > 0) initial[entityName] = new Set(dates);
      });
      if (Object.keys(initial).length > 0) setUnavailableDates(initial);
    });
  }, [entityProfileIdMap]);
  const [markingMode, setMarkingMode] = useState(false);
  const [markRangeOpen, setMarkRangeOpen] = useState(false);
  const [markingEntity, setMarkingEntity] = useState<string>("");
  const [entitySelectorOpen, setEntitySelectorOpen] = useState(false);
  const [pendingMarkDate, setPendingMarkDate] = useState<string | null>(null);

  // Share / invite / print
  const [shareOpen, setShareOpen] = useState(false);
  const [shareEntity, setShareEntity] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEventName, setInviteEventName] = useState("");
  const [inviteEventId, setInviteEventId] = useState("");
  const [printOpen, setPrintOpen] = useState(false);
  const [printEventId, setPrintEventId] = useState("");
  const [printEventName, setPrintEventName] = useState("");
  const [printEventStatus, setPrintEventStatus] = useState("");

  // Drag
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null);

  // ── Calendar entities ──
  const calendarEntities = useMemo<CalendarEntity[]>(() => {
    const entities: CalendarEntity[] = [];
    const seen = new Set<string>();
    Object.entries(profiles).forEach(([key, profile]) => {
      if (!profile?.created || !profile.name) return;
      const base = key.startsWith("venue") ? "venue" : key.startsWith("performer") ? "performer" : key.startsWith("festival") ? "festival" : key.startsWith("promoter") ? "promoter" : key.startsWith("organizer") ? "organizer" : null;
      if (!base) return;
      if (!seen.has(profile.name)) {
        seen.add(profile.name);
        entities.push({ name: profile.name, type: base as CalendarEntity["type"], color: "" });
      }
      if (base === "venue" && profile.subVenues) {
        for (const sv of profile.subVenues) {
          const roomKey = `${profile.name}::${sv.name}`;
          if (sv.name && !seen.has(roomKey)) {
            seen.add(roomKey);
            entities.push({ name: roomKey, type: "room", color: "", parentVenue: profile.name, displayName: sv.name });
          }
        }
      }
    });
    return entities.map((ent, i) => ({ ...ent, color: CALENDAR_ENTITY_COLORS[i % CALENDAR_ENTITY_COLORS.length] }));
  }, [profiles]);

  const [visibleCalendars, setVisibleCalendars] = useState<Set<string>>(new Set());

  useEffect(() => {
    setVisibleCalendars(prev => {
      const allNames = new Set(calendarEntities.map(e => e.name));
      if (prev.size === 0 && allNames.size > 0) return allNames;
      const next = new Set(prev);
      allNames.forEach(n => { if (!next.has(n) && prev.size === 0) next.add(n); });
      return next.size > 0 ? next : allNames;
    });
  }, [calendarEntities]);

  const entityColorMap = useMemo(() => {
    const map = new Map<string, string>();
    calendarEntities.forEach(e => map.set(e.name, e.color));
    return map;
  }, [calendarEntities]);

  const hasAvailabilityRole = currentUser.roles.some(r => r === "venue" || r === "performer");

  const autoUnavailableDates = useMemo<Record<string, Set<string>>>(() => {
    if (!hasAvailabilityRole) return {};
    const result: Record<string, Set<string>> = {};
    events.forEach(e => {
      if (e.archived || (e.eventStatus !== "confirmed" && e.eventStatus !== "on_hold")) return;
      if (e.isMultiPerformer && e.childEventIds?.length) return;
      if (!e.date) return;
      if (e.venue) { if (!result[e.venue]) result[e.venue] = new Set(); result[e.venue].add(e.date); }
      if (e.artist) { if (!result[e.artist]) result[e.artist] = new Set(); result[e.artist].add(e.date); }
    });
    return result;
  }, [events, hasAvailabilityRole]);

  const combinedUnavailable = useMemo<Record<string, Set<string>>>(() => {
    const combined: Record<string, Set<string>> = {};
    for (const [entity, dates] of Object.entries(unavailableDates)) combined[entity] = new Set(dates);
    for (const [entity, dates] of Object.entries(autoUnavailableDates)) {
      if (!combined[entity]) combined[entity] = new Set();
      const overrides = manualOverrides[entity] || new Set();
      dates.forEach(d => { if (!overrides.has(d)) combined[entity].add(d); });
    }
    return combined;
  }, [unavailableDates, autoUnavailableDates, manualOverrides]);

  const flatCombinedUnavailable = useMemo(() => {
    const flat = new Set<string>();
    for (const [entity, dates] of Object.entries(combinedUnavailable)) {
      if (visibleCalendars.has(entity)) dates.forEach(d => flat.add(d));
    }
    return flat;
  }, [combinedUnavailable, visibleCalendars]);

  useEffect(() => {
    if (calendarEntities.length > 0 && !markingEntity) setMarkingEntity(calendarEntities[0].name);
  }, [calendarEntities, markingEntity]);

  // Load user-level items once
  useEffect(() => {
    if (calendarLoaded.current) return;
    calendarLoaded.current = true;
    fetchCalendarItems().then(items => { if (items.length > 0) setCalendarItems(items); });
  }, []);

  // Load profile-level items when profiles become available
  const profileItemsLoaded = useRef(false);
  useEffect(() => {
    if (profileItemsLoaded.current || profileOptions.length === 0) return;
    profileItemsLoaded.current = true;
    const pids = profileOptions.map(p => p.id);
    fetchProfileCalendarItems(pids).then(items => {
      if (items.length > 0) setCalendarItems(prev => [...prev, ...items]);
    });
  }, [profileOptions]);

  // ── Import handlers ──
  const handleImportCalendarItems = (items: { title: string; date: string; startTime?: string; endTime?: string; description?: string }[]) => {
    items.forEach((item, i) => {
      addCalendarItem({ id: `CI-import-${Date.now()}-${i}`, type: "appointment", title: item.title, date: item.date, startTime: item.startTime, endTime: item.endTime, description: item.description });
    });
  };

  const handleImportEvents = (items: { title: string; date: string; startTime?: string; endTime?: string; location?: string; description?: string }[]) => {
    items.forEach((item, i) => {
      addCalendarItem({ id: `CI-import-${Date.now()}-${i}`, type: "appointment", title: item.title, date: item.date, startTime: item.startTime, endTime: item.endTime, description: [item.location, item.description].filter(Boolean).join(" — ") });
    });
  };

  // ── CalendarItem CRUD ──
  const addCalendarItem = (item: CalendarItem) => {
    setCalendarItems(prev => [...prev, item]);
    upsertCalendarItem(item);
  };

  const deleteCalendarItem = (id: string, profileId?: string) => {
    setCalendarItems(prev => prev.filter(ci => ci.id !== id));
    deleteCalendarItemFromDb(id, profileId);
    toast({ title: "Item deleted" });
  };

  const duplicateCalendarItem = (item: CalendarItem) => {
    const dup: CalendarItem = { ...item, id: `CI-${Date.now()}`, title: `${item.title} (copy)` };
    setCalendarItems(prev => [...prev, dup]);
    upsertCalendarItem(dup);
    toast({ title: "Item duplicated" });
  };

  const updateCalendarItem = useCallback((updated: CalendarItem) => {
    setCalendarItems(prev => prev.map(ci => ci.id === updated.id ? updated : ci));
    upsertCalendarItem(updated);
  }, []);

  // ── Unavailability ──
  const persistUnavailability = useCallback((entity: string, dates: Set<string>) => {
    const profileId = entityProfileIdMap.get(entity);
    if (profileId) saveProfileUnavailability(profileId, [...dates]);
  }, [entityProfileIdMap]);

  const toggleUnavailable = (dateKey: string, entity: string) => {
    if (autoUnavailableDates[entity]?.has(dateKey)) {
      setManualOverrides(prev => {
        const s = new Set(prev[entity] || []);
        if (s.has(dateKey)) s.delete(dateKey); else s.add(dateKey);
        return { ...prev, [entity]: s };
      });
    } else {
      setUnavailableDates(prev => {
        const s = new Set(prev[entity] || []);
        if (s.has(dateKey)) s.delete(dateKey); else s.add(dateKey);
        persistUnavailability(entity, s);
        return { ...prev, [entity]: s };
      });
    }
  };

  const markRangeUnavailable = (from: string, to: string, entity: string) => {
    try {
      const days = eachDayOfInterval({ start: parseISO(from), end: parseISO(to) });
      setUnavailableDates(prev => {
        const s = new Set(prev[entity] || []);
        days.forEach(d => s.add(format(d, "yyyy-MM-dd")));
        persistUnavailability(entity, s);
        return { ...prev, [entity]: s };
      });
      toast({ title: `${days.length} dates marked unavailable for ${entity}` });
    } catch { toast({ title: "Invalid date range", variant: "destructive" }); }
  };

  const clearUnavailable = () => {
    if (!markingEntity) return;
    setUnavailableDates(prev => { const next = { ...prev }; delete next[markingEntity]; return next; });
    persistUnavailability(markingEntity, new Set());
    toast({ title: `Unavailability cleared for ${markingEntity}` });
  };

  const markDaysUnavailable = useCallback((dateKeys: string[]) => {
    if (!markingEntity) return;
    setUnavailableDates(prev => {
      const s = new Set(prev[markingEntity] || []);
      dateKeys.forEach(d => s.add(d));
      persistUnavailability(markingEntity, s);
      return { ...prev, [markingEntity]: s };
    });
    toast({ title: `${dateKeys.length} date${dateKeys.length === 1 ? "" : "s"} marked unavailable` });
  }, [markingEntity, persistUnavailability]);

  // ── Drag handlers ──
  const handleDragStart = (e: React.DragEvent, itemId: string) => {
    e.dataTransfer.setData("text/plain", itemId);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = useCallback((e: React.DragEvent, targetKey: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverTarget(targetKey);
  }, []);

  const handleDragLeave = useCallback(() => setDragOverTarget(null), []);

  const handleDrop = useCallback((e: React.DragEvent, dateKey: string, hour?: number) => {
    e.preventDefault();
    setDragOverTarget(null);
    const itemId = e.dataTransfer.getData("text/plain");
    if (!itemId) return;
    const item = calendarItems.find(ci => ci.id === itemId);
    if (!item) return;
    const updated = { ...item, date: dateKey };
    if (hour !== undefined) updated.startTime = `${hour.toString().padStart(2, "0")}:00`;
    updateCalendarItem(updated);
    toast({ title: "Item moved" });
  }, [calendarItems, updateCalendarItem]);

  const handleWeekAllDayDrop = useCallback((e: React.DragEvent, dateKey: string) => {
    e.preventDefault();
    setDragOverTarget(null);
    const itemId = e.dataTransfer.getData("text/plain");
    const item = calendarItems.find(ci => ci.id === itemId);
    if (item) { updateCalendarItem({ ...item, date: dateKey, startTime: undefined }); toast({ title: "Item moved" }); }
  }, [calendarItems, updateCalendarItem]);

  // ── Computed ──
  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(currentMonth);
    const calStart = startOfWeek(monthStart, { weekStartsOn: 1 });
    const calEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
    const days: Date[] = [];
    let day = calStart;
    while (day <= calEnd) { days.push(day); day = addDays(day, 1); }
    return days;
  }, [currentMonth]);

  const parentNameMap = useMemo(() => {
    const map = new Map<string, string>();
    events.forEach(e => { if (e.isMultiPerformer && e.childEventIds?.length) map.set(e.id, e.name); });
    return map;
  }, [events]);

  // Set of `${venue}::${room}` keys that exist as registered room entities.
  // An event with a `roomStage` matching one of these is filtered by its room
  // entity, not its parent venue — selecting only "Main Hall" should show
  // Main Hall events even when the parent venue checkbox is off.
  const roomEntityKeys = useMemo(() => {
    const set = new Set<string>();
    calendarEntities.forEach(ent => { if (ent.type === "room") set.add(ent.name); });
    return set;
  }, [calendarEntities]);

  const eventMatchesVisibleCalendars = useCallback((e: { venue: string; artist: string; operator: string; roomStage?: string }) => {
    const roomKey = e.roomStage ? `${e.venue}::${e.roomStage}` : null;
    const venueOrRoomVisible = roomKey && roomEntityKeys.has(roomKey)
      ? visibleCalendars.has(roomKey)
      : visibleCalendars.has(e.venue);
    return venueOrRoomVisible || visibleCalendars.has(e.artist) || visibleCalendars.has(e.operator);
  }, [roomEntityKeys, visibleCalendars]);

  const activeEvents = useMemo(() => {
    let filtered = events.filter(e => !e.archived && !e.parentEventId);
    if (calendarEntities.length > 0) filtered = filtered.filter(eventMatchesVisibleCalendars);
    if (filterStatus.length > 0) filtered = filtered.filter(e => filterStatus.includes(e.eventStatus));
    if (filterArtist) filtered = filtered.filter(e =>
      e.artist.toLowerCase().includes(filterArtist.toLowerCase()) ||
      (e.isMultiPerformer && e.childEventIds?.some((cid: string) => {
        const child = events.find(ce => ce.id === cid && !ce.archived);
        return child?.artist.toLowerCase().includes(filterArtist.toLowerCase());
      }))
    );
    if (filterVenue) filtered = filtered.filter(e => e.venue.toLowerCase().includes(filterVenue.toLowerCase()));
    const expanded: typeof events = [];
    filtered.forEach(e => {
      if (e.isMultiPerformer && e.childEventIds?.length) {
        e.childEventIds.forEach((cid: string) => {
          const child = events.find(ce => ce.id === cid && !ce.archived);
          if (child) {
            if (filterStatus.length > 0 && !filterStatus.includes(child.eventStatus)) return;
            if (filterArtist && !child.artist.toLowerCase().includes(filterArtist.toLowerCase())) return;
            if (calendarEntities.length > 0 && !eventMatchesVisibleCalendars(child)) return;
            expanded.push(child);
          }
        });
      } else expanded.push(e);
    });
    return expanded;
  }, [events, filterStatus, filterArtist, filterVenue, calendarEntities, eventMatchesVisibleCalendars]);

  const eventsByDate = useMemo(() => {
    const map = new Map<string, typeof events>();
    activeEvents.forEach(e => { if (!map.has(e.date)) map.set(e.date, []); map.get(e.date)!.push(e); });
    return map;
  }, [activeEvents]);

  const calItemsByDate = useMemo(() => {
    const map = new Map<string, CalendarItem[]>();
    calendarItems.forEach(ci => { if (!map.has(ci.date)) map.set(ci.date, []); map.get(ci.date)!.push(ci); });
    return map;
  }, [calendarItems]);

  const dayViewEvents = useMemo(() => activeEvents.filter(e => e.date === format(dayViewDate, "yyyy-MM-dd")), [activeEvents, dayViewDate]);
  const dayViewCalItems = useMemo(() => calendarItems.filter(ci => ci.date === format(dayViewDate, "yyyy-MM-dd")), [calendarItems, dayViewDate]);
  const weekViewDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStartDate, i)), [weekStartDate]);
  const hours = useMemo(() => Array.from({ length: 18 }, (_, i) => i + 6), []);

  // ── Handlers ──
  const getEventEntityColor = useCallback((event: AppEvent): string | undefined =>
    entityColorMap.get(event.venue) || entityColorMap.get(event.artist),
  [entityColorMap]);

  const handleCellClick = (day: Date, e: React.MouseEvent) => {
    const dateKey = format(day, "yyyy-MM-dd");
    if (markingMode) {
      if (calendarEntities.length > 1 && !markingEntity) { setPendingMarkDate(dateKey); setEntitySelectorOpen(true); }
      else if (markingEntity) toggleUnavailable(dateKey, markingEntity);
      return;
    }
    if (canCreate) { setQuickCreateDate(day); setQuickCreatePos({ x: e.clientX, y: e.clientY }); setQuickCreateTime(undefined); }
    setSelectedDate(day);
  };

  const handleHourCellClick = (day: Date, hour: number, e: React.MouseEvent) => {
    const dateKey = format(day, "yyyy-MM-dd");
    if (markingMode) { if (markingEntity) toggleUnavailable(dateKey, markingEntity); return; }
    if (canCreate) { setQuickCreateDate(day); setQuickCreatePos({ x: e.clientX, y: e.clientY }); setQuickCreateTime(`${hour.toString().padStart(2, "0")}:00`); }
  };

  const handleItemClick = useCallback((item: PopupItemType, e: React.MouseEvent) => {
    e.stopPropagation(); e.preventDefault();
    setPopupItem(item); setPopupPos({ x: e.clientX, y: e.clientY }); setQuickCreateDate(null);
  }, []);

  const [createAsHold, setCreateAsHold] = useState(false);

  const handleQuickCreate = (type: "event" | "hold" | CalendarItemType) => {
    const targetDate = quickCreateDate || selectedDate || new Date();
    setSelectedDate(targetDate);
    if (type === "event") { setCreateAsHold(false); setCreateEventOpen(true); }
    else if (type === "hold") { setCreateAsHold(true); setCreateEventOpen(true); }
    else { setCreateItemType(type); setCreateItemDate(targetDate); setCreateItemTime(quickCreateTime); }
    setQuickCreateDate(null);
  };

  // Navigation
  const navigatePrev = () => {
    if (viewMode === "month") setCurrentMonth(subMonths(currentMonth, 1));
    else if (viewMode === "week") setWeekStartDate(subWeeks(weekStartDate, 1));
    else setDayViewDate(subDays(dayViewDate, 1));
  };
  const navigateNext = () => {
    if (viewMode === "month") setCurrentMonth(addMonths(currentMonth, 1));
    else if (viewMode === "week") setWeekStartDate(addWeeks(weekStartDate, 1));
    else setDayViewDate(addDays(dayViewDate, 1));
  };
  const navigateToday = () => {
    if (viewMode === "month") { setCurrentMonth(new Date()); setSelectedDate(new Date()); }
    else if (viewMode === "week") setWeekStartDate(startOfWeek(new Date(), { weekStartsOn: 1 }));
    else setDayViewDate(new Date());
  };

  const headerTitle = viewMode === "month"
    ? format(currentMonth, "MMMM yyyy")
    : viewMode === "week"
    ? `${format(weekStartDate, "MMM d")} – ${format(addDays(weekStartDate, 6), "MMM d, yyyy")}`
    : format(dayViewDate, "EEEE, MMMM d, yyyy");

  // ── Chip renderers ──
  const renderCalItemChip = useCallback((ci: CalendarItem, sizeClass: string, showTime: boolean = false) => (
    <button
      key={ci.id}
      draggable
      onDragStart={(e) => { e.stopPropagation(); handleDragStart(e, ci.id); }}
      onClick={(e) => handleItemClick({ kind: "calItem", data: ci }, e)}
      className={cn(sizeClass, "rounded truncate font-medium border text-left cursor-grab active:cursor-grabbing", CALENDAR_ITEM_COLORS[ci.type], "hover:opacity-80 transition-opacity")}
      title={ci.title}
    >
      {showTime && ci.startTime ? `${ci.startTime}${ci.endTime ? ` – ${ci.endTime}` : ""} ` : ""}{ci.title}
    </button>
  ), [handleItemClick]);

  const renderEventChip = useCallback((event: AppEvent, sizeClass: string, showParentIndent: boolean = false) => {
    const color = getEventEntityColor(event);
    const holdRank = event.eventStatus === "on_hold" && event.holdRank ? event.holdRank : 0;
    const rankLabel = holdRank > 0 ? (holdRank === 1 ? "1st" : holdRank === 2 ? "2nd" : holdRank === 3 ? "3rd" : `${holdRank}th`) : "";
    const chipLabel = titleDisplay === "event"
      ? (event.name || event.artist)
      : titleDisplay === "both"
        ? [event.artist, event.name].filter(Boolean).join(" — ")
        : (event.artist || event.name);
    return (
      <button
        key={event.id}
        onClick={(e) => handleItemClick({ kind: "event", data: event }, e)}
        className={cn(sizeClass, "rounded truncate font-medium border text-left w-full flex items-center gap-1", showParentIndent && "ml-1.5 border-l-2", EVENT_STATUS_COLORS[event.eventStatus], "hover:opacity-80 transition-opacity")}
        title={`${event.name}${event.artist ? ` — ${event.artist}` : ''}${rankLabel ? ` (${rankLabel} hold)` : ''}`}
      >
        {color && <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: color }} />}
        {rankLabel && <span className="text-[9px] font-bold shrink-0 opacity-70">{rankLabel}</span>}
        <span className="truncate">{chipLabel}</span>
      </button>
    );
  }, [getEventEntityColor, handleItemClick, titleDisplay]);

  // ── Calendar toggles ──
  const toggleCalendar = (name: string) => setVisibleCalendars(prev => { const next = new Set(prev); if (next.has(name)) next.delete(name); else next.add(name); return next; });
  const showAllCalendars = () => setVisibleCalendars(new Set(calendarEntities.map(e => e.name)));
  const hideAllCalendars = () => setVisibleCalendars(new Set());
  const toggleGroup = (type: string) => setCollapsedGroups(prev => { const next = new Set(prev); if (next.has(type)) next.delete(type); else next.add(type); return next; });
  const toggleVenueRooms = (venueName: string) => setCollapsedGroups(prev => { const next = new Set(prev); const key = `venue-rooms::${venueName}`; if (next.has(key)) next.delete(key); else next.add(key); return next; });

  const entitiesByType = useMemo(() => {
    const groups: Record<string, CalendarEntity[]> = {};
    calendarEntities.forEach(e => { if (e.type === "room") return; if (!groups[e.type]) groups[e.type] = []; groups[e.type].push(e); });
    return groups;
  }, [calendarEntities]);

  const roomsByVenue = useMemo(() => {
    const map: Record<string, CalendarEntity[]> = {};
    calendarEntities.forEach(e => { if (e.type === "room" && e.parentVenue) { if (!map[e.parentVenue]) map[e.parentVenue] = []; map[e.parentVenue].push(e); } });
    return map;
  }, [calendarEntities]);

  // Shared view props
  const viewSharedProps = {
    eventsByDate,
    calItemsByDate,
    calendarItems,
    parentNameMap,
    flatCombinedUnavailable,
    dragOverTarget,
    markingMode,
    renderCalItemChip,
    renderEventChip,
    getEventEntityColor,
    onCellClick: handleCellClick,
    onHourCellClick: handleHourCellClick,
    onItemClick: handleItemClick,
    onDragOver: handleDragOver,
    onDragLeave: handleDragLeave,
    onDrop: handleDrop,
    onWeekAllDayDrop: handleWeekAllDayDrop,
    hours,
  };

  return (
    <AppLayout>
      <div className="animate-fade-in flex flex-col h-[calc(100vh-3rem)]">
        <CalendarHeader
          headerTitle={headerTitle}
          viewMode={viewMode}
          markingMode={markingMode}
          markingEntity={markingEntity}
          calendarEntities={calendarEntities}
          canCreate={canCreate}
          selectedDate={selectedDate}
          onNavigatePrev={navigatePrev}
          onNavigateNext={navigateNext}
          onNavigateToday={navigateToday}
          onSetViewMode={setViewMode}
          onSetWeekStart={setWeekStartDate}
          onSetDayViewDate={setDayViewDate}
          onToggleMarkingMode={() => setMarkingMode(!markingMode)}
          onSetMarkingEntity={setMarkingEntity}
          onMarkRangeOpen={() => setMarkRangeOpen(true)}
          onClearUnavailable={clearUnavailable}
          onShareOpen={() => { if (calendarEntities.length > 0 && !shareEntity) setShareEntity(calendarEntities[0].name); setShareOpen(true); }}
          onImportOpen={() => setImportOpen(true)}
          onCreateEvent={() => setCreateEventOpen(true)}
          onExportICS={() => {
            const nonArchived = events.filter(e => !e.archived);
            if (nonArchived.length === 0) return;
            import("@/lib/calendarExport").then(m => m.downloadICS(nonArchived));
          }}
          isLoading={eventsFetching}
          titleDisplay={titleDisplay}
          onTitleDisplayChange={handleTitleDisplayChange}
        />

        <CalendarLegend />

        <CalendarFilterBar
          calendarEntities={calendarEntities}
          visibleCalendars={visibleCalendars}
          isSidebarOpen={isSidebarOpen}
          filterStatus={filterStatus}
          filterArtist={filterArtist}
          filterVenue={filterVenue}
          jumpDate={jumpDate}
          viewMode={viewMode}
          onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
          onSetFilterStatus={setFilterStatus}
          onSetFilterArtist={setFilterArtist}
          onSetFilterVenue={setFilterVenue}
          onSetJumpDate={setJumpDate}
          onSetCurrentMonth={setCurrentMonth}
          onSetSelectedDate={setSelectedDate}
          onSetWeekStart={setWeekStartDate}
          onSetDayViewDate={setDayViewDate}
        />

        {/* Dialogs */}
        <CreateEventDialog defaultDate={quickCreateDate || selectedDate || new Date()} externalOpen={createEventOpen} onExternalOpenChange={(v) => { setCreateEventOpen(v); if (!v) setCreateAsHold(false); }} defaultStatus={createAsHold ? "on_hold" : undefined} trigger={<span className="hidden" />} />
        <ImportCalendarDialog open={importOpen} onOpenChange={setImportOpen} onImportEvents={handleImportEvents} onImportCalendarItems={handleImportCalendarItems} />
        {createItemType && <CalendarItemFormDialog type={createItemType} defaultDate={createItemDate} defaultStartTime={createItemTime} onAdd={addCalendarItem} open={!!createItemType} onOpenChange={(v) => { if (!v) { setCreateItemType(null); setCreateItemTime(undefined); } }} profiles={profileOptions} members={memberOptions} currentUserUid={currentUser.id} currentUserName={currentUser.name} />}
        {editingItem && <CalendarItemFormDialog type={editingItem.type} defaultDate={parseISO(editingItem.date)} defaultStartTime={editingItem.startTime} onAdd={(item) => updateCalendarItem({ ...item, id: editingItem.id })} open={!!editingItem} onOpenChange={(v) => { if (!v) setEditingItem(null); }} profiles={profileOptions} members={memberOptions} currentUserUid={currentUser.id} currentUserName={currentUser.name} editingItem={editingItem} />}
        <ShareAvailabilityDialog open={shareOpen} onOpenChange={setShareOpen} unavailableDates={combinedUnavailable} ownerUid={currentUser.id} calendarEntities={calendarEntities} selectedEntity={shareEntity || (calendarEntities[0]?.name || "")} onEntityChange={setShareEntity} events={events} profileSlug={(() => { for (const [role, profile] of Object.entries(profiles)) { if ((role === "venue" || role === "performer") && profile.created) { return profile.slug || profile.name?.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || role; } } return undefined; })()} profileRole={currentUser.roles.find(r => r === "venue" || r === "performer")} />
        <MarkRangeDialog open={markRangeOpen} onOpenChange={setMarkRangeOpen} onApply={markRangeUnavailable} calendarEntities={calendarEntities} selectedEntity={markingEntity || (calendarEntities[0]?.name || "")} onEntityChange={setMarkingEntity} />
        <EntitySelectorDialog open={entitySelectorOpen} onOpenChange={setEntitySelectorOpen} entities={calendarEntities} onSelect={(entity) => { if (pendingMarkDate) { toggleUnavailable(pendingMarkDate, entity); setPendingMarkDate(null); } }} />

        {/* Main content: sidebar + grid */}
        <div className="flex-1 flex gap-3 min-h-0">
          {isSidebarOpen && calendarEntities.length > 0 && (
            <CalendarSidebar
              calendarEntities={calendarEntities}
              visibleCalendars={visibleCalendars}
              collapsedGroups={collapsedGroups}
              entitiesByType={entitiesByType}
              roomsByVenue={roomsByVenue}
              onClose={() => setIsSidebarOpen(false)}
              onToggleCalendar={toggleCalendar}
              onShowAll={showAllCalendars}
              onHideAll={hideAllCalendars}
              onToggleGroup={toggleGroup}
              onToggleVenueRooms={toggleVenueRooms}
            />
          )}

          <div className="flex-1 min-h-0 min-w-0 flex flex-col overflow-y-auto">
            {viewMode === "month" && <CalendarMonthView {...viewSharedProps} currentMonth={currentMonth} calendarDays={calendarDays} selectedDate={selectedDate} onSelectDays={markDaysUnavailable} />}
            {viewMode === "day" && <CalendarDayView {...viewSharedProps} dayViewDate={dayViewDate} dayViewEvents={dayViewEvents} dayViewCalItems={dayViewCalItems} />}
            {viewMode === "week" && <CalendarWeekView {...viewSharedProps} weekViewDays={weekViewDays} />}

            {quickCreateDate && quickCreatePos && canCreate && !markingMode && (
              <CalendarQuickCreateMenu quickCreateDate={quickCreateDate} quickCreatePos={quickCreatePos} quickCreateTime={quickCreateTime} onQuickCreate={handleQuickCreate} onClose={() => setQuickCreateDate(null)} />
            )}

            {popupItem && (() => {
              const isEvt = popupItem.kind === "event";
              // Look up the live event so the popup's controlled props
              // (holdRank, holdAutoPromote, eventStatus, published) reflect
              // post-mutation cache state rather than the snapshot captured
              // when the user clicked. Falls back to the snapshot if the
              // event isn't in the current calendar window.
              const evt = isEvt
                ? (events.find((e) => e.id === popupItem.data.id) || popupItem.data) as AppEvent
                : null;
              return (
                <CalendarItemPopup
                  item={popupItem}
                  position={popupPos}
                  onClose={() => setPopupItem(null)}
                  entityColor={isEvt ? getEventEntityColor(evt!) : undefined}
                  onDelete={popupItem.kind === "calItem" ? () => deleteCalendarItem(popupItem.data.id, (popupItem.data as CalendarItem).profileId) : undefined}
                  onDuplicate={popupItem.kind === "calItem" ? () => duplicateCalendarItem(popupItem.data as CalendarItem) : undefined}
                  onEdit={popupItem.kind === "calItem" ? () => { setEditingItem(popupItem.data as CalendarItem); setPopupItem(null); } : undefined}
                  onInvite={isEvt ? () => { setInviteEventName(evt!.name); setInviteEventId(evt!.id); setInviteOpen(true); } : undefined}
                  onPrint={isEvt ? () => { setPrintEventId(evt!.id); setPrintEventName(evt!.name); setPrintEventStatus(evt!.eventStatus); setPrintOpen(true); } : undefined}
                  onPublish={isEvt ? () => {
                    const e = evt!;
                    const next = !e.published;
                    const gate = trySetPublished(e, next);
                    if (!gate.ok) { toast({ title: "Cannot publish", description: gate.reason, variant: "destructive" }); return; }
                    updateEvent(e.id, { published: next });
                    toast({ title: next ? "Event published" : "Event unpublished" });
                  } : undefined}
                  holdRank={evt?.holdRank}
                  holdAutoPromote={evt?.holdAutoPromote}
                  onHoldRankChange={isEvt && evt!.eventStatus === "on_hold" ? (rank) => resolveHoldRankConflicts(evt!.id, evt!.date, evt!.venue, evt!.roomStage || "", rank) : undefined}
                  onHoldAutoPromoteChange={isEvt && evt!.eventStatus === "on_hold" ? (auto) => updateEvent(evt!.id, { holdAutoPromote: auto }) : undefined}
                  onConfirmHold={isEvt && evt!.eventStatus === "on_hold" ? () => {
                    const e = evt!;
                    updateEvent(e.id, { eventStatus: ACCEPTED_HOLD_STATUS });
                    const siblings = findCompetingHolds(events, e);
                    for (const s of siblings) {
                      updateEvent(s.id, { eventStatus: "cancelled" });
                    }
                    toast({
                      title: "Date accepted, event is now pending.",
                      description: siblings.length > 0 ? `${siblings.length} competing hold(s) cancelled.` : undefined,
                    });
                  } : undefined}
                  onDeclineHold={isEvt && evt!.eventStatus === "on_hold" ? () => {
                    updateEvent(evt!.id, { eventStatus: "cancelled" });
                    toast({ title: "Event declined" });
                  } : undefined}
                />
              );
            })()}

            {viewMode === "month" && selectedDate && (
              <CalendarSelectedDatePanel
                selectedDate={selectedDate}
                activeEvents={activeEvents}
                calendarItems={calendarItems}
                flatCombinedUnavailable={flatCombinedUnavailable}
                getEventEntityColor={getEventEntityColor}
                onItemClick={handleItemClick}
                onDayView={() => { setViewMode("day"); setDayViewDate(selectedDate); }}
                onClose={() => setSelectedDate(null)}
              />
            )}
          </div>
        </div>

        <InviteCollaboratorDialog open={inviteOpen} onOpenChange={setInviteOpen} eventName={inviteEventName} eventId={inviteEventId || undefined} />
        <ExportEventDialog open={printOpen} onOpenChange={setPrintOpen} eventName={printEventName} eventId={printEventId} eventStatus={printEventStatus} />
      </div>
    </AppLayout>
  );
}
