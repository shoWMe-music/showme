import { useState, useMemo, useEffect, useRef } from "react";
import { useNavigate, Link } from "@tanstack/react-router";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { QueryDocumentSnapshot } from "firebase/firestore";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchBookingRequestPage, updateBookingRequest } from "@/lib/db";
import type { BookingRequestPage } from "@/lib/db";
import { httpsCallable } from "firebase/functions";
import { getFirebaseFunctions } from "@/integrations/firebase/app";
import { toast, copyToast } from "@/hooks/use-toast";
import { useUpdateEvent } from "@/lib/queries/useEventMutations";
import { queryKeys, useEvents } from "@/lib/queries";
import CreateEventDialog from "@/components/CreateEventDialog";
import CreateDraftWithVenueHandoffDialog from "@/components/CreateDraftWithVenueHandoffDialog";
import InviteCollaboratorDialog from "@/components/InviteCollaboratorDialog";
import { FileText, Send, X, Archive, Ban, Search, Clock, ExternalLink, Copy, Music, Video, ChevronDown, ChevronLeft, ChevronRight, Mail, CalendarCheck, MapPin, Check, XCircle, Loader2, Globe, Link2, Flag } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { ProfilePreviewPopover } from "@/components/ProfilePreviewPopover";
import { useUser, type SharedProfile } from "@/lib/user-context";
import { useAllProfiles } from "@/lib/queries/useProfilesQuery";
import { useAuth } from "@/lib/auth-context";
import { formatCurrency, type BookingRequest, type Event } from "@/lib/models";
import {
  senderTypeForVenueLabels,
  senderTypeForPerformerLabels,
  performerTypeLabels,
} from "@/lib/enums";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

type BookingRequestUpdate = Partial<Pick<BookingRequest, "status" | "event_id">>;

// sender_type vocabulary depends on the role being requested (venue vs performer);
// fall back to the raw value if a record arrives with an unknown key.
function senderTypeLabel(req: BookingRequest): string | undefined {
  if (!req.sender_type) return undefined;
  const labels = req.target_role === "venue"
    ? senderTypeForVenueLabels as Record<string, string>
    : req.target_role === "performer"
      ? senderTypeForPerformerLabels as Record<string, string>
      : undefined;
  return labels?.[req.sender_type] ?? req.sender_type;
}

function performerTypeLabel(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return (performerTypeLabels as Record<string, string>)[value] ?? value;
}

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-[hsl(var(--warning)/0.12)] text-[hsl(var(--warning))] border-[hsl(var(--warning)/0.3)]",
  accepted: "bg-[hsl(var(--success)/0.12)] text-[hsl(var(--success))] border-[hsl(var(--success)/0.3)]",
  declined: "bg-[hsl(var(--destructive)/0.12)] text-[hsl(var(--destructive))] border-[hsl(var(--destructive)/0.3)]",
  draft_created: "bg-[hsl(var(--info)/0.12)] text-[hsl(var(--info))] border-[hsl(var(--info)/0.3)]",
  archived: "bg-muted text-muted-foreground border-border",
  blocked: "bg-[hsl(var(--destructive)/0.12)] text-[hsl(var(--destructive))] border-[hsl(var(--destructive)/0.3)]",
  flagged: "bg-[hsl(var(--destructive)/0.12)] text-[hsl(var(--destructive))] border-[hsl(var(--destructive)/0.3)]",
};

const SOURCE_LABELS: Record<string, string> = {
  profile: "Profile",
  availability: "Availability",
  widget: "Widget",
  performer_offer: "Performer offer",
  venue_handoff_collab: "Collaborate invite",
};

const STATUS_FILTERS = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "accepted", label: "Accepted" },
  { value: "declined", label: "Declined" },
  { value: "archived", label: "Archived" },
  { value: "blocked", label: "Blocked" },
];

const PAGE_SIZE = 25;
const FETCH_SIZE = 50;

/**
 * Collapse a list of performer-relevant events so each booking appears once:
 * - One entry per (parentEventId || id)
 * - When a parent and any of its children are both present, hide the parent
 *   and keep only one child entry per parent (the first one encountered).
 *
 * Pure helper exported for unit testing the deduplication used by the
 * Incoming Requests page.
 */
export function dedupeInvitationEvents(events: Event[]): Event[] {
  // Sort: events without parentEventId (parents) come first so we can detect
  // them before deciding whether to keep their children.
  const sorted = [...events].sort((a, b) => {
    if (a.parentEventId && !b.parentEventId) return 1;
    if (!a.parentEventId && b.parentEventId) return -1;
    return 0;
  });
  const childParentIds = new Set(
    sorted.filter((e) => e.parentEventId).map((e) => e.parentEventId!),
  );
  const seenBookingKey = new Set<string>();
  const out: Event[] = [];
  for (const e of sorted) {
    // If this event is a parent that has children in the list, drop the parent.
    if (!e.parentEventId && childParentIds.has(e.id)) continue;
    const key = e.parentEventId || e.id;
    if (seenBookingKey.has(key)) continue;
    seenBookingKey.add(key);
    out.push(e);
  }
  return out;
}

export default function IncomingRequestsPage() {
  const navigate = useNavigate();
  const { currentUser } = useUser();
  // `useAllProfiles()` is the source of truth for access matching — includes both
  // owned profiles and ones the user is a member of (admin/editor). The slot Record
  // on `useUser().profiles` silently drops duplicates by slot, so two profiles
  // sharing a slot key would disappear from `Object.entries(profiles)` reads.
  const allProfiles = useAllProfiles();
  const { user: firebaseUser } = useAuth();
  const queryClient = useQueryClient();
  const currency = currentUser.currency || "EUR";
  const allEvents = useEvents();
  const updateEventMutation = useUpdateEvent();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    debounceRef.current = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(debounceRef.current);
  }, [search]);

  const [statusFilter, setStatusFilter] = useState<string>(
    () => localStorage.getItem("incomingRequestsFilter") ?? "all"
  );
  const [profileFilter, setProfileFilter] = useState<string>("all");
  const [page, setPage] = useState(0);
  const handleFilterChange = (value: string) => {
    setStatusFilter(value);
    setPage(0);
    localStorage.setItem("incomingRequestsFilter", value);
  };

  const profileOptions = useMemo(
    () =>
      allProfiles
        .filter((p) => p.created && p.id)
        .map((p) => ({ id: p.id!, slug: p.slug ?? "", name: p.name, role: p.role })),
    [allProfiles],
  );

  // Memoize the profile-id list separately so the query key + queryFn capture
  // an identity-stable array (filter+sort so equal-membership re-renders don't
  // bust the cache).
  const myProfileIds = useMemo(
    () =>
      allProfiles
        .map((p) => p.id)
        .filter((id): id is string => !!id)
        .sort(),
    [allProfiles],
  );

  // Reset to first page when filters change
  useEffect(() => {
    setPage(0);
  }, [debouncedSearch, statusFilter, profileFilter]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [activeRequest, setActiveRequest] = useState<BookingRequest | null>(null);
  const [dialogMode, setDialogMode] = useState<"draft" | "offer">("draft");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteEventName, setInviteEventName] = useState("");
  const [inviteEventId, setInviteEventId] = useState("");
  const [detailRequest, setDetailRequest] = useState<BookingRequest | null>(null);
  const [handoffRequest, setHandoffRequest] = useState<BookingRequest | null>(null);

  const firestoreFilters = useMemo(() => {
    if (statusFilter === "all") return {};
    return { status: statusFilter };
  }, [statusFilter]);

  // Same pattern as useEventsQuery: keep the cache key stable across profile
  // load so we don't flash a fresh skeleton each time the profile set settles.
  // Invalidate in-place when the user's profile set changes so the wider access
  // scope is picked up without dropping the previously loaded data on the floor.
  const profileKey = myProfileIds.join(",");
  const bookingRequestsKey = queryKeys.bookingRequests(firestoreFilters as Record<string, unknown>);
  useEffect(() => {
    if (!firebaseUser?.uid) return;
    queryClient.invalidateQueries({ queryKey: bookingRequestsKey });
    // bookingRequestsKey identity is incidental; the load-bearing trigger is
    // profileKey + filter change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileKey, firebaseUser?.uid, statusFilter, queryClient]);

  const {
    data: paginatedData,
    isPending: loading,
    isFetchingNextPage,
    fetchNextPage,
    hasNextPage,
  } = useInfiniteQuery<BookingRequestPage, Error>({
    queryKey: bookingRequestsKey,
    enabled: !!firebaseUser?.uid && myProfileIds.length > 0,
    staleTime: 5 * 60 * 1000,
    initialPageParam: null as QueryDocumentSnapshot | null,
    queryFn: ({ pageParam }) =>
      fetchBookingRequestPage(FETCH_SIZE, pageParam, firestoreFilters, myProfileIds),
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? lastPage.lastDoc : undefined,
  });

  const allRequests = useMemo(
    () =>
      (paginatedData?.pages ?? []).flatMap((p) => p.requests) as BookingRequest[],
    [paginatedData],
  );

  // Fetch more from Firestore when user pages past loaded data
  const neededCount = (page + 1) * PAGE_SIZE;
  useEffect(() => {
    if (neededCount > allRequests.length && hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [neededCount, allRequests.length, hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Auto-fetch all remaining pages when search is active so client-side filtering is comprehensive
  useEffect(() => {
    if (debouncedSearch && hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [debouncedSearch, hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Event invitations: events where the user is the performer.
  // Read from `allProfiles` (flat list) so member-of profiles are included —
  // not the slot Record which silently drops slot collisions.
  const myArtistProfileIds = useMemo(() => {
    const ids: string[] = [];
    for (const p of allProfiles) {
      if (p.role === "performer" && p.id) {
        if (profileFilter !== "all" && p.id !== profileFilter) continue;
        ids.push(p.id);
      }
    }
    return ids;
  }, [allProfiles, profileFilter]);

  const allInvitations = useMemo(() => {
    const matched = allEvents.filter(e =>
      e.performerProfileId &&
      myArtistProfileIds.includes(e.performerProfileId) &&
      !e.archived &&
      e.eventStatus !== "draft"
    );
    return dedupeInvitationEvents(matched);
  }, [allEvents, myArtistProfileIds]);

  const eventInvitations = useMemo(() => {
    return allInvitations.filter(e => {
      if (e.eventStatus === "on_hold") return false; // shown in holds section
      const invStatus = e.performerResponse === "declined"
        ? "declined"
        : e.eventStatus === "suggested"
          ? "pending"
          : "accepted";

      if (statusFilter === "all") return invStatus !== "declined";
      return statusFilter === invStatus;
    });
  }, [allInvitations, statusFilter]);

  const holdEvents = useMemo(() => {
    // allInvitations already collapses parent + children to a single booking entry,
    // but we re-apply dedupe defensively in case raw data flows in differently.
    return dedupeInvitationEvents(allInvitations.filter(e => e.eventStatus === "on_hold"));
  }, [allInvitations]);

  const handleAcceptInvitation = (event: Event) => {
    updateEventMutation.mutate({ id: event.id, updates: { eventStatus: "pending", performerResponse: "accepted" } });
    toast({ title: "Invitation accepted", description: `"${event.name}" is now pending.` });
  };

  const handleDeclineInvitation = (event: Event) => {
    updateEventMutation.mutate({ id: event.id, updates: { performerResponse: "declined" } });
    toast({ title: "Invitation declined", description: `The host will be notified.` });
  };

  const handleConfirmHold = (event: Event) => {
    updateEventMutation.mutate({ id: event.id, updates: { eventStatus: "pending" } });
    // Cancel sibling holds on the same date
    const siblings = holdEvents.filter(e => e.id !== event.id && e.date === event.date);
    for (const s of siblings) {
      updateEventMutation.mutate({ id: s.id, updates: { eventStatus: "cancelled" } });
    }
    toast({
      title: "Date accepted, event is now pending.",
      description: siblings.length > 0 ? `${siblings.length} competing hold(s) cancelled.` : undefined,
    });
  };

  const handleDeclineHold = (event: Event) => {
    updateEventMutation.mutate({ id: event.id, updates: { eventStatus: "cancelled" } });
    toast({ title: "Hold declined" });
  };

  const updateMutation = useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: BookingRequestUpdate }) =>
      updateBookingRequest(id, updates as Record<string, unknown>),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["bookingRequests"] }),
  });

  const updateStatus = (id: string, status: string, eventId?: string) => {
    const updates: BookingRequestUpdate = { status };
    if (eventId) updates.event_id = eventId;
    updateMutation.mutate({ id, updates });
  };

  const handleOpenDialog = (req: BookingRequest, mode: "draft" | "offer") => {
    setActiveRequest(req);
    setDialogMode(mode);
    setDialogOpen(true);
  };

  const handleEventCreated = (eventId: string) => {
    if (!activeRequest) return;
    const newStatus = dialogMode === "offer" ? "accepted" : "draft_created";
    updateStatus(activeRequest.id, newStatus, eventId);
    if (dialogMode === "offer") {
      setInviteEventId(eventId);
      setInviteEventName(activeRequest.artist_name);
      setInviteEmail(activeRequest.email);
      setInviteOpen(true);
      toast({ title: "Event created", description: "Now invite the requester as a collaborator." });
    } else {
      toast({ title: "Draft event created" });
      navigate({ to: "/events/$id", params: { id: eventId } });
    }
    setActiveRequest(null);
  };

  const handleDecline = (req: BookingRequest) => {
    updateStatus(req.id, "declined");
    toast({ title: "Request declined" });
  };

  const handleArchive = (req: BookingRequest) => {
    updateStatus(req.id, "archived");
    toast({ title: "Request archived" });
  };

  const handleBlock = (req: BookingRequest) => {
    updateStatus(req.id, "blocked");
    toast({ title: "Email blocked", description: `${req.email} will no longer be able to submit requests.` });
  };

  // Flag a collaborate invite as spam (Phase 3 close-out). Server callable
  // verifies the caller owns/admins the reporter profile, dedups per-reporter
  // so a second flag is a no-op for the counter, and at 3 distinct flags in
  // 90 days auto-suspends the performer's collab-invite flow.
  const flagMutation = useMutation({
    mutationFn: async (req: BookingRequest) => {
      if (!req.sender_profile_id || !req.target_profile_id) {
        throw new Error("This request is missing the routing metadata needed to flag it.");
      }
      const fn = httpsCallable<
        {
          performerProfileId: string;
          reporterProfileId: string;
          context: { kind: "venue_handoff_collab"; id: string };
        },
        { ok: true; distinctFlagsLast90d: number; suspended: boolean }
      >(getFirebaseFunctions(), "flagSenderAsSpam");
      const res = await fn({
        performerProfileId: req.sender_profile_id,
        reporterProfileId: req.target_profile_id,
        context: { kind: "venue_handoff_collab", id: req.id },
      });
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bookingRequests"] });
      toast({ title: "Flagged as spam", description: "Thanks — we'll review." });
    },
    onError: (err: Error) => {
      toast({
        title: "Could not flag",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const handleFlagSpam = (req: BookingRequest) => {
    flagMutation.mutate(req);
  };

  // When a specific status is selected, Firestore already filters — only apply client-side
  // filtering for "all" (hide archived/blocked), profile, and text search.
  const filtered = allRequests.filter(r => {
    if (statusFilter === "all" && (r.status === "archived" || r.status === "blocked" || r.status === "draft_created")) return false;
    if (profileOptions.length > 1 && profileFilter !== "all") {
      const selected = profileOptions.find(p => p.id === profileFilter);
      if (!selected || !selected.slug || r.target_profile_slug !== selected.slug) return false;
    }
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase();
      return r.name.toLowerCase().includes(q) || r.artist_name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q);
    }
    return true;
  });

  const pageStart = page * PAGE_SIZE;
  const pageEnd = pageStart + PAGE_SIZE;
  const paginatedFiltered = filtered.slice(pageStart, pageEnd);
  const totalLoaded = filtered.length;
  const canGoPrev = page > 0;
  const canGoNext = pageEnd < totalLoaded || hasNextPage;

  const pendingInvitationCount = allInvitations.filter(e => e.eventStatus === "suggested" && e.performerResponse !== "declined").length;
  const pendingCount = allRequests.filter(r => r.status === "pending").length + pendingInvitationCount;

  const groupedByEmail = useMemo(() => {
    const map = new Map<string, BookingRequest[]>();
    for (const req of paginatedFiltered) {
      // Group by requester email so one person's multiple requests appear bundled
      const key = req.email.toLowerCase();
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(req);
    }
    return Array.from(map.entries()).sort((a, b) =>
      new Date(b[1][0].created_at).getTime() - new Date(a[1][0].created_at).getTime()
    );
  }, [paginatedFiltered]);

  const prefillData = activeRequest ? {
    artistName: activeRequest.artist_name,
    date: activeRequest.wanted_date,
    fee: activeRequest.artist_fee || undefined,
    contactEmail: dialogMode === "offer" ? activeRequest.email : undefined,
    contactName: activeRequest.name,
    sourceRequestId: activeRequest.id,
    sourceRequestDate: activeRequest.wanted_date,
  } : undefined;

  const hasLinkedEvent = (req: BookingRequest) => !!req.event_id && req.event_id !== "";

  const handleCardClick = (req: BookingRequest) => {
    if (hasLinkedEvent(req)) {
      navigate({ to: "/events/$id", params: { id: req.event_id } });
    } else {
      setDetailRequest(req);
    }
  };

  // True when the request was sent TO a performer profile (i.e. an operator
  // pinging a performer to ask if they'll play). Free Artists viewing these
  // can't create regular events (rule blocks performer-as-host), but they
  // CAN spin up a draft + invite the venue to manage it on shoWMe.
  const isPerformerRecipient = (req: BookingRequest) => req.target_role === "performer";

  // Resolve the performer profile this request targets, so the handoff dialog
  // knows which performer to attach as collaborator on the new event AND can
  // run its own profile-completeness gate before sending the invite.
  const findPerformerProfileForRequest = (req: BookingRequest): SharedProfile | null => {
    if (req.target_profile_id) {
      const match = allProfiles.find((p) => p.id === req.target_profile_id);
      if (match?.id) return match;
    }
    // Fallback to slug for legacy requests that pre-date the target_profile_id backfill.
    if (req.target_profile_slug) {
      const match = allProfiles.find((p) => p.slug === req.target_profile_slug);
      if (match?.id) return match;
    }
    return null;
  };

  const renderRequestCard = (req: BookingRequest, isSingle: boolean) => (
    <div
      key={req.id}
      className={cn(
        "rounded-xl border bg-card p-4 shadow-sm cursor-pointer hover:border-primary/40 transition-colors",
        (req.status === "declined" || req.status === "blocked") && "opacity-60",
      )}
      onClick={() => handleCardClick(req)}
    >
      <div className="flex items-start gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="font-semibold text-sm">{req.artist_name}</span>
            <Badge variant="outline" className={cn("text-[10px]", STATUS_COLORS[req.status])}>
              {req.status === "draft_created" ? "Draft Created" : req.status}
            </Badge>
            <Badge variant="outline" className="text-[10px]">{SOURCE_LABELS[req.source] || req.source}</Badge>
            {hasLinkedEvent(req) && <ExternalLink className="h-3.5 w-3.5 text-primary" />}
          </div>
          <div className="text-xs text-muted-foreground space-y-0.5">
            {isSingle && (
              <p>
                <span className="font-medium">From:</span> {req.name} · {req.email}
                <button
                  className="inline-flex items-center ml-1 p-0.5 rounded hover:bg-muted transition-colors"
                  title="Copy email"
                  onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(req.email); copyToast("Email copied"); }}
                >
                  <Copy className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                </button>
                {req.phone ? ` · ${req.phone}` : ""}
              </p>
            )}
            <p><span className="font-medium">Wanted date:</span> {req.wanted_date}</p>
            {req.artist_fee != null && req.artist_fee > 0 && (
              <p><span className="font-medium">Fee:</span> {formatCurrency(req.artist_fee, currency)}</p>
            )}
            {req.music_url && (
              <p><a href={req.music_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline" onClick={e => e.stopPropagation()}><Music className="h-3 w-3" /> Music Link</a></p>
            )}
            {req.video_url && (
              <p><a href={req.video_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline" onClick={e => e.stopPropagation()}><Video className="h-3 w-3" /> Video Link</a></p>
            )}
            {req.note && <p className="mt-1 text-muted-foreground/80 italic">"{req.note}"</p>}
          </div>
          {(req.performer_type || (req.genres && req.genres.length > 0)) && (
            <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
              {req.performer_type && (
                <Badge variant="secondary" className="text-[10px]">
                  {performerTypeLabel(req.performer_type)}
                </Badge>
              )}
              {req.genres?.map((g) => (
                <Badge key={g} variant="outline" className="text-[10px]">{g}</Badge>
              ))}
            </div>
          )}
          {(req.website_url || (req.social_links && req.social_links.length > 0)) && (
            <div className="mt-1.5 flex items-center gap-2 flex-wrap text-[11px]">
              {req.website_url && (
                <a
                  href={req.website_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={e => e.stopPropagation()}
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  <Globe className="h-3 w-3" /> Website
                </a>
              )}
              {req.social_links?.map((link, i) => (
                <a
                  key={`${link.platform}-${i}`}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={e => e.stopPropagation()}
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  <Link2 className="h-3 w-3" /> {link.platform}
                </a>
              ))}
            </div>
          )}
          <div className="flex items-center gap-1 mt-1.5 text-[10px] text-muted-foreground">
            <Clock className="h-3 w-3" />
            {new Date(req.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
          </div>
        </div>
        <div className="flex flex-col gap-1.5 shrink-0" onClick={e => e.stopPropagation()}>
          {req.status === "pending" && (
            <>
              {isPerformerRecipient(req) ? (
                // Performer recipient: only the handoff flow makes sense.
                // Performer can't host events; the "Make Offer" path doesn't apply.
                <Button
                  size="sm"
                  variant="default"
                  className="text-xs gap-1"
                  onClick={() => setHandoffRequest(req)}
                >
                  <FileText className="h-3 w-3" /> Create Draft & Invite Venue
                </Button>
              ) : (
                <>
                  <Button size="sm" variant="default" className="text-xs gap-1" onClick={() => handleOpenDialog(req, "draft")}>
                    <FileText className="h-3 w-3" /> Create Draft
                  </Button>
                  <Button size="sm" variant="outline" className="text-xs gap-1" onClick={() => handleOpenDialog(req, "offer")}>
                    <Send className="h-3 w-3" /> Make Offer
                  </Button>
                </>
              )}
              <Button size="sm" variant="outline" className="text-xs gap-1 text-destructive hover:text-destructive" onClick={() => handleDecline(req)}>
                <X className="h-3 w-3" /> Decline
              </Button>
              <Button size="sm" variant="ghost" className="text-xs gap-1 text-destructive hover:text-destructive" onClick={() => handleBlock(req)}>
                <Ban className="h-3 w-3" /> Block
              </Button>
              {req.source === "venue_handoff_collab" && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-xs gap-1 text-destructive hover:text-destructive"
                  onClick={() => handleFlagSpam(req)}
                  disabled={flagMutation.isPending}
                  title="Flag as spam — sender claims a prior conversation that didn't happen"
                >
                  <Flag className="h-3 w-3" /> Flag as spam
                </Button>
              )}
            </>
          )}
          {req.status !== "archived" && (
            <Button size="sm" variant="ghost" className="text-xs gap-1" onClick={() => handleArchive(req)}>
              <Archive className="h-3 w-3" /> Archive
            </Button>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <AppLayout>
      <div className="animate-fade-in">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              Incoming Requests
              {pendingCount > 0 && (
                <Badge className="ml-3 bg-primary text-primary-foreground">{pendingCount}</Badge>
              )}
            </h1>
            <p className="mt-1 text-muted-foreground">Manage booking requests from artists, agents, and venues</p>
          </div>
        </div>

        <div className="mb-4 flex flex-col gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search by name, artist, email..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full rounded-lg border bg-card pl-10 pr-4 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="flex items-start justify-between gap-4">
            <div className="flex gap-1 flex-wrap">
              {STATUS_FILTERS.map(f => (
                <button
                  key={f.value}
                  onClick={() => handleFilterChange(f.value)}
                  className={cn(
                    "px-3 py-1.5 rounded-full text-xs font-medium transition-colors",
                    statusFilter === f.value
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:text-foreground",
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
            {profileOptions.length > 1 && (
              <div className="flex gap-1 flex-wrap justify-end shrink-0">
                <button
                  onClick={() => setProfileFilter("all")}
                  className={cn(
                    "px-3 py-1.5 rounded-full text-xs font-medium transition-colors",
                    profileFilter === "all"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:text-foreground",
                  )}
                >
                  All profiles
                </button>
                {profileOptions.map(p => (
                  <button
                    key={p.id}
                    onClick={() => setProfileFilter(p.id)}
                    className={cn(
                      "px-3 py-1.5 rounded-full text-xs font-medium transition-colors",
                      profileFilter === p.id
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Event Invitations */}
        {eventInvitations.length > 0 && (
          <div className="mb-6 space-y-3">
            <div className="flex items-center gap-2">
              <CalendarCheck className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold">Event Invitations</h2>
              <Badge className="bg-primary text-primary-foreground text-[10px]">{eventInvitations.length}</Badge>
            </div>
            {eventInvitations.map(event => {
              const invStatus = event.performerResponse === "declined"
                ? "declined"
                : event.eventStatus === "suggested"
                  ? "pending"
                  : "accepted";
              return (
              <div key={event.id} className={cn("rounded-xl border-2 bg-card p-4 shadow-sm", invStatus === "pending" ? "border-primary/20" : "border-border")}>
                <div className="flex items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="font-semibold text-sm">{event.name}</span>
                      <Badge variant="outline" className={cn("text-[10px]", STATUS_COLORS[invStatus] || STATUS_COLORS.pending)}>
                        {invStatus === "pending" ? "Invitation" : invStatus === "accepted" ? "Accepted" : "Declined"}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground space-y-0.5">
                      <p className="flex items-center gap-1">
                        <CalendarCheck className="h-3 w-3" />
                        <Link to="/calendar" search={{ date: event.date }} className="hover:underline hover:text-foreground transition-colors">
                          {new Date(event.date + "T00:00").toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" })}
                        </Link>
                      </p>
                      <p className="flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        <ProfilePreviewPopover name={event.venue} />
                      </p>
                      <p>
                        <span className="font-medium">From:</span> {event.operator}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5 shrink-0">
                    {invStatus === "pending" && (
                      <>
                        <Button size="sm" className="text-xs gap-1" onClick={() => handleAcceptInvitation(event)}>
                          <Check className="h-3 w-3" /> Accept
                        </Button>
                        <Button size="sm" variant="outline" className="text-xs gap-1 text-destructive hover:text-destructive" onClick={() => handleDeclineInvitation(event)}>
                          <XCircle className="h-3 w-3" /> Decline
                        </Button>
                      </>
                    )}
                    <Button size="sm" variant="outline" className="text-xs gap-1" onClick={() => navigate({ to: "/events/$id", params: { id: event.id } })}>
                      <ExternalLink className="h-3 w-3" /> View
                    </Button>
                  </div>
                </div>
              </div>
              );
            })}
          </div>
        )}

        {/* Holds */}
        {holdEvents.length > 0 && (
          <div className="mb-6 space-y-3">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-amber-500" />
              <h2 className="text-sm font-semibold">Holds</h2>
              <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200 text-[10px]">{holdEvents.length}</Badge>
            </div>
            {holdEvents.map(event => (
              <div key={event.id} className="rounded-xl border-2 border-amber-200 dark:border-amber-800 bg-card p-4 shadow-sm">
                <div className="flex items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="font-semibold text-sm">{event.name}</span>
                      <Badge variant="outline" className="text-[10px] bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border-amber-300">On Hold</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground space-y-0.5">
                      <p className="flex items-center gap-1">
                        <CalendarCheck className="h-3 w-3" />
                        <Link to="/calendar" search={{ date: event.date }} className="hover:underline hover:text-foreground transition-colors">
                          {new Date(event.date + "T00:00").toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" })}
                        </Link>
                      </p>
                      <p className="flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        <ProfilePreviewPopover name={event.venue} />
                      </p>
                      <p><span className="font-medium">From:</span> {event.operator}</p>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5 shrink-0">
                    <Button size="sm" className="text-xs gap-1" onClick={() => handleConfirmHold(event)}>
                      <Check className="h-3 w-3" /> Accept date
                    </Button>
                    <Button size="sm" variant="outline" className="text-xs gap-1 text-destructive hover:text-destructive" onClick={() => handleDeclineHold(event)}>
                      <XCircle className="h-3 w-3" /> Decline
                    </Button>
                    <Button size="sm" variant="outline" className="text-xs gap-1" onClick={() => navigate({ to: "/events/$id", params: { id: event.id } })}>
                      <ExternalLink className="h-3 w-3" /> View
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {loading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="rounded-xl border bg-card p-4 shadow-sm space-y-2">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-16 rounded-full" />
                </div>
                <Skeleton className="h-3 w-64" />
                <Skeleton className="h-3 w-48" />
              </div>
            ))}
          </div>
        ) : paginatedFiltered.length === 0 && eventInvitations.length === 0 && holdEvents.length === 0 ? (
          <div className="rounded-xl border bg-card shadow-sm py-16 text-center">
            <p className="text-muted-foreground">No requests found</p>
          </div>
        ) : paginatedFiltered.length > 0 ? (
          <>
            <div className="space-y-3">
              {groupedByEmail.map(([email, reqs]) => {
                const senderName = reqs[0].name;
                const pendingInGroup = reqs.filter(r => r.status === "pending").length;
                const isSingle = reqs.length === 1;

                if (isSingle) return renderRequestCard(reqs[0], true);

                return (
                  <Collapsible key={email} defaultOpen>
                    <CollapsibleTrigger className="w-full">
                      <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg border bg-card hover:border-primary/40 transition-colors group">
                        <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className="font-medium text-sm">{senderName}</span>
                        <span className="text-xs text-muted-foreground">({email})</span>
                        <Badge variant="outline" className="text-[10px] ml-1">{reqs.length} requests</Badge>
                        {pendingInGroup > 0 && (
                          <Badge className="text-[10px] bg-primary text-primary-foreground ml-1">{pendingInGroup} pending</Badge>
                        )}
                        <ChevronDown className="h-4 w-4 text-muted-foreground ml-auto group-data-[state=open]:rotate-180 transition-transform" />
                      </div>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="space-y-2 mt-2 ml-4 border-l-2 border-muted pl-3">
                        {reqs.map(req => renderRequestCard(req, false))}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                );
              })}
            </div>

            {/* Pagination controls */}
            <div className="mt-6 flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Showing {pageStart + 1}–{Math.min(pageEnd, totalLoaded)} of {totalLoaded}{hasNextPage ? "+" : ""} booking requests
                {eventInvitations.length > 0 && ` · ${eventInvitations.length} event invitation${eventInvitations.length === 1 ? "" : "s"}`}
                {holdEvents.length > 0 && ` · ${holdEvents.length} hold${holdEvents.length === 1 ? "" : "s"}`}
              </p>
              <div className="flex items-center gap-2">
                {isFetchingNextPage && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!canGoPrev}
                  onClick={() => setPage(p => p - 1)}
                >
                  <ChevronLeft className="h-4 w-4 mr-1" /> Prev
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!canGoNext}
                  onClick={() => setPage(p => p + 1)}
                >
                  Next <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </div>
          </>
        ) : null}
      </div>

      <CreateEventDialog
        trigger={<span className="hidden" />}
        externalOpen={dialogOpen}
        onExternalOpenChange={setDialogOpen}
        prefillData={prefillData}
        onEventCreated={handleEventCreated}
      />

      <InviteCollaboratorDialog
        open={inviteOpen}
        onOpenChange={open => {
          setInviteOpen(open);
          if (!open && inviteEventId) navigate({ to: "/events/$id", params: { id: inviteEventId } });
        }}
        eventName={inviteEventName}
        eventId={inviteEventId}
        defaultEmail={inviteEmail}
      />

      {handoffRequest && (() => {
        const performer = findPerformerProfileForRequest(handoffRequest);
        if (!performer) return null;
        return (
          <CreateDraftWithVenueHandoffDialog
            open={true}
            onOpenChange={(o) => { if (!o) setHandoffRequest(null); }}
            performerProfile={performer}
            defaultVenueName={handoffRequest.name}
            defaultVenueEmail={handoffRequest.email}
            defaultDate={handoffRequest.wanted_date}
            defaultFee={handoffRequest.artist_fee}
            sourceRequestId={handoffRequest.id}
            onCreated={(eventId) => {
              updateStatus(handoffRequest.id, "draft_created", eventId);
              setHandoffRequest(null);
              // In-platform path returns an empty eventId (no draft event
              // exists yet — the venue creates it on accept). Navigate to
              // /sent-requests so the performer can track the outbound row.
              if (eventId) {
                navigate({ to: "/events/$id", params: { id: eventId } });
              } else {
                navigate({ to: "/sent-requests" });
              }
            }}
          />
        );
      })()}

      <Dialog open={!!detailRequest} onOpenChange={open => { if (!open) setDetailRequest(null); }}>
        <DialogContent className="sm:max-w-lg">
          {detailRequest && (
            <>
              <DialogHeader>
                <DialogTitle className="font-display">{detailRequest.artist_name}</DialogTitle>
              </DialogHeader>
              <div className="space-y-3 text-sm">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className={cn("text-xs", STATUS_COLORS[detailRequest.status])}>
                    {detailRequest.status === "draft_created" ? "Draft Created" : detailRequest.status}
                  </Badge>
                  <Badge variant="outline" className="text-xs">{SOURCE_LABELS[detailRequest.source] || detailRequest.source}</Badge>
                </div>
                <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
                  <span className="text-muted-foreground font-medium">Name</span><span>{detailRequest.name}</span>
                  {senderTypeLabel(detailRequest) && (
                    <><span className="text-muted-foreground font-medium">Sender Type</span><span>{senderTypeLabel(detailRequest)}</span></>
                  )}
                  <span className="text-muted-foreground font-medium">Email</span>
                  <span className="flex items-center gap-1">
                    {detailRequest.email}
                    <button className="p-0.5 rounded hover:bg-muted" onClick={() => { navigator.clipboard.writeText(detailRequest.email); copyToast("Email copied"); }}>
                      <Copy className="h-3 w-3 text-muted-foreground" />
                    </button>
                  </span>
                  {detailRequest.phone && (
                    <><span className="text-muted-foreground font-medium">Phone</span><span>{detailRequest.phone}</span></>
                  )}
                  <span className="text-muted-foreground font-medium">Wanted Date</span><span>{detailRequest.wanted_date}</span>
                  {detailRequest.artist_fee != null && detailRequest.artist_fee > 0 && (
                    <><span className="text-muted-foreground font-medium">Fee</span><span>{formatCurrency(detailRequest.artist_fee, currency)}</span></>
                  )}
                  {detailRequest.performer_type && (
                    <><span className="text-muted-foreground font-medium">Performer Type</span><span>{performerTypeLabel(detailRequest.performer_type)}</span></>
                  )}
                  {detailRequest.website_url && (
                    <>
                      <span className="text-muted-foreground font-medium">Website</span>
                      <a href={detailRequest.website_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline truncate">
                        {detailRequest.website_url}
                      </a>
                    </>
                  )}
                </div>
                {detailRequest.genres && detailRequest.genres.length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground font-medium mb-1.5">Genres</p>
                    <div className="flex flex-wrap gap-1.5">
                      {detailRequest.genres.map((g) => (
                        <Badge key={g} variant="outline" className="text-xs">{g}</Badge>
                      ))}
                    </div>
                  </div>
                )}
                {detailRequest.social_links && detailRequest.social_links.length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground font-medium mb-1.5">Social Links</p>
                    <div className="space-y-1">
                      {detailRequest.social_links.map((link, i) => (
                        <a
                          key={`${link.platform}-${i}`}
                          href={link.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 text-sm text-primary hover:underline"
                        >
                          <Link2 className="h-3.5 w-3.5 shrink-0" />
                          <span className="font-medium text-foreground">{link.platform}</span>
                          <span className="truncate text-xs">{link.url}</span>
                        </a>
                      ))}
                    </div>
                  </div>
                )}
                {(detailRequest.music_url || detailRequest.video_url) && (
                  <div className="flex gap-3">
                    {detailRequest.music_url && (
                      <a href={detailRequest.music_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-primary hover:underline text-sm">
                        <Music className="h-3.5 w-3.5" /> Music Link
                      </a>
                    )}
                    {detailRequest.video_url && (
                      <a href={detailRequest.video_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-primary hover:underline text-sm">
                        <Video className="h-3.5 w-3.5" /> Video Link
                      </a>
                    )}
                  </div>
                )}
                {detailRequest.note && (
                  <div className="rounded-lg bg-muted/50 p-3 italic text-muted-foreground">"{detailRequest.note}"</div>
                )}
                <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  Received {new Date(detailRequest.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
