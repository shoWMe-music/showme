import {
  type getApiV1EventsIdBudgets,
  getGetApiV1EventsIdBudgetsQueryOptions,
  useGetApiV1InsightsProfilesIdRevenue,
  useGetApiV1InsightsProfilesIdSummary,
} from "@showme/api-client";
import {
  Card,
  DataTable,
  type DataTableColumn,
  EmptyState,
  Icon,
  SectionHeader,
} from "@showme/design-system";
import { useQueries } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { KpiRow, SegmentedToggle } from "../components";
import { ErrorState, LoadingState } from "../components/states";
import { type EventItem, useAllEvents } from "../hooks/useEventList";
import { formatDate, formatMoney } from "../lib/format";
import { isDestinationForKind } from "../shell/navigation";
type BudgetList = Awaited<ReturnType<typeof getApiV1EventsIdBudgets>>;

const POSITIVE = "#6FC97A";
const NEGATIVE = "#EE5746";

type Scope = "all" | "confirmed" | "upcoming";

const SCOPES: { value: Scope; label: string }[] = [
  { value: "all", label: "All events" },
  { value: "confirmed", label: "Confirmed" },
  { value: "upcoming", label: "Upcoming" },
];

/**
 * A per-event projected P&L, derived from the event's budget lines. Budgets ARE
 * the forward-looking projection (planned ticket/bar revenue vs. planned costs),
 * so this is real data — not a fabricated forecast. Events with no budget loaded
 * carry `hasBudget: false` and render as an honest "—" everywhere downstream.
 */
interface EventProjection {
  event: EventItem;
  hasBudget: boolean;
  revenueMinor: number;
  costMinor: number;
  profitMinor: number;
  /** Fraction (0..1), or null when there's no revenue to divide by. */
  margin: number | null;
}

/** Sum a budget list's revenue and cost lines (minor units) into a projection. */
function projectFromBudgets(event: EventItem, budgets: BudgetList | undefined): EventProjection {
  if (!budgets || budgets.length === 0) {
    return { event, hasBudget: false, revenueMinor: 0, costMinor: 0, profitMinor: 0, margin: null };
  }
  let revenueMinor = 0;
  let costMinor = 0;
  for (const budget of budgets) {
    for (const line of budget.lines) {
      const amount = Number(line.amount);
      if (!Number.isFinite(amount)) continue;
      if (line.kind === "revenue") revenueMinor += amount;
      else if (line.kind === "cost") costMinor += amount;
    }
  }
  const profitMinor = revenueMinor - costMinor;
  return {
    event,
    hasBudget: true,
    revenueMinor,
    costMinor,
    profitMinor,
    margin: revenueMinor > 0 ? profitMinor / revenueMinor : null,
  };
}

function marginLabel(margin: number | null): string {
  if (margin === null) return "—";
  return `${Math.round(margin * 100)}%`;
}

function pluralEvents(count: number): string {
  return count === 1 ? "event" : "events";
}

/**
 * How much of the filtered pipeline the projected figures actually cover. A budget
 * is optional, so a scope can match events that have nothing to project — and a
 * figure summed over the budgeted subset must never be captioned with the matched
 * count, or the card claims to describe events it silently left out.
 */
interface BudgetCoverage {
  /** Events matching the selected scope. */
  matched: number;
  /** Of those, the ones carrying a budget — the set every figure is summed over. */
  budgeted: number;
  isPartial: boolean;
}

/** Caption for a stat card: names the set the figure above it was summed over. */
function coverageHint(coverage: BudgetCoverage): string {
  if (coverage.isPartial) return `${coverage.budgeted} of ${coverage.matched} events budgeted`;
  return `${coverage.budgeted} ${pluralEvents(coverage.budgeted)} budgeted`;
}

/** One honest line for the partial case: totals over a subset need saying so. */
function partialCoverageNote(coverage: BudgetCoverage): string {
  const missing = coverage.matched - coverage.budgeted;
  const missingClause = missing === 1 ? "1 event has none yet" : `${missing} events have none yet`;
  return `Figures cover the ${coverage.budgeted} of ${coverage.matched} events in this view that have a budget — ${missingClause}, so they show as —.`;
}

/** Why the screen is empty when the filter did match events: no budgets on them. */
function noBudgetDescription(matched: number): string {
  const subject =
    matched === 1
      ? "The event in this view has no budget yet"
      : `None of the ${matched} events in this view has a budget yet`;
  return `${subject}. A projection is computed from an event's budget lines, so there is nothing to project until one is added.`;
}

function scopeMatches(event: EventItem, scope: Scope, now: number): boolean {
  if (scope === "confirmed") return event.status.toLowerCase() === "confirmed";
  if (scope === "upcoming") {
    if (!event.eventDate) return false;
    const time = new Date(event.eventDate).getTime();
    return Number.isFinite(time) && time >= now;
  }
  return true;
}

function ProjectionsScreen() {
  const { session } = useAuth();
  const profileId = session?.memberships[0]?.profileId ?? "";
  const [scope, setScope] = useState<Scope>("all");

  // Every event, not the first page: a projection is a total over all of them.
  const events = useAllEvents();
  const eventItems = events.items;

  // Realized totals (settled-to-date) — surfaced honestly alongside the projections.
  const revenue = useGetApiV1InsightsProfilesIdRevenue(profileId, {
    query: { enabled: Boolean(profileId) },
  });
  const summary = useGetApiV1InsightsProfilesIdSummary(profileId, {
    query: { enabled: Boolean(profileId) },
  });

  // Budgets live under each event, so expand one query per event (as Reports does).
  const budgetQueries = useQueries({
    queries: eventItems.map((event) =>
      getGetApiV1EventsIdBudgetsQueryOptions(event.id, {
        query: { enabled: Boolean(profileId) },
      }),
    ),
  });
  const budgetsPending = eventItems.length > 0 && budgetQueries.some((query) => query.isPending);

  const currency = revenue.data?.currency ?? eventItems[0]?.baseCurrency ?? "EUR";

  const now = Date.now();
  const projections = eventItems
    .map((event, index) => projectFromBudgets(event, budgetQueries[index]?.data))
    .filter((projection) => scopeMatches(projection.event, scope, now));

  const withBudget = projections.filter((projection) => projection.hasBudget);
  const hasProjection = withBudget.length > 0;
  const totalRevenueMinor = withBudget.reduce((sum, row) => sum + row.revenueMinor, 0);
  const totalCostMinor = withBudget.reduce((sum, row) => sum + row.costMinor, 0);
  const totalProfitMinor = totalRevenueMinor - totalCostMinor;
  const overallMargin = totalRevenueMinor > 0 ? totalProfitMinor / totalRevenueMinor : null;
  const avgProfitMinor = hasProjection ? totalProfitMinor / withBudget.length : null;
  const maxRevenueMinor = withBudget.reduce((max, row) => Math.max(max, row.revenueMinor), 0);

  const coverage: BudgetCoverage = {
    matched: projections.length,
    budgeted: withBudget.length,
    isPartial: withBudget.length > 0 && withBudget.length < projections.length,
  };

  const dash = "—";
  const kpiItems = [
    {
      label: "Projected Revenue",
      // The figure is summed over the budgeted events, so the caption counts those
      // — not the scope match, which is what made an empty card read as a bug.
      value: hasProjection ? formatMoney(totalRevenueMinor, currency) : dash,
      hint: budgetsPending ? "Loading budgets…" : coverageHint(coverage),
      tone: "green" as const,
    },
    {
      label: "Projected Costs",
      value: hasProjection ? formatMoney(totalCostMinor, currency) : dash,
      hint: "All-in",
      tone: "red" as const,
    },
    {
      label: "Net Profit",
      value: hasProjection ? formatMoney(totalProfitMinor, currency) : dash,
      hint: overallMargin === null ? "Margin —" : `${Math.round(overallMargin * 100)}% margin`,
      tone: (totalProfitMinor < 0 ? "red" : "green") as "red" | "green",
    },
    {
      label: "Avg per Event",
      value: avgProfitMinor === null ? dash : formatMoney(avgProfitMinor, currency),
      hint: "Profit / show",
      tone: "neutral" as const,
    },
  ];

  const columns: DataTableColumn<EventProjection>[] = [
    {
      header: "Event",
      width: "2.2fr",
      render: (row) => (
        <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
          <span style={{ color: "var(--text)", fontWeight: 600 }}>
            {row.event.title || "Untitled event"}
          </span>
          <span style={{ color: "var(--muted)", fontSize: 12 }}>
            {row.event.eventDate ? formatDate(row.event.eventDate) : row.event.status}
          </span>
        </div>
      ),
    },
    {
      header: "Revenue",
      width: "1fr",
      align: "right",
      render: (row) =>
        row.hasBudget ? (
          <span style={{ fontFamily: "var(--font-mono)" }}>
            {formatMoney(row.revenueMinor, currency)}
          </span>
        ) : (
          <span style={{ color: "var(--dim)" }}>{dash}</span>
        ),
    },
    {
      header: "Profit",
      width: "1fr",
      align: "right",
      render: (row) =>
        row.hasBudget ? (
          <span
            style={{
              fontFamily: "var(--font-mono)",
              color: row.profitMinor < 0 ? NEGATIVE : POSITIVE,
            }}
          >
            {formatMoney(row.profitMinor, currency)}
          </span>
        ) : (
          <span style={{ color: "var(--dim)" }}>{dash}</span>
        ),
    },
    {
      header: "Margin",
      width: "0.7fr",
      align: "right",
      render: (row) => (
        <span style={{ fontFamily: "var(--font-mono)", color: "var(--muted)" }}>
          {row.hasBudget ? marginLabel(row.margin) : dash}
        </span>
      ),
    },
  ];

  // The realized figures come from settled history, which the scope toggle does not
  // filter — sitting silently under filtered projections they read as the same set,
  // so the scope difference is stated rather than left to be inferred.
  const realizedNote =
    revenue.data && summary.data ? (
      <div style={{ color: "var(--muted)", fontSize: 12.5 }}>
        All time, ignoring the filter above: realized revenue{" "}
        <span style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>
          {formatMoney(revenue.data.totalRevenue, currency)}
        </span>{" "}
        across {summary.data.eventsHosted} {pluralEvents(summary.data.eventsHosted)} hosted.
      </div>
    ) : null;

  return (
    <>
      <SectionHeader
        eyebrow="Forecast"
        title="Financial Projections"
        subtitle="Forward-looking P&L aggregated across your event pipeline."
        actions={
          <SegmentedToggle<Scope>
            options={SCOPES}
            value={scope}
            onChange={setScope}
            aria-label="Projection scope"
          />
        }
      />

      {!profileId ? (
        <EmptyState icon={<Icon name="trending-up" />} title="No profile selected" />
      ) : events.isPending ? (
        <LoadingState label="Loading projections" />
      ) : events.isError ? (
        <ErrorState error={events.error} title="Couldn't load projections" />
      ) : eventItems.length === 0 ? (
        <EmptyState
          icon={<Icon name="trending-up" />}
          title="No events to project"
          description="Once you have events with budgets, their projected P&L rolls up here."
        />
      ) : projections.length === 0 ? (
        <EmptyState
          icon={<Icon name="trending-up" />}
          title="No events match this filter"
          description="Nothing in your pipeline fits this scope — switch the filter above to see the rest of it."
        />
      ) : !hasProjection && !budgetsPending ? (
        // The filter matched, the budgets are in, and every one of them is missing:
        // say that, rather than showing four dashes the user has to interpret.
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <EmptyState
            icon={<Icon name="trending-up" />}
            title="Nothing to project on these events yet"
            description={noBudgetDescription(projections.length)}
          />
          {realizedNote}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <KpiRow items={kpiItems} />
          {coverage.isPartial && !budgetsPending && (
            <div style={{ color: "var(--muted)", fontSize: 12.5 }}>
              {partialCoverageNote(coverage)}
            </div>
          )}
          {realizedNote}

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
              gap: 16,
              alignItems: "start",
            }}
          >
            <Card padding="lg" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "var(--muted)",
                }}
              >
                Revenue by Event
              </span>
              {projections.map((row) => {
                const denominator = maxRevenueMinor > 0 ? maxRevenueMinor : 1;
                const percent = row.hasBudget
                  ? Math.max(0, Math.min(100, (row.revenueMinor / denominator) * 100))
                  : 0;
                return (
                  <div
                    key={row.event.id}
                    style={{ display: "flex", flexDirection: "column", gap: 6 }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "baseline",
                        justifyContent: "space-between",
                        gap: 12,
                      }}
                    >
                      <span style={{ color: "var(--text)", fontSize: 14 }}>
                        {row.event.title || "Untitled event"}
                      </span>
                      <span
                        style={{
                          fontFamily: "var(--font-mono)",
                          color: row.hasBudget ? "var(--text)" : "var(--dim)",
                          fontSize: 14,
                        }}
                      >
                        {row.hasBudget ? formatMoney(row.revenueMinor, currency) : dash}
                      </span>
                    </div>
                    <div
                      style={{
                        height: 8,
                        borderRadius: 999,
                        background: "var(--shape-fill)",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: `${percent}%`,
                          height: "100%",
                          borderRadius: 999,
                          background:
                            "linear-gradient(90deg, var(--brand-amber), var(--brand-red))",
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </Card>

            <DataTable
              columns={columns}
              rows={projections}
              getRowKey={(row) => row.event.id}
              loading={budgetsPending}
            />
          </div>
        </div>
      )}
    </>
  );
}

/**
 * The screen is registered for every account kind — a hidden sidebar link is a
 * navigation decision, not an authorization one — but the other kinds cannot own the
 * data behind it, so reaching it by URL says so instead of asking the API for
 * rows it will (correctly) refuse. Authorization itself stays server-side.
 */
function OperatorOnlyProjections({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  if (isDestinationForKind("/projections", session?.kind ?? null)) return <>{children}</>;
  return (
    <EmptyState
      icon={<Icon name="trending-up" />}
      title="Projections belong to the venue's books"
      description="A projection rolls up the event budget, which only the operator hosting the event can see."
    />
  );
}

export function Projections() {
  return (
    <OperatorOnlyProjections>
      <ProjectionsScreen />
    </OperatorOnlyProjections>
  );
}
