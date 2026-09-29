import { type getApiV1Settlements, useGetApiV1Settlements } from "@showme/api-client";
import {
  Badge,
  Button,
  Chip,
  DataTable,
  type DataTableColumn,
  EmptyState,
  Icon,
  SearchInput,
  type Status,
  StatusDot,
} from "@showme/design-system";
import { Link } from "@tanstack/react-router";
import { type ReactNode, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { KpiRow } from "../components";
import {
  matchingSettlements,
  settlementStatusToDisplay,
  settlementTotals,
} from "../components/settlementDocument";
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
  // A disputed settlement was reachable only under "All" (QA sweep run 16) — and it is the one state
  // an operator most needs to find, since it is the one somebody is waiting on them about.
  { key: "dispute", label: "Disputed" },
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
function buildColumns(
  isSingleProfile: boolean,
  isOperator: boolean,
): DataTableColumn<SettlementItem>[] {
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
      // A one-word label, broken mid-word at 490 px. Same rule as the figure below it.
      wrap: "nowrap",
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
      /*
       * "Artist payout" reads as someone else's money when the artist IS the viewer.
       *
       * AND "PAYOUT" IS THE WRONG WORD FOR AN OPERATOR (QA sweep run 5, QA5-14, run 6
       * re-confirmed it on a second account). The figure in this column is the reader's
       * ENTITLEMENT, and for the operator that is the residual they RETAIN while paying
       * everyone else out — SEK 24,000 and SEK 20,700 in the sweep, against 56,000 and
       * 46,500 actually leaving the building. The settlement screen already draws this
       * distinction in words: *"As operator your share is retained; below are the
       * amounts payable to the other parties."* This column had borrowed the wrong half
       * of it.
       *
       * QA7-28 finishes the same argument on the other two branches. The reason "payout"
       * is wrong here was never about the OPERATOR — it is that the column holds an
       * entitlement, and an advance or a deduction moves a performer's payout away from
       * it just as surely (an act entitled to SEK 30,000 against an advance of 3,000 is
       * paid 27,000). The row carries `net` as well, but a column header cannot lean one
       * way for one row and the other way for the next, so the honest fix is to name what
       * the column actually holds for everybody. The signed figure, with a label that
       * follows its direction, is on the event's Settlement tab.
       */
      header: isOperator || isSingleProfile ? "Your share" : "Artist share",
      width: "1.1fr",
      align: "right",
      // A settled figure is one token (QA sweep run 16) — see `DataTableColumn.wrap`.
      wrap: "nowrap",
      render: (row) => {
        // Null until the event has been computed — a real "not yet", not a placeholder.
        if (row.entitlement == null) return <span className="muted">—</span>;
        return (
          /*
           * A FIGURE NEVER BREAKS MID-NUMBER (QA sweep run 16).
           *
           * At 490 px this column wrapped `SEK 3,60 / 5` and `SEK 20,7 / 00` — a settled amount split
           * between its thousands separator and its last digits, which is the one thing a money column
           * must not do. Nothing overflowed: `scrollWidth === clientWidth` and a walk of every element
           * found zero offenders, which is the green-is-not-correct lesson exactly.
           *
           * `nowrap` alone DOES push the overflow sideways — this shipped believing the cell's
           * `min-width: 0` stopped it, and the mobile audit then found 13px of `SEK 20,700` cut off
           * at 360px. The TRACK has to carry the floor (`minmax(min-content, 1.1fr)`, see
           * `shrinkableTrack`); the room comes out of the four columns beside this one.
           */
          <b style={{ whiteSpace: "nowrap" }}>
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
  const [search, setSearch] = useState("");
  const { session } = useAuth();

  // One profile → the viewer is unambiguously the artist on every row.
  const isSingleProfile = (session?.memberships.length ?? 0) === 1;
  // An operator RETAINS their share rather than being paid it — see the column.
  const isOperator = session?.kind === "operator";
  const columns = useMemo(
    () => buildColumns(isSingleProfile, isOperator),
    [isSingleProfile, isOperator],
  );

  // `GET /settlements` takes no query and no cursor: it answers with every
  // settlement the caller is a party to, in one response. So this chip really
  // does filter the whole list (and the tiles below really do sum it) — there is
  // no server-side filter to push to, and nothing is hidden behind a page.
  const settlements = data?.items ?? [];
  const rows = useMemo(
    () => matchingSettlements(settlements, filter, search),
    [settlements, filter, search],
  );

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
                // NAMED FOR WHAT IT COUNTS (r2:880). "Total settled" counted `paid`
                // alone and read `SEK 0` beside a finalized SEK 20,700.
                label: <TileLabel status="confirmed">Paid</TileLabel>,
                value: totals.paid,
              },
              {
                label: <TileLabel status="pending">In review</TileLabel>,
                value: totals.inReview,
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

          {/*
            THE TILES OVERLAP, AND THAT USED TO BE INVISIBLE (QA sweep run 5, QA5-14).
            `outstanding` is everything not yet paid — which is right, and the reason is
            written at `settlementTotals` — so a finalized settlement is inside both it
            and `Finalized`, and the sweep read `OUTSTANDING SEK 44,700` beside
            `FINALIZED SEK 20,700` for a ledger holding 44,700 in total. Every figure was
            correct and the strip read as arithmetic that did not add up. One sentence is
            cheaper than four disjoint buckets, and truer: these are four questions about
            the same money, not four slices of it.
          */}
          {/*
            WHEN THE ROWS SPAN CURRENCIES THIS SENTENCE IS THE WRONG ONE (decisions §25.8.1). The
            four tiles are dashes then, and explaining how four dashes overlap says nothing. The
            note says why there is no figure — a dash on its own reads as "no money".
          */}
          <p className="muted" style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5 }}>
            {totals.mixedCurrencyNote ??
              "These count the same money four ways rather than splitting it: Outstanding is everything not yet paid, so anything Finalized or In review is inside it too."}
          </p>

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
                  onClick={() => setFilter(option.key)}
                >
                  {option.label}
                </Chip>
              ))}
            </div>
            {/* ClickUp `123qy9rngbp`. Filtered HERE rather than on the server, and
                that is correct for this list alone: `GET /settlements` takes no
                cursor and answers with every settlement the caller is a party to,
                so the browser genuinely holds all of them. The Events list pages,
                which is why its search is a server parameter. */}
            <div style={{ width: 260, maxWidth: "100%" }}>
              <SearchInput
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by event or date…"
                aria-label="Search settlements"
              />
            </div>
          </div>

          {rows.length === 0 ? (
            <EmptyState
              icon={<Icon name={search.trim() === "" ? "receipt" : "search"} />}
              title={
                settlements.length === 0
                  ? "No settlements yet"
                  : search.trim() !== ""
                    ? `Nothing matches "${search.trim()}"`
                    : "No settlements match this filter"
              }
              description={
                settlements.length === 0
                  ? "They appear once an event's money is reconciled."
                  : search.trim() !== ""
                    ? "Searches cover the event's name and its date."
                    : "Try another filter."
              }
              action={
                search.trim() !== "" ? (
                  <Button variant="secondary" onClick={() => setSearch("")}>
                    Clear search
                  </Button>
                ) : undefined
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
