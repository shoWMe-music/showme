import {
  getGetApiV1TasksQueryKey,
  useDeleteApiV1TasksId,
  useGetApiV1Activity,
  useGetApiV1Tasks,
  usePatchApiV1TasksId,
  usePostApiV1Tasks,
} from "@showme/api-client";
import { Avatar, Icon } from "@showme/design-system";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { describeActivity } from "./eventHistory";
import {
  GlyphButton,
  GradientButton,
  MonoPill,
  OutlineButton,
  SectionCard,
  fieldStyle,
} from "./eventUi";
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
  const queryClient = useQueryClient();
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getGetApiV1TasksQueryKey({ eventId }) });

  const { data, isPending, isError, error } = useGetApiV1Tasks({ eventId });
  const create = usePostApiV1Tasks({ mutation: { onSuccess: invalidate } });
  const patch = usePatchApiV1TasksId({ mutation: { onSuccess: invalidate } });
  const remove = useDeleteApiV1TasksId({ mutation: { onSuccess: invalidate } });
  const [draft, setDraft] = useState("");

  if (isPending) return <LoadingState label="Loading tasks" />;
  if (isError) return <ErrorState error={error} title="Couldn't load tasks" />;

  const tasks = data?.items ?? [];
  const active = tasks.filter((task) => !task.completed).length;

  const add = () => {
    const title = draft.trim();
    if (!title) return;
    create.mutate({ data: { title, eventId } });
    setDraft("");
  };

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
          <MonoPill>{active} active</MonoPill>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && add()}
            placeholder="Add a task…"
            style={{ ...fieldStyle, width: 210 }}
          />
          <GradientButton onClick={add} disabled={create.isPending}>
            + Add
          </GradientButton>
        </div>
      </div>

      <SectionCard style={{ padding: 0, overflow: "hidden" }}>
        {tasks.length === 0 ? (
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
          tasks.map((task, index) => (
            <div
              key={task.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                padding: "14px 20px",
                borderTop: index === 0 ? "none" : "1px solid var(--border)",
              }}
            >
              <button
                type="button"
                aria-label={task.completed ? "Mark incomplete" : "Mark complete"}
                onClick={() => patch.mutate({ id: task.id, data: { completed: !task.completed } })}
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
              <span
                style={{
                  flex: 1,
                  fontSize: 14,
                  color: task.completed ? "var(--muted)" : "var(--text)",
                  textDecoration: task.completed ? "line-through" : "none",
                }}
              >
                {task.title}
              </span>
              <GlyphButton ariaLabel="Delete task" onClick={() => remove.mutate({ id: task.id })}>
                <Icon name="trash" size={16} />
              </GlyphButton>
            </div>
          ))
        )}
      </SectionCard>
    </div>
  );
}

// ── Team / Crew ───────────────────────────────────────────────────────────

export interface CrewMember {
  id: string;
  name: string;
  initials: string;
  role: string;
}

export function EventTeamCrewTab({ crew }: { crew: CrewMember[] }) {
  const [sub, setSub] = useState<"shared" | "inhouse">("shared");
  return (
    <div>
      <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
        <SubToggle active={sub === "shared"} onClick={() => setSub("shared")}>
          <Icon name="users" size={15} /> Shared Team
        </SubToggle>
        <SubToggle active={sub === "inhouse"} onClick={() => setSub("inhouse")}>
          <Icon name="settings" size={15} /> In-House Management
        </SubToggle>
      </div>

      {sub === "shared" ? (
        <>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 14,
              flexWrap: "wrap",
              gap: 12,
            }}
          >
            <div>
              <h3
                style={{
                  fontFamily: "var(--font-display)",
                  fontWeight: 600,
                  fontSize: 16,
                  margin: 0,
                  color: "var(--text)",
                }}
              >
                Team &amp; Crew
              </h3>
              <p style={{ color: "var(--muted)", fontSize: 12.5, margin: "3px 0 0" }}>
                Visible to all event collaborators
              </p>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <OutlineButton>
                <Icon name="users" size={15} /> From Team
              </OutlineButton>
              <GradientButton>+ Add Member</GradientButton>
            </div>
          </div>
          <SectionCard style={{ padding: 0 }}>
            {crew.length === 0 ? (
              <div style={{ textAlign: "center", padding: "60px 20px", color: "var(--muted)" }}>
                <Icon name="users" size={32} />
                <div style={{ fontSize: 13.5, marginTop: 12 }}>No crew members added yet.</div>
              </div>
            ) : (
              crew.map((member, index) => (
                <div
                  key={member.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "14px 18px",
                    borderTop: index === 0 ? "none" : "1px solid var(--border)",
                  }}
                >
                  <Avatar initials={member.initials} tone="blue" shape="square" size={32} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, color: "var(--text)", fontSize: 13.5 }}>
                      {member.name}
                    </div>
                    <div style={{ color: "var(--muted)", fontSize: 12 }}>{member.role}</div>
                  </div>
                </div>
              ))
            )}
          </SectionCard>
        </>
      ) : (
        <SectionCard>
          <h3
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 600,
              fontSize: 16,
              margin: 0,
              color: "var(--text)",
            }}
          >
            Private Team Management
          </h3>
          <p style={{ color: "var(--muted)", fontSize: 12.5, margin: "6px 0 0" }}>
            Only visible to you. Team schedules, private notes and assigned tasks live here — manage
            assignees from the To Do tab.
          </p>
        </SectionCard>
      )}
    </div>
  );
}

function SubToggle({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "10px 16px",
        borderRadius: 10,
        border: active ? "1px solid var(--brand-red)" : "1px solid var(--border)",
        background: active
          ? "color-mix(in srgb,var(--brand-red) 8%,transparent)"
          : "var(--surface)",
        color: active ? "var(--brand-red)" : "var(--text)",
        fontSize: 13,
        fontWeight: 500,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
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
