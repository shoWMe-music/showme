import { type getApiV1Events, useGetApiV1Events } from "@showme/api-client";
import { Button, EmptyState, Icon } from "@showme/design-system";
import { useNavigate } from "@tanstack/react-router";
import { type CSSProperties, useState } from "react";
import { GradientButton } from "../components/eventUi";
import { ErrorState, LoadingState } from "../components/states";
import { useNewEvent } from "../shell/NewEventProvider";

type EventItem = Awaited<ReturnType<typeof getApiV1Events>>["items"][number];

/** Status colour + label map — ported verbatim from the prototype's EVMETA so
 * the pills overlay the design exactly. */
const EV_META: Record<string, { color: string; label: string }> = {
  draft: { color: "#8C7A6C", label: "Draft" },
  suggested: { color: "#B58BE0", label: "Suggested" },
  pending: { color: "#F4A046", label: "Pending" },
  confirmed: { color: "#6FC97A", label: "Confirmed" },
  on_hold: { color: "#FFC266", label: "On hold" },
  concluded: { color: "#B8A99B", label: "Concluded" },
  cancelled: { color: "#EE5746", label: "Cancelled" },
};

/** The filter pill row (left of the view toggle). Values match the API status
 * enum; "Pending" folds in offers awaiting a response (suggested). */
const FILTER_CHIPS: [value: string, label: string][] = [
  ["all", "All"],
  ["pending", "Pending"],
  ["on_hold", "On hold"],
  ["concluded", "Concluded"],
  ["draft", "Draft"],
];

/** Board view = four fixed columns, in this order and colour (prototype boardDefs). */
const BOARD_DEFS: [status: string, label: string, color: string][] = [
  ["pending", "Pending", "#F4A046"],
  ["on_hold", "On hold", "#FFC266"],
  ["confirmed", "Confirmed", "#6FC97A"],
  ["concluded", "Concluded", "#B8A99B"],
];

/** `#RRGGBB` → `rgba()` at the given alpha (prototype's hexA). */
function hexA(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** The pill wrapper style for a status badge (prototype `badge(color)`). */
function badgeStyle(color: string): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "4px 10px",
    borderRadius: 999,
    fontSize: 11.5,
    fontWeight: 500,
    fontFamily: "var(--font-mono)",
    letterSpacing: ".01em",
    whiteSpace: "nowrap",
    background: hexA(color, 0.15),
    color,
  };
}

/** The 6px status dot inside a badge (prototype `dot(color)`). */
function dotStyle(color: string): CSSProperties {
  return { width: 6, height: 6, borderRadius: "50%", background: color, flexShrink: 0 };
}

function eventMeta(status: string): { color: string; label: string } {
  return EV_META[status] ?? { color: "#8C7A6C", label: "Draft" };
}

/** "Jul 04" — month short + 2-digit day, no year (matches the prototype list). */
function shortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", { month: "short", day: "2-digit" });
}

/** The "Pending" filter folds in offers awaiting a response (suggested). */
function matchesFilter(event: EventItem, filter: string): boolean {
  if (filter === "all") return true;
  if (filter === "pending") return event.status === "pending" || event.status === "suggested";
  return event.status === filter;
}

const GRID_COLUMNS = "2.4fr 1.5fr 1fr .8fr 1.2fr 1fr";

export function Events() {
  const navigate = useNavigate();
  const { openNewEvent, canCreateEvent } = useNewEvent();
  const [filter, setFilter] = useState("all");
  const [view, setView] = useState<"list" | "board">("list");
  const { data, isPending, isError, error } = useGetApiV1Events();

  const rows = (data?.items ?? []).filter((event) => matchesFilter(event, filter));
  const openEvent = (eventId: string) => navigate({ to: "/events/$eventId", params: { eventId } });

  return (
    <div style={{ width: "100%", maxWidth: 1180, margin: "0 auto" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          marginBottom: 20,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
          {FILTER_CHIPS.map(([value, label]) => {
            const active = value === filter;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setFilter(value)}
                style={{
                  padding: "6px 13px",
                  borderRadius: 999,
                  fontSize: 12.5,
                  fontWeight: 500,
                  cursor: "pointer",
                  border: active ? "1px solid transparent" : "1px solid var(--border)",
                  background: active ? "linear-gradient(135deg,#EE5746,#F4A046)" : "transparent",
                  color: active ? "#fff" : "var(--muted)",
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <ViewToggle value={view} onChange={setView} />
          {canCreateEvent && (
            <GradientButton onClick={openNewEvent}>
              <Icon name="plus" size={15} /> New event
            </GradientButton>
          )}
        </div>
      </div>

      {isPending ? (
        <LoadingState label="Loading events" />
      ) : isError ? (
        <ErrorState error={error} title="Couldn't load events" />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Icon name="calendar" />}
          title="No events yet"
          description="Events you create or join will show up here."
          action={
            canCreateEvent ? (
              <Button variant="primary" leftIcon={<Icon name="plus" />} onClick={openNewEvent}>
                New event
              </Button>
            ) : undefined
          }
        />
      ) : view === "board" ? (
        <EventBoard rows={rows} onOpen={openEvent} />
      ) : (
        <EventList rows={rows} onOpen={openEvent} />
      )}
    </div>
  );
}

/** List / Board segmented pill (top-right of the filter row). Full 999px pill
 * container; the active option gets the surface fill + soft shadow. */
function ViewToggle({
  value,
  onChange,
}: {
  value: "list" | "board";
  onChange: (next: "list" | "board") => void;
}) {
  const options: { key: "list" | "board"; label: string }[] = [
    { key: "list", label: "List" },
    { key: "board", label: "Board" },
  ];
  return (
    <div
      style={{
        display: "flex",
        gap: 4,
        background: "var(--elevated)",
        border: "1px solid var(--border)",
        borderRadius: 999,
        padding: 4,
      }}
    >
      {options.map((option) => {
        const active = option.key === value;
        return (
          <button
            key={option.key}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.key)}
            style={{
              padding: "6px 16px",
              borderRadius: 999,
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
              border: 0,
              background: active ? "var(--surface)" : "transparent",
              color: active ? "var(--text)" : "var(--muted)",
              boxShadow: active ? "var(--shadow)" : "none",
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** The List view — a bordered card with a mono header row and one grid row per
 * event. The events-list payload carries only title, date and status, so Venue,
 * Cap and Settlement render an honest "—" (no faked venue name/capacity). */
function EventList({ rows, onOpen }: { rows: EventItem[]; onOpen: (eventId: string) => void }) {
  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 18,
        overflow: "hidden",
        boxShadow: "var(--shadow)",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: GRID_COLUMNS,
          gap: 12,
          padding: "13px 22px",
          borderBottom: "1px solid var(--border)",
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          letterSpacing: ".12em",
          textTransform: "uppercase",
          color: "var(--dim)",
        }}
      >
        <span>Event / Artist</span>
        <span>Venue</span>
        <span>Date</span>
        <span style={{ textAlign: "right" }}>Cap</span>
        <span>Status</span>
        <span>Settlement</span>
      </div>
      {rows.map((event) => {
        const meta = eventMeta(event.status);
        return (
          <button
            key={event.id}
            type="button"
            onClick={() => onOpen(event.id)}
            onMouseEnter={(mouse) => {
              mouse.currentTarget.style.background = "var(--elevated)";
            }}
            onMouseLeave={(mouse) => {
              mouse.currentTarget.style.background = "transparent";
            }}
            style={{
              width: "100%",
              display: "grid",
              gridTemplateColumns: GRID_COLUMNS,
              gap: 12,
              alignItems: "center",
              padding: "15px 22px",
              background: "transparent",
              border: 0,
              borderTop: "1px solid var(--border)",
              cursor: "pointer",
              textAlign: "left",
              transition: "background .16s",
            }}
          >
            <span style={{ minWidth: 0 }}>
              <span
                style={{
                  display: "block",
                  fontWeight: 600,
                  color: "var(--text)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {event.title}
              </span>
              <span style={{ display: "block", color: "var(--muted)", fontSize: 12.5 }}>—</span>
            </span>
            <span style={{ color: "var(--muted)", fontSize: 13 }}>—</span>
            <span style={{ fontFamily: "var(--font-mono)", color: "var(--text)", fontSize: 13 }}>
              {shortDate(event.eventDate)}
            </span>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                color: "var(--muted)",
                fontSize: 13,
                textAlign: "right",
              }}
            >
              —
            </span>
            <span>
              <span style={badgeStyle(meta.color)}>
                <span style={dotStyle(meta.color)} />
                {meta.label}
              </span>
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ display: "inline-flex", color: "var(--dim)", fontSize: 12 }}>
                <span style={dotStyle("#8C7A6C")} />
                <span style={{ marginLeft: 6 }}>—</span>
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** The Board view — the four fixed status columns, each holding the events in
 * that status. Cards carry only the title + date honestly ("— cap" since the
 * list payload has no capacity). Draft/suggested/cancelled events fall outside
 * the four columns, exactly as in the prototype. */
function EventBoard({ rows, onOpen }: { rows: EventItem[]; onOpen: (eventId: string) => void }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(4,minmax(220px,1fr))",
        gap: 14,
        overflowX: "auto",
      }}
    >
      {BOARD_DEFS.map(([status, label, color]) => {
        const items = rows.filter((event) => event.status === status);
        return (
          <div
            key={status}
            style={{
              background: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: 16,
              padding: 14,
              minHeight: 200,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: color }} />
              <span style={{ fontWeight: 600, fontSize: 13.5, color: "var(--text)" }}>{label}</span>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  color: "var(--muted)",
                  marginLeft: "auto",
                }}
              >
                {items.length}
              </span>
            </div>
            {items.map((event) => (
              <button
                key={event.id}
                type="button"
                onClick={() => onOpen(event.id)}
                onMouseEnter={(mouse) => {
                  mouse.currentTarget.style.transform = "translateY(-2px)";
                }}
                onMouseLeave={(mouse) => {
                  mouse.currentTarget.style.transform = "none";
                }}
                style={{
                  width: "100%",
                  textAlign: "left",
                  background: "var(--elevated)",
                  border: "1px solid var(--border)",
                  borderRadius: 12,
                  padding: 12,
                  marginBottom: 9,
                  cursor: "pointer",
                  transition: "transform .16s",
                }}
              >
                <span
                  style={{
                    display: "block",
                    fontWeight: 600,
                    color: "var(--text)",
                    fontSize: 13.5,
                  }}
                >
                  {event.title}
                </span>
                <span
                  style={{
                    display: "block",
                    color: "var(--muted)",
                    fontSize: 12,
                    margin: "2px 0 8px",
                  }}
                >
                  —
                </span>
                <span
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontFamily: "var(--font-mono)",
                    fontSize: 11.5,
                    color: "var(--muted)",
                  }}
                >
                  <span>{shortDate(event.eventDate)}</span>
                  <span>— cap</span>
                </span>
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}
