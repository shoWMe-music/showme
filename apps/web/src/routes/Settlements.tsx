import { type getApiV1Events, useGetApiV1Events } from "@showme/api-client";
import {
  Badge,
  Chip,
  DataTable,
  type DataTableColumn,
  EmptyState,
  Icon,
  type Status,
  StatusDot,
} from "@showme/design-system";
import { type ReactNode, useState } from "react";
import { KpiRow } from "../components";
import { ErrorState, LoadingState } from "../components/states";
import { formatDate } from "../lib/format";
import { apiStatusToDisplay } from "../lib/status";

type EventItem = Awaited<ReturnType<typeof getApiV1Events>>["items"][number];

/** The prototype's filter chips. These name settlement *sub-statuses* (pending
 * review, comments received, partly paid, …). Our per-event API payload does
 * not carry a settlement sub-status — only the event lifecycle status — so
 * every chip except "All" filters honestly to nothing until an aggregate
 * settlement endpoint exists. See `settlementSubStatus`. */
const FILTERS = [
  { key: "all", label: "All" },
  { key: "pending_review", label: "Pending review" },
  { key: "comments", label: "Comments" },
  { key: "finalized", label: "Finalized" },
  { key: "partly_paid", label: "Partly paid" },
  { key: "paid", label: "Paid" },
] as const;

type FilterKey = (typeof FILTERS)[number]["key"];

/** A KPI tile label: a small status dot next to the mono caption, matching the
 * prototype's coloured markers. */
function TileLabel({ status, children }: { status: Status; children: ReactNode }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <StatusDot status={status} size={8} />
      {children}
    </span>
  );
}

/** The settlement sub-status for an event, if the payload carried one. It never
 * does today (there is no profile-level settlement aggregate endpoint), so this
 * is always `null` — the honest source of the "—" payout and the empty
 * non-"All" filters. */
function settlementSubStatus(_event: EventItem): FilterKey | null {
  return null;
}

const columns: DataTableColumn<EventItem>[] = [
  {
    header: "Artist / Event",
    width: "2.4fr",
    render: (event) => <b>{event.title}</b>,
  },
  {
    header: "Venue",
    width: "1.6fr",
    // The list payload carries only `venueProfileId`, not a venue name.
    render: () => <span className="muted">—</span>,
  },
  {
    header: "Date",
    width: "1fr",
    render: (event) => formatDate(event.eventDate, { day: "2-digit", month: "short" }),
  },
  {
    header: "Status",
    width: "1.2fr",
    render: (event) => {
      const display = apiStatusToDisplay(event.status);
      return (
        <Badge status={display.status} dot>
          {display.label}
        </Badge>
      );
    },
  },
  {
    header: "Artist payout",
    width: "1fr",
    align: "right",
    // No settlement payout on the event payload — honest placeholder.
    render: () => <span className="muted">—</span>,
  },
];

export function Settlements() {
  const { data, isPending, isError, error } = useGetApiV1Events();
  const [filter, setFilter] = useState<FilterKey>("all");

  const events = data?.items ?? [];
  const rows = events.filter((event) => filter === "all" || settlementSubStatus(event) === filter);

  return (
    <>
      {isPending ? (
        <LoadingState label="Loading settlements" />
      ) : isError ? (
        <ErrorState error={error} title="Couldn't load settlements" />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <KpiRow
            minTileWidth={220}
            items={[
              {
                label: <TileLabel status="confirmed">Total settled</TileLabel>,
                value: "—",
              },
              {
                label: <TileLabel status="pending">Pending review</TileLabel>,
                value: "—",
              },
              {
                label: <TileLabel status="task">Outstanding</TileLabel>,
                value: "—",
              },
              {
                label: <TileLabel status="concluded">Finalized</TileLabel>,
                value: "—",
              },
            ]}
          />

          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
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

          {rows.length === 0 ? (
            <EmptyState
              icon={<Icon name="receipt" />}
              title={
                events.length === 0 ? "No settlements yet" : "No settlements match this filter"
              }
              description={
                events.length === 0
                  ? "They appear once events conclude and their money is reconciled."
                  : "Try another filter to see the artist payouts you're reconciling."
              }
            />
          ) : (
            <DataTable columns={columns} rows={rows} getRowKey={(event) => event.id} />
          )}
        </div>
      )}
    </>
  );
}
