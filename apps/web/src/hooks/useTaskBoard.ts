import {
  type getApiV1Groups,
  getApiV1Tasks,
  getGetApiV1TasksQueryKey,
  useGetApiV1Groups,
} from "@showme/api-client";
import type { Status } from "@showme/design-system";
import { useMemo, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { MAX_PAGE_SIZE, infiniteKey, useCursorList } from "./useCursorList";

export type Task = Awaited<ReturnType<typeof getApiV1Tasks>>["items"][number];
export type Group = Awaited<ReturnType<typeof getApiV1Groups>>[number];

/** A task's scope: the tightest thing it hangs off (event > profile > personal). */
export type TaskScope = "event" | "profile" | "personal";

export type TaskFilterKey = "all" | "mine" | "open" | "done" | TaskScope;

/** How each scope is labelled and badged — shared by the list rows and the board
 * cards so one task never reads as two different things across the two views. */
export const SCOPE_META: Record<TaskScope, { label: string; status: Status }> = {
  event: { label: "Event", status: "task" },
  profile: { label: "Profile", status: "suggested" },
  personal: { label: "Personal", status: "pending" },
};

/** The two ways of reading the same filtered tasks (mirrors Events' List/Board). */
export type TaskView = "list" | "board";

/** The "no work-group" bucket. Not a group id — a sentinel for the ungrouped pile. */
export const UNGROUPED = "__ungrouped";

export function scopeOf(task: Task): TaskScope {
  if (task.eventId) return "event";
  if (task.ownerProfileId) return "profile";
  return "personal";
}

/** "18 Jul 2026 12:00" when the due date carries a time, else "18 Jul 2026".
 * Lives here rather than on a screen because the list rows and the board cards
 * must render the same task's due date identically. */
export function formatTaskDueDate(iso: string): string {
  // `tasks.due_date` is a DATE column, so the API sends a bare "yyyy-mm-dd".
  // `new Date()` reads that as UTC midnight, which renders as the PREVIOUS day
  // for anyone west of Greenwich — so build the day from its own parts instead.
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const date = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const day = date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  const hasTime = /\d{2}:\d{2}/.test(iso) && !iso.includes("T00:00:00");
  if (!hasTime) return day;
  const time = date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return `${day} ${time}`;
}

/** The group a task is filed under, or the ungrouped sentinel. */
function bucketOf(task: Task): string {
  return task.groupId ?? UNGROUPED;
}

/**
 * `mine` is **ownership**, because ownership is the only "who" the task payload
 * carries: `ownerUserId` is stamped when a task is filed under the person, and is
 * null when the task belongs to a profile — i.e. to everyone on the team. So "My
 * Tasks" = the pile that is yours alone, as opposed to your profile's shared pile.
 *
 * It deliberately is NOT "assigned to me". `tasks.assignee_participant_id` exists
 * in the schema but is never written by any route and never serialized by
 * `GET /tasks`, so the browser cannot see an assignee at all. Making the chip
 * pretend otherwise would be a lie; see the note on the chip's tooltip.
 */
function matchesFilter(task: Task, filter: TaskFilterKey, currentUserId: string | null): boolean {
  switch (filter) {
    case "all":
      return true;
    case "mine":
      return currentUserId != null && task.ownerUserId === currentUserId;
    case "open":
      return !task.completed;
    case "done":
      return task.completed;
    default:
      return scopeOf(task) === filter;
  }
}

export interface TaskBucket {
  id: string;
  name: string;
}

/** One board column. `tasks.completed` is the WHOLE status vocabulary the model
 * stores (a boolean — there is no `task_status` enum), so the board has exactly
 * two columns. Anything richer would be a column the database cannot hold. */
export interface TaskBoardColumn {
  key: "open" | "done";
  label: string;
  /** Whether a card in this column is a completed task — what a move writes. */
  completed: boolean;
  color: string;
  /** Every visible task in the column, across all work-groups. */
  tasks: Task[];
  /** The same cards split by work-group, mirroring the list's sections. */
  sections: { bucket: TaskBucket; tasks: Task[] }[];
}

export interface TaskBoard {
  filter: TaskFilterKey;
  setFilter: (filter: TaskFilterKey) => void;
  view: TaskView;
  setView: (view: TaskView) => void;
  groupFilter: string | null;
  toggleGroupFilter: (bucketId: string) => void;
  /** Every task the caller can reach — all pages of it. */
  tasks: Task[];
  groups: Group[];
  buckets: TaskBucket[];
  /** The tasks the chips select, out of the complete list. */
  visible: Task[];
  doneTasks: Task[];
  openVisibleCount: number;
  /** The board's two columns, over the same `visible` tasks the list renders. */
  boardColumns: TaskBoardColumn[];
  /** The signed-in user, or null while the session is still resolving. */
  currentUserId: string | null;
  /** Open tasks in one bucket, within the current filter — the list rendered. */
  openTasksIn: (bucketId: string) => Task[];
  /** Open tasks in one bucket across the WHOLE list — the number on its card. */
  openCountFor: (bucketId: string) => number;
  openCount: number;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
  refetchGroups: () => void;
}

/**
 * The Tasks screen's data.
 *
 * `GET /tasks` is keyset-paginated, and this screen used to read page one and
 * call it "your tasks": every bucket count, the "N open" badge and the Ungrouped
 * pile were computed over at most 20 rows. So the cursor is drained here — the
 * screen states totals, and a total over one page is simply wrong.
 *
 * That completeness is also why the chips (Open/Done, Event/Profile/Personal) and
 * the group selection stay in the browser even though the route accepts
 * `completed` and `groupId`. This screen is a board, not a feed: each work-group
 * card shows how many tasks are open in it, and the header counts every open task
 * — figures that describe the whole list and must not change when a chip narrows
 * the view below them. A server-side `completed=false` would zero the Done
 * section's own counts, and a server-side `groupId` would blank every other
 * card's number. The API offers no counts endpoint, so the complete list is the
 * only honest source for them; the narrowing is a view over it.
 *
 * (The event-scoped task list is different — one event's to-do, no board totals —
 * and that one does filter server-side via `?eventId=`, in `EventExtraTabs`.)
 */
export function useTaskBoard(): TaskBoard {
  const [filter, setFilter] = useState<TaskFilterKey>("all");
  const [view, setView] = useState<TaskView>("list");
  const [groupFilter, setGroupFilter] = useState<string | null>(null);
  const { session } = useAuth();
  const currentUserId = session?.userId ?? null;

  const params = { limit: MAX_PAGE_SIZE } as const;
  const list = useCursorList<Task>({
    queryKey: infiniteKey(getGetApiV1TasksQueryKey(params)),
    fetchPage: (cursor, signal) => getApiV1Tasks({ ...params, cursor }, signal),
    loadAllPages: true,
  });

  const groupsQuery = useGetApiV1Groups();
  const groups = useMemo(() => groupsQuery.data ?? [], [groupsQuery.data]);
  const tasks = list.items;

  const buckets = useMemo(() => {
    const hasUngrouped = tasks.some((task) => !task.groupId);
    return [
      ...groups.map((group) => ({ id: group.id, name: group.name })),
      ...(hasUngrouped ? [{ id: UNGROUPED, name: "Ungrouped" }] : []),
    ];
  }, [groups, tasks]);

  const visible = useMemo(
    () =>
      tasks
        .filter((task) => matchesFilter(task, filter, currentUserId))
        .filter((task) => (groupFilter ? bucketOf(task) === groupFilter : true)),
    [tasks, filter, groupFilter, currentUserId],
  );

  const doneTasks = useMemo(() => visible.filter((task) => task.completed), [visible]);
  const openVisible = useMemo(() => visible.filter((task) => !task.completed), [visible]);

  // The board is the same `visible` tasks laid sideways — never a second query —
  // so the chips and the group selection narrow both views identically. Cards keep
  // the list's work-group sections inside each column, so the two views agree on
  // where a task lives as well as on which tasks exist.
  const boardColumns = useMemo<TaskBoardColumn[]>(() => {
    const column = (
      key: "open" | "done",
      label: string,
      color: string,
      columnTasks: Task[],
    ): TaskBoardColumn => ({
      key,
      label,
      completed: key === "done",
      color,
      tasks: columnTasks,
      sections: buckets
        .map((bucket) => ({
          bucket,
          tasks: columnTasks.filter((task) => bucketOf(task) === bucket.id),
        }))
        .filter((section) => section.tasks.length > 0),
    });
    return [
      column("open", "Open", "#F4A046", openVisible),
      column("done", "Done", "#6FC97A", doneTasks),
    ];
  }, [buckets, openVisible, doneTasks]);

  return {
    filter,
    setFilter,
    view,
    setView,
    groupFilter,
    toggleGroupFilter: (bucketId) =>
      setGroupFilter((current) => (current === bucketId ? null : bucketId)),
    tasks,
    groups,
    buckets,
    visible,
    doneTasks,
    openVisibleCount: openVisible.length,
    boardColumns,
    currentUserId,
    openTasksIn: (bucketId) => openVisible.filter((task) => bucketOf(task) === bucketId),
    openCountFor: (bucketId) =>
      tasks.filter((task) => bucketOf(task) === bucketId && !task.completed).length,
    openCount: tasks.filter((task) => !task.completed).length,
    isPending: list.isPending,
    isError: list.isError,
    error: list.error,
    refetch: list.refetch,
    refetchGroups: () => {
      void groupsQuery.refetch();
    },
  };
}
