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
import { type ReactNode, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { KpiRow } from "../components";
import { ErrorState, LoadingState } from "../components/states";
import { formatAmount, formatDate, formatMoney } from "../lib/format";
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
/** `settlement_status` → the design system's status vocabulary + a human label. */
function settlementStatusToDisplay(status: string): { status: Status; label: string } {
  switch (status) {
    case "finalized":
      return { status: "confirmed", label: "Finalized" };
    case "paid":
      return { status: "confirmed", label: "Paid" };
    case "partly_paid":
      return { status: "pending", label: "Partly paid" };
    case "comments_received":
      return { status: "pending", label: "Comments" };
    case "revised":
      return { status: "pending", label: "Revised" };
    case "dispute":
      return { status: "cancelled", label: "Dispute" };
    default:
      return { status: "task", label: "Pending review" };
  }
}

function buildColumns(isSingleProfile: boolean): DataTableColumn<SettlementItem>[] {
  return [
    {
      header: isSingleProfile ? "Event" : "Artist / Event",
      width: "2.4fr",
      render: (row) => <b>{row.event.title}</b>,
    },
    {
      header: "Date",
      width: "1fr",
      render: (row) => formatDate(row.event.eventDate, { day: "2-digit", month: "short" }),
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

  const settlements = data?.items ?? [];
  const rows = settlements.filter((row) => filter === "all" || row.status === filter);

  // Tiles summarise the caller's OWN money, so they sum entitlements rather than
  // counting rows — "outstanding" is the number that matters when it is yours.
  const totals = useMemo(() => {
    const sum = (predicate: (row: SettlementItem) => boolean) =>
      settlements
        .filter((row) => row.entitlement != null && predicate(row))
        .reduce((total, row) => total + BigInt(row.entitlement as string), 0n);
    const currency = settlements[0]?.currency ?? null;
    const format = (amount: bigint) =>
      settlements.length === 0
        ? "—"
        : currency
          ? formatMoney(amount.toString(), currency)
          : formatAmount(amount.toString());
    return {
      settled: format(sum((row) => row.status === "paid")),
      pending: format(sum((row) => row.status === "open" || row.status === "comments_received")),
      outstanding: format(sum((row) => row.status !== "paid")),
      finalized: format(sum((row) => row.status === "finalized")),
    };
  }, [settlements]);

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
            <DataTable columns={columns} rows={rows} getRowKey={(row) => row.id} />
          )}
        </div>
      )}
    </>
  );
}
