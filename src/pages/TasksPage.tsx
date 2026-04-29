import { useState, useEffect, useMemo, useCallback } from "react";
import { Link } from "@tanstack/react-router";
import AppLayout from "@/components/AppLayout";
import {
  usePaginatedEvents,
  useAllEventEconomics,
  useUpdateAnyEventMeta,
  type EventEconomicsData,
} from "@/lib/queries";
import type { Event } from "@/lib/models";
import { useUser, type TeamMember } from "@/lib/user-context";
import { useAuth } from "@/lib/auth-context";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { toast as sonnerToast } from "sonner";
import {
  Search, ListTodo, Calendar, User, Bell, ArrowRight, DollarSign,
  CheckCircle2, Clock, PauseCircle, FileEdit, MessageSquare,
  CalendarRange, Send, TicketCheck, Zap, ChevronDown, Plus,
  Mic2, MapPin, CalendarDays, ChevronLeft, ChevronRight, ArrowUpDown, Loader2,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface UserTodo {
  kind: "user";
  id: string;
  title: string;
  completed: boolean;
  completedAt?: string;
  dueDate?: string;
  assignee?: string;
  budgetType?: "cost" | "revenue";
  budgetAmount?: number;
  reminders: { id: string }[];
  eventId: string;
  eventName: string;
  eventDate: string;
  artist: string;
  venue: string;
}

interface ActionItem {
  kind: "action";
  id: string;
  label: string;
  link: string;
  icon: React.ElementType;
  priority: number;
  eventId?: string;
  eventName?: string;
  artist?: string;
  venue?: string;
  assignee?: string;
}

const FILTERS = [
  { value: "all",       label: "All" },
  { value: "action",    label: "Action Items" },
  { value: "todos",     label: "My Tasks" },
  { value: "team",      label: "Team" },
  { value: "system",    label: "System" },
  { value: "overdue",   label: "Overdue" },
  { value: "upcoming",  label: "Next 7 days" },
  { value: "completed", label: "Completed" },
] as const;
type Filter = (typeof FILTERS)[number]["value"];

const GROUP_BY_OPTIONS = [
  { value: "event",    label: "Event" },
  { value: "artist",   label: "Performer" },
  { value: "venue",    label: "Venue" },
  { value: "assignee", label: "Assignee" },
  { value: "dueDate",  label: "Due Date" },
  { value: "none",     label: "No grouping" },
] as const;
type GroupBy = (typeof GROUP_BY_OPTIONS)[number]["value"];

// ─── Action item generation ───────────────────────────────────────────────────

function buildActionItems(
  events: Event[],
  allEconomics: Record<string, EventEconomicsData>,
): ActionItem[] {
  const items: ActionItem[] = [];
  const today = new Date().toISOString().slice(0, 10);

  events.forEach(e => {
    if (e.archived || e.parentEventId) return;
    const econ = allEconomics[e.id];
    const s = econ?.settlement;
    const assignees = econ?.meta?.actionItemAssignees ?? {};
    const base = { eventId: e.id, eventName: e.name, artist: e.artist, venue: e.venue };
    const withAssignee = (id: string) => ({ assignee: assignees[id] });

    if (e.eventStatus === "concluded" && s && s.status !== "finalized" && s.status !== "paid")
      items.push({ kind: "action", id: `finalize-${e.id}`, icon: CheckCircle2, label: `Finalize settlement for "${e.name}"`, link: `/settlements?event=${e.id}`, priority: 1, ...base, ...withAssignee(`finalize-${e.id}`) });
    if (e.eventStatus === "concluded" && s && s.status === "open")
      items.push({ kind: "action", id: `send-review-${e.id}`, icon: Send, label: `Send settlement for review: "${e.name}"`, link: `/settlements?event=${e.id}`, priority: 2, ...base, ...withAssignee(`send-review-${e.id}`) });
    if (s && s.status === "comments_received")
      items.push({ kind: "action", id: `comments-${e.id}`, icon: MessageSquare, label: `Review comments on "${e.name}"`, link: `/settlements?event=${e.id}&tab=settlement#comments`, priority: 2, ...base, ...withAssignee(`comments-${e.id}`) });
    if (e.eventStatus === "pending")
      items.push({ kind: "action", id: `confirm-${e.id}`, icon: Clock, label: `Confirm pending event "${e.name}"`, link: `/events/${e.id}`, priority: 3, ...base, ...withAssignee(`confirm-${e.id}`) });
    if (e.eventStatus === "on_hold")
      items.push({ kind: "action", id: `onhold-${e.id}`, icon: PauseCircle, label: `Decide on "${e.name}" (on hold)`, link: `/events/${e.id}`, priority: 3, ...base, ...withAssignee(`onhold-${e.id}`) });
    const rev = econ?.revenue;
    if (e.eventStatus === "confirmed" && rev?.ticketTypes?.every(t => t.sold === 0))
      items.push({ kind: "action", id: `revenue-${e.id}`, icon: TicketCheck, label: `Update ticket revenue for "${e.name}"`, link: `/events/${e.id}?tab=details`, priority: 5, ...base, ...withAssignee(`revenue-${e.id}`) });
    if (e.eventStatus === "draft" && (!e.date || !e.artist || !e.venue))
      items.push({ kind: "action", id: `draft-${e.id}`, icon: FileEdit, label: `Complete details for "${e.name}"`, link: `/events/${e.id}`, priority: 4, ...base, ...withAssignee(`draft-${e.id}`) });
    if (e.eventStatus === "confirmed" && e.date >= today && !econ?.deal)
      items.push({ kind: "action", id: `nodeal-${e.id}`, icon: FileEdit, label: `Add deal structure for "${e.name}"`, link: `/events/${e.id}?tab=details`, priority: 4, ...base, ...withAssignee(`nodeal-${e.id}`) });
    // Date change confirmation
    const pending = econ?.meta?.pendingDateChange;
    if (pending) {
      const hasPending = Object.values(pending.confirmations).some(c => c.status === "pending");
      if (hasPending) {
        items.push({ kind: "action", id: `datechange-${e.id}`, icon: Calendar, label: `Confirm date change for "${e.name}"`, link: `/events/${e.id}`, priority: 2, ...base, ...withAssignee(`datechange-${e.id}`) });
      }
    }
  });

  // Calendar gap detection (no event association)
  const confirmed = events
    .filter(e => !e.archived && !e.parentEventId && e.eventStatus === "confirmed" && e.date)
    .sort((a, b) => a.date.localeCompare(b.date));
  for (let i = 0; i < confirmed.length - 1; i++) {
    const curr = new Date(confirmed[i].date);
    const next = new Date(confirmed[i + 1].date);
    const diffDays = Math.round((next.getTime() - curr.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays > 14) {
      const fmt = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
      items.push({ kind: "action", id: `gap-${confirmed[i].id}-${confirmed[i + 1].id}`, icon: CalendarRange, label: `Fill the gap: no events between ${fmt(curr)} and ${fmt(next)}`, link: `/calendar`, priority: 6 });
    }
  }

  items.sort((a, b) => a.priority - b.priority);
  // Deduplicate per event (keep highest priority action per event)
  const seen = new Set<string>();
  return items.filter(item => {
    if (!item.eventId) return true;
    if (seen.has(item.eventId)) return false;
    seen.add(item.eventId);
    return true;
  });
}

// ─── Grouping helpers ─────────────────────────────────────────────────────────

function dueDateBucket(dueDate: string | undefined, today: string): string {
  if (!dueDate) return "No due date";
  if (dueDate < today) return "Overdue";
  const diff = Math.round((new Date(dueDate + "T00:00:00").getTime() - new Date(today + "T00:00:00").getTime()) / 86400000);
  if (diff <= 7) return "This week";
  if (diff <= 14) return "Next week";
  return new Date(dueDate + "T00:00:00").toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

const DUE_DATE_BUCKET_ORDER = ["Overdue", "This week", "Next week", "No due date"];

function actionGroupKey(a: ActionItem, groupBy: GroupBy): string {
  switch (groupBy) {
    case "event":    return a.eventId ?? "__general__";
    case "artist":   return a.artist  || "General";
    case "venue":    return a.venue   || "General";
    case "assignee": return a.assignee || "Unassigned";
    case "dueDate":  return "Action Required";
    case "none":     return "__all__";
  }
}

function todoGroupKey(t: UserTodo, groupBy: GroupBy, today: string): string {
  switch (groupBy) {
    case "event":    return t.eventId;
    case "artist":   return t.artist   || "Unknown performer";
    case "venue":    return t.venue    || "Unknown venue";
    case "assignee": return t.assignee || "Unassigned";
    case "dueDate":  return dueDateBucket(t.dueDate, today);
    case "none":     return "__all__";
  }
}

interface GroupEntry { actions: ActionItem[]; todos: UserTodo[] }

function buildGroups(
  actions: ActionItem[],
  todos: UserTodo[],
  groupBy: GroupBy,
  today: string,
): { order: string[]; map: Record<string, GroupEntry> } {
  const order: string[] = [];
  const map: Record<string, GroupEntry> = {};

  const entry = (key: string): GroupEntry => {
    if (!map[key]) { order.push(key); map[key] = { actions: [], todos: [] }; }
    return map[key];
  };

  for (const a of actions) entry(actionGroupKey(a, groupBy)).actions.push(a);
  for (const t of todos)   entry(todoGroupKey(t, groupBy, today)).todos.push(t);

  // Sort due-date buckets
  if (groupBy === "dueDate") {
    order.sort((a, b) => {
      const ia = DUE_DATE_BUCKET_ORDER.indexOf(a);
      const ib = DUE_DATE_BUCKET_ORDER.indexOf(b);
      // "Action Required" always first
      if (a === "Action Required") return -1;
      if (b === "Action Required") return 1;
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a.localeCompare(b);
    });
  }

  // "General" / "__general__" always last
  const generalIdx = order.indexOf("__general__");
  if (generalIdx > 0) { order.splice(generalIdx, 1); order.push("__general__"); }
  const generalIdx2 = order.indexOf("General");
  if (generalIdx2 > 0) { order.splice(generalIdx2, 1); order.push("General"); }

  return { order, map };
}

function groupLabel(groupBy: GroupBy, key: string, events: Event[]): string {
  if (groupBy === "event") {
    if (key === "__general__") return "General";
    const ev = events.find(e => e.id === key);
    return ev ? ev.name : key;
  }
  if (key === "__all__") return "All tasks";
  return key;
}

function groupSubLabel(groupBy: GroupBy, key: string, events: Event[]): string | undefined {
  if (groupBy === "event" && key !== "__general__") {
    const ev = events.find(e => e.id === key);
    return ev?.date;
  }
  return undefined;
}

function groupManageLink(groupBy: GroupBy, key: string): { to: string; params?: Record<string, string>; search?: Record<string, string> } | null {
  if (groupBy === "event" && key !== "__general__") return { to: "/events/$id", params: { id: key }, search: { tab: "todo" } };
  return null;
}

const GROUP_ICONS: Record<GroupBy, React.ElementType> = {
  event:    CalendarDays,
  artist:   Mic2,
  venue:    MapPin,
  assignee: User,
  dueDate:  Calendar,
  none:     ListTodo,
};

const DUE_DATE_ACCENT: Record<string, string> = {
  "Overdue":          "border-l-4 border-l-destructive",
  "This week":        "border-l-4 border-l-amber-500",
  "Next week":        "border-l-4 border-l-blue-400",
  "Action Required":  "border-l-4 border-l-primary",
};

function groupAccentClass(groupBy: GroupBy, key: string): string {
  if (groupBy === "dueDate") return DUE_DATE_ACCENT[key] ?? "";
  return "";
}

const PAGE_SIZE = 25;
const FETCH_SIZE = 50;

// ─── Assignee button ─────────────────────────────────────────────────────────

function AssigneeButton({ assignee, members, onAssign }: {
  assignee?: string;
  members: TeamMember[];
  onAssign: (name: string | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return q ? members.filter(m => m.name.toLowerCase().includes(q)) : members;
  }, [members, search]);

  return (
    <Popover open={open} onOpenChange={o => { setOpen(o); if (!o) setSearch(""); }}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors shrink-0",
            assignee
              ? "border-border bg-muted/50 text-foreground hover:bg-muted"
              : "border-dashed border-muted-foreground/30 text-muted-foreground opacity-0 group-hover/row:opacity-100 hover:border-muted-foreground/60 hover:text-foreground",
          )}
        >
          <User className="h-3 w-3 shrink-0" />
          {assignee ? (() => {
            const member = members.find(m => m.name === assignee);
            return member?.roles?.[0] ? `${assignee} (${member.roles[0]})` : assignee;
          })() : "Assign"}
          <ChevronRight className="h-2.5 w-2.5 text-muted-foreground/50 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-52 p-0" align="end">
        <div className="p-2 border-b">
          <input
            autoFocus
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search members…"
            className="w-full rounded border border-border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <div className="max-h-48 overflow-y-auto py-1">
          {filtered.map(m => (
            <button
              key={m.id}
              onClick={() => { onAssign(m.name); setOpen(false); setSearch(""); }}
              className={cn(
                "w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-muted transition-colors text-left",
                m.name === assignee && "bg-muted font-medium",
              )}
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted-foreground/15 text-[10px] font-semibold">
                {m.name.trim().split(" ").map(p => p[0]).join("").slice(0, 2).toUpperCase()}
              </span>
              <span className="flex-1 truncate">{m.name}</span>
              {m.name === assignee && <span className="text-primary text-xs">✓</span>}
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="px-3 py-2 text-xs text-muted-foreground">No members found</p>
          )}
        </div>
        {assignee && (
          <div className="border-t p-1">
            <button
              onClick={() => { onAssign(undefined); setOpen(false); }}
              className="w-full px-3 py-1.5 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded transition-colors text-left"
            >
              Remove assignee
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function TasksPage() {
  const updateAnyEventMeta = useUpdateAnyEventMeta();
  const { teamMembers, profiles, currentUser } = useUser();
  const { user } = useAuth();
  const [filter, setFilter] = useState<Filter>("all");
  const [groupBy, setGroupBy] = useState<GroupBy>("event");
  const [groupByOpen, setGroupByOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [dismissedActions, setDismissedActions] = useState<Set<string>>(new Set());
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskAssignee, setNewTaskAssignee] = useState(currentUser.name);
  const [newTaskDueDate, setNewTaskDueDate] = useState("");
  const [newTaskEventId, setNewTaskEventId] = useState("");

  const {
    data: paginatedData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isSuccess: eventsLoaded,
  } = usePaginatedEvents(FETCH_SIZE);

  const events = useMemo(
    () => paginatedData?.pages.flatMap((p) => p.events) ?? [],
    [paginatedData],
  );

  // Load economics for all non-archived non-parent events in parallel via TanStack Query
  const activeEventIds = events
    .filter(e => !e.archived && !e.parentEventId)
    .map(e => e.id);
  const allEconomics = useAllEventEconomics(activeEventIds);

  const today = new Date().toISOString().slice(0, 10);
  const sevenDaysOut = useMemo(() => {
    const d = new Date(); d.setDate(d.getDate() + 7); return d.toISOString().slice(0, 10);
  }, []);

  const allActionItems = useMemo(() => {
    const items = buildActionItems(events, allEconomics).filter(a => !dismissedActions.has(a.id));
    return items.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      const dateA = a.eventId ? (events.find(e => e.id === a.eventId)?.date ?? "") : "";
      const dateB = b.eventId ? (events.find(e => e.id === b.eventId)?.date ?? "") : "";
      const cmp = dateA.localeCompare(dateB);
      return sortOrder === "asc" ? cmp : -cmp;
    });
  }, [events, allEconomics, dismissedActions, sortOrder]);

  const allUserTodos = useMemo<UserTodo[]>(() => {
    const tasks: UserTodo[] = [];
    for (const event of events.filter(e => !e.archived)) {
      const meta = allEconomics[event.id]?.meta;
      if (!meta?.todos?.length) continue;
      for (const todo of meta.todos as UserTodo[]) {
        tasks.push({
          kind: "user", ...todo,
          reminders: Array.isArray(todo.reminders) ? todo.reminders : [],
          eventId: event.id, eventName: event.name, eventDate: event.date,
          artist: event.artist, venue: event.venue,
        });
      }
    }
    return tasks.sort((a, b) => {
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      const cmp = a.dueDate.localeCompare(b.dueDate);
      return sortOrder === "asc" ? cmp : -cmp;
    });
  }, [events, allEconomics, sortOrder]);

  // Apply filter + search to produce the sets fed into grouping
  const filteredActions = useMemo(() => {
    if (filter === "todos" || filter === "overdue" || filter === "upcoming" || filter === "team" || filter === "completed") return [];
    let items = allActionItems;
    if (search) {
      const q = search.toLowerCase();
      items = items.filter(a =>
        a.label.toLowerCase().includes(q) ||
        a.eventName?.toLowerCase().includes(q) ||
        a.artist?.toLowerCase().includes(q) ||
        a.venue?.toLowerCase().includes(q),
      );
    }
    // "system" shows only action items (they are system-generated)
    // "action" and "all" also include action items — no extra filtering needed
    return items;
  }, [allActionItems, filter, search]);

  const filteredTodos = useMemo(() => {
    if (filter === "action" || filter === "system") return [];
    return allUserTodos.filter(t => {
      if (search) {
        const q = search.toLowerCase();
        if (!t.title.toLowerCase().includes(q) && !t.eventName.toLowerCase().includes(q) && !t.artist.toLowerCase().includes(q) && !t.venue.toLowerCase().includes(q)) return false;
      }
      switch (filter) {
        case "overdue":   return !t.completed && !!t.dueDate && t.dueDate < today;
        case "upcoming":  return !t.completed && !!t.dueDate && t.dueDate >= today && t.dueDate <= sevenDaysOut;
        case "completed": return t.completed;
        case "team":      return !t.completed && !!t.assignee && t.assignee !== currentUser.name;
        default:          return !t.completed;
      }
    });
  }, [allUserTodos, filter, search, today, sevenDaysOut, currentUser.name]);

  const grouped = useMemo(
    () => buildGroups(filteredActions, filteredTodos, groupBy, today),
    [filteredActions, filteredTodos, groupBy, today],
  );

  // Flatten grouped items in order so we can paginate by item count
  const flatItems = useMemo(() => {
    const items: Array<{ kind: "action"; item: ActionItem; groupKey: string } | { kind: "todo"; item: UserTodo; groupKey: string }> = [];
    for (const key of grouped.order) {
      const entry = grouped.map[key];
      if (!entry) continue;
      for (const a of entry.actions) items.push({ kind: "action", item: a, groupKey: key });
      for (const t of entry.todos) items.push({ kind: "todo", item: t, groupKey: key });
    }
    return items;
  }, [grouped]);

  // Reset to page 1 when filters, grouping, search, or sort change
  useEffect(() => { setPage(1); }, [filter, groupBy, search, sortOrder]);

  // Fetch more events from Firestore when user pages past available tasks
  useEffect(() => {
    if (page * PAGE_SIZE > flatItems.length && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [page, flatItems.length, hasNextPage, isFetchingNextPage, fetchNextPage]);

  const canGoNext = page * PAGE_SIZE < flatItems.length || hasNextPage;

  // Rebuild groups from the current page's slice of flat items
  const pagedGroups = useMemo(() => {
    const slice = flatItems.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    const order: string[] = [];
    const map: Record<string, GroupEntry> = {};
    const entry = (key: string): GroupEntry => {
      if (!map[key]) { order.push(key); map[key] = { actions: [], todos: [] }; }
      return map[key];
    };
    for (const fi of slice) {
      if (fi.kind === "action") entry(fi.groupKey).actions.push(fi.item);
      else entry(fi.groupKey).todos.push(fi.item);
    }
    return { order, map };
  }, [flatItems, page]);

  // Deduplicated team members for a given event, filtered to the event's profile
  const membersForEvent = useCallback((eventId: string): TeamMember[] => {
    const event = events.find(e => e.id === eventId);
    const uid = user?.uid;
    let candidates = teamMembers;

    if (event && uid) {
      // Find profiles whose role matches the event's operatorType
      const matchingProfileIds = Object.entries(profiles)
        .filter(([, p]) => p.role === event.operatorType)
        .map(([slot]) => `${uid}__${slot}`);

      if (matchingProfileIds.length > 0) {
        const filtered = teamMembers.filter(m => m.profileId && matchingProfileIds.includes(m.profileId));
        if (filtered.length > 0) candidates = filtered;
      }
    }

    // Deduplicate by id
    const seen = new Set<string>();
    return candidates.filter(m => { if (seen.has(m.id)) return false; seen.add(m.id); return true; });
  }, [events, teamMembers, profiles, user?.uid]);

  const toggleTodo = useCallback((eventId: string, todoId: string) => {
    const meta = allEconomics[eventId]?.meta;
    if (!meta?.todos) return;
    const todo = (meta.todos as UserTodo[]).find(t => t.id === todoId);
    const wasCompleted = todo?.completed;
    const updated = (meta.todos as UserTodo[]).map(t =>
      t.id === todoId ? { ...t, completed: !t.completed, completedAt: !t.completed ? new Date().toISOString() : undefined } : t,
    );
    updateAnyEventMeta(eventId, { todos: updated });

    if (!wasCompleted && todo) {
      sonnerToast.success("Task completed", {
        action: {
          label: "Undo",
          onClick: () => {
            const currentMeta = allEconomics[eventId]?.meta;
            if (!currentMeta?.todos) return;
            const reverted = (currentMeta.todos as UserTodo[]).map(t =>
              t.id === todoId ? { ...t, completed: false, completedAt: undefined } : t,
            );
            updateAnyEventMeta(eventId, { todos: reverted });
          },
        },
      });
    }
  }, [allEconomics, updateAnyEventMeta]);

  const assignTodo = useCallback((eventId: string, todoId: string, name: string | undefined) => {
    const meta = allEconomics[eventId]?.meta;
    if (!meta?.todos) return;
    const updated = (meta.todos as UserTodo[]).map(t =>
      t.id === todoId ? { ...t, assignee: name } : t,
    );
    updateAnyEventMeta(eventId, { todos: updated });
  }, [allEconomics, updateAnyEventMeta]);

  const assignActionItem = useCallback((eventId: string, actionId: string, name: string | undefined) => {
    const existing = allEconomics[eventId]?.meta?.actionItemAssignees ?? {};
    const updated = name
      ? { ...existing, [actionId]: name }
      : Object.fromEntries(Object.entries(existing).filter(([k]) => k !== actionId));
    updateAnyEventMeta(eventId, { actionItemAssignees: updated });
  }, [allEconomics, updateAnyEventMeta]);

  const createTask = useCallback(() => {
    if (!newTaskTitle.trim() || !newTaskEventId) return;
    const meta = allEconomics[newTaskEventId]?.meta;
    const existingTodos = (meta?.todos as UserTodo[]) ?? [];
    const newTodo = {
      id: `todo-${Date.now()}`,
      title: newTaskTitle.trim(),
      completed: false,
      reminders: [],
      createdAt: new Date().toISOString(),
      ...(newTaskAssignee ? { assignee: newTaskAssignee } : {}),
      ...(newTaskDueDate ? { dueDate: newTaskDueDate } : {}),
    };
    updateAnyEventMeta(newTaskEventId, { todos: [...existingTodos, newTodo] });
    setNewTaskTitle("");
    setNewTaskAssignee("");
    setNewTaskDueDate("");
    setNewTaskEventId("");
    setShowCreateForm(false);
    sonnerToast.success("Task created");
  }, [newTaskTitle, newTaskEventId, newTaskAssignee, newTaskDueDate, allEconomics, updateAnyEventMeta]);

  const overdueCt = allUserTodos.filter(t => !t.completed && !!t.dueDate && t.dueDate < today).length;
  const totalVisible = filteredActions.length + filteredTodos.length;
  const showInitialSkeleton = !eventsLoaded;
  const GroupIcon = GROUP_ICONS[groupBy];
  const activeGroupLabel = GROUP_BY_OPTIONS.find(o => o.value === groupBy)?.label ?? "Event";

  return (
    <AppLayout>
      <div className="animate-fade-in">
        {/* Header */}
        <div className="mb-8 flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Tasks</h1>
            <p className="mt-1 text-muted-foreground">
              {eventsLoaded
                ? `${allActionItems.length} action item${allActionItems.length !== 1 ? "s" : ""} · ${allUserTodos.filter(t => !t.completed).length} open task${allUserTodos.filter(t => !t.completed).length !== 1 ? "s" : ""}${overdueCt > 0 ? ` · ${overdueCt} overdue` : ""}`
                : "Loading…"}
            </p>
          </div>
          <Button className="gap-2" onClick={() => setShowCreateForm(true)}>
            <Plus className="h-4 w-4" /> Create Task
          </Button>
        </div>

        {/* Inline create form */}
        {showCreateForm && (
          <div className="mb-6 rounded-xl border bg-card p-4 shadow-sm space-y-3">
            <h3 className="text-sm font-semibold">New Task</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <input
                  type="text"
                  placeholder="Task title"
                  value={newTaskTitle}
                  onChange={e => setNewTaskTitle(e.target.value)}
                  className="w-full rounded-lg border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  autoFocus
                />
              </div>
              <div>
                <select
                  value={newTaskEventId}
                  onChange={e => setNewTaskEventId(e.target.value)}
                  className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">Select event...</option>
                  {events.filter(e => !e.archived && !e.parentEventId).map(e => (
                    <option key={e.id} value={e.id}>{e.name} ({e.date})</option>
                  ))}
                </select>
              </div>
              <div>
                <input
                  type="text"
                  placeholder="Assignee (optional)"
                  value={newTaskAssignee}
                  onChange={e => setNewTaskAssignee(e.target.value)}
                  className="w-full rounded-lg border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div>
                <input
                  type="date"
                  value={newTaskDueDate}
                  onChange={e => setNewTaskDueDate(e.target.value)}
                  className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={createTask} disabled={!newTaskTitle.trim() || !newTaskEventId}>
                Create
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setShowCreateForm(false); setNewTaskTitle(""); setNewTaskAssignee(currentUser.name); setNewTaskDueDate(""); setNewTaskEventId(""); }}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Toolbar */}
        <div className="mb-4 flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search tasks, events, artists, venues…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full rounded-lg border bg-card pl-10 pr-4 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <button
              onClick={() => setSortOrder(o => o === "asc" ? "desc" : "asc")}
              className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2.5 text-sm font-medium hover:bg-muted/50 transition-colors whitespace-nowrap"
            >
              <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
              {sortOrder === "asc" ? "Oldest first" : "Newest first"}
            </button>
            <div className="relative">
              <button
                onClick={() => setGroupByOpen(o => !o)}
                className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2.5 text-sm font-medium hover:bg-muted/50 transition-colors whitespace-nowrap"
              >
                <span className="text-muted-foreground text-xs">Group:</span>
                {activeGroupLabel}
                <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", groupByOpen && "rotate-180")} />
              </button>
              {groupByOpen && (
                <div className="absolute right-0 top-full mt-1 z-10 min-w-[150px] rounded-lg border bg-popover shadow-lg py-1">
                  {GROUP_BY_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => { setGroupBy(opt.value); setGroupByOpen(false); }}
                      className={cn(
                        "w-full text-left px-4 py-2 text-sm hover:bg-muted/60 transition-colors",
                        groupBy === opt.value && "font-semibold text-primary",
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="flex gap-1 flex-wrap">
            {FILTERS.map(f => (
              <button
                key={f.value}
                onClick={() => setFilter(f.value)}
                className={cn(
                  "px-3 py-1.5 rounded-full text-xs font-medium transition-colors",
                  filter === f.value ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground",
                )}
              >
                {f.label}
                {f.value === "overdue" && overdueCt > 0 && (
                  <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold w-4 h-4">
                    {overdueCt > 9 ? "9+" : overdueCt}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Loading skeleton — only on first load, not on return visits */}
        {showInitialSkeleton && (
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="rounded-xl border bg-card shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b bg-muted/40"><Skeleton className="h-4 w-40" /></div>
                <div className="divide-y">
                  {Array.from({ length: 2 }).map((_, j) => (
                    <div key={j} className="flex items-center gap-3 px-4 py-3">
                      <Skeleton className="h-4 w-4 rounded" />
                      <Skeleton className="h-4 flex-1" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {eventsLoaded && totalVisible === 0 && (
          <div className="rounded-xl border bg-card p-12 text-center">
            <ListTodo className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <h3 className="font-display text-base font-semibold mb-1">
              {filter === "overdue" ? "No overdue tasks" : "All clear"}
            </h3>
            <p className="text-sm text-muted-foreground">
              {filter === "overdue" ? "You're all caught up." : "Nothing requires your attention right now."}
            </p>
          </div>
        )}

        {/* Grouped content */}
        {eventsLoaded && totalVisible > 0 && (
          <div className="space-y-4">
            {pagedGroups.order.map(groupKey => {
              const entry = pagedGroups.map[groupKey];
              if (!entry) return null;
              const { actions, todos } = entry;
              if (actions.length === 0 && todos.length === 0) return null;

              const label = groupLabel(groupBy, groupKey, events);
              const sub = groupSubLabel(groupBy, groupKey, events);
              const manageLink = groupManageLink(groupBy, groupKey);
              const accentClass = groupAccentClass(groupBy, groupKey);
              const totalCount = actions.length + todos.length;

              return (
                <div key={groupKey} className={cn("rounded-xl border bg-card shadow-sm overflow-hidden", accentClass)}>
                  {/* Group header */}
                  <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/40">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <GroupIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="font-semibold text-sm truncate">{label}</span>
                      {sub && <span className="font-normal text-muted-foreground text-xs">· {sub}</span>}
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">{totalCount}</Badge>
                    </div>
                    {manageLink && (
                      <Link
                        to={manageLink.to as string}
                        params={manageLink.params as Record<string, string>}
                        search={manageLink.search as Record<string, string>}
                        className="text-xs text-muted-foreground hover:text-primary transition-colors flex items-center gap-1 shrink-0"
                      >
                        Manage <ArrowRight className="h-3 w-3" />
                      </Link>
                    )}
                  </div>

                  <div className="divide-y">
                    {/* Action items */}
                    {actions.map(action => {
                      const Icon = action.icon;
                      return (
                        <div key={action.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/20 transition-colors group/row">
                          <Icon className="h-4 w-4 text-primary shrink-0" />
                          <div className="flex-1 min-w-0">
                            <Link to={action.link as string} className="text-sm hover:text-primary transition-colors">
                              {action.label}
                            </Link>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {action.eventId && (
                              <AssigneeButton
                                assignee={action.assignee}
                                members={membersForEvent(action.eventId)}
                                onAssign={name => assignActionItem(action.eventId!, action.id, name)}
                              />
                            )}
                            <div className="flex items-center gap-2 opacity-0 group-hover/row:opacity-100 transition-opacity">
                              <span className="inline-flex items-center gap-1 text-[10px] font-medium text-primary/70 bg-primary/10 rounded px-1.5 py-0.5">
                                <Zap className="h-2.5 w-2.5" /> Action
                              </span>
                              {action.eventId && groupBy !== "event" && (
                                <Link
                                  to="/events/$id"
                                  params={{ id: action.eventId }}
                                  className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1"
                                >
                                  Event <ArrowRight className="h-3 w-3" />
                                </Link>
                              )}
                              <button
                                onClick={() => setDismissedActions(prev => new Set([...prev, action.id]))}
                                className="text-xs text-muted-foreground hover:text-foreground px-2 py-0.5 rounded hover:bg-muted"
                              >
                                Dismiss
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}

                    {/* User todos */}
                    {todos.map(task => {
                      const isOverdue = !task.completed && !!task.dueDate && task.dueDate < today;
                      return (
                        <div key={task.id} className="flex items-start gap-3 px-4 py-3 hover:bg-muted/20 transition-colors group/row">
                          <Checkbox checked={task.completed} onCheckedChange={() => toggleTodo(task.eventId, task.id)} className="mt-0.5" />
                          <div className="flex-1 min-w-0">
                            <p className={cn("text-sm font-medium", task.completed && "line-through text-muted-foreground")}>
                              {task.title}
                            </p>
                            <div className="flex items-center gap-3 mt-1 flex-wrap">
                              {groupBy !== "event" && groupBy !== "none" && (
                                <Link
                                  to="/events/$id"
                                  params={{ id: task.eventId }}
                                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
                                >
                                  {task.eventName}
                                </Link>
                              )}
                              {task.dueDate && (
                                <span className={cn("inline-flex items-center gap-1 text-xs", isOverdue ? "text-destructive font-medium" : "text-muted-foreground")}>
                                  <Calendar className="h-3 w-3" />
                                  {new Date(task.dueDate + "T00:00:00").toLocaleDateString()}
                                  {isOverdue && " · Overdue"}
                                </span>
                              )}
                              {task.budgetType && task.budgetAmount != null && (
                                <span className={cn("inline-flex items-center gap-1 text-xs font-medium", task.budgetType === "cost" ? "text-destructive" : "text-emerald-600")}>
                                  <DollarSign className="h-3 w-3" />
                                  {task.budgetType === "cost" ? "Cost" : "Revenue"}: €{task.budgetAmount.toLocaleString()}
                                </span>
                              )}
                            </div>
                          </div>
                          {task.reminders.length > 0 && (
                            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground shrink-0 mt-0.5">
                              <Bell className="h-3 w-3" /> {task.reminders.length}
                            </span>
                          )}
                          <AssigneeButton
                            assignee={task.assignee}
                            members={membersForEvent(task.eventId)}
                            onAssign={name => assignTodo(task.eventId, task.id, name)}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Pagination */}
        {eventsLoaded && flatItems.length > PAGE_SIZE && (
          <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
            <span className="flex items-center gap-2">
              Showing {Math.min((page - 1) * PAGE_SIZE + 1, flatItems.length)}–{Math.min(page * PAGE_SIZE, flatItems.length)} of {flatItems.length}{hasNextPage ? "+" : ""} items
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
    </AppLayout>
  );
}
