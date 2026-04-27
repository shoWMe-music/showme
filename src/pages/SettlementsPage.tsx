import { useState, useMemo, useEffect } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useNavigate } from "@tanstack/react-router";
import AppLayout from "@/components/AppLayout";
import StatusBadge from "@/components/StatusBadge";
import { useUser } from "@/lib/user-context";
import { formatCurrency, SettlementStatus, settlementStatusLabels } from "@/lib/models";
import { Plus, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { SETTLEMENT_STATUS_DOT } from "@/components/settlements/settlementConstants";
import { usePaginatedEvents, useAllEventEconomics } from "@/lib/queries";

export default function SettlementsPage() {
  const { canCreate, currentUser } = useUser();
  const navigate = useNavigate();
  const [starterOpen, setStarterOpen] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>(
    () => localStorage.getItem("settlementsFilter") ?? "all"
  );
  const handleFilterStatusChange = (value: string) => {
    setFilterStatus(value);
    localStorage.setItem("settlementsFilter", value);
  };
  const [filterArtist, setFilterArtist] = useState("");
  const [filterName, setFilterName] = useState("");
  const [page, setPage] = useState(1);

  const PAGE_SIZE = 25;
  const FETCH_SIZE = 50;

  // Fetch only concluded events from Firestore
  const {
    data: paginatedData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isSuccess: eventsLoaded,
  } = usePaginatedEvents(FETCH_SIZE, { status: "concluded" });

  const events = useMemo(
    () => paginatedData?.pages.flatMap((p) => p.events) ?? [],
    [paginatedData],
  );

  // Load economics for all loaded concluded events in parallel
  const concludedEventIds = events
    .filter((e) => !e.archived)
    .map((e) => e.id);
  const allEconomics = useAllEventEconomics(concludedEventIds);

  const eventsWithSettlements = events.filter(
    (e) => !e.archived && allEconomics[e.id]?.settlement
  );

  const filteredEvents = eventsWithSettlements.filter(e => {
    const s = allEconomics[e.id]?.settlement;
    if (!s) return false;
    if (filterStatus !== "all" && s.status !== filterStatus) return false;
    if (filterArtist && !e.artist.toLowerCase().includes(filterArtist.toLowerCase())) return false;
    if (filterName && !e.name.toLowerCase().includes(filterName.toLowerCase())) return false;
    return true;
  });

  const paginatedEvents = filteredEvents.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const canGoNext = page * PAGE_SIZE < filteredEvents.length || hasNextPage;

  // Reset page when filters change
  useEffect(() => { setPage(1); }, [filterStatus, filterArtist, filterName]);

  // Fetch more events when user pages past loaded data
  useEffect(() => {
    if (page * PAGE_SIZE > events.length && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [page, events.length, hasNextPage, isFetchingNextPage, fetchNextPage]);

  const economicsLoaded =
    concludedEventIds.length === 0 || concludedEventIds.every((id) => id in allEconomics);

  const legend: [SettlementStatus, string][] = Object.entries(settlementStatusLabels) as [SettlementStatus, string][];

  const settleableEvents = events.filter(
    e => !e.archived && allEconomics[e.id]?.settlement?.status === "open"
  );

  return (
    <AppLayout>
      <div className="animate-fade-in">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Settlements</h1>
            <p className="mt-1 text-muted-foreground">Track and manage settlement status across all events</p>
          </div>
          {canCreate && (
            <Button className="gap-2" onClick={() => setStarterOpen(true)}>
              <Plus className="h-4 w-4" /> New Settlement
            </Button>
          )}
        </div>

        <div className="mb-4 flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
          {legend.map(([status, label]) => (
            <span key={status} className="flex items-center gap-1.5">
              <span className={cn("h-2 w-2 rounded-full", SETTLEMENT_STATUS_DOT[status])} />
              {label}
            </span>
          ))}
        </div>

        <div className="mb-4 flex items-center gap-3 flex-wrap">
          <Input placeholder="Search event name…" value={filterName} onChange={e => setFilterName(e.target.value)} className="w-48 h-9 text-sm" />
          <Input placeholder="Search performer…" value={filterArtist} onChange={e => setFilterArtist(e.target.value)} className="w-48 h-9 text-sm" />
          <Select value={filterStatus} onValueChange={handleFilterStatusChange}>
            <SelectTrigger className="w-44 h-9 text-sm"><SelectValue placeholder="All statuses" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {legend.map(([status, label]) => (
                <SelectItem key={status} value={status}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Event</th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Performer</th>
                <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">Total</th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Status</th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Approvals</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {!eventsLoaded || !economicsLoaded ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="px-6 py-4"><Skeleton className="h-4 w-40" /></td>
                    <td className="px-6 py-4"><Skeleton className="h-4 w-28" /></td>
                    <td className="px-6 py-4 text-right"><Skeleton className="h-4 w-20 ml-auto" /></td>
                    <td className="px-6 py-4"><Skeleton className="h-5 w-24 rounded-full" /></td>
                    <td className="px-6 py-4"><Skeleton className="h-4 w-10" /></td>
                  </tr>
                ))
              ) : (
                <>
                  {paginatedEvents.map((event) => {
                    const s = allEconomics[event.id]?.settlement;
                    if (!s) return null;
                    const total = s.artistPayout + s.promoterPayout + s.venuePayout + s.commissionPayouts.reduce((sum, c) => sum + c.payout, 0);
                    const approvedCount = s.approvals.filter(a => a.approved).length;
                    return (
                      <tr key={event.id} className="transition-colors hover:bg-muted/30 cursor-pointer" onClick={() => navigate({ to: "/settlements/$id", params: { id: event.id } })}>
                        <td className="px-6 py-4"><span className="font-medium hover:text-primary transition-colors">{event.name}</span></td>
                        <td className="px-6 py-4 text-sm">{event.artist}</td>
                        <td className="px-6 py-4 text-sm font-semibold font-display text-right">{formatCurrency(total, currentUser.currency)}</td>
                        <td className="px-6 py-4"><StatusBadge status={s.status} /></td>
                        <td className="px-6 py-4 text-sm text-muted-foreground">{approvedCount}/{s.approvals.length}</td>
                      </tr>
                    );
                  })}
                  {filteredEvents.length === 0 && (
                    <tr><td colSpan={5} className="px-6 py-12 text-center text-muted-foreground">No settlements match the current filters.</td></tr>
                  )}
                </>
              )}
            </tbody>
          </table>
        </div>

        {eventsLoaded && filteredEvents.length > PAGE_SIZE && (
          <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
            <span className="flex items-center gap-2">
              Showing {Math.min((page - 1) * PAGE_SIZE + 1, filteredEvents.length)}–{Math.min(page * PAGE_SIZE, filteredEvents.length)} of {filteredEvents.length}{hasNextPage ? "+" : ""} settlements
              {isFetchingNextPage && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            </span>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" className="h-8 w-8" disabled={page === 1} onClick={() => setPage(p => p - 1)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="px-2">Page {page}</span>
              <Button variant="outline" size="icon" className="h-8 w-8" disabled={!canGoNext} onClick={() => setPage(p => p + 1)}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>

      <Dialog open={starterOpen} onOpenChange={setStarterOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create Settlement</DialogTitle>
            <DialogDescription>Select a concluded event to start its settlement</DialogDescription>
          </DialogHeader>
          {settleableEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">No concluded events available for settlement. Events must reach "Concluded" status first.</p>
          ) : (
            <div className="space-y-2 py-2 max-h-80 overflow-y-auto">
              {settleableEvents.map(event => (
                <button key={event.id} className="w-full text-left rounded-lg border p-3 hover:bg-muted/50 transition-colors" onClick={() => { setStarterOpen(false); navigate({ to: "/settlements/$id", params: { id: event.id } }); }}>
                  <p className="font-medium text-sm">{event.name}</p>
                  <p className="text-xs text-muted-foreground">{event.artist} · {event.venue} · {event.date}</p>
                </button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
