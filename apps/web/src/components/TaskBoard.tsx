import { Badge, Icon } from "@showme/design-system";
import {
  type DragEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  SCOPE_META,
  type Task,
  type TaskBoardColumn,
  formatTaskDueDate,
  scopeOf,
} from "../hooks/useTaskBoard";
import { Eyebrow } from "./primitives";

/**
 * The Tasks screen's board view — the same tasks the list shows, laid out as
 * columns you can move a card between.
 *
 * **Two columns, because two is the whole vocabulary.** `tasks.completed` is a
 * boolean; there is no `task_status` enum in `packages/db`. A "To do / Doing /
 * Done" board would therefore be three columns over two storable states, and the
 * middle one could never survive a reload. So the columns are Open and Done, and
 * a move writes the only thing a move can write: `PATCH /tasks/:id { completed }`.
 *
 * **Every move is keyboard-reachable.** Cards are draggable, but dragging is the
 * optional half: each card is focusable and carries an explicit "Mark done" /
 * "Reopen" button, plus ArrowRight / ArrowLeft on the focused card. No drag
 * library is involved — the native HTML5 drag events are enough for two columns,
 * and a dependency for this would have bought nothing the keyboard route needs.
 */
export interface TaskBoardProps {
  columns: TaskBoardColumn[];
  /** Persist the move. The caller PATCHes and refetches; nothing is optimistic. */
  onMove: (task: Task, completed: boolean) => void;
  onEdit: (task: Task) => void;
  /** A move is in flight — the board dims rather than pretending it landed. */
  isMoving: boolean;
}

export function TaskBoard({ columns, onMove, onEdit, isMoving }: TaskBoardProps) {
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  // Where to put focus back after a move. Moving unmounts the card from one column
  // and mounts it in the other, which would otherwise drop focus to <body> and
  // strand a keyboard user after every single move.
  //
  // The intent records the DESTINATION, not just the task, because nothing is
  // optimistic: for the moment between the PATCH and the refetch landing, the card
  // is still sitting in the column it came from. Matching on the task id alone let
  // that stale card claim the focus and clear the intent, so focus was handed to a
  // card that then unmounted — which is exactly how it ended up on <body>.
  const [focusIntent, setFocusIntent] = useState<{ taskId: string; completed: boolean } | null>(
    null,
  );
  const clearFocusIntent = useCallback(() => setFocusIntent(null), []);

  const findTask = (taskId: string): Task | undefined =>
    columns.flatMap((column) => column.tasks).find((task) => task.id === taskId);

  const move = (task: Task, completed: boolean) => {
    if (task.completed === completed) return;
    setFocusIntent({ taskId: task.id, completed });
    onMove(task, completed);
  };

  const dropOn = (column: TaskBoardColumn) => (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOverColumn(null);
    setDraggingTaskId(null);
    const task = findTask(event.dataTransfer.getData("text/plain"));
    if (task) move(task, column.completed);
  };

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(2, minmax(260px, 1fr))",
        gap: 14,
        overflowX: "auto",
        opacity: isMoving ? 0.65 : 1,
        transition: "opacity .15s",
      }}
    >
      {columns.map((column) => {
        const dragging = draggingTaskId ? findTask(draggingTaskId) : undefined;
        const acceptsDrop = dragging != null && dragging.completed !== column.completed;
        const highlighted = acceptsDrop && dragOverColumn === column.key;
        return (
          <div
            key={column.key}
            onDragOver={(event) => {
              if (!acceptsDrop) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              setDragOverColumn(column.key);
            }}
            onDragLeave={() =>
              setDragOverColumn((current) => (current === column.key ? null : current))
            }
            onDrop={dropOn(column)}
            style={{
              background: "var(--card)",
              border: `1px solid ${highlighted ? column.color : "var(--border)"}`,
              boxShadow: highlighted ? `0 0 0 2px ${column.color}33` : "none",
              borderRadius: 16,
              padding: 14,
              minHeight: 220,
              transition: "border-color .15s, box-shadow .15s",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <span
                style={{ width: 8, height: 8, borderRadius: "50%", background: column.color }}
              />
              <span style={{ fontWeight: 600, fontSize: 13.5, color: "var(--text)" }}>
                {column.label}
              </span>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  color: "var(--muted)",
                  marginLeft: "auto",
                }}
              >
                {column.tasks.length}
              </span>
            </div>

            {column.sections.length === 0 ? (
              <p style={{ margin: 0, fontSize: 12.5, color: "var(--muted)" }}>
                {column.completed ? "Nothing completed in this view." : "Nothing open here."}
              </p>
            ) : (
              column.sections.map((section) => (
                <div key={section.bucket.id} style={{ marginBottom: 12 }}>
                  <Eyebrow>{section.bucket.name}</Eyebrow>
                  <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0 }}>
                    {section.tasks.map((task) => (
                      <TaskBoardCard
                        key={task.id}
                        task={task}
                        columnLabel={column.label}
                        shouldFocus={
                          focusIntent?.taskId === task.id &&
                          focusIntent.completed === task.completed
                        }
                        onFocused={clearFocusIntent}
                        onDragStart={(event) => {
                          event.dataTransfer.setData("text/plain", task.id);
                          event.dataTransfer.effectAllowed = "move";
                          setDraggingTaskId(task.id);
                        }}
                        onDragEnd={() => {
                          setDraggingTaskId(null);
                          setDragOverColumn(null);
                        }}
                        onMove={(completed) => move(task, completed)}
                        onEdit={() => onEdit(task)}
                      />
                    ))}
                  </ul>
                </div>
              ))
            )}
          </div>
        );
      })}
    </div>
  );
}

function TaskBoardCard({
  task,
  columnLabel,
  shouldFocus,
  onFocused,
  onDragStart,
  onDragEnd,
  onMove,
  onEdit,
}: {
  task: Task;
  columnLabel: string;
  shouldFocus: boolean;
  onFocused: () => void;
  onDragStart: (event: DragEvent<HTMLLIElement>) => void;
  onDragEnd: () => void;
  onMove: (completed: boolean) => void;
  onEdit: () => void;
}) {
  // The card's keyboard handle is its move BUTTON, not the card box: a button
  // already announces what it does and what it is for, where a focusable div has
  // to be explained. Focus is restored to that button after a move, because the
  // card unmounts from one column and remounts in the other.
  const moveButtonRef = useRef<HTMLButtonElement>(null);
  const scope = scopeOf(task);

  useEffect(() => {
    if (!shouldFocus) return;
    moveButtonRef.current?.focus();
    onFocused();
  }, [shouldFocus, onFocused]);

  // Left moves towards Open, right towards Done — the columns' reading order.
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowRight" && !task.completed) {
      event.preventDefault();
      onMove(true);
    } else if (event.key === "ArrowLeft" && task.completed) {
      event.preventDefault();
      onMove(false);
    }
  };

  return (
    <li
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      style={{
        background: "var(--elevated)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: 12,
        marginBottom: 9,
        cursor: "grab",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <span
        style={{
          fontWeight: 600,
          fontSize: 13.5,
          color: task.completed ? "var(--muted)" : "var(--text)",
          textDecoration: task.completed ? "line-through" : "none",
        }}
      >
        {task.title}
      </span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Badge status={SCOPE_META[scope].status}>{SCOPE_META[scope].label}</Badge>
        {task.dueDate && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontFamily: "var(--font-mono)",
              fontSize: 11.5,
              color: "var(--muted)",
            }}
          >
            <Icon name="clock" size={12} />
            {formatTaskDueDate(task.dueDate)}
          </span>
        )}
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
        <button
          ref={moveButtonRef}
          type="button"
          onClick={() => onMove(!task.completed)}
          onKeyDown={onKeyDown}
          aria-keyshortcuts="ArrowLeft ArrowRight"
          aria-label={
            task.completed
              ? `Reopen ${task.title} — move to Open`
              : `Mark ${task.title} done — move to Done`
          }
          title={`In ${columnLabel}. Drag the card, or use this button (arrow keys move it too).`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "5px 10px",
            borderRadius: 999,
            border: "1px solid var(--border)",
            background: "transparent",
            color: "var(--muted)",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          <MoveArrow direction={task.completed ? "left" : "right"} />
          {task.completed ? "Reopen" : "Mark done"}
        </button>
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Edit ${task.title}`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 28,
            height: 28,
            marginLeft: "auto",
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "transparent",
            color: "var(--muted)",
            cursor: "pointer",
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
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
    </li>
  );
}

/** The little arrow on the move button — points at the column the card goes to. */
function MoveArrow({ direction }: { direction: "left" | "right" }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      style={{ transform: direction === "left" ? "rotate(180deg)" : undefined }}
    >
      <path
        d="M5 12h14M13 6l6 6-6 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
