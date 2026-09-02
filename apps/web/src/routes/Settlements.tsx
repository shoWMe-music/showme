import { type getApiV1Settlements, useGetApiV1Settlements } from "@showme/api-client";
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
import { Link } from "@tanstack/react-router";
import { type ReactNode, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { KpiRow } from "../components";
import { settlementStatusToDisplay, settlementTotals } from "../components/settlementDocument";
import { ErrorState, LoadingState } from "../components/states";
import { formatAmount, formatDay, formatMoney } from "../lib/format";
import { apiStatusToDisplay } from "../lib/status";

type SettlementItem = Awaited<ReturnType<typeof getApiV1Settlements>>["items"][number];

/** The chips map 1:1 onto `settlement_status`, so filtering is a real comparison
 * against the row's own status rather than a placeholder. `open` is surfaced as
 * "Pending review" — it is what an unreviewed settlement looks like to a party. */
const FILTERS = [
  { key: "all", label: "All" },
  { key: "open", label: "Pending review" },
  { key: "comments_received", label: "Comments" },
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

/**
 * The first column names the row. Who the row is *about* only needs saying when it
 * could be someone else: an operator settles many artists, and a performer running
 * several acts needs to know which one. A performer with a single profile is always
 * the artist, so naming them on every row is noise — the event alone identifies it.
 *
 * Built per-render from the session rather than as a module constant, because the
 * answer depends on who is looking.
 */
function buildColumns(isSingleProfile: boolean): DataTableColumn<SettlementItem>[] {
  return [
    {
      header: isSingleProfile ? "Event" : "Artist / Event",
      width: "2.4fr",
      // The money document — the same workspace the event's Settlement tab opens.
      render: (row) => (
        <Link
          to="/events/$eventId/settlement"
          params={{ eventId: row.event.id }}
          style={{ fontWeight: 700, color: "inherit" }}
        >
          {row.event.title}
        </Link>
      ),
    },
    {
      header: "Date",
      width: "1fr",
      /*
       * THE DATE GOES TO THE SHOW, NOT TO ITS MONEY.
       *
       * Asked for by name (ClickUp 86cbcn1ue): *"Clicking a date in Settlements
       * should open the event manager."* It is the same instinct the calendar
       * work already answered — a date is the show, and the reader looking at a
       * settlement row who clicks the date wants the night behind the figures,
       * not a second route into the figures they are already reading.
       *
       * This is why the row is no longer one big `onRowClick` button. Two
       * destinations cannot live in one control, and a link nested inside a
       * button is invalid HTML — the row would have had to stop being a button
       * either way. Linking the cells instead keeps every target keyboard
       * reachable (an anchor is, a `div` with an onClick is not) and makes each
       * one say where it goes.
       */
      render: (row) => (
        <Link to="/events/$eventId" params={{ eventId: row.event.id }} style={{ color: "inherit" }}>
          {formatDay(row.event.eventDate)}
        </Link>
      ),
    },
    {
      header: "Event status",
      width: "1.2fr",
      render: (row) => {
        const display = apiStatusToDisplay(row.event.status);
        return (
          <Badge status={display.status} dot>
            {display.label}
          </Badge>
        );
      },
    },
    {
      header: "Settlement",
      width: "1.3fr",
      render: (row) => {
        const display = settlementStatusToDisplay(row.status);
        return (
          <Badge status={display.status} dot>
            {display.label}
          </Badge>
        );
      },
    },
    {
      // "Artist payout" reads as someone else's money when the artist IS the viewer.
      header: isSingleProfile ? "Your payout" : "Artist payout",
      width: "1.1fr",
      align: "right",
      render: (row) => {
        // Null until the event has been computed — a real "not yet", not a placeholder.
        if (row.entitlement == null) return <span className="muted">—</span>;
        return (
          <b>
            {row.currency
              ? formatMoney(row.entitlement, row.currency)
              : formatAmount(row.entitlement)}
          </b>
        );
      },
    },
  ];
}

export function Settlements() {
  const { data, isPending, isError, error } = useGetApiV1Settlements();
  const [filter, setFilter] = useState<FilterKey>("all");
  const { session } = useAuth();

  // One profile → the viewer is unambiguously the artist on every row.
  const isSingleProfile = (session?.memberships.length ?? 0) === 1;
  const columns = useMemo(() => buildColumns(isSingleProfile), [isSingleProfile]);

  // `GET /settlements` takes no query and no cursor: it answers with every
  // settlement the caller is a party to, in one response. So this chip really
  // does filter the whole list (and the tiles below really do sum it) — there is
  // no server-side filter to push to, and nothing is hidden behind a page.
  const settlements = data?.items ?? [];
  const rows = settlements.filter((row) => filter === "all" || row.status === filter);

  // Tiles summarise the caller's OWN money, so they sum entitlements rather than
  // counting rows — "outstanding" is the number that matters when it is yours. The
  // summation itself lives in `settlementDocument` because the dashboard band shows
  // the same four figures, and two implementations of it would drift.
  const totals = useMemo(() => settlementTotals(settlements), [settlements]);

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
                value: totals.settled,
              },
              {
                label: <TileLabel status="pending">Pending review</TileLabel>,
                value: totals.pending,
              },
              {
                label: <TileLabel status="task">Outstanding</TileLabel>,
                value: totals.outstanding,
              },
              {
                label: <TileLabel status="concluded">Finalized</TileLabel>,
                value: totals.finalized,
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
                settlements.length === 0 ? "No settlements yet" : "No settlements match this filter"
              }
              description={
                settlements.length === 0
                  ? "They appear once an event's money is reconciled."
                  : "Try another filter."
              }
            />
          ) : (
            /*
             * NO `onRowClick`. It renders the row as one `<button>`, and this row
             * now has two destinations: the title opens the settlement workspace,
             * the date opens the event manager (86cbcn1ue). One control cannot go
             * to two places, and a link inside a button is invalid HTML — the same
             * constraint that forced the invoice ledger to hand-roll its rows,
             * arriving here for the same reason.
             *
             * Keyboard reach is not lost by dropping it: the anchors in the cells
             * are focusable on their own, which is what the row-as-button was
             * buying in the first place.
             */
            <DataTable columns={columns} rows={rows} getRowKey={(row) => row.id} />
          )}
        </div>
      )}
    </>
  );
}
