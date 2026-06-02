import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useInfiniteQuery } from "@tanstack/react-query";
import type { QueryDocumentSnapshot } from "firebase/firestore";
import {
  Clock,
  MapPin,
  Send,
  Mail,
  Inbox,
  CalendarCheck,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import { useUser, type SharedProfile } from "@/lib/user-context";
import { useAllProfiles } from "@/lib/queries/useProfilesQuery";
import { queryKeys } from "@/lib/queries";
import {
  fetchSentBookingRequestPage,
  type SentBookingRequestPage,
} from "@/lib/db";
import { formatCurrency, type BookingRequest } from "@/lib/models";
import CreatePerformerOfferDialog from "@/components/CreatePerformerOfferDialog";

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-[hsl(var(--warning)/0.12)] text-[hsl(var(--warning))] border-[hsl(var(--warning)/0.3)]",
  accepted: "bg-[hsl(var(--success)/0.12)] text-[hsl(var(--success))] border-[hsl(var(--success)/0.3)]",
  declined: "bg-[hsl(var(--destructive)/0.12)] text-[hsl(var(--destructive))] border-[hsl(var(--destructive)/0.3)]",
  expired: "bg-muted text-muted-foreground border-border",
  archived: "bg-muted text-muted-foreground border-border",
  draft_created: "bg-[hsl(var(--info)/0.12)] text-[hsl(var(--info))] border-[hsl(var(--info)/0.3)]",
};

const STATUS_FILTERS = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "accepted", label: "Accepted" },
  { value: "declined", label: "Declined" },
  { value: "archived", label: "Archived" },
];

const PAGE_SIZE = 25;
const FETCH_SIZE = 50;

function formatFee(req: BookingRequest, currency: string): string | null {
  const min = req.offer_fee_min ?? req.artist_fee;
  const max = req.offer_fee_max ?? null;
  if (min == null || min <= 0) return null;
  if (max != null && max > 0 && max !== min) {
    return `${formatCurrency(min, currency)} – ${formatCurrency(max, currency)}`;
  }
  return formatCurrency(min, currency);
}

function formatDate(iso: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function SentRequestsPage() {
  const { user: firebaseUser } = useAuth();
  const { currentUser } = useUser();
  const currency = currentUser.currency || "EUR";

  // Performer profiles the user can send offers from. Read from the flat
  // `useAllProfiles` list (owned + member-of) so band-manager use cases work.
  const allProfiles = useAllProfiles();
  const performerProfiles = useMemo<SharedProfile[]>(
    () => allProfiles.filter((p) => p.role === "performer" && !!p.id),
    [allProfiles],
  );
  const canSendOffers = performerProfiles.length > 0;

  const [composerOpen, setComposerOpen] = useState(false);
  const [composerProfileId, setComposerProfileId] = useState<string>("");

  useEffect(() => {
    if (composerProfileId || performerProfiles.length === 0) return;
    setComposerProfileId(performerProfiles[0].id ?? "");
  }, [composerProfileId, performerProfiles]);

  const composerProfile = useMemo(
    () => performerProfiles.find((p) => p.id === composerProfileId) ?? performerProfiles[0],
    [performerProfiles, composerProfileId],
  );

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [page, setPage] = useState<number>(0);

  // Reset to first page whenever the filter switches.
  useEffect(() => {
    setPage(0);
  }, [statusFilter]);

  const firestoreFilters = useMemo(
    () => (statusFilter === "all" ? {} : { status: statusFilter }),
    [statusFilter],
  );

  const sentRequestsKey = queryKeys.sentBookingRequests(
    firestoreFilters as Record<string, unknown>,
  );

  const {
    data: paginatedData,
    isPending: loading,
    isFetchingNextPage,
    fetchNextPage,
    hasNextPage,
  } = useInfiniteQuery<SentBookingRequestPage, Error>({
    queryKey: sentRequestsKey,
    enabled: !!firebaseUser?.uid,
    staleTime: 5 * 60 * 1000,
    initialPageParam: null as QueryDocumentSnapshot | null,
    queryFn: ({ pageParam }) =>
      fetchSentBookingRequestPage(FETCH_SIZE, pageParam, firestoreFilters),
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? lastPage.lastDoc : undefined,
  });

  const allRequests = useMemo(
    () => (paginatedData?.pages ?? []).flatMap((p) => p.requests),
    [paginatedData],
  );

  // Paginate forward into Firestore when the user moves past the loaded slice.
  const neededCount = (page + 1) * PAGE_SIZE;
  useEffect(() => {
    if (neededCount > allRequests.length && hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [neededCount, allRequests.length, hasNextPage, isFetchingNextPage, fetchNextPage]);

  const visibleRequests = useMemo(
    () => allRequests.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
    [allRequests, page],
  );

  const totalLoaded = allRequests.length;
  const canGoPrev = page > 0;
  const canGoNext = (page + 1) * PAGE_SIZE < totalLoaded || hasNextPage;

  return (
    <AppLayout>
      <div className="animate-fade-in">
        <div className="mb-6 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Sent Requests</h1>
            <p className="mt-1 text-muted-foreground">
              Offers and invitations you&apos;ve sent to venues
            </p>
          </div>
          {canSendOffers && (
            <div className="flex items-center gap-2">
              {performerProfiles.length > 1 && (
                <Select value={composerProfileId} onValueChange={setComposerProfileId}>
                  <SelectTrigger className="w-44 h-9 text-xs">
                    <SelectValue placeholder="From profile" />
                  </SelectTrigger>
                  <SelectContent>
                    {performerProfiles.map((p) => (
                      <SelectItem key={p.id} value={p.id ?? ""}>
                        {p.name || "(unnamed)"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Button onClick={() => setComposerOpen(true)} className="gap-1.5">
                <Send className="h-3.5 w-3.5" /> Send an offer
              </Button>
            </div>
          )}
        </div>

        <div className="mb-5 flex items-center gap-2 flex-wrap">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setStatusFilter(f.value)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                statusFilter === f.value
                  ? "border-foreground bg-foreground text-background"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-xl" />
            ))}
          </div>
        ) : visibleRequests.length === 0 ? (
          <EmptyState
            statusFilter={statusFilter}
            canSendOffers={canSendOffers}
            onSendOffer={() => setComposerOpen(true)}
          />
        ) : (
          <>
            <div className="space-y-3">
              {visibleRequests.map((req) => (
                <SentRequestCard key={req.id} req={req} currency={currency} />
              ))}
            </div>

            <div className="mt-6 flex items-center justify-between text-xs text-muted-foreground">
              <span>
                Showing {page * PAGE_SIZE + 1}–
                {Math.min((page + 1) * PAGE_SIZE, totalLoaded)} of {totalLoaded}
                {hasNextPage ? "+" : ""}
              </span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!canGoPrev}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                >
                  <ChevronLeft className="h-4 w-4 mr-1" /> Previous
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!canGoNext}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </div>
          </>
        )}
      </div>

      {composerProfile && (
        <CreatePerformerOfferDialog
          open={composerOpen}
          onOpenChange={setComposerOpen}
          performerProfile={composerProfile}
        />
      )}
    </AppLayout>
  );
}

function SentRequestCard({
  req,
  currency,
}: {
  req: BookingRequest;
  currency: string;
}) {
  const fee = formatFee(req, currency);
  const linkedEventId = req.event_id || null;

  const cardBody = (
    <div className="flex items-start justify-between gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <span className="font-semibold text-sm">{req.name || "(no venue name)"}</span>
          <Badge
            variant="outline"
            className={cn("text-[10px]", STATUS_COLORS[req.status] ?? STATUS_COLORS.pending)}
          >
            {req.status === "draft_created" ? "Draft Created" : req.status}
          </Badge>
          {req.sent_via === "mailto" && (
            <Badge variant="outline" className="text-[10px] gap-1">
              <Mail className="h-3 w-3" /> mailto:
            </Badge>
          )}
          {req.sent_via === "in_platform" && (
            <Badge variant="outline" className="text-[10px] gap-1">
              <Inbox className="h-3 w-3" /> In-platform
            </Badge>
          )}
        </div>
        <div className="text-xs text-muted-foreground space-y-0.5">
          {req.email && (
            <p>
              <span className="font-medium">To:</span> {req.email}
            </p>
          )}
          <p className="flex items-center gap-1">
            <CalendarCheck className="h-3 w-3" />
            <span className="font-medium">Date:</span> {req.wanted_date}
            {req.additional_dates && req.additional_dates.length > 0 && (
              <span> · +{req.additional_dates.length} more</span>
            )}
          </p>
          {fee && (
            <p>
              <span className="font-medium">Fee:</span> {fee}
            </p>
          )}
          {req.offer_pitch && (
            <p className="mt-1 text-muted-foreground/80 italic line-clamp-2">
              &ldquo;{req.offer_pitch}&rdquo;
            </p>
          )}
        </div>
        {req.declined_reason && (
          <div className="mt-2 rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-1.5 text-[11px] text-destructive">
            <span className="font-medium">Declined reason:</span> {req.declined_reason}
          </div>
        )}
        <div className="mt-1.5 flex items-center gap-1 text-[10px] text-muted-foreground">
          <Clock className="h-3 w-3" />
          {new Date(req.created_at).toLocaleString("en-GB", {
            day: "2-digit",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
          {req.expires_at && (
            <span className="ml-2">· Expires {formatDate(req.expires_at)}</span>
          )}
        </div>
      </div>
      {req.sender_profile_name && (
        <div className="shrink-0 text-right">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">From</p>
          <p className="text-xs font-medium flex items-center gap-1 justify-end">
            <MapPin className="h-3 w-3" /> {req.sender_profile_name}
          </p>
        </div>
      )}
    </div>
  );

  // When the request resolved into an event, make the whole card a link to it.
  if (linkedEventId && req.status === "accepted") {
    return (
      <Link
        to="/events/$id"
        params={{ id: linkedEventId }}
        className="block rounded-xl border bg-card p-4 shadow-sm hover:border-primary/40 transition-colors"
      >
        {cardBody}
      </Link>
    );
  }

  return (
    <div
      className={cn(
        "rounded-xl border bg-card p-4 shadow-sm",
        (req.status === "declined" || req.status === "archived" || req.status === "expired") && "opacity-70",
      )}
    >
      {cardBody}
    </div>
  );
}

function EmptyState({
  statusFilter,
  canSendOffers,
  onSendOffer,
}: {
  statusFilter: string;
  canSendOffers: boolean;
  onSendOffer: () => void;
}) {
  if (statusFilter !== "all") {
    return (
      <div className="rounded-xl border border-dashed bg-muted/20 px-6 py-12 text-center">
        <p className="text-sm text-muted-foreground">
          No requests with status &ldquo;{statusFilter}&rdquo; yet.
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-dashed bg-muted/20 px-6 py-12 text-center">
      <Send className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
      <p className="font-medium text-sm">No requests sent yet</p>
      <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
        Send an offer to a venue to pitch a show. Offers to venues already on shoWMe
        land directly in their incoming requests; for venues that aren&apos;t on the
        platform, we&apos;ll generate a templated email for you to send from your own
        inbox.
      </p>
      {canSendOffers && (
        <Button className="mt-4 gap-1.5" onClick={onSendOffer}>
          <Send className="h-3.5 w-3.5" /> Send your first offer
        </Button>
      )}
    </div>
  );
}
