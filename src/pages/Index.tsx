import AppLayout from "@/components/AppLayout";
import { EventStatusBadge } from "@/components/StatusBadge";
import StatusBadge from "@/components/StatusBadge";
import { useEvents, useAllEventEconomics, useEventsLoaded } from "@/lib/queries";
import { Skeleton } from "@/components/ui/skeleton";
import type { DealStructure, TicketRevenue, Settlement } from "@/lib/models";
import {
  formatCurrency,
  calculateSettlement,
  type SettlementStatus,
  type EventStatus,
} from "@/lib/models";
import { Link } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import {
  Calendar,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
  Search,
  Clock,
  PauseCircle,
  XCircle,
  BarChart3,
  Users,
  ListTodo,
  MessageSquare,
  FileEdit,
  Eye,
  Inbox,
  CircleDot,
  PartyPopper,
  Filter,
  Trash2,
  CalendarRange,
  Send,
  TicketCheck,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ProfilePreviewPopover } from "@/components/ProfilePreviewPopover";

// ─── To-Do Section ───────────────────────────────────────────────
function TodoSection({
  events,
  settlements,
  deals,
  revenue,
}: {
  events: import("@/lib/models").Event[];
  settlements: Record<string, Settlement>;
  deals: Record<string, DealStructure>;
  revenue: Record<string, TicketRevenue>;
}) {
  const [completedTodos, setCompletedTodos] = useState<Set<string>>(new Set());
  const [removedTodos, setRemovedTodos] = useState<Set<string>>(new Set());

  const allTodos = useMemo(() => {
    const items: { id: string; icon: React.ElementType; label: string; link: string; priority: number }[] = [];

    events.forEach((e) => {
      if (e.archived) return;

      // Concluded but not finalized
      const s = settlements[e.id];
      if (e.eventStatus === "concluded" && s && s.status !== "finalized" && s.status !== "paid") {
        items.push({
          id: `finalize-${e.id}`,
          icon: CheckCircle2,
          label: `Finalize settlement for "${e.name}"`,
          link: `/settlements/${e.id}`,
          priority: 1,
        });
      }

      // Settlement open and event concluded → send for review
      if (e.eventStatus === "concluded" && s && s.status === "open") {
        items.push({
          id: `send-review-${e.id}`,
          icon: Send,
          label: `Send settlement for review: "${e.name}"`,
          link: `/settlements/${e.id}`,
          priority: 2,
        });
      }

      // Settlements with comments to review
      if (s && s.status === "comments_received") {
        items.push({
          id: `comments-${e.id}`,
          icon: MessageSquare,
          label: `Review comments on "${e.name}"`,
          link: `/settlements?event=${e.id}&tab=settlement#comments`,
          priority: 2,
        });
      }

      // Pending events → confirm
      if (e.eventStatus === "pending") {
        items.push({
          id: `confirm-${e.id}`,
          icon: Clock,
          label: `Confirm pending event "${e.name}"`,
          link: `/events/${e.id}`,
          priority: 3,
        });
      }

      // On-hold events
      if (e.eventStatus === "on_hold") {
        items.push({
          id: `onhold-${e.id}`,
          icon: PauseCircle,
          label: `Decide on "${e.name}" (on hold)`,
          link: `/events/${e.id}`,
          priority: 3,
        });
      }

      // Update ticket revenue for confirmed events with zero revenue
      const rev = revenue[e.id];
      if (e.eventStatus === "confirmed" && rev && rev.ticketTypes && rev.ticketTypes.every(t => t.sold === 0)) {
        items.push({
          id: `revenue-${e.id}`,
          icon: TicketCheck,
          label: `Update ticket revenue for "${e.name}"`,
          link: `/event-manager?event=${e.id}&tab=details`,
          priority: 5,
        });
      }

      // Draft events missing key fields
      if (e.eventStatus === "draft" && (!e.date || !e.artist || !e.venue)) {
        items.push({
          id: `draft-${e.id}`,
          icon: FileEdit,
          label: `Complete details for "${e.name}"`,
          link: `/events/${e.id}`,
          priority: 4,
        });
      }
    });

    // Fill in the gaps — detect date gaps between confirmed events
    const confirmedWithDates = events
      .filter(e => !e.archived && e.eventStatus === "confirmed" && e.date)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    for (let i = 0; i < confirmedWithDates.length - 1; i++) {
      const curr = new Date(confirmedWithDates[i].date);
      const next = new Date(confirmedWithDates[i + 1].date);
      const diffDays = Math.round((next.getTime() - curr.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays > 14) {
        const startStr = curr.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
        const endStr = next.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
        items.push({
          id: `gap-${confirmedWithDates[i].id}-${confirmedWithDates[i + 1].id}`,
          icon: CalendarRange,
          label: `Fill the gap: no events between ${startStr} and ${endStr}`,
          link: `/calendar`,
          priority: 6,
        });
      }
    }

    items.sort((a, b) => a.priority - b.priority);
    return items;
  }, [events, settlements, revenue]);

  const filteredTodos = allTodos.filter(t => !removedTodos.has(t.id));
  const visibleTodos = filteredTodos.slice(0, 5);
  const hasMore = filteredTodos.length > 5;

  const toggleComplete = (id: string) => {
    setCompletedTodos(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const removeTodo = (id: string) => {
    setRemovedTodos(prev => new Set(prev).add(id));
    setCompletedTodos(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  return (
    <div>
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-2">
        <ListTodo className="h-4 w-4" /> To Do
      </h2>
      <p className="text-xs text-muted-foreground mb-3">
        These tasks are suggested by the system. You can mark them done and remove them as you wish. The system will suggest new tasks.
      </p>
      {visibleTodos.length === 0 ? (
        <div className="rounded-xl border bg-card p-5 shadow-sm text-center">
          <PartyPopper className="h-6 w-6 mx-auto mb-2 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">You're all caught up!</p>
        </div>
      ) : (
        <div className="rounded-xl border bg-card shadow-sm divide-y">
          {visibleTodos.map((todo) => {
            const isCompleted = completedTodos.has(todo.id);
            return (
              <div
                key={todo.id}
                className={`flex items-center gap-3 px-4 py-3 transition-colors ${isCompleted ? "bg-muted/30" : ""}`}
              >
                <button
                  onClick={() => toggleComplete(todo.id)}
                  className="shrink-0"
                  title={isCompleted ? "Undo" : "Mark done"}
                >
                  <CheckCircle2
                    className={`h-4 w-4 transition-colors ${
                      isCompleted ? "text-[hsl(var(--success))] fill-[hsl(var(--success))]/20" : "text-muted-foreground hover:text-primary"
                    }`}
                  />
                </button>
                <Link
                  to={todo.link}
                  className={`text-sm flex-1 min-w-0 truncate transition-colors hover:text-primary ${
                    isCompleted ? "line-through text-muted-foreground" : ""
                  }`}
                >
                  {todo.label}
                </Link>
                <button
                  onClick={() => removeTodo(todo.id)}
                  className="shrink-0 text-muted-foreground hover:text-destructive transition-colors"
                  title="Remove task"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
          {hasMore && (
            <Link
              to="/tasks"
              className="flex items-center justify-center gap-1.5 px-4 py-3 text-sm text-muted-foreground hover:text-primary hover:bg-muted/30 transition-colors"
            >
              View all {filteredTodos.length} tasks <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Activity Feed ───────────────────────────────────────────────
interface ActivityItem {
  id: string;
  eventName: string;
  eventId: string;
  description: string;
  date: string;
  icon: "comment" | "revision" | "status" | "collaborator" | "upload";
}

function ActivityFeed({
  events,
  settlements,
}: {
  events: import("@/lib/models").Event[];
  settlements: Record<string, Settlement>;
}) {
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());

  const activities = useMemo(() => {
    const items: ActivityItem[] = [];

    events.forEach((e) => {
      if (e.archived) return;

      // Settlement comments
      const s = settlements[e.id];
      if (s) {
        s.comments.forEach((c, ci: number) => {
          items.push({
            id: `${e.id}-c-${ci}`,
            eventName: e.name,
            eventId: e.id,
            description: `${c.party} commented: "${c.message.slice(0, 60)}${c.message.length > 60 ? "…" : ""}"`,
            date: c.date,
            icon: "comment",
          });
        });

        s.revisions.forEach((r, ri: number) => {
          items.push({
            id: `${e.id}-r-${ri}`,
            eventName: e.name,
            eventId: e.id,
            description: `${r.by} revised: ${r.changes.slice(0, 60)}${r.changes.length > 60 ? "…" : ""}`,
            date: r.date,
            icon: "revision",
          });
        });
      }

      // Event status (non-draft)
      if (e.eventStatus && e.eventStatus !== "draft") {
        const label = e.eventStatus === "confirmed" ? "Event confirmed" : e.eventStatus === "concluded" ? "Event concluded" : e.eventStatus === "on_hold" ? "Event on hold" : e.eventStatus === "cancelled" ? "Event cancelled" : `Status: ${e.eventStatus}`;
        items.push({
          id: `${e.id}-status`,
          eventName: e.name,
          eventId: e.id,
          description: label,
          date: e.date || new Date().toISOString(),
          icon: "status",
        });
      }

      // Published events
      if (e.published) {
        items.push({
          id: `${e.id}-published`,
          eventName: e.name,
          eventId: e.id,
          description: "Event published",
          date: e.date || new Date().toISOString(),
          icon: "status",
        });
      }

    });

    items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return items;
  }, [events, settlements]);

  const visibleActivities = activities.filter((a) => !removedIds.has(a.id)).slice(0, 5);

  const activityIcon = (type: ActivityItem["icon"]) => {
    switch (type) {
      case "comment": return <MessageSquare className="h-4 w-4 text-muted-foreground shrink-0" />;
      case "revision": return <FileEdit className="h-4 w-4 text-muted-foreground shrink-0" />;
      case "status": return <CircleDot className="h-4 w-4 text-muted-foreground shrink-0" />;
      case "collaborator": return <Users className="h-4 w-4 text-muted-foreground shrink-0" />;
      case "upload": return <Inbox className="h-4 w-4 text-muted-foreground shrink-0" />;
    }
  };

  return (
    <div>
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
        <Eye className="h-4 w-4" /> Recent Activity
      </h2>
      {visibleActivities.length === 0 ? (
        <div className="rounded-xl border bg-card p-5 shadow-sm text-center">
          <p className="text-sm text-muted-foreground">No recent activity.</p>
        </div>
      ) : (
        <div className="rounded-xl border bg-card shadow-sm divide-y">
          {visibleActivities.map((a) => (
            <div key={a.id} className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-muted/50">
              {activityIcon(a.icon)}
              <Link
                to={a.eventId ? `/settlements/${a.eventId}` : "#"}
                className="min-w-0 flex-1"
              >
                <p className="text-sm font-medium truncate">{a.eventName}</p>
                <p className="text-xs text-muted-foreground truncate">{a.description}</p>
              </Link>
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {new Date(a.date).toLocaleDateString()}
              </span>
              <button
                onClick={() => setRemovedIds((prev) => new Set(prev).add(a.id))}
                className="shrink-0 p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                title="Dismiss"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Settlement Status Filter ────────────────────────────────────
const SETTLEMENT_FILTERS: { value: SettlementStatus | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "pending_review", label: "Pending Review" },
  { value: "comments_received", label: "Comments" },
  { value: "finalized", label: "Finalized" },
  { value: "partly_paid", label: "Partly Paid" },
  { value: "paid", label: "Paid" },
];

// ─── Dashboard ───────────────────────────────────────────────────
export default function Dashboard() {
  const eventsLoaded = useEventsLoaded();
  const events = useEvents();
  const eventIds = events.map((e) => e.id);
  const allEconomics = useAllEventEconomics(eventIds);

  // Build flat maps from economics data (mirrors previous store shape)
  const settlements: Record<string, Settlement> = {};
  const deals: Record<string, DealStructure> = {};
  const revenue: Record<string, TicketRevenue> = {};
  for (const [id, econ] of Object.entries(allEconomics)) {
    if (econ.settlement) settlements[id] = econ.settlement;
    if (econ.deal) deals[id] = econ.deal;
    if (econ.revenue) revenue[id] = econ.revenue;
  }
  const [searchQuery, setSearchQuery] = useState("");
  const [settlementFilter, setSettlementFilter] = useState<SettlementStatus | "all">("all");

  const filteredEvents = events.filter((e) => {
    if (e.archived) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (!e.name.toLowerCase().includes(q) && !e.artist.toLowerCase().includes(q) && !e.venue.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const getSettlementTotal = (s: typeof settlements[string]) =>
    s.artistPayout + s.promoterPayout + s.venuePayout + s.commissionPayouts.reduce((sum, c) => sum + c.payout, 0);

  const totalSettled = Object.values(settlements)
    .filter(s => s.status === "finalized" || s.status === "paid")
    .reduce((sum, s) => sum + getSettlementTotal(s), 0);

  // Event stats (exclude archived)
  const activeEvents = events.filter(e => !e.archived);
  const confirmedCount = activeEvents.filter(e => e.eventStatus === "confirmed").length;
  const pendingEventCount = activeEvents.filter(e => e.eventStatus === "pending").length;
  const onHoldCount = activeEvents.filter(e => e.eventStatus === "on_hold").length;
  const concludedCount = activeEvents.filter(e => e.eventStatus === "concluded").length;

  // Settlement stats
  const pendingReviewCount = Object.values(settlements).filter(s => s.status === "pending_review").length;
  const commentsCount = Object.values(settlements).filter(s => s.status === "comments_received").length;
  const finalizedCount = Object.values(settlements).filter(s => s.status === "finalized").length;

  // Banner: events needing attention
  const concludedNotFinalized = events.filter(
    e => e.eventStatus === "concluded" && settlements[e.id] && settlements[e.id].status !== "finalized" && settlements[e.id].status !== "paid"
  ).length;

  const eventStats = [
    { label: "Total Events", value: activeEvents.length, icon: Calendar, color: "text-foreground" },
    { label: "Confirmed", value: confirmedCount, icon: CheckCircle2, color: "text-[hsl(var(--event-confirmed))]" },
    { label: "Pending", value: pendingEventCount, icon: Clock, color: "text-[hsl(var(--event-pending))]" },
    { label: "On Hold", value: onHoldCount, icon: PauseCircle, color: "text-[hsl(var(--event-on-hold))]" },
  ];

  const settlementStats = [
    { label: "Total Settled", value: formatCurrency(totalSettled), icon: TrendingUp, color: "text-[hsl(var(--success))]" },
    { label: "Pending Review", value: pendingReviewCount, icon: AlertTriangle, color: "text-warning" },
    { label: "Finalized", value: finalizedCount, icon: CheckCircle2, color: "text-[hsl(var(--success))]" },
    { label: "Concluded Events", value: concludedCount, icon: Calendar, color: "text-[hsl(var(--event-concluded))]" },
  ];

  // Filtered settlement events
  const settlementEvents = filteredEvents
    .filter(e => {
      const s = settlements[e.id];
      if (!s) return false;
      if (e.eventStatus !== "concluded" && s.status === "open") return false;
      if (settlementFilter !== "all" && s.status !== settlementFilter) return false;
      return true;
    })
    .slice(0, 10);

  // Helper to get operator's share for finalized settlements
  const getOperatorShare = (eventId: string) => {
    const deal = deals[eventId];
    const rev = revenue[eventId];
    const event = events.find(e => e.id === eventId);
    if (!deal || !rev || !event) return null;

    try {
      const calc = calculateSettlement(deal, rev);
      const opType = event.operatorType;
      const breakdown = calc.partyBreakdowns.find(
        (b) =>
          b.party.toLowerCase() === opType ||
          (opType === "promoter" && b.party === "Promoter") ||
          (opType === "venue" && b.party === "Venue") ||
          (opType === "organizer" && b.party === "Organizer")
      );
      return breakdown?.finalPayout ?? null;
    } catch {
      return null;
    }
  };

  if (!eventsLoaded) {
    return (
      <AppLayout>
        <div>
          <div className="mb-8">
            <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
            <Skeleton className="h-4 w-64 mt-1" />
          </div>

          {/* To Do + Recent Activity skeletons */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            <div>
              <Skeleton className="h-4 w-24 mb-3" />
              <div className="rounded-xl border bg-card shadow-sm divide-y">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-3">
                    <Skeleton className="h-4 w-4 rounded-full shrink-0" />
                    <Skeleton className="h-4 flex-1" />
                  </div>
                ))}
              </div>
            </div>
            <div>
              <Skeleton className="h-4 w-32 mb-3" />
              <div className="rounded-xl border bg-card shadow-sm divide-y">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 px-5 py-3">
                    <Skeleton className="h-4 w-4 shrink-0" />
                    <div className="flex-1 min-w-0 space-y-1">
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-3 w-1/2" />
                    </div>
                    <Skeleton className="h-3 w-16 shrink-0" />
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Events stats skeleton */}
          <Skeleton className="h-4 w-16 mb-3" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-8">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-xl border bg-card p-5 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-5 w-5 rounded" />
                </div>
                <Skeleton className="h-8 w-16 mt-2" />
              </div>
            ))}
          </div>

          {/* Settlements stats skeleton */}
          <Skeleton className="h-4 w-24 mb-3" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-8">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-xl border bg-card p-5 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-5 w-5 rounded" />
                </div>
                <Skeleton className="h-8 w-20 mt-2" />
              </div>
            ))}
          </div>

          {/* Recent Settlements skeleton */}
          <div className="rounded-xl border bg-card shadow-sm">
            <div className="flex items-center justify-between border-b px-6 py-4">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-4 w-16" />
            </div>
            <div className="px-6 py-3 border-b space-y-2">
              <Skeleton className="h-9 w-full" />
              <div className="flex gap-1.5">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-7 w-16 rounded-md" />
                ))}
              </div>
            </div>
            <div className="divide-y">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between px-6 py-4">
                  <div className="flex items-center gap-4">
                    <Skeleton className="h-10 w-10 rounded-lg shrink-0" />
                    <div className="space-y-1.5">
                      <Skeleton className="h-4 w-40" />
                      <Skeleton className="h-3 w-56" />
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-5 w-20" />
                    <Skeleton className="h-6 w-20 rounded-full" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="animate-fade-in">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-muted-foreground">Overview of your events and settlements</p>
        </div>

        {/* To Do + Recent Activity side by side */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          <TodoSection events={events} settlements={settlements} deals={deals} revenue={revenue} />
          <ActivityFeed events={events} settlements={settlements} />
        </div>

        {/* Events stats */}
        <div className="mb-2">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Events</h2>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-8">
          {eventStats.map((stat) => (
            <div key={stat.label} className="rounded-xl border bg-card p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-muted-foreground">{stat.label}</p>
                <stat.icon className={`h-5 w-5 ${stat.color}`} />
              </div>
              <p className="mt-2 text-2xl font-bold font-display">{stat.value}</p>
            </div>
          ))}
        </div>

        {/* Settlements stats */}
        <div className="mb-2">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Settlements</h2>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-8">
          {settlementStats.map((stat) => (
            <div key={stat.label} className="rounded-xl border bg-card p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-muted-foreground">{stat.label}</p>
                <stat.icon className={`h-5 w-5 ${stat.color}`} />
              </div>
              <p className="mt-2 text-2xl font-bold font-display">{stat.value}</p>
            </div>
          ))}
        </div>

        {/* Enhanced banner */}
        {(commentsCount > 0 || pendingReviewCount > 0 || concludedNotFinalized > 0) && (
          <div className="mb-8 space-y-2">
            {commentsCount > 0 && (
              <div className="rounded-xl border-2 border-info/20 bg-info/5 p-4">
                <div className="flex items-center gap-2">
                  <MessageSquare className="h-5 w-5 text-info" />
                  <span className="font-semibold text-info">
                    {commentsCount} settlement{commentsCount > 1 ? "s" : ""} with comments to review
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">Review comments and revise settlements as needed.</p>
              </div>
            )}
            {pendingReviewCount > 0 && (
              <div className="rounded-xl border-2 border-warning/20 bg-warning/5 p-4">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-warning" />
                  <span className="font-semibold text-warning">
                    {pendingReviewCount} settlement{pendingReviewCount > 1 ? "s" : ""} pending review
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">These settlements are awaiting stakeholder review.</p>
              </div>
            )}
            {concludedNotFinalized > 0 && (
              <div className="rounded-xl border-2 border-primary/20 bg-primary/5 p-4">
                <div className="flex items-center gap-2">
                  <CircleDot className="h-5 w-5 text-primary" />
                  <span className="font-semibold text-primary">
                    {concludedNotFinalized} concluded event{concludedNotFinalized > 1 ? "s" : ""} not yet finalized
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">Finalize settlements for concluded events to process payouts.</p>
              </div>
            )}
          </div>
        )}

        {/* Recent Settlements */}
        <div className="rounded-xl border bg-card shadow-sm">
          <div className="flex items-center justify-between border-b px-6 py-4">
            <h2 className="font-display text-lg font-semibold">Recent Settlements</h2>
            <Link to="/settlements" className="flex items-center gap-1 text-sm font-medium text-primary hover:underline">
              View all <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          <div className="px-6 py-3 border-b space-y-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search events, artists, venues..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 h-9"
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {SETTLEMENT_FILTERS.map((f) => (
                <Button
                  key={f.value}
                  size="sm"
                  variant={settlementFilter === f.value ? "default" : "outline"}
                  className="h-7 text-xs px-2.5"
                  onClick={() => setSettlementFilter(f.value)}
                >
                  {f.label}
                </Button>
              ))}
            </div>
          </div>

          <div className="divide-y">
            {settlementEvents.length === 0 && (
              <div className="px-6 py-8 text-center text-sm text-muted-foreground">
                No settlements match your filters.
              </div>
            )}
            {settlementEvents.map((event) => {
              const s = settlements[event.id];
              const total = s.artistPayout + s.promoterPayout + s.venuePayout + s.commissionPayouts.reduce((sum, c) => sum + c.payout, 0);
              const isFinalized = s.status === "finalized" || s.status === "paid";
              const operatorShare = isFinalized ? getOperatorShare(event.id) : null;

              return (
                <Link
                  key={event.id}
                  to="/settlements/$id"
                  params={{ id: event.id }}
                  className="flex items-center justify-between px-6 py-4 transition-colors hover:bg-muted/50"
                >
                  <div className="flex items-center gap-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary font-display font-bold text-sm">
                      {event.artist.charAt(0)}
                    </div>
                    <div>
                      <p className="font-medium">{event.name}</p>
                      <p className="text-sm text-muted-foreground">
                        <ProfilePreviewPopover name={event.artist} profileId={event.performerProfileId} /> · <ProfilePreviewPopover name={event.venue} />
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <span className="text-sm font-semibold font-display">{formatCurrency(total)}</span>
                      {operatorShare !== null && (
                        <p className="text-xs text-muted-foreground">
                          Your share: <span className="font-semibold text-foreground">{formatCurrency(operatorShare)}</span>
                        </p>
                      )}
                    </div>
                    <StatusBadge status={s.status} />
                  </div>
                </Link>
              );
            })}
          </div>
        </div>

        {/* Analytics Section */}
        <div className="mt-8">
          <div className="mb-2">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
              <BarChart3 className="h-4 w-4" /> Analytics
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {/* Revenue by Performer */}
            <div className="rounded-xl border bg-card p-5 shadow-sm">
              <h3 className="text-sm font-semibold mb-3">Top Performers by Revenue</h3>
              <div className="space-y-2">
                {events
                  .filter(e => e.eventStatus === "concluded" && settlements[e.id])
                  .sort((a, b) => {
                    const sa = settlements[a.id], sb = settlements[b.id];
                    const ta = sa.artistPayout + sa.promoterPayout + sa.venuePayout + sa.commissionPayouts.reduce((s, c) => s + c.payout, 0);
                    const tb = sb.artistPayout + sb.promoterPayout + sb.venuePayout + sb.commissionPayouts.reduce((s, c) => s + c.payout, 0);
                    return tb - ta;
                  })
                  .slice(0, 5)
                  .map((e) => {
                    const s = settlements[e.id];
                    const total = s.artistPayout + s.promoterPayout + s.venuePayout + s.commissionPayouts.reduce((sum, c) => sum + c.payout, 0);
                    return (
                      <div key={e.id} className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground truncate"><ProfilePreviewPopover name={e.artist} profileId={e.performerProfileId} /></span>
                        <span className="text-sm font-semibold font-display">{formatCurrency(total)}</span>
                      </div>
                    );
                  })}
                {events.filter(e => e.eventStatus === "concluded").length === 0 && (
                  <p className="text-xs text-muted-foreground">No concluded events yet.</p>
                )}
              </div>
            </div>

            {/* Venue Utilization */}
            <div className="rounded-xl border bg-card p-5 shadow-sm">
              <h3 className="text-sm font-semibold mb-3">Events by Venue</h3>
              <div className="space-y-2">
                {Object.entries(
                  events.reduce((acc, e) => {
                    acc[e.venue] = (acc[e.venue] || 0) + 1;
                    return acc;
                  }, {} as Record<string, number>)
                )
                  .sort(([, a], [, b]) => b - a)
                  .slice(0, 5)
                  .map(([venue, count]) => (
                    <div key={venue} className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground truncate">{venue}</span>
                      <Badge variant="secondary" className="text-xs">{count} event{count > 1 ? "s" : ""}</Badge>
                    </div>
                  ))}
              </div>
            </div>

            {/* Status Distribution */}
            <div className="rounded-xl border bg-card p-5 shadow-sm">
              <h3 className="text-sm font-semibold mb-3">Event Status Distribution</h3>
              <div className="space-y-2">
                {(["confirmed", "pending", "suggested", "on_hold", "concluded", "cancelled"] as EventStatus[]).map((status) => {
                  const count = activeEvents.filter(e => e.eventStatus === status).length;
                  if (count === 0) return null;
                  const pct = activeEvents.length > 0 ? (count / activeEvents.length) * 100 : 0;
                  return (
                    <div key={status}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-muted-foreground capitalize">{status.replace(/_/g, " ")}</span>
                        <span className="font-medium">{count}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className={`h-full rounded-full bg-[hsl(var(--event-${status.replace(/_/g, "-")}))]`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}

