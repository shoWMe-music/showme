import {
  type getApiV1BookingRequests,
  useGetApiV1BookingRequests,
  usePostApiV1BookingRequestsIdFlagSpam,
} from "@showme/api-client";
import {
  Badge,
  Card,
  Chip,
  Icon,
  SectionHeader,
  type Status,
  useToast,
} from "@showme/design-system";
import { useMemo, useState } from "react";
import {
  MiniMonthCalendar,
  RequestCard,
  type RequestCardData,
  SegmentedToggle,
} from "../components";
import { dayKey } from "../components/calendarGrid";
import { Eyebrow } from "../components/primitives";
import { ErrorState, LoadingState } from "../components/states";
import { errorMessage } from "../lib/errors";
import { formatDate, formatMoney } from "../lib/format";

type RequestItem = Awaited<ReturnType<typeof getApiV1BookingRequests>>["items"][number];

/** Booking-request status → design-system status vocabulary + a display label. */
const REQUEST_STATUS: Record<string, { status: Status; label: string }> = {
  pending: { status: "pending", label: "Pending" },
  accepted: { status: "confirmed", label: "Accepted" },
  declined: { status: "cancelled", label: "Declined" },
  flagged: { status: "cancelled", label: "Flagged" },
  archived: { status: "draft", label: "Archived" },
  expired: { status: "draft", label: "Expired" },
};

/** The status filter chips (main column), in shot order. */
const FILTERS: { key: string; label: string }[] = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "accepted", label: "Accepted" },
  { key: "declined", label: "Declined" },
  { key: "flagged", label: "Flagged" },
  { key: "archived", label: "Archived" },
  { key: "expired", label: "Expired" },
];

function initials(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  const first = parts[0];
  if (!first) return "?";
  const last = parts[parts.length - 1];
  if (parts.length === 1 || !last) return first.slice(0, 2).toUpperCase();
  return ((first[0] ?? "") + (last[0] ?? "")).toUpperCase();
}

function relativeTime(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function requesterName(request: RequestItem): string {
  return request.artistName ?? request.contactName ?? "Unknown requester";
}

function toCardData(request: RequestItem): RequestCardData {
  const requester = requesterName(request);
  const meta = REQUEST_STATUS[request.status] ?? {
    status: "draft" as Status,
    label: request.status,
  };
  const contactBits = [request.contactName, relativeTime(request.createdAt)].filter(Boolean);
  return {
    id: request.id,
    requester,
    initials: initials(requester),
    tone: "purple",
    contactLine: contactBits.length > 0 ? contactBits.join(" · ") : undefined,
    status: meta.status,
    statusLabel: meta.label,
    wantedDate: formatDate(request.wantedDate, { day: "2-digit", month: "short", year: "numeric" }),
    source: request.source
      ? request.source.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())
      : "—",
    fee: request.offerFeeMin ? formatMoney(request.offerFeeMin, "EUR") : "Fee TBD",
    email: request.email ?? undefined,
    message: request.pitch ?? undefined,
  };
}

export function Requests() {
  const toast = useToast();
  const [selectedDay, setSelectedDay] = useState<string | undefined>(undefined);
  const [month, setMonth] = useState(() => new Date());
  const [filter, setFilter] = useState("all");
  // Incoming = requests targeting me; Outgoing = offers/requests I have sent (fix-list #6).
  const [direction, setDirection] = useState<"incoming" | "outgoing">("incoming");

  const { data, isPending, isError, error, refetch } = useGetApiV1BookingRequests({ direction });
  const flagSpam = usePostApiV1BookingRequestsIdFlagSpam({
    mutation: {
      onSuccess: () => {
        toast.success("Request blocked");
        void refetch();
      },
      onError: (mutationError) =>
        toast.error(errorMessage(mutationError, "Couldn't block the request.")),
    },
  });

  // Triage belongs to the RECIPIENT of a request. On the outgoing view these are
  // offers this user SENT, so declining or blocking them is meaningless (Block
  // would flag your own request as spam). Passing no handlers makes RequestCard
  // render no action bar, which is the honest state until a withdraw flow exists.
  const triageActions =
    direction === "incoming"
      ? {
          onCreateDraft: () => toast.info("Draft flow coming soon"),
          onMakeOffer: () => toast.info("Offer flow coming soon"),
          onDecline: () => toast.info("Decline flow coming soon"),
          onBlock: (id: string) => flagSpam.mutate({ id, data: { kind: "spam" } }),
          onArchive: () => toast.info("Archive flow coming soon"),
        }
      : {};

  const requests = data?.items ?? [];
  const pendingCount = requests.filter((request) => request.status === "pending").length;

  const markedDates = useMemo(
    () =>
      requests
        .filter((request) => request.wantedDate)
        .map((request) => dayKey(new Date(request.wantedDate as string))),
    [requests],
  );

  const visible = requests.filter((request) => {
    if (filter !== "all" && request.status !== filter) return false;
    if (
      selectedDay &&
      (!request.wantedDate || dayKey(new Date(request.wantedDate)) !== selectedDay)
    )
      return false;
    return true;
  });

  return (
    <>
      <SectionHeader
        eyebrow={direction === "outgoing" ? "Outbound" : "Inbound"}
        title={direction === "outgoing" ? "Outgoing Requests" : "Incoming Requests"}
        subtitle={
          direction === "outgoing"
            ? "Offers and requests you have sent, and where they stand."
            : "Manage booking requests from artists, agents, and venues."
        }
        actions={
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <SegmentedToggle
              aria-label="Request direction"
              value={direction}
              onChange={setDirection}
              options={[
                { value: "incoming", label: "Incoming" },
                { value: "outgoing", label: "Outgoing" },
              ]}
            />
            {pendingCount > 0 ? (
              <Badge status="pending" dot>
                {pendingCount} pending
              </Badge>
            ) : null}
          </div>
        }
      />

      {isPending ? (
        <LoadingState label="Loading requests" />
      ) : isError ? (
        <ErrorState error={error} title="Couldn't load requests" />
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(240px, 0.4fr) minmax(0, 1fr)",
            gap: 22,
            alignItems: "start",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
            <MiniMonthCalendar
              month={month}
              markedDates={markedDates}
              selected={selectedDay}
              onSelect={(day) => setSelectedDay((current) => (current === day ? undefined : day))}
              onNavigate={(offset) =>
                setMonth(
                  (current) => new Date(current.getFullYear(), current.getMonth() + offset, 1),
                )
              }
            />
            <RequestsByDate
              requests={requests}
              selectedDay={selectedDay}
              onSelectDay={setSelectedDay}
            />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
              {selectedDay && (
                <span style={{ fontFamily: "var(--font-display)", fontSize: 16, marginRight: 8 }}>
                  {formatDate(selectedDay, { weekday: "long", day: "2-digit", month: "long" })}
                </span>
              )}
              {FILTERS.map((option) => (
                <Chip
                  key={option.key}
                  active={filter === option.key}
                  onClick={() => setFilter(option.key)}
                >
                  {option.label}
                </Chip>
              ))}
            </div>

            {visible.length === 0 ? (
              <Card padding="lg">
                <div style={{ textAlign: "center", color: "var(--muted)", padding: "24px 0" }}>
                  <Icon name="inbox" size={28} />
                  <p style={{ marginTop: 10 }}>No requests match this view.</p>
                </div>
              </Card>
            ) : (
              visible.map((request) => (
                <RequestCard key={request.id} request={toCardData(request)} {...triageActions} />
              ))
            )}
          </div>
        </div>
      )}
    </>
  );
}

/** Left-rail "Requests by date" list, grouped Earlier / Selected day / Later. */
function RequestsByDate({
  requests,
  selectedDay,
  onSelectDay,
}: {
  requests: RequestItem[];
  selectedDay?: string;
  onSelectDay: (day: string) => void;
}) {
  const dated = requests
    .filter((request) => request.wantedDate)
    .slice()
    .sort((a, b) => Date.parse(a.wantedDate as string) - Date.parse(b.wantedDate as string));

  if (dated.length === 0) {
    return (
      <Card padding="md">
        <Eyebrow>Requests by date</Eyebrow>
        <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 8 }}>No dated requests yet.</p>
      </Card>
    );
  }

  const earlier: RequestItem[] = [];
  const onSelected: RequestItem[] = [];
  const later: RequestItem[] = [];
  for (const request of dated) {
    const key = dayKey(new Date(request.wantedDate as string));
    if (selectedDay && key === selectedDay) onSelected.push(request);
    else if (selectedDay && key < selectedDay) earlier.push(request);
    else later.push(request);
  }
  const groups: { key: string; label: string; items: RequestItem[] }[] = [
    { key: "earlier", label: "Earlier", items: earlier },
    { key: "selected", label: "Selected day", items: onSelected },
    { key: "later", label: "Later", items: later },
  ];

  return (
    <Card padding="md" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Eyebrow>Requests by date</Eyebrow>
      {groups
        .filter((group) => group.items.length > 0)
        .map((group) => (
          <div key={group.key} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {selectedDay && (
              <span style={{ fontSize: 11, color: "var(--dim)", textTransform: "uppercase" }}>
                {group.label}
              </span>
            )}
            {group.items.map((request) => {
              const key = dayKey(new Date(request.wantedDate as string));
              return (
                <button
                  key={request.id}
                  type="button"
                  onClick={() => onSelectDay(key)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "6px 8px",
                    borderRadius: 8,
                    border: "none",
                    background: key === selectedDay ? "var(--elevated)" : "transparent",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 12,
                      color: "var(--muted)",
                      minWidth: 52,
                    }}
                  >
                    {formatDate(request.wantedDate, { day: "2-digit", month: "short" })}
                  </span>
                  <span style={{ color: "var(--text)", fontSize: 13 }}>
                    {requesterName(request)}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
    </Card>
  );
}
