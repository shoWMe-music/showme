import { usePatchApiV1TasksId, usePostApiV1Tasks } from "@showme/api-client";
import { Button, Modal, Select, TextField, useToast } from "@showme/design-system";
import { type FormEvent, useEffect, useState } from "react";
import type { Group, Task } from "../hooks/useTaskBoard";
import { errorMessage } from "../lib/errors";
import { DateTimeField } from "./DateTimeField";

/**
 * The app's one task form — create and edit, wherever a task is written.
 *
 * It was born inside `routes/Tasks.tsx` and stayed there while the event
 * workspace's To Do tab grew its own half of a task UI: a checkbox and a bin, no
 * way to fix a typo, set a due date or leave a note, and no way to SEE the ones
 * already set. The two surfaces show the same rows out of the same table, so a
 * task that is editable on one screen and frozen on the other is a bug the
 * reader has to discover. One dialog, two callers.
 *
 * `eventId` is the only difference between them: the Tasks screen creates
 * unattached tasks, the event tab creates tasks on its own event. Editing sends
 * neither — a task does not move between events from here.
 */
export interface TaskFormModalProps {
  open: boolean;
  /** The task being edited, or `null` to create one. */
  task: Task | null;
  /** Work-groups this task may be filed under. Empty is fine — "No group". */
  groups: Group[];
  /** Attach a newly created task to this event. Ignored when editing. */
  eventId?: string;
  onClose: () => void;
  onSaved: () => void;
}

export function TaskFormModal({
  open,
  task,
  groups,
  eventId,
  onClose,
  onSaved,
}: TaskFormModalProps) {
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [groupId, setGroupId] = useState("");

  useEffect(() => {
    if (!open) return;
    setTitle(task?.title ?? "");
    setDescription(task?.description ?? "");
    // "yyyy-mm-dd" — the exact shape a `type="date"` input round-trips.
    setDueDate(task?.dueDate ? task.dueDate.slice(0, 10) : "");
    setGroupId(task?.groupId ?? "");
  }, [open, task]);

  const create = usePostApiV1Tasks({
    mutation: {
      onSuccess: () => {
        toast.success("Task created.");
        onSaved();
      },
      onError: (error) => toast.error(errorMessage(error, "Couldn't create the task.")),
    },
  });
  const patch = usePatchApiV1TasksId({
    mutation: {
      onSuccess: () => {
        toast.success("Task updated.");
        onSaved();
      },
      onError: (error) => toast.error(errorMessage(error, "Couldn't update the task.")),
    },
  });

  const submitting = create.isPending || patch.isPending;
  // Send the calendar day the user picked, verbatim. Converting to a UTC instant
  // used to shift it: `tasks.due_date` is a DATE, so an evening pick east of
  // Greenwich (or a small-hours pick west of it) landed on the wrong day.
  const due = dueDate || undefined;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    if (task) {
      patch.mutate({
        id: task.id,
        data: {
          title: title.trim(),
          description: description.trim() || null,
          dueDate: due ?? null,
          groupId: groupId || null,
        },
      });
    } else {
      create.mutate({
        data: {
          title: title.trim(),
          ...(description.trim() ? { description: description.trim() } : {}),
          ...(due ? { dueDate: due } : {}),
          ...(groupId ? { groupId } : {}),
          ...(eventId ? { eventId } : {}),
        },
      });
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={task ? "Edit task" : "New task"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={submitting || !title.trim()}>
            {task ? "Save changes" : "Create task"}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <TextField
          label="Title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Confirm final headcount with venue"
          required
        />
        <Select
          label="Work-group"
          value={groupId}
          onChange={setGroupId}
          placeholder="No group"
          options={[
            { value: "", label: "No group" },
            ...groups.map((group) => ({ value: group.id, label: group.name })),
          ]}
        />
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--muted)",
            }}
          >
            Note
          </span>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Add context for whoever picks this up…"
            rows={3}
            style={{
              resize: "vertical",
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid var(--control-border)",
              background: "var(--control-surface)",
              color: "var(--text)",
              fontFamily: "var(--font-sans)",
              fontSize: 14,
            }}
          />
        </label>
        <DateTimeField
          label="Due"
          type="date"
          value={dueDate}
          onChange={(event) => setDueDate(event.target.value)}
        />
      </form>
    </Modal>
  );
}
