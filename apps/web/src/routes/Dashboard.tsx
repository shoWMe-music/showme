import {
  useGetApiV1BookingRequests,
  useGetApiV1Events,
  useGetApiV1InsightsProfilesIdSummary,
  useGetApiV1Tasks,
} from "@showme/api-client";
import { EmptyState, Icon, type IconName } from "@showme/design-system";
import { useNavigate } from "@tanstack/react-router";
import type { CSSProperties, ReactNode } from "react";
import { useAuth } from "../auth/AuthProvider";
import { ErrorState, LoadingState } from "../components/states";
import { formatDate } from "../lib/format";

type TaskItem = { id: string; title: string; dueDate: string | null; completed: boolean };

/** Events still waiting on an operator decision — the prototype's "needs a decision" set. */
const NEEDS_DECISION = new Set(["pending", "suggested", "on_hold"]);

/** Time-of-day greeting, matching the prototype's "Good morning, {name}". */
function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** Status hue → translucent tint, matching the prototype's `hexA(color, .14)`. */
function tint(hex: string, alpha = 0.14): string {
  const value = hex.replace("#", "");
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

/** One actionable row on the "needs attention" card. */
interface AttentionItem {
  id: string;
  icon: IconName;
  color: string;
  title: string;
  detail: string;
  action: string;
  onAction: () => void;
}

/** A KPI tile matching the prototype: dotted sentence-case label + oversized display value. */
function KpiTile({
  dot,
  label,
  value,
  valueSize,
  onClick,
}: {
  dot: string;
  label: string;
  value: ReactNode;
  valueSize: number;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className="dash-kpi" style={kpiTileStyle}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          color: "var(--muted)",
          fontSize: 12.5,
          marginBottom: 10,
        }}
      >
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: dot }} />
        {label}
      </div>
      <div
        style={{
          fontFamily: "var(--font-display)",
          fontWeight: 500,
          fontSize: valueSize,
          letterSpacing: "-.03em",
          lineHeight: 1,
          color: "var(--text)",
        }}
      >
        {value}
      </div>
    </button>
  );
}

const kpiTileStyle: CSSProperties = {
  textAlign: "left",
  background: "var(--card)",
  border: "1px solid var(--border)",
  borderRadius: 16,
  padding: "18px 20px",
  cursor: "pointer",
  boxShadow: "var(--shadow)",
  transition: "transform .2s, border-color .2s",
};

/** The compact mono eyebrow the prototype stamps above each stat band. */
function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 10.5,
        letterSpacing: ".16em",
        textTransform: "uppercase",
        color: "var(--dim)",
        marginBottom: 12,
      }}
    >
      {children}
    </div>
  );
}

const panelStyle: CSSProperties = {
  background: "var(--card)",
  border: "1px solid var(--border)",
  borderRadius: 18,
  padding: 22,
  boxShadow: "var(--shadow)",
};

export function Dashboard() {
  const navigate = useNavigate();
  const { session, user } = useAuth();
  const profileId = session?.memberships[0]?.profileId ?? "";

  const events = useGetApiV1Events();
  const summary = useGetApiV1InsightsProfilesIdSummary(profileId, {
    query: { enabled: Boolean(profileId) },
  });
  const requests = useGetApiV1BookingRequests({ limit: 5 });
  const tasks = useGetApiV1Tasks({ limit: 5 });

  const firstName =
    user?.displayName?.trim().split(/\s+/)[0] ?? session?.email?.split("@")[0] ?? "there";

  if (events.isPending) return <LoadingState label="Loading your dashboard" />;
  if (events.isError)
    return <ErrorState error={events.error} title="Couldn't load your dashboard" />;

  const eventList = events.data.items;
  const requestList = requests.data?.items ?? [];
  const taskList = ((tasks.data?.items ?? []) as TaskItem[]).filter((task) => !task.completed);
  const eventsByStatus = summary.data?.eventsByStatus as Record<string, number> | undefined;

  const openEvent = (id: string) => navigate({ to: "/events/$eventId", params: { eventId: id } });

  // --- "Needs attention" — assembled from the data we actually have: events
  // awaiting a decision, unanswered booking requests, and open tasks. ---
  const attention: AttentionItem[] = [];
  for (const event of eventList) {
    if (!NEEDS_DECISION.has(event.status)) continue;
    attention.push({
      id: `event-${event.id}`,
      icon: "calendar",
      color: "#F4A046",
      title: `Confirm ${event.title}`,
      detail: `Pending event · ${formatDate(event.eventDate, { day: "2-digit", month: "short" })} · needs a decision`,
      action: "Review",
      onAction: () => openEvent(event.id),
    });
  }
  for (const request of requestList) {
    if (request.status !== "pending") continue;
    const requester = request.artistName ?? request.contactName ?? "New request";
    attention.push({
      id: `request-${request.id}`,
      icon: "inbox",
      color: "#6FA8E0",
      title: `Reply to ${requester}`,
      detail: `Booking request · ${formatDate(request.wantedDate, { day: "2-digit", month: "short" })}`,
      action: "Review",
      onAction: () => navigate({ to: "/requests" }),
    });
  }
  for (const task of taskList) {
    attention.push({
      id: `task-${task.id}`,
      icon: "check",
      color: "#6FC97A",
      title: task.title,
      detail: task.dueDate
        ? `Task · due ${formatDate(task.dueDate, { day: "2-digit", month: "short" })}`
        : "Task · open",
      action: "Open",
      onAction: () => navigate({ to: "/tasks" }),
    });
  }
  const attentionShown = attention.slice(0, 5);

  // --- Event stat band (from the insights summary, falling back to the list). ---
  const countStatus = (...statuses: string[]) => {
    if (eventsByStatus) return statuses.reduce((sum, key) => sum + (eventsByStatus[key] ?? 0), 0);
    return eventList.filter((event) => statuses.includes(event.status)).length;
  };
  const totalEvents = summary.data?.eventsHosted ?? eventList.length;

  return (
    <div
      style={{
        maxWidth: 1180,
        margin: "0 auto",
        display: "flex",
        flexDirection: "column",
        gap: 26,
      }}
    >
      <style>{`
        .dash-attn-row:hover { background: var(--elevated) !important; }
        .dash-recent-row:hover { background: var(--elevated) !important; }
        .dash-kpi:hover { transform: translateY(-3px); border-color: var(--border-strong); }
      `}</style>

      {/* Greeting */}
      <div>
        <h2
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: 500,
            fontSize: 34,
            letterSpacing: "-.025em",
            margin: "0 0 4px",
          }}
        >
          {greeting()},{" "}
          <span
            style={{
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontWeight: 400,
              color: "var(--accent)",
            }}
          >
            {firstName}
          </span>
        </h2>
        <p style={{ color: "var(--muted)", margin: 0, fontSize: 15 }}>
          {attentionShown.length === 0 ? (
            <>You're all caught up — nothing needs your attention today.</>
          ) : (
            <>
              You have{" "}
              <b style={{ color: "var(--text)" }}>
                {attentionShown.length} {attentionShown.length === 1 ? "thing" : "things"}
              </b>{" "}
              that need attention today.
            </>
          )}
        </p>
      </div>

      {/* Needs attention */}
      {attentionShown.length === 0 ? (
        <EmptyState
          icon={<Icon name="check" />}
          title="Nothing needs attention"
          description="Pending events, new booking requests and open tasks surface here."
        />
      ) : (
        <div
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: 18,
            padding: 6,
            boxShadow: "var(--shadow)",
          }}
        >
          {attentionShown.map((item) => (
            <button
              type="button"
              key={item.id}
              onClick={item.onAction}
              className="dash-attn-row"
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                gap: 16,
                padding: "15px 16px",
                background: "transparent",
                border: 0,
                borderRadius: 14,
                cursor: "pointer",
                textAlign: "left",
                transition: "background .18s",
              }}
            >
              <span
                style={{
                  width: 38,
                  height: 38,
                  flexShrink: 0,
                  borderRadius: 11,
                  display: "grid",
                  placeItems: "center",
                  background: tint(item.color),
                  color: item.color,
                }}
              >
                <Icon name={item.icon} size={18} />
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span
                  style={{
                    display: "block",
                    fontWeight: 500,
                    color: "var(--text)",
                    fontSize: 14.5,
                  }}
                >
                  {item.title}
                </span>
                <span style={{ display: "block", color: "var(--muted)", fontSize: 13 }}>
                  {item.detail}
                </span>
              </span>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  color: item.color,
                  padding: "4px 10px",
                  borderRadius: 999,
                  background: tint(item.color),
                  whiteSpace: "nowrap",
                }}
              >
                {item.action}
              </span>
              <span style={{ color: "var(--muted)", display: "inline-flex" }}>
                <Icon name="chevron-right" size={18} />
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Events band */}
      <div>
        <Eyebrow>Events</Eyebrow>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
          <KpiTile
            dot="#B8A99B"
            label="Total events"
            value={totalEvents}
            valueSize={38}
            onClick={() => navigate({ to: "/events" })}
          />
          <KpiTile
            dot="#6FC97A"
            label="Confirmed"
            value={countStatus("confirmed")}
            valueSize={38}
            onClick={() => navigate({ to: "/events" })}
          />
          <KpiTile
            dot="#F4A046"
            label="Pending"
            value={countStatus("pending", "suggested")}
            valueSize={38}
            onClick={() => navigate({ to: "/events" })}
          />
          <KpiTile
            dot="#FFC266"
            label="On hold"
            value={countStatus("on_hold")}
            valueSize={38}
            onClick={() => navigate({ to: "/events" })}
          />
        </div>
      </div>

      {/* Settlements band — no profile-level settlement aggregate endpoint yet, so the
          figures are honest placeholders rather than fabricated numbers. */}
      <div>
        <Eyebrow>Settlements</Eyebrow>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
          <KpiTile
            dot="#6FC97A"
            label="Total settled"
            value="—"
            valueSize={34}
            onClick={() => navigate({ to: "/settlements" })}
          />
          <KpiTile
            dot="#F4A046"
            label="Pending review"
            value="—"
            valueSize={34}
            onClick={() => navigate({ to: "/settlements" })}
          />
          <KpiTile
            dot="#6FA8E0"
            label="Outstanding"
            value="—"
            valueSize={34}
            onClick={() => navigate({ to: "/settlements" })}
          />
          <KpiTile
            dot="#E6D9CB"
            label="Finalized"
            value="—"
            valueSize={34}
            onClick={() => navigate({ to: "/settlements" })}
          />
        </div>
      </div>

      {/* Recent settlements + Top venues */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.55fr 1fr",
          gap: 20,
          alignItems: "start",
        }}
      >
        <div style={panelStyle}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 14,
            }}
          >
            <h3
              style={{
                fontFamily: "var(--font-display)",
                fontWeight: 500,
                fontSize: 18,
                margin: 0,
              }}
            >
              Recent settlements
            </h3>
            <button
              type="button"
              onClick={() => navigate({ to: "/settlements" })}
              style={{
                background: "transparent",
                border: 0,
                color: "var(--accent)",
                fontSize: 13,
                cursor: "pointer",
                fontWeight: 500,
              }}
            >
              See all
            </button>
          </div>
          <EmptyState
            icon={<Icon name="receipt" />}
            title="No settlements yet"
            description="Concluded events with a settlement will show here — with status and amount."
          />
        </div>

        <div style={panelStyle}>
          <h3
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 500,
              fontSize: 18,
              margin: "0 0 16px",
            }}
          >
            Top venues by revenue
          </h3>
          <EmptyState
            icon={<Icon name="trending-up" />}
            title="No revenue yet"
            description="Revenue by venue appears here once your events start settling."
          />
        </div>
      </div>
    </div>
  );
}
