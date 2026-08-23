import {
  type getApiV1Groups,
  getApiV1Tasks,
  getGetApiV1TasksQueryKey,
  useGetApiV1Groups,
} from "@showme/api-client";
import { useMemo, useState } from "react";
import { MAX_PAGE_SIZE, infiniteKey, useCursorList } from "./useCursorList";

export type Task = Awaited<ReturnType<typeof getApiV1Tasks>>["items"][number];
export type Group = Awaited<ReturnType<typeof getApiV1Groups>>[number];

/** A task's scope: the tightest thing it hangs off (event > profile > personal). */
export type TaskScope = "event" | "profile" | "personal";

export type TaskFilterKey = "all" | "mine" | "open" | "done" | TaskScope;

/** The "no work-group" bucket. Not a group id — a sentinel for the ungrouped pile. */
export const UNGROUPED = "__ungrouped";

export function scopeOf(task: Task): TaskScope {
  if (task.eventId) return "event";
  if (task.ownerProfileId) return "profile";
  return "personal";
}

/** The group a task is filed under, or the ungrouped sentinel. */
function bucketOf(task: Task): string {
  return task.groupId ?? UNGROUPED;
}

function matchesFilter(task: Task, filter: TaskFilterKey): boolean {
  switch (filter) {
    case "all":
    case "mine":
      return true;
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

export interface TaskBoard {
  filter: TaskFilterKey;
  setFilter: (filter: TaskFilterKey) => void;
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
  const [groupFilter, setGroupFilter] = useState<string | null>(null);

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
        .filter((task) => matchesFilter(task, filter))
        .filter((task) => (groupFilter ? bucketOf(task) === groupFilter : true)),
    [tasks, filter, groupFilter],
  );

  const doneTasks = useMemo(() => visible.filter((task) => task.completed), [visible]);
  const openVisible = useMemo(() => visible.filter((task) => !task.completed), [visible]);

  return {
    filter,
    setFilter,
    groupFilter,
    toggleGroupFilter: (bucketId) =>
      setGroupFilter((current) => (current === bucketId ? null : bucketId)),
    tasks,
    groups,
    buckets,
    visible,
    doneTasks,
    openVisibleCount: openVisible.length,
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
