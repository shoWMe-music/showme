import {
  useDeleteApiV1GroupsGid,
  usePatchApiV1TasksId,
  usePostApiV1Groups,
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
  TextField,
  useToast,
} from "@showme/design-system";
import { type FormEvent, useEffect, useState } from "react";
import { SegmentedToggle } from "../components/SegmentedToggle";
import { TaskBoard } from "../components/TaskBoard";
import { TaskFormModal } from "../components/TaskFormModal";
import { Eyebrow } from "../components/primitives";
import { ErrorState, LoadingState } from "../components/states";
import {
  SCOPE_META,
  type Task,
  type TaskFilterKey,
  type TaskView,
  formatTaskDueDate,
  scopeOf,
  useTaskBoard,
} from "../hooks/useTaskBoard";
import { errorMessage } from "../lib/errors";

/**
 * Tasks are grouped by **named work-group** — the reusable rosters (Door,
 * Marketing, Sound…) shared with Team, linked via `task.groupId`. Tasks with no
 * group fall into "Ungrouped". The task's scope (event / profile / personal)
 * stays as a filter chip, not the primary grouping. The List/Board toggle picks
 * how those same filtered tasks are laid out; it never changes which they are.
 */

/** The chip row. Every chip narrows the complete list in the browser — see the
 * note in `useTaskBoard` for why this screen does not filter server-side. */
const FILTERS: { key: TaskFilterKey; label: string; title?: string }[] = [
  { key: "all", label: "All" },
  {
    key: "mine",
    label: "My Tasks",
    // The chip used to be permanently disabled ("assignees aren't in the data
    // model yet"), which is why it looked broken. Ownership IS in the model and
    // in the payload — `ownerUserId` — so the chip now answers the question the
    // data can actually answer, and the tooltip says which question that is.
    title: "Tasks filed under you personally — not your profile's shared pile.",
  },
  { key: "open", label: "Open" },
  { key: "done", label: "Done" },
  { key: "event", label: "Event" },
  { key: "profile", label: "Profile" },
  { key: "personal", label: "Personal" },
];

const VIEW_OPTIONS: { value: TaskView; label: string }[] = [
  { value: "list", label: "List" },
  { value: "board", label: "Board" },
];

/**
 * Why a view came back empty. A blank screen saying "you're all caught up" when
 * the reader asked for *their* tasks reads as a broken filter, not as an answer —
 * so each chip explains its own emptiness in its own words.
 */
function emptyForFilter(
  filter: TaskFilterKey,
  groupName: string | undefined,
): { title: string; description: string } {
  const inGroup = groupName ? ` in ${groupName}` : "";
  switch (filter) {
    case "mine":
      return {
        title: `Nothing is filed under you${inGroup}`,
        description:
          "My Tasks shows tasks owned by you personally. Everything else here belongs to a profile you are a member of, so it is shared with the whole team.",
      };
    case "open":
      return { title: `No open tasks${inGroup}`, description: "Everything here is done." };
    case "done":
      return {
        title: `Nothing completed${inGroup}`,
        description: "Tasks you tick off collect here.",
      };
    case "event":
    case "profile":
    case "personal":
      return {
        title: `No ${SCOPE_META[filter].label.toLowerCase()} tasks${inGroup}`,
        description: "Nothing in this view hangs off that scope.",
      };
    default:
      return {
        title: `No tasks${inGroup}`,
        description: "Nothing matches the current selection.",
      };
  }
}

export function Tasks() {
  const toast = useToast();
  const [formOpen, setFormOpen] = useState(false);
  const [groupFormOpen, setGroupFormOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);

  const {
    filter,
    setFilter,
    view,
    setView,
    groupFilter,
    toggleGroupFilter,
    tasks,
    groups,
    buckets,
    visible,
    boardColumns,
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

  // Both views move a task the same way: the ONLY status the model stores is the
  // `completed` boolean, so a checkbox tick and a drag across the board write the
  // same field through the same route, and both refetch rather than assume.
  const toggle = (task: Task, next: boolean) =>
    patch.mutate({ id: task.id, data: { completed: next } });

  const selectedGroupName = buckets.find((bucket) => bucket.id === groupFilter)?.name;

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
                    background: "var(--shape-fill)",
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
                          background: "var(--shape-fill)",
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

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {FILTERS.map((option) => (
                <Chip
                  key={option.key}
                  active={filter === option.key}
                  title={option.title}
                  onClick={() => setFilter(option.key)}
                >
                  {option.label}
                </Chip>
              ))}
            </div>
            <SegmentedToggle<TaskView>
              aria-label="Task view"
              options={VIEW_OPTIONS}
              value={view}
              onChange={setView}
            />
          </div>

          {tasks.length === 0 ? (
            <EmptyState
              icon={<Icon name="check" />}
              title="You're all caught up"
              description="New tasks show up here, grouped by work-group."
            />
          ) : visible.length === 0 ? (
            <EmptyState
              icon={<Icon name="check" />}
              {...emptyForFilter(filter, selectedGroupName)}
            />
          ) : view === "board" ? (
            <TaskBoard
              columns={boardColumns}
              onMove={toggle}
              onEdit={openEdit}
              isMoving={patch.isPending}
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
            {formatTaskDueDate(task.dueDate)}
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
          background: "var(--control-surface)",
          color: "var(--muted)",
          cursor: "pointer",
        }}
      >
        <Icon name="pencil" size={15} />
      </button>
    </div>
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
