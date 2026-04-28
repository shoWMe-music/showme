import AppLayout from "@/components/AppLayout";
import { EventStatusBadge } from "@/components/StatusBadge";
import { useUpdateEvent, useArchiveEvent } from "@/lib/queries/useEventMutations";
import { usePaginatedEvents } from "@/lib/queries";
import { useUser } from "@/lib/user-context";
import { EventStatus } from "@/lib/models";
import CreateEventDialog from "@/components/CreateEventDialog";
import InviteCollaboratorDialog from "@/components/InviteCollaboratorDialog";
import ExportEventDialog from "@/components/ExportEventDialog";
import { Link } from "@tanstack/react-router";
import { Search, Globe, EyeOff, CreditCard, UserPlus, Printer, Trash2, ArchiveRestore, Users, ChevronLeft, ChevronRight, ArrowUp, ArrowDown, ArrowUpDown, Loader2 } from "lucide-react";
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

const EVENT_STATUS_FILTERS: { value: EventStatus | "all" | "archived"; label: string }[] = [
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

export default function EventsPage() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    debounceRef.current = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(debounceRef.current);
  }, [search]);

  const [statusFilter, setStatusFilter] = useState<EventStatus | "all" | "archived">("all");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);
  const [inviteEventId, setInviteEventId] = useState<string | null>(null);
  const [printEventId, setPrintEventId] = useState<string | null>(null);
  const [archiveEventId, setArchiveEventId] = useState<string | null>(null);

  // Map UI sort key to Firestore field; status sort stays client-side
  const serverSortField = sortKey === "performer" ? "artist" : sortKey === "status" ? "date" : sortKey;
  const serverSortDir = sortKey === "status" ? "desc" : sortDir;

  const firestoreFilters = useMemo(
    () => ({
      ...(statusFilter !== "all" && statusFilter !== "archived" ? { status: statusFilter } : {}),
      sortField: serverSortField as "date" | "artist" | "venue",
      sortDir: serverSortDir as "asc" | "desc",
    }),
    [statusFilter, serverSortField, serverSortDir],
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
  const updateEvent = (id: string, updates: Partial<(typeof allLoadedEvents)[0]>) => updateEventMutation.mutate({ id, updates });
  const archiveEvent = (id: string) => archiveEventMutation.mutate({ id });
  const togglePublish = usePublishEventToggle(updateEvent);
  const { canCreate, profiles } = useUser();
  const [profileFilter, setProfileFilter] = useState<string>("all");

  // Build list of profiles the user has (with id + name)
  const profileOptions = Object.entries(profiles)
    .filter(([, p]) => p.created && p.id)
    .map(([, p]) => ({ id: p.id!, name: p.name, role: p.role }));
  const allProfileIds = profileOptions.map((p) => p.id);

  // Reset to first page whenever filters change.
  useEffect(() => { setPage(1); }, [debouncedSearch, statusFilter, profileFilter, sortKey, sortDir]);

  const filtered = allLoadedEvents.filter((e) => {
    if (statusFilter === "archived") return !!e.archived;
    if (e.archived) return false;
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
                      <td className="px-6 py-4"><Skeleton className="h-4 w-20" /></td>
                      <td className="px-6 py-4"><Skeleton className="h-5 w-20 rounded-full" /></td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-end gap-1">
                          {Array.from({ length: 5 }).map((_, j) => (
                            <Skeleton key={j} className="h-8 w-8 rounded-md" />
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <>
                    {paginated.map((event) => {
                      const isChildEvent = !!event.parentEventId;
                      const parentName = isChildEvent
                        ? allLoadedEvents.find(e => e.id === event.parentEventId)?.name
                        : undefined;
                      return (
                      <tr key={event.id} className={`transition-colors hover:bg-muted/30 ${event.isMultiPerformer ? "border-l-4 border-l-primary/40 bg-primary/[0.02]" : ""} ${isChildEvent ? "border-l-4 border-l-primary/20 bg-muted/10" : ""}`}>
                        <td className="px-6 py-4">
                          {isChildEvent && parentName && (
                            <p className="text-[10px] text-muted-foreground/70 font-medium mb-0.5 pl-2">{parentName}</p>
                          )}
                          <Link to="/events/$id" params={{ id: event.id }} className={`font-medium hover:text-primary transition-colors flex items-center gap-2 ${isChildEvent ? "pl-2" : ""}`}>
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
                          <ProfilePreviewPopover name={event.artist} />
                          {event.isMultiPerformer && (() => {
                            const childNames = allLoadedEvents
                              .filter(e => e.parentEventId === event.id)
                              .map(e => e.artist)
                              .filter(Boolean);
                            return childNames.length > 0 ? (
                              <p className="text-xs text-muted-foreground mt-0.5">{childNames.join(", ")}</p>
                            ) : null;
                          })()}
                        </td>
                        <td className="px-6 py-4 text-sm text-muted-foreground"><ProfilePreviewPopover name={event.venue} /></td>
                        <td className="px-6 py-4 text-sm text-muted-foreground">
                          <Link to="/calendar" search={{ date: event.date }} className="hover:underline hover:text-foreground cursor-pointer transition-colors">
                            {event.date}
                          </Link>
                        </td>
                        <td className="px-6 py-4"><EventStatusBadge status={event.eventStatus} /></td>
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
                            ) : (event.eventStatus === "concluded" || event.eventStatus === "cancelled") && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setArchiveEventId(event.id)}>
                                    <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Archive Event</TooltipContent>
                              </Tooltip>
                            )}
                          </div>
                        </td>
                      </tr>
                      );
                    })}
                    {sorted.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-6 py-12 text-center text-muted-foreground">No events found</td>
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

      <AlertDialog open={!!archiveEventId} onOpenChange={(v) => { if (!v) setArchiveEventId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive Event</AlertDialogTitle>
            <AlertDialogDescription>
              This will archive the event. Are you sure you want to delete this event?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              if (archiveEventId) {
                const evt = allLoadedEvents.find(e => e.id === archiveEventId);
                archiveEvent(archiveEventId);
                toast({ title: "Event deleted", description: `${evt?.name || "Event"} has been archived.` });
                setArchiveEventId(null);
              }
            }}>
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
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
