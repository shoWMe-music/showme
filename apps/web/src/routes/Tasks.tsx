import {
  useDeleteApiV1GroupsGid,
  usePatchApiV1TasksId,
  usePostApiV1Groups,
  usePostApiV1Tasks,
} from "@showme/api-client";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Chip,
  EmptyState,
  Icon,
  Modal,
  Select,
  type Status,
  TextField,
  useToast,
} from "@showme/design-system";
import { type FormEvent, useEffect, useState } from "react";
import { DateTimeField } from "../components/DateTimeField";
import { Eyebrow } from "../components/primitives";
import { ErrorState, LoadingState } from "../components/states";
import {
  type Group,
  type Task,
  type TaskFilterKey,
  type TaskScope,
  scopeOf,
  useTaskBoard,
} from "../hooks/useTaskBoard";
import { errorMessage } from "../lib/errors";

/**
 * Tasks are grouped by **named work-group** — the reusable rosters (Door,
 * Marketing, Sound…) shared with Team, linked via `task.groupId`. Tasks with no
 * group fall into "Ungrouped". The task's scope (event / profile / personal)
 * stays as a filter chip, not the primary grouping.
 */
const SCOPE_META: Record<TaskScope, { label: string; status: Status }> = {
  event: { label: "Event", status: "task" },
  profile: { label: "Profile", status: "suggested" },
  personal: { label: "Personal", status: "pending" },
};

/** "Jul 18, 2026 12:00" when the due date carries a time, else "Jul 18, 2026". */
function formatDueDateTime(iso: string): string {
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

const FILTERS: { key: TaskFilterKey; label: string; disabled?: boolean }[] = [
  { key: "all", label: "All" },
  { key: "mine", label: "My Tasks", disabled: true },
  { key: "open", label: "Open" },
  { key: "done", label: "Done" },
  { key: "event", label: "Event" },
  { key: "profile", label: "Profile" },
  { key: "personal", label: "Personal" },
];

export function Tasks() {
  const toast = useToast();
  const [formOpen, setFormOpen] = useState(false);
  const [groupFormOpen, setGroupFormOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);

  const {
    filter,
    setFilter,
    groupFilter,
    toggleGroupFilter,
    tasks,
    groups,
    buckets,
    doneTasks,
    openVisibleCount,
    openTasksIn,
    openCountFor,
    openCount,
    isPending,
    isError,
    error,
    refetch,
    refetchGroups,
  } = useTaskBoard();

  const patch = usePatchApiV1TasksId({
    mutation: {
      onSuccess: () => refetch(),
      onError: (mutationError) =>
        toast.error(errorMessage(mutationError, "Couldn't update the task.")),
    },
  });
  const deleteGroup = useDeleteApiV1GroupsGid({
    mutation: {
      onSuccess: () => {
        toast.success("Work-group removed.");
        refetchGroups();
        refetch();
      },
      onError: (mutationError) =>
        toast.error(errorMessage(mutationError, "Couldn't remove the work-group.")),
    },
  });

  const toggle = (task: Task, next: boolean) =>
    patch.mutate({ id: task.id, data: { completed: next } });

  const openNew = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (task: Task) => {
    setEditing(task);
    setFormOpen(true);
  };

  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h2
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              margin: 0,
              fontFamily: "var(--font-display)",
              fontSize: 30,
              color: "var(--text)",
            }}
          >
            Tasks
            <Badge status="pending">{openCount} open</Badge>
          </h2>
          <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--muted)" }}>
            Grouped by work-group — the reusable rosters you share with Team.
          </p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <Button
            variant="secondary"
            leftIcon={<Icon name="users" size={16} />}
            onClick={() => setGroupFormOpen(true)}
          >
            Create Group
          </Button>
          <Button variant="cta" leftIcon={<Icon name="plus" size={16} />} onClick={openNew}>
            New Task
          </Button>
        </div>
      </div>

      {isPending ? (
        <LoadingState label="Loading tasks" />
      ) : isError ? (
        <ErrorState error={error} title="Couldn't load tasks" />
      ) : (
        <>
          {groups.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <Eyebrow>Groups</Eyebrow>
              {groups.map((group) => (
                <span
                  key={group.id}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "6px 10px",
                    borderRadius: 999,
                    border: "1px solid var(--border)",
                    background: "var(--elevated)",
                    fontSize: 13,
                    color: "var(--text)",
                  }}
                >
                  {group.name}
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(`Remove the "${group.name}" work-group?`)) {
                        deleteGroup.mutate({ gid: group.id });
                      }
                    }}
                    aria-label={`Remove ${group.name} group`}
                    style={{
                      display: "inline-flex",
                      border: "none",
                      background: "transparent",
                      color: "var(--muted)",
                      cursor: "pointer",
                      padding: 0,
                    }}
                  >
                    <Icon name="x" size={13} />
                  </button>
                </span>
              ))}
            </div>
          )}

          {buckets.length > 0 && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                gap: 12,
              }}
            >
              {buckets.map((bucket) => {
                const count = openCountFor(bucket.id);
                const active = groupFilter === bucket.id;
                return (
                  <button
                    key={bucket.id}
                    type="button"
                    onClick={() => toggleGroupFilter(bucket.id)}
                    style={{
                      textAlign: "left",
                      border: "none",
                      background: "transparent",
                      padding: 0,
                    }}
                  >
                    <Card
                      padding="md"
                      interactive
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        borderColor: active ? "var(--accent)" : undefined,
                      }}
                    >
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          minWidth: 34,
                          height: 34,
                          borderRadius: 10,
                          background: "var(--elevated)",
                          fontFamily: "var(--font-display)",
                          fontSize: 16,
                          color: "var(--text)",
                        }}
                      >
                        {count}
                      </span>
                      <span style={{ display: "flex", flexDirection: "column" }}>
                        <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>
                          {bucket.name}
                        </span>
                        <span style={{ fontSize: 12, color: "var(--muted)" }}>{count} open</span>
                      </span>
                    </Card>
                  </button>
                );
              })}
            </div>
          )}

          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {FILTERS.map((option) => (
              <Chip
                key={option.key}
                active={filter === option.key}
                disabled={option.disabled}
                title={option.disabled ? "Assignees aren't in the data model yet." : undefined}
                onClick={() => !option.disabled && setFilter(option.key)}
              >
                {option.label}
              </Chip>
            ))}
          </div>

          {tasks.length === 0 ? (
            <EmptyState
              icon={<Icon name="check" />}
              title="You're all caught up"
              description="New tasks show up here, grouped by work-group."
            />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              {buckets.map((bucket) => {
                const group = openTasksIn(bucket.id);
                if (group.length === 0) return null;
                return (
                  <section
                    key={bucket.id}
                    style={{ display: "flex", flexDirection: "column", gap: 10 }}
                  >
                    <Eyebrow>{bucket.name}</Eyebrow>
                    <Card padding="none">
                      {group.map((task) => (
                        <TaskRow
                          key={task.id}
                          task={task}
                          groupName={task.groupId ? bucket.name : undefined}
                          onToggle={(next) => toggle(task, next)}
                          onEdit={() => openEdit(task)}
                        />
                      ))}
                    </Card>
                  </section>
                );
              })}

              {openVisibleCount === 0 && (
                <EmptyState
                  icon={<Icon name="check" />}
                  title="No open tasks"
                  description="Everything in this view is done."
                />
              )}

              {doneTasks.length > 0 && (
                <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <Eyebrow>Completed ({doneTasks.length})</Eyebrow>
                  <Card padding="none">
                    {doneTasks.map((task) => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        groupName={
                          task.groupId
                            ? groups.find((group) => group.id === task.groupId)?.name
                            : undefined
                        }
                        onToggle={(next) => toggle(task, next)}
                        onEdit={() => openEdit(task)}
                      />
                    ))}
                  </Card>
                </section>
              )}
            </div>
          )}
        </>
      )}

      <TaskFormModal
        open={formOpen}
        task={editing}
        groups={groups}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          setFormOpen(false);
          refetch();
        }}
      />

      <CreateGroupModal
        open={groupFormOpen}
        onClose={() => setGroupFormOpen(false)}
        onCreated={() => {
          setGroupFormOpen(false);
          refetchGroups();
        }}
      />
    </>
  );
}

function TaskRow({
  task,
  groupName,
  onToggle,
  onEdit,
}: {
  task: Task;
  groupName?: string;
  onToggle: (done: boolean) => void;
  onEdit: () => void;
}) {
  const scope = scopeOf(task);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        padding: "14px 16px",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <div style={{ paddingTop: 1 }}>
        <Checkbox checked={task.completed} onChange={onToggle} />
      </div>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span
            style={{
              fontSize: 14,
              fontWeight: 500,
              color: task.completed ? "var(--muted)" : "var(--text)",
              textDecoration: task.completed ? "line-through" : "none",
            }}
          >
            {task.title}
          </span>
          {groupName ? (
            <Badge status="task">{groupName}</Badge>
          ) : (
            <Badge status={SCOPE_META[scope].status}>{SCOPE_META[scope].label}</Badge>
          )}
        </span>
        {task.dueDate && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              color: "var(--muted)",
            }}
          >
            <Icon name="clock" size={13} />
            {formatDueDateTime(task.dueDate)}
          </span>
        )}
        {task.description && (
          <span style={{ fontSize: 13, fontStyle: "italic", color: "var(--muted)" }}>
            “{task.description}”
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={onEdit}
        aria-label="Edit task"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 32,
          height: 32,
          borderRadius: 8,
          border: "1px solid var(--border)",
          background: "var(--elevated)",
          color: "var(--muted)",
          cursor: "pointer",
        }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}

/** Shared create/edit form. New tasks POST; existing tasks PATCH the editable
 * fields (title, description, dueDate, work-group). */
function TaskFormModal({
  open,
  task,
  groups,
  onClose,
  onSaved,
}: {
  open: boolean;
  task: Task | null;
  groups: Group[];
  onClose: () => void;
  onSaved: () => void;
}) {
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
              border: "1px solid var(--border)",
              background: "var(--elevated)",
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

/** Create a named work-group (reusable roster) — starts empty; members are added
 * from Team. */
function CreateGroupModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState("");

  useEffect(() => {
    if (open) setName("");
  }, [open]);

  const create = usePostApiV1Groups({
    mutation: {
      onSuccess: () => {
        toast.success("Work-group created.");
        onCreated();
      },
      onError: (error) => toast.error(errorMessage(error, "Couldn't create the work-group.")),
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    create.mutate({ data: { name: name.trim() } });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New work-group"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={create.isPending || !name.trim()}>
            Create group
          </Button>
        </>
      }
    >
      <form onSubmit={submit}>
        <TextField
          label="Name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Marketing"
          required
        />
      </form>
    </Modal>
  );
}
