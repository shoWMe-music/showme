import React from "react";
import AppLayout from "@/components/AppLayout";
import { EventStatusBadge } from "@/components/StatusBadge";
import { useUpdateEvent, useArchiveEvent, useDuplicateEvent, useDeleteEvent } from "@/lib/queries/useEventMutations";
import { usePaginatedEvents, useAllProfiles } from "@/lib/queries";
import { useUser } from "@/lib/user-context";
import { EventStatus } from "@/lib/models";
import CreateEventDialog from "@/components/CreateEventDialog";
import InviteCollaboratorDialog from "@/components/InviteCollaboratorDialog";
import ExportEventDialog from "@/components/ExportEventDialog";
import { Link } from "@tanstack/react-router";
import { Search, Globe, EyeOff, CreditCard, UserPlus, Printer, Trash2, Archive, ArchiveRestore, Users, ChevronLeft, ChevronRight, ArrowUp, ArrowDown, ArrowUpDown, Loader2, Copy } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useState, useEffect, useMemo, useRef } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "@/hooks/use-toast";
import { usePublishEventToggle } from "@/hooks/usePublishEventToggle";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ProfilePreviewPopover } from "@/components/ProfilePreviewPopover";

type StatusFilterValue = EventStatus | "all" | "archived" | "next-shows";

const EVENT_STATUS_FILTERS: { value: StatusFilterValue; label: string }[] = [
  { value: "next-shows", label: "Next Shows" },
  { value: "all", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "suggested", label: "Suggested" },
  { value: "pending", label: "Pending" },
  { value: "confirmed", label: "Confirmed" },
  { value: "on_hold", label: "On Hold" },
  { value: "concluded", label: "Concluded" },
  { value: "cancelled", label: "Cancelled" },
  { value: "archived", label: "Archived" },
];

const PAGE_SIZE = 25;
const FETCH_SIZE = 50;

type SortKey = "date" | "status" | "performer" | "venue";
type SortDir = "asc" | "desc";

const STATUS_ORDER: Record<string, number> = {
  draft: 0, suggested: 1, pending: 2, confirmed: 3, on_hold: 4, concluded: 5, cancelled: 6,
};

/**
 * Resolve the operator/host display name for an event row. Accepts either the
 * slot-keyed Record (legacy callers) or the flat array from `useAllProfiles()`.
 * The flat-array form is required to find profiles the user is a *member* of —
 * the slot Record collapses two profiles of the same role-type. Exported for
 * testing.
 */
export function resolveOperatorName(
  event: { hostProfileId?: string; operator?: string },
  profiles:
    | Record<string, { id?: string; name: string }>
    | ReadonlyArray<{ id?: string; name: string }>,
): string {
  if (event.hostProfileId) {
    const list = Array.isArray(profiles) ? profiles : Object.values(profiles);
    const match = list.find((p) => p.id === event.hostProfileId);
    if (match?.name) return match.name;
  }
  return event.operator || "";
}

export default function EventsPage() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    debounceRef.current = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(debounceRef.current);
  }, [search]);

  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>("next-shows");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);
  const [inviteEventId, setInviteEventId] = useState<string | null>(null);
  const [printEventId, setPrintEventId] = useState<string | null>(null);
  // Two-step delete flow: "cancel-confirm" → "archive-confirm".
  // Drafts skip step 1 with a "permanently delete" dialog. Cancelled events skip
  // step 1 and go straight to archive. After Yes-No (cancel + decline-archive),
  // the event is added to readyToArchiveIds so the next click archives directly.
  const [deleteDialog, setDeleteDialog] = useState<
    | { eventId: string; step: "cancel-confirm" | "archive-confirm" | "delete-draft" | "archive-only" }
    | null
  >(null);
  const [readyToArchiveIds, setReadyToArchiveIds] = useState<Set<string>>(new Set());
  const [expandedParents, setExpandedParents] = useState<Set<string>>(new Set());

  // Map UI sort key to Firestore field; status sort stays client-side
  const serverSortField = sortKey === "performer" ? "artist" : sortKey === "status" ? "date" : sortKey;
  const serverSortDir = sortKey === "status" ? "desc" : sortDir;

  const isStatusServerFilter = statusFilter !== "all" && statusFilter !== "archived" && statusFilter !== "next-shows";
  const firestoreFilters = useMemo(
    () => ({
      ...(isStatusServerFilter ? { status: statusFilter as EventStatus } : {}),
      sortField: serverSortField as "date" | "artist" | "venue",
      sortDir: serverSortDir as "asc" | "desc",
    }),
    [statusFilter, isStatusServerFilter, serverSortField, serverSortDir],
  );

  const {
    data: paginatedData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isSuccess: eventsLoaded,
  } = usePaginatedEvents(FETCH_SIZE, firestoreFilters);

  // Flatten all loaded Firestore pages into a single array
  const allLoadedEvents = useMemo(
    () => paginatedData?.pages.flatMap((p) => p.events) ?? [],
    [paginatedData],
  );

  const updateEventMutation = useUpdateEvent();
  const archiveEventMutation = useArchiveEvent();
  const duplicateEventMutation = useDuplicateEvent();
  const deleteEventMutation = useDeleteEvent();
  const updateEvent = (id: string, updates: Partial<(typeof allLoadedEvents)[0]>) => updateEventMutation.mutate({ id, updates });
  const archiveEvent = (id: string) => archiveEventMutation.mutate({ id });
  const deleteEvent = (id: string) => deleteEventMutation.mutate({ id });
  const [duplicateEventId, setDuplicateEventId] = useState<string | null>(null);
  const togglePublish = usePublishEventToggle(updateEvent);
  const { canCreate } = useUser();
  // Source from the flat `all` array, not the slotted dict — two profiles of
  // the same role-type collide on slot, which would silently hide a profile
  // the user is a *member of* from the filter dropdown when they also own
  // one of the same type.
  const allProfiles = useAllProfiles();
  const [profileFilter, setProfileFilter] = useState<string>("all");

  // Build list of profiles the user has (with id + name)
  const profileOptions = allProfiles
    .filter((p) => p.created && p.id)
    .map((p) => ({ id: p.id!, name: p.name, role: p.role }));
  const allProfileIds = profileOptions.map((p) => p.id);

  const hostNameForEvent = (e: { hostProfileId?: string; operator?: string }): string =>
    resolveOperatorName(e, allProfiles);

  // Reset to first page whenever filters change.
  useEffect(() => { setPage(1); }, [debouncedSearch, statusFilter, profileFilter, sortKey, sortDir]);

  // Auto-fetch all remaining pages when search is active so client-side filtering is comprehensive
  useEffect(() => {
    if (debouncedSearch && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [debouncedSearch, hasNextPage, isFetchingNextPage, fetchNextPage]);

  const today = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();
  const filtered = allLoadedEvents.filter((e) => {
    if (statusFilter === "archived") return !!e.archived;
    if (e.archived) return false;
    if (statusFilter === "next-shows" && e.date < today) return false;
    // Hide child events unless the user is the performer on it (not the host)
    if (e.parentEventId) {
      const isMyChildEvent = allProfileIds.some(
        pid => pid === e.performerProfileId || e.accessProfileIds?.includes(pid),
      ) && !allProfileIds.includes(e.hostProfileId || "");
      if (!isMyChildEvent) return false;
    }
    // Hide parent multi-performer event from non-host performers
    if (e.isMultiPerformer && !allProfileIds.includes(e.hostProfileId || "")) return false;
    if (profileOptions.length > 1) {
      const idsToMatch = profileFilter === "all" ? allProfileIds : [profileFilter];
      const profileMatch = idsToMatch.some((pid) => e.hostProfileId === pid || e.accessProfileIds?.includes(pid));
      if (!profileMatch) return false;
    }
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase();
      if (!e.name.toLowerCase().includes(q) && !e.artist.toLowerCase().includes(q) && !e.venue.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  // Date, performer, venue are sorted server-side; only status needs client-side sort
  const sorted = sortKey === "status"
    ? [...filtered].sort((a, b) => {
        const cmp = (STATUS_ORDER[a.eventStatus] ?? 99) - (STATUS_ORDER[b.eventStatus] ?? 99);
        return sortDir === "asc" ? cmp : -cmp;
      })
    : filtered;

  const paginated = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Fetch next Firestore batch only when user navigates past loaded data
  useEffect(() => {
    if (page * PAGE_SIZE > allLoadedEvents.length && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [page, allLoadedEvents.length, hasNextPage, isFetchingNextPage, fetchNextPage]);

  const canGoNext = page * PAGE_SIZE < sorted.length || hasNextPage;

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(key === "date" ? "desc" : "asc");
    }
  };

  const inviteEvent = inviteEventId ? allLoadedEvents.find(e => e.id === inviteEventId) : null;
  const printEvent = printEventId ? allLoadedEvents.find(e => e.id === printEventId) : null;

  return (
    <AppLayout>
      <div className="animate-fade-in">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Events</h1>
            <p className="mt-1 text-muted-foreground">Manage your events from creation to settlement</p>
          </div>
          {canCreate && statusFilter !== "concluded" && statusFilter !== "cancelled" && statusFilter !== "archived" && <CreateEventDialog />}
        </div>

        <div className="mb-4 flex flex-col gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search events, performers, venues..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border bg-card pl-10 pr-4 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="flex items-start justify-between gap-4">
            <div className="flex gap-1 flex-wrap">
              {EVENT_STATUS_FILTERS.map((f) => (
                <button
                  key={f.value}
                  onClick={() => setStatusFilter(f.value)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                    statusFilter === f.value
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            {profileOptions.length > 1 && (
              <div className="flex gap-1 flex-wrap justify-end shrink-0">
                <button
                  onClick={() => setProfileFilter("all")}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                    profileFilter === "all"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:text-foreground"
                  }`}
                >
                  All profiles
                </button>
                {profileOptions.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setProfileFilter(p.id)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                      profileFilter === p.id
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
          <TooltipProvider>
            <table className="w-full">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Event</th>
                  <SortableTh label="Performer" sortKey="performer" currentKey={sortKey} dir={sortDir} onSort={toggleSort} />
                  <SortableTh label="Venue" sortKey="venue" currentKey={sortKey} dir={sortDir} onSort={toggleSort} />
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Host</th>
                  <SortableTh label="Date" sortKey="date" currentKey={sortKey} dir={sortDir} onSort={toggleSort} />
                  <SortableTh label="Status" sortKey="status" currentKey={sortKey} dir={sortDir} onSort={toggleSort} />
                  <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {!eventsLoaded ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="px-6 py-4">
                        <Skeleton className="h-4 w-40 mb-1.5" />
                        <Skeleton className="h-3 w-20" />
                      </td>
                      <td className="px-6 py-4"><Skeleton className="h-4 w-28" /></td>
                      <td className="px-6 py-4"><Skeleton className="h-4 w-36" /></td>
                      <td className="px-6 py-4"><Skeleton className="h-4 w-28" /></td>
                      <td className="px-6 py-4"><Skeleton className="h-4 w-20" /></td>
                      <td className="px-6 py-4"><Skeleton className="h-5 w-20 rounded-full" /></td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-end gap-1">
                          {Array.from({ length: 6 }).map((_, j) => (
                            <Skeleton key={j} className="h-8 w-8 rounded-md" />
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <>
                    {paginated
                      .filter((event) => {
                        // Skip child events whose parent is also visible in this page
                        if (!event.parentEventId) return true;
                        return !paginated.some(e => e.id === event.parentEventId);
                      })
                      .map((event) => {
                      const isChildEvent = !!event.parentEventId;
                      const parentName = isChildEvent
                        ? allLoadedEvents.find(e => e.id === event.parentEventId)?.name
                        : undefined;
                      const isExpanded = expandedParents.has(event.id);
                      const childEvents = event.isMultiPerformer
                        ? allLoadedEvents.filter(e => e.parentEventId === event.id)
                        : [];
                      const toggleExpand = () => {
                        setExpandedParents(prev => {
                          const next = new Set(prev);
                          if (next.has(event.id)) next.delete(event.id);
                          else next.add(event.id);
                          return next;
                        });
                      };
                      return (
                      <React.Fragment key={event.id}>
                      <tr className={`transition-colors hover:bg-muted/30 ${event.isMultiPerformer ? "border-l-4 border-l-primary/40 bg-primary/[0.02]" : ""} ${isChildEvent ? "border-l-4 border-l-primary/20 bg-muted/10" : ""}`}>
                        <td className="px-6 py-4">
                          {isChildEvent && parentName && (
                            <p className="text-[10px] text-muted-foreground/70 font-medium mb-0.5 pl-2">{parentName}</p>
                          )}
                          <Link to="/events/$id" params={{ id: event.id }} className={`font-medium hover:text-primary transition-colors flex items-center gap-2 ${isChildEvent ? "pl-2" : ""}`}>
                            {event.isMultiPerformer && childEvents.length > 0 && (
                              <button type="button" onClick={(e) => { e.preventDefault(); toggleExpand(); }} className="shrink-0 p-0.5 rounded hover:bg-muted transition-colors">
                                <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                              </button>
                            )}
                            {event.name}
                            {event.isMultiPerformer && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                                <Users className="h-3 w-3" /> {(event.childEventIds || []).length} performers
                              </span>
                            )}
                          </Link>
                          <p className={`text-xs text-muted-foreground ${isChildEvent ? "pl-2" : ""}`}>{event.id}</p>
                        </td>
                        <td className="px-6 py-4 text-sm">
                          {event.isMultiPerformer && childEvents.length > 0 ? (
                            <MultiPerformerAvatars childEvents={childEvents} />
                          ) : (
                            <ProfilePreviewPopover name={event.artist} profileId={event.performerProfileId} />
                          )}
                        </td>
                        <td className="px-6 py-4 text-sm text-muted-foreground"><ProfilePreviewPopover name={event.venue} /></td>
                        <td className="px-6 py-4 text-sm text-muted-foreground" data-testid="operator-cell">
                          {hostNameForEvent(event)
                            ? <ProfilePreviewPopover name={hostNameForEvent(event)} profileId={event.hostProfileId} />
                            : <span className="text-muted-foreground/50">—</span>}
                        </td>
                        <td className="px-6 py-4 text-sm text-muted-foreground">
                          <Link to="/calendar" search={{ date: event.date }} className="hover:underline hover:text-foreground cursor-pointer transition-colors">
                            {event.date}
                          </Link>
                        </td>
                        <td className="px-6 py-4"><EventStatusBadge status={event.eventStatus} event={event} /></td>
                        <td className="px-6 py-4">
                          <div className="flex items-center justify-end gap-1">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => togglePublish(event)}
                                >
                                  {event.published ? <Globe className="h-4 w-4 text-primary" /> : <EyeOff className="h-4 w-4 text-muted-foreground" />}
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>{event.published ? "Unpublish" : "Publish"}</TooltipContent>
                            </Tooltip>

                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
                                  <Link to="/events/$id" params={{ id: event.id }} search={{ tab: "settlement" }}>
                                    <CreditCard className="h-4 w-4 text-muted-foreground" />
                                  </Link>
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Settlement</TooltipContent>
                            </Tooltip>

                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setInviteEventId(event.id)}>
                                  <UserPlus className="h-4 w-4 text-muted-foreground" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Invite Collaborator</TooltipContent>
                            </Tooltip>

                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setPrintEventId(event.id)}>
                                  <Printer className="h-4 w-4 text-muted-foreground" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Print Event Details</TooltipContent>
                            </Tooltip>

                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => setDuplicateEventId(event.id)}
                                  data-testid={`event-row-duplicate-${event.id}`}
                                  aria-label="Duplicate Event"
                                >
                                  <Copy className="h-4 w-4 text-muted-foreground" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Duplicate Event</TooltipContent>
                            </Tooltip>

                            {event.archived ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => {
                                    updateEvent(event.id, { archived: false });
                                    toast({ title: "Event restored" });
                                  }}>
                                    <ArchiveRestore className="h-4 w-4 text-muted-foreground hover:text-primary" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Restore Event</TooltipContent>
                              </Tooltip>
                            ) : (() => {
                              const isDraft = event.eventStatus === "draft";
                              const isCancelled = event.eventStatus === "cancelled";
                              const isReadyToArchive = readyToArchiveIds.has(event.id);
                              const showArchiveIcon = isCancelled || isReadyToArchive;
                              const handleClick = () => {
                                if (isDraft) {
                                  setDeleteDialog({ eventId: event.id, step: "delete-draft" });
                                } else if (showArchiveIcon) {
                                  setDeleteDialog({ eventId: event.id, step: "archive-only" });
                                } else {
                                  setDeleteDialog({ eventId: event.id, step: "cancel-confirm" });
                                }
                              };
                              const tooltipLabel = isDraft
                                ? "Delete Draft"
                                : showArchiveIcon
                                  ? "Archive Event"
                                  : "Cancel / Archive Event";
                              return (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8"
                                      onClick={handleClick}
                                      data-testid={`event-row-delete-${event.id}`}
                                      aria-label={tooltipLabel}
                                    >
                                      {showArchiveIcon
                                        ? <Archive className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                                        : <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />}
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>{tooltipLabel}</TooltipContent>
                                </Tooltip>
                              );
                            })()}
                          </div>
                        </td>
                      </tr>
                      {event.isMultiPerformer && isExpanded && childEvents.map((child) => (
                        <tr key={child.id} className="transition-colors hover:bg-muted/30 border-l-4 border-l-primary/20 bg-muted/10">
                          <td className="px-6 py-3 pl-12">
                            <Link to="/events/$id" params={{ id: child.id }} className="font-medium text-sm hover:text-primary transition-colors">
                              {child.artist || child.name}
                            </Link>
                            <p className="text-xs text-muted-foreground">{child.id}</p>
                          </td>
                          <td className="px-6 py-3 text-sm">
                            <ProfilePreviewPopover name={child.artist} />
                          </td>
                          <td className="px-6 py-3 text-sm text-muted-foreground"><ProfilePreviewPopover name={child.venue} /></td>
                          <td className="px-6 py-3 text-sm text-muted-foreground">
                            {hostNameForEvent(child)
                              ? <ProfilePreviewPopover name={hostNameForEvent(child)} profileId={child.hostProfileId} />
                              : <span className="text-muted-foreground/50">—</span>}
                          </td>
                          <td className="px-6 py-3 text-sm text-muted-foreground">
                            <Link to="/calendar" search={{ date: child.date }} className="hover:underline hover:text-foreground cursor-pointer transition-colors">
                              {child.date}
                            </Link>
                          </td>
                          <td className="px-6 py-3"><EventStatusBadge status={child.eventStatus} event={child} /></td>
                          <td className="px-6 py-3">
                            <div className="flex items-center justify-end">
                              <Button variant="ghost" size="sm" className="h-7 text-xs" asChild>
                                <Link to="/events/$id" params={{ id: child.id }}>View</Link>
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      </React.Fragment>
                      );
                    })}
                    {sorted.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-6 py-12 text-center text-muted-foreground">No events found</td>
                      </tr>
                    )}
                  </>
                )}
              </tbody>
            </table>
          </TooltipProvider>
        </div>

        {eventsLoaded && sorted.length > 0 && (
          <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
            <span className="flex items-center gap-2">
              Showing {Math.min((page - 1) * PAGE_SIZE + 1, sorted.length)}–{Math.min(page * PAGE_SIZE, sorted.length)} of {sorted.length}{hasNextPage ? "+" : ""} events
              {isFetchingNextPage && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                disabled={page === 1}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="px-2">Page {page}</span>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                disabled={!canGoNext}
                onClick={() => setPage((p) => p + 1)}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>

      <InviteCollaboratorDialog
        open={!!inviteEventId}
        onOpenChange={(v) => { if (!v) setInviteEventId(null); }}
        eventName={inviteEvent?.name || ""}
        eventId={inviteEventId || undefined}
      />
      <ExportEventDialog
        open={!!printEventId}
        onOpenChange={(v) => { if (!v) setPrintEventId(null); }}
        eventName={printEvent?.name || ""}
        eventId={printEventId || ""}
        eventStatus={printEvent?.eventStatus}
      />

      {/* Step 1 — Cancel confirm (active events) */}
      <AlertDialog
        open={deleteDialog?.step === "cancel-confirm"}
        onOpenChange={(v) => { if (!v) setDeleteDialog(null); }}
      >
        <AlertDialogContent data-testid="cancel-confirm-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel event?</AlertDialogTitle>
            <AlertDialogDescription>
              This will cancel the event. Are you sure?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="cancel-confirm-no">No</AlertDialogCancel>
            <AlertDialogAction
              data-testid="cancel-confirm-yes"
              onClick={() => {
                if (!deleteDialog) return;
                const id = deleteDialog.eventId;
                const evt = allLoadedEvents.find(e => e.id === id);
                updateEvent(id, { eventStatus: "cancelled" });
                toast({ title: "Event cancelled", description: `${evt?.name || "Event"} has been cancelled.` });
                setDeleteDialog({ eventId: id, step: "archive-confirm" });
              }}
            >
              Yes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Step 2 — Archive confirm (after a successful cancel) */}
      <AlertDialog
        open={deleteDialog?.step === "archive-confirm"}
        onOpenChange={(v) => { if (!v) setDeleteDialog(null); }}
      >
        <AlertDialogContent data-testid="archive-confirm-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Archive this event?</AlertDialogTitle>
            <AlertDialogDescription>
              Would you like to archive this event now?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              data-testid="archive-confirm-no"
              onClick={() => {
                if (!deleteDialog) return;
                // Decline-archive: switch the row's icon to Archive so the next click archives directly.
                setReadyToArchiveIds(prev => new Set(prev).add(deleteDialog.eventId));
                setDeleteDialog(null);
              }}
            >
              No
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="archive-confirm-yes"
              onClick={() => {
                if (!deleteDialog) return;
                archiveEvent(deleteDialog.eventId);
                setReadyToArchiveIds(prev => {
                  const next = new Set(prev);
                  next.delete(deleteDialog.eventId);
                  return next;
                });
                setDeleteDialog(null);
              }}
            >
              Yes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Direct archive (cancelled events, or after decline-archive) */}
      <AlertDialog
        open={deleteDialog?.step === "archive-only"}
        onOpenChange={(v) => { if (!v) setDeleteDialog(null); }}
      >
        <AlertDialogContent data-testid="archive-only-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Archive event?</AlertDialogTitle>
            <AlertDialogDescription>
              This will archive the event. You can restore it later from the Archived filter.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!deleteDialog) return;
                archiveEvent(deleteDialog.eventId);
                setReadyToArchiveIds(prev => {
                  const next = new Set(prev);
                  next.delete(deleteDialog.eventId);
                  return next;
                });
                setDeleteDialog(null);
              }}
            >
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Permanent delete dialog (drafts only) */}
      <AlertDialog
        open={deleteDialog?.step === "delete-draft"}
        onOpenChange={(v) => { if (!v) setDeleteDialog(null); }}
      >
        <AlertDialogContent data-testid="delete-draft-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete draft?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this draft. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!deleteDialog) return;
                deleteEvent(deleteDialog.eventId);
                setDeleteDialog(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Duplicate event confirm */}
      <AlertDialog
        open={!!duplicateEventId}
        onOpenChange={(v) => { if (!v) setDuplicateEventId(null); }}
      >
        <AlertDialogContent data-testid="duplicate-event-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Duplicate this event?</AlertDialogTitle>
            <AlertDialogDescription>
              You can edit the date and details after.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!duplicateEventId) return;
                const id = duplicateEventId;
                setDuplicateEventId(null);
                duplicateEventMutation.mutate({ eventId: id });
              }}
            >
              Duplicate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}

export function MultiPerformerAvatars({ childEvents }: { childEvents: { id: string; artist: string; performerProfileId?: string }[] }) {
  const visible = childEvents.slice(0, 3);
  const overflow = childEvents.length - visible.length;
  const initials = (name: string) =>
    name.split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? "").join("");
  return (
    <div data-testid="multi-performer-avatars" className="flex items-center gap-2">
      <div className="flex -space-x-2">
        {visible.map((c) => (
          <Avatar key={c.id} className="h-6 w-6 ring-2 ring-background" data-testid="performer-avatar">
            <AvatarFallback className="text-[10px] bg-muted text-muted-foreground font-medium">
              {initials(c.artist || "?")}
            </AvatarFallback>
          </Avatar>
        ))}
        {overflow > 0 && (
          <Avatar className="h-6 w-6 ring-2 ring-background">
            <AvatarFallback className="text-[10px] bg-muted text-muted-foreground font-medium">
              +{overflow}
            </AvatarFallback>
          </Avatar>
        )}
      </div>
      <span className="text-xs text-muted-foreground truncate max-w-[180px]">
        {childEvents.map(c => c.artist).filter(Boolean).join(", ")}
      </span>
    </div>
  );
}

function SortableTh({ label, sortKey: key, currentKey, dir, onSort }: {
  label: string;
  sortKey: SortKey;
  currentKey: SortKey;
  dir: SortDir;
  onSort: (key: SortKey) => void;
}) {
  const active = currentKey === key;
  return (
    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      <button
        type="button"
        className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
        onClick={() => onSort(key)}
      >
        {label}
        {active ? (
          dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
        ) : (
          <ArrowUpDown className="h-3 w-3 opacity-40" />
        )}
      </button>
    </th>
  );
}
