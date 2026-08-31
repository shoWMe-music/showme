import { useGetApiV1Activity } from "@showme/api-client";
import { Icon } from "@showme/design-system";
import { useEventTasks } from "../hooks/useEventTasks";
import { formatTaskDueDate } from "../hooks/useTaskBoard";
import { ConfirmDialog, useConfirmDialog } from "./ConfirmDialog";
import { TaskAssigneeTag } from "./TaskAssigneeTag";
import { TaskFormModal } from "./TaskFormModal";
import { describeActivity } from "./eventHistory";
import { GlyphButton, GradientButton, MonoPill, SectionCard, fieldStyle } from "./eventUi";
import { ErrorState, LoadingState } from "./states";

function relativeTime(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  return `${months}mo ago`;
}

// ── To Do ─────────────────────────────────────────────────────────────────

export function EventTodoTab({ eventId }: { eventId: string }) {
  const board = useEventTasks(eventId);
  // `DELETE /tasks/:id` is a hard delete with no undo, and the bin sits one row
  // away from the checkbox that merely completes it.
  const confirmDelete = useConfirmDialog();

  if (board.isPending) return <LoadingState label="Loading tasks" />;
  if (board.isError) return <ErrorState error={board.error} title="Couldn't load tasks" />;

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          marginBottom: 16,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
          <h3
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 600,
              fontSize: 18,
              margin: 0,
              color: "var(--text)",
            }}
          >
            To Do
          </h3>
          <MonoPill>{board.activeCount} active</MonoPill>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={board.draft}
            onChange={(event) => board.setDraft(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && board.addDraft()}
            placeholder="Add a task…"
            style={{ ...fieldStyle, width: 210 }}
          />
          <GradientButton onClick={board.addDraft} disabled={board.isAdding}>
            + Add
          </GradientButton>
        </div>
      </div>

      <SectionCard style={{ padding: 0, overflow: "hidden" }}>
        {board.tasks.length === 0 ? (
          <div style={{ textAlign: "center", padding: "64px 20px", color: "var(--muted)" }}>
            <Icon name="check" size={30} />
            <div
              style={{
                fontFamily: "var(--font-display)",
                fontWeight: 600,
                fontSize: 16,
                color: "var(--text)",
                margin: "12px 0 4px",
              }}
            >
              No tasks yet
            </div>
            <div style={{ fontSize: 13 }}>Create your first task to start tracking.</div>
          </div>
        ) : (
          board.tasks.map((task, index) => (
            <div
              key={task.id}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 14,
                padding: "14px 20px",
                borderTop: index === 0 ? "none" : "1px solid var(--border)",
              }}
            >
              <button
                type="button"
                aria-label={task.completed ? "Mark incomplete" : "Mark complete"}
                onClick={() => board.toggleCompleted(task)}
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 6,
                  border: task.completed ? "none" : "1.5px solid var(--border-strong)",
                  background: task.completed ? "#6FC97A" : "transparent",
                  color: "#fff",
                  cursor: "pointer",
                  display: "grid",
                  placeItems: "center",
                  flexShrink: 0,
                }}
              >
                {task.completed && <Icon name="check" size={14} />}
              </button>
              {/* The due date and the note, which this tab used to drop on the
                  floor: the SAME task showed a deadline and a note on /tasks and
                  a bare title here, so an operator working out of the event
                  workspace could not see what they had written down. Same fields,
                  same formatter, same order as the Tasks list rows. */}
              <div
                style={{
                  flex: 1,
                  minWidth: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
              >
                <span
                  style={{
                    fontSize: 14,
                    color: task.completed ? "var(--muted)" : "var(--text)",
                    textDecoration: task.completed ? "line-through" : "none",
                  }}
                >
                  {task.title}
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
                {/* Who owes it. The In-House Management panel points here for
                    exactly this, and until now there was nothing to point at. */}
                <TaskAssigneeTag name={task.assigneeName} />
                {task.description && (
                  <span style={{ fontSize: 13, fontStyle: "italic", color: "var(--muted)" }}>
                    “{task.description}”
                  </span>
                )}
              </div>
              <GlyphButton ariaLabel="Edit task" onClick={() => board.openEditor(task)}>
                <Icon name="pencil" size={16} />
              </GlyphButton>
              <GlyphButton
                ariaLabel="Delete task"
                onClick={() =>
                  confirmDelete.ask({
                    title: "Delete this task?",
                    body: (
                      <>
                        <strong>{task.title}</strong> is deleted for everyone on this event. There
                        is no undo — completing it instead keeps the record.
                      </>
                    ),
                    confirmLabel: "Delete task",
                    destructive: true,
                    onConfirm: () => board.remove(task),
                  })
                }
              >
                <Icon name="trash" size={16} />
              </GlyphButton>
            </div>
          ))
        )}
      </SectionCard>

      {/* The SAME dialog /tasks opens — title, work-group, note, due date. This
          tab used to offer a checkbox and a bin and nothing else. */}
      <ConfirmDialog {...confirmDelete.dialogProps} />

      <TaskFormModal
        open={board.editorOpen}
        task={board.editing}
        groups={board.groups}
        eventId={eventId}
        onClose={board.closeEditor}
        onSaved={board.onSaved}
      />
    </div>
  );
}

// ── Team / Crew ───────────────────────────────────────────────────────────

export interface CrewMember {
  id: string;
  name: string;
  initials: string;
  /** The crew member's profile picture, straight off the roster. Nullable: an
   * off-platform hand added by name has no profile behind them. */
  avatarUrl: string | null;
  role: string;
}

// ── Event History ─────────────────────────────────────────────────────────

type HistoryIcon = { name: Parameters<typeof Icon>[0]["name"]; color: string; tint: string };
const DEFAULT_HISTORY_ICON: HistoryIcon = {
  name: "calendar-check",
  color: "#EE5746",
  tint: "color-mix(in srgb,#EE5746 14%,transparent)",
};
const PEOPLE_HISTORY_ICON: HistoryIcon = {
  name: "users",
  color: "#6FC97A",
  tint: "color-mix(in srgb,#6FC97A 16%,transparent)",
};
const MONEY_HISTORY_ICON: HistoryIcon = {
  name: "file",
  color: "#F4A046",
  tint: "color-mix(in srgb,#F4A046 16%,transparent)",
};
const TIME_HISTORY_ICON: HistoryIcon = {
  name: "clock",
  color: "#6aa5d8",
  tint: "color-mix(in srgb,#6aa5d8 16%,transparent)",
};
/** The act's own material — what the performer brings, rather than what the operator runs. */
const ARTIST_HISTORY_ICON: HistoryIcon = {
  name: "music",
  color: "#B48BE0",
  tint: "color-mix(in srgb,#B48BE0 16%,transparent)",
};
/** One icon per activity `targetKind` — every kind the API can write has an entry. */
const HISTORY_ICON: Record<string, HistoryIcon> = {
  event: DEFAULT_HISTORY_ICON,
  hold: DEFAULT_HISTORY_ICON,
  schedule: TIME_HISTORY_ICON,
  task: TIME_HISTORY_ICON,
  deal: MONEY_HISTORY_ICON,
  budget: MONEY_HISTORY_ICON,
  settlement: MONEY_HISTORY_ICON,
  transfer: MONEY_HISTORY_ICON,
  participant: PEOPLE_HISTORY_ICON,
  invitation: PEOPLE_HISTORY_ICON,
  share: PEOPLE_HISTORY_ICON,
  rider: ARTIST_HISTORY_ICON,
  setlist: ARTIST_HISTORY_ICON,
};

export function EventHistoryTab({ eventId }: { eventId: string }) {
  const { data, isPending, isError, error } = useGetApiV1Activity({ eventId });
  if (isPending) return <LoadingState label="Loading history" />;
  if (isError) return <ErrorState error={error} title="Couldn't load history" />;

  const items = data?.items ?? [];
  if (items.length === 0) {
    return (
      <SectionCard>
        <div style={{ color: "var(--dim)", fontSize: 13, textAlign: "center", padding: "24px 0" }}>
          No history yet.
        </div>
      </SectionCard>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {items.map((item) => {
        const meta = HISTORY_ICON[item.targetKind ?? ""] ?? DEFAULT_HISTORY_ICON;
        const { title, lines } = describeActivity(item.type, item.summary);
        return (
          <div
            key={item.id}
            style={{
              background: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: 14,
              padding: "16px 18px",
              boxShadow: "var(--shadow)",
              display: "flex",
              gap: 14,
            }}
          >
            <span
              style={{
                width: 34,
                height: 34,
                flexShrink: 0,
                borderRadius: 9,
                background: meta.tint,
                color: meta.color,
                display: "grid",
                placeItems: "center",
              }}
            >
              <Icon name={meta.name} size={17} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 500, color: "var(--text)", fontSize: 13.5 }}>{title}</div>
              {lines.length > 0 && (
                <div
                  style={{
                    margin: "8px 0",
                    fontFamily: "var(--font-mono)",
                    fontSize: 12,
                    color: "var(--muted)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 3,
                  }}
                >
                  {lines.map((line) => (
                    <span key={line}>{line}</span>
                  ))}
                </div>
              )}
              <div style={{ color: "var(--dim)", fontSize: 11.5, marginTop: 4 }}>
                {[item.actorDisplay, relativeTime(item.createdAt)].filter(Boolean).join(" · ")}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
