import {
  useGetApiV1EventsIdParticipants,
  usePatchApiV1TasksId,
  usePostApiV1Tasks,
} from "@showme/api-client";
import { useToast } from "@showme/design-system";
import { useEffect, useMemo, useState } from "react";
import { errorMessage } from "../lib/errors";
import type { Task } from "./useTaskBoard";

/**
 * The task dialog's brain — every field it edits, every list it offers, and the
 * one write at the end of it.
 *
 * It lives here rather than inside `TaskFormModal` because the dialog now READS
 * as well as writes: the Assignee select is the event's participant roster, so
 * the component would otherwise own a query, two mutations and six pieces of
 * form state and still be expected to stay a renderer.
 */
export interface TaskAssigneeOption {
  value: string;
  label: string;
}

export interface TaskForm {
  title: string;
  setTitle: (title: string) => void;
  description: string;
  setDescription: (description: string) => void;
  dueDate: string;
  setDueDate: (dueDate: string) => void;
  /** A `datetime-local` string ("yyyy-mm-ddThh:mm") in the reader's OWN zone. */
  remindAt: string;
  setRemindAt: (remindAt: string) => void;
  groupId: string;
  setGroupId: (groupId: string) => void;
  assigneeParticipantId: string;
  setAssigneeParticipantId: (assigneeParticipantId: string) => void;
  /**
   * Who this task can be handed to — the people on its event, minus anyone
   * removed from it. Empty for a personal or profile task, which HAS no event
   * and therefore no participants: `tasks.assignee_participant_id` is a foreign
   * key into `event_participants`, so the API refuses an assignee there (400)
   * and the dialog does not offer the field at all.
   */
  assigneeOptions: TaskAssigneeOption[];
  /** Whether an assignee can be chosen — i.e. whether this task has an event. */
  canAssign: boolean;
  submitting: boolean;
  canSubmit: boolean;
  submit: () => void;
}

/**
 * THE REMINDER CROSSES A ZONE BOUNDARY IN BOTH DIRECTIONS, and these two are it.
 *
 * `tasks.remind_at` is an absolute instant (the API takes and returns ISO-8601
 * UTC); a `datetime-local` input speaks wall-clock with no zone at all. So the
 * field shows the instant AS THIS READER'S CLOCK — "remind me at nine" means
 * nine where they are, which is what docs/timezones.md calls a user-local
 * reminder — and the submit resolves it back to the moment that wall-clock names
 * here. `new Date("2026-09-01T09:00")` is parsed in the browser's zone, which is
 * exactly the resolution wanted; the same string with a `Z` would not be.
 *
 * Note this is the OPPOSITE of what `dueDate` does two lines below, and both are
 * right: a due DATE is a calendar day and must travel verbatim or it lands on the
 * wrong one, while a reminder is a moment and must be converted or it fires at
 * the wrong time.
 */
function instantToLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  const day = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
  return `${day}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

function localInputToInstant(local: string): string | null {
  if (!local) return null;
  const at = new Date(local);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

/**
 * The task's reminder instant, read defensively.
 *
 * `Task` comes from `@showme/api-client`, a build artefact: `GET /tasks`
 * serializes `remindAt` today, but the generated type only learns that when orval
 * is re-run against the API's OpenAPI document. Delete this the moment it has
 * been — the same note `useTaskBoard`'s `Task` carries about the assignee fields.
 */
function remindAtOf(task: Task | null): string | null {
  return (task as { remindAt?: string | null } | null)?.remindAt ?? null;
}

/** Which event's roster the assignee list comes from: the task's own when
 * editing, the host screen's when creating. A task never moves between events
 * from this dialog, so those two can't disagree. */
function eventOf(task: Task | null, eventId?: string): string | null {
  return task ? (task.eventId ?? null) : (eventId ?? null);
}

export function useTaskForm({
  open,
  task,
  eventId,
  initialDueDate,
  onSaved,
}: {
  open: boolean;
  task: Task | null;
  eventId?: string;
  /**
   * The due date a NEW task opens with, as "yyyy-mm-dd". Set when the dialog is
   * opened from a day on the calendar: the day that was clicked is the whole
   * reason the reader is here, and making them pick it again is the difference
   * between "add a task on the 14th" and "go to the Tasks screen".
   *
   * Ignored when editing — an existing task's own due date wins.
   */
  initialDueDate?: string;
  onSaved: () => void;
}): TaskForm {
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [remindAt, setRemindAt] = useState("");
  const [groupId, setGroupId] = useState("");
  const [assigneeParticipantId, setAssigneeParticipantId] = useState("");

  const formEventId = eventOf(task, eventId);

  useEffect(() => {
    if (!open) return;
    setTitle(task?.title ?? "");
    setDescription(task?.description ?? "");
    // "yyyy-mm-dd" — the exact shape a `type="date"` input round-trips.
    setDueDate(task?.dueDate ? task.dueDate.slice(0, 10) : (initialDueDate ?? ""));
    setRemindAt(instantToLocalInput(remindAtOf(task)));
    setGroupId(task?.groupId ?? "");
    setAssigneeParticipantId(task?.assigneeParticipantId ?? "");
  }, [open, task, initialDueDate]);

  // Only fetched while the dialog is open on an event task — the roster is a
  // second request, and a closed dialog has no business making it.
  const participants = useGetApiV1EventsIdParticipants(formEventId ?? "", {
    query: { enabled: open && formEventId != null },
  });

  const assigneeOptions = useMemo<TaskAssigneeOption[]>(
    () =>
      (participants.data ?? [])
        // A removed participant is kept for history, not as an address — the API
        // refuses them, so offering them would be an option that cannot be taken.
        .filter((participant) => participant.status !== "removed")
        .map((participant) => ({
          value: participant.id,
          label: participant.name ?? "Unnamed participant",
        })),
    [participants.data],
  );

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

  // Send the calendar day the user picked, verbatim. Converting to a UTC instant
  // used to shift it: `tasks.due_date` is a DATE, so an evening pick east of
  // Greenwich (or a small-hours pick west of it) landed on the wrong day.
  const due = dueDate || undefined;
  const remind = localInputToInstant(remindAt);
  const canAssign = formEventId != null;

  const submit = () => {
    if (!title.trim()) return;
    if (task) {
      // Assembled as a value rather than inline so the assignee — which the
      // generated client does not know about until `@showme/api-client` is
      // regenerated against the new tasks contract — rides along typed as what
      // it is. Sent as `null` to unassign; omitted entirely for a task with no
      // event, which the API refuses an assignee on.
      const changes = {
        title: title.trim(),
        description: description.trim() || null,
        dueDate: due ?? null,
        // Always sent, never omitted: clearing the field has to mean "take the
        // reminder off", and an omitted key would leave the old instant armed.
        remindAt: remind,
        groupId: groupId || null,
        ...(canAssign ? { assigneeParticipantId: assigneeParticipantId || null } : {}),
      };
      patch.mutate({ id: task.id, data: changes });
      return;
    }
    const fields = {
      title: title.trim(),
      ...(description.trim() ? { description: description.trim() } : {}),
      ...(due ? { dueDate: due } : {}),
      ...(remind ? { remindAt: remind } : {}),
      ...(groupId ? { groupId } : {}),
      ...(eventId ? { eventId } : {}),
      ...(canAssign && assigneeParticipantId ? { assigneeParticipantId } : {}),
    };
    create.mutate({ data: fields });
  };

  const submitting = create.isPending || patch.isPending;

  return {
    title,
    setTitle,
    description,
    setDescription,
    dueDate,
    setDueDate,
    remindAt,
    setRemindAt,
    groupId,
    setGroupId,
    assigneeParticipantId,
    setAssigneeParticipantId,
    assigneeOptions,
    canAssign,
    submitting,
    canSubmit: title.trim().length > 0 && !submitting,
    submit,
  };
}
