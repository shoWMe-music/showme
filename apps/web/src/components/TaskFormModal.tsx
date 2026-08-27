import { Button, Modal, Select, TextField } from "@showme/design-system";
import type { FormEvent } from "react";
import type { Group, Task } from "../hooks/useTaskBoard";
import { useTaskForm } from "../hooks/useTaskForm";
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
 *
 * Dumb by design: every field, the participant roster behind the Assignee select
 * and the write itself live in `useTaskForm`.
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
  const form = useTaskForm({ open, task, eventId, onSaved });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    form.submit();
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
          <Button variant="primary" onClick={submit} disabled={!form.canSubmit}>
            {task ? "Save changes" : "Create task"}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <TextField
          label="Title"
          value={form.title}
          onChange={(event) => form.setTitle(event.target.value)}
          placeholder="Confirm final headcount with venue"
          required
        />
        {/* Two different acts, side by side on purpose: the work-group says which
            team the task belongs to, the assignee says which PERSON owes it.
            Assigning to a team is not assigning it to somebody. */}
        <Select
          label="Work-group"
          value={form.groupId}
          onChange={form.setGroupId}
          placeholder="No group"
          options={[
            { value: "", label: "No group" },
            ...groups.map((group) => ({ value: group.id, label: group.name })),
          ]}
        />
        {/* Only an event has people on it. A personal or profile task gets no
            select rather than a disabled one: the API refuses an assignee there,
            and an affordance that cannot be taken is worse than no affordance. */}
        {form.canAssign && (
          <Select
            label="Assignee"
            value={form.assigneeParticipantId}
            onChange={form.setAssigneeParticipantId}
            placeholder="Nobody yet"
            options={[
              { value: "", label: "Nobody yet" },
              ...form.assigneeOptions.map((option) => ({
                value: option.value,
                label: option.label,
              })),
            ]}
            noResultsLabel="Nobody on this event matches"
          />
        )}
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
            value={form.description}
            onChange={(event) => form.setDescription(event.target.value)}
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
          value={form.dueDate}
          onChange={(event) => form.setDueDate(event.target.value)}
        />
        {/* A due DATE and a reminder INSTANT, deliberately two fields. A day says
            when the work is owed; a reminder says when to be interrupted about
            it, which is a time — and is worth setting on a task with no due date
            at all. Empty means no reminder; clearing it takes one off. */}
        <DateTimeField
          label="Remind me"
          type="datetime-local"
          value={form.remindAt}
          onChange={(event) => form.setRemindAt(event.target.value)}
        />
      </form>
    </Modal>
  );
}
