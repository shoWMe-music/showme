import {
  getGetApiV1TasksQueryKey,
  useDeleteApiV1TasksId,
  useGetApiV1Groups,
  useGetApiV1Tasks,
  usePatchApiV1TasksId,
  usePostApiV1Tasks,
} from "@showme/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import type { Group, Task } from "./useTaskBoard";

/**
 * ONE event's to-do list — the data behind the event workspace's To Do tab.
 *
 * The rows are the same `tasks` the /tasks screen shows; this one narrows them
 * server-side with `?eventId=`, which the board screen deliberately does not do
 * (it states totals over the whole list — see `useTaskBoard`). No board, no
 * chips, no totals: one event, its tasks, in the order the API returns them.
 *
 * The work-groups come along because the shared task dialog offers them, and a
 * task filed under "Sound" on one screen must not lose that filing when it is
 * edited on the other.
 */
export interface EventTasks {
  tasks: Task[];
  groups: Group[];
  /** Tasks not yet ticked off — the number in the header pill. */
  activeCount: number;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  /** The quick-add field at the top of the tab. */
  draft: string;
  setDraft: (draft: string) => void;
  addDraft: () => void;
  isAdding: boolean;
  toggleCompleted: (task: Task) => void;
  remove: (task: Task) => void;
  /** The task the dialog is editing; survives the close so the panel is not
   * blanked mid exit-tween (the same reason `ConfirmDialog` splits the two). */
  editing: Task | null;
  editorOpen: boolean;
  openEditor: (task: Task) => void;
  closeEditor: () => void;
  /** Hand to the dialog's `onSaved`: refresh this event's list and close. */
  onSaved: () => void;
}

export function useEventTasks(eventId: string): EventTasks {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<Task | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: getGetApiV1TasksQueryKey({ eventId }) });
  }, [queryClient, eventId]);

  const list = useGetApiV1Tasks({ eventId });
  const groupsQuery = useGetApiV1Groups();
  const create = usePostApiV1Tasks({ mutation: { onSuccess: invalidate } });
  const patch = usePatchApiV1TasksId({ mutation: { onSuccess: invalidate } });
  const remove = useDeleteApiV1TasksId({ mutation: { onSuccess: invalidate } });

  const tasks = list.data?.items ?? [];

  return {
    tasks,
    groups: groupsQuery.data ?? [],
    activeCount: tasks.filter((task) => !task.completed).length,
    isPending: list.isPending,
    isError: list.isError,
    error: list.error,
    draft,
    setDraft,
    addDraft: () => {
      const title = draft.trim();
      if (!title) return;
      create.mutate({ data: { title, eventId } });
      setDraft("");
    },
    isAdding: create.isPending,
    toggleCompleted: (task) => patch.mutate({ id: task.id, data: { completed: !task.completed } }),
    remove: (task) => remove.mutate({ id: task.id }),
    editing,
    editorOpen,
    openEditor: (task) => {
      setEditing(task);
      setEditorOpen(true);
    },
    closeEditor: () => setEditorOpen(false),
    onSaved: () => {
      invalidate();
      setEditorOpen(false);
    },
  };
}
