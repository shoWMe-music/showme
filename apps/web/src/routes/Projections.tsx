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
import { DateText, KpiRow, SegmentedToggle } from "../components";
import { ErrorState, LoadingState } from "../components/states";
import { type EventItem, useAllEvents } from "../hooks/useEventList";
import {
  coPromotedCount,
  coPromotedNote,
  forecastsNothing,
  projectFromBudgets,
} from "../lib/eventProjection";
import { formatMoney } from "../lib/format";
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
 * A per-event projection, and the night it is about. The arithmetic is in
 * `lib/eventProjection.ts` — which ledger it reads and where it stops are rules worth
 * asserting, not rendering details.
 */
type EventProjection = ReturnType<typeof projectFromBudgets> & { event: EventItem };

/** The projection for one event, with the event carried alongside it. */
function projectEvent(event: EventItem, budgets: BudgetList | undefined): EventProjection {
  return { event, ...projectFromBudgets(budgets) };
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
  // A withdrawn night forecasts nothing, under every scope including "All events" —
  // it was counted in the pipeline and in every total on this screen.
  if (forecastsNothing(event.status)) return false;
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
    .map((event, index) => projectEvent(event, budgetQueries[index]?.data))
    .filter((projection) => scopeMatches(projection.event, scope, now));

  const withBudget = projections.filter((projection) => projection.hasBudget);
  const hasProjection = withBudget.length > 0;
  const totalRevenueMinor = withBudget.reduce((sum, row) => sum + row.revenueMinor, 0);
  const totalCostMinor = withBudget.reduce((sum, row) => sum + row.costMinor, 0);
  const totalBeforeDealsMinor = totalRevenueMinor - totalCostMinor;
  const overallMargin = totalRevenueMinor > 0 ? totalBeforeDealsMinor / totalRevenueMinor : null;
  const avgBeforeDealsMinor = hasProjection ? totalBeforeDealsMinor / withBudget.length : null;
  const maxRevenueMinor = withBudget.reduce((max, row) => Math.max(max, row.revenueMinor), 0);

  /*
   * HOW MANY OF THESE NIGHTS THE READER SHARES — the second reason "Revenue − costs" is not their
   * money, and the one the paragraph below never said (QA sweep run 12). Counted over the nights
   * the figures actually cover, not every event in scope: a night with no ledger contributes
   * nothing to the total and so has nothing to caveat.
   */
  const myProfileIds = session?.memberships.map((membership) => membership.profileId) ?? [];
  const coPromoted = coPromotedCount(
    withBudget.map((projection) => projection.event),
    myProfileIds,
  );
  const sharedNote = coPromotedNote(coPromoted, withBudget.length);

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
      /**
       * NOT "Net Profit", which is what this said while it meant something else.
       *
       * The figure is the ledger's revenue less the costs entered in it. What the acts
       * take is not a budget line — it is derived from the deals against a door
       * forecast, which is the Budget Planner's job — so on a door-split night where
       * the performers take the whole adjusted net this read SEK 50,000 "profit" at a
       * 60 % margin for a night the planner called a SEK 1,245 loss and the settlement
       * left the operator nothing from (QA sweep, 2026-09-27). The arithmetic was
       * right; the word over it was not.
       */
      label: "Revenue − costs",
      value: hasProjection ? formatMoney(totalBeforeDealsMinor, currency) : dash,
      hint:
        overallMargin === null
          ? "Before the deals pay out"
          : `${Math.round(overallMargin * 100)}% of revenue, before deals`,
      tone: (totalBeforeDealsMinor < 0 ? "red" : "green") as "red" | "green",
    },
    {
      label: "Avg per Event",
      value: avgBeforeDealsMinor === null ? dash : formatMoney(avgBeforeDealsMinor, currency),
      hint: "Per show, before deals",
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
          {/* Rows here are plain `<div>`s (no `onRowClick`), so the date is free to
              be the link to that night on the calendar. */}
          <span style={{ color: "var(--muted)", fontSize: 12 }}>
            {row.event.eventDate ? <DateText value={row.event.eventDate} /> : row.event.status}
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
      // Named for what it measures: the deals are not in it (see the KPI above).
      header: "Before deals",
      width: "1fr",
      align: "right",
      render: (row) =>
        row.hasBudget ? (
          <span
            style={{
              fontFamily: "var(--font-mono)",
              color: row.beforeDealsMinor < 0 ? NEGATIVE : POSITIVE,
            }}
          >
            {formatMoney(row.beforeDealsMinor, currency)}
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

  /**
   * BUDGETED, NOT REALIZED — the endpoint sums `budget_lines`.
   *
   * This line called the figure "realized revenue", which is what an operator reads to
   * mean money that arrived. `GET /insights/profiles/:id/revenue` sums the BUDGET, so
   * the number included three events that had not happened yet at SEK 0 each and only
   * one of the seven had a finalized settlement (measured 2026-09-26) — and it was the
   * same figure as PROJECTED REVENUE directly above it, which is the tell.
   *
   * The scope difference it exists to state is still worth stating: these totals ignore
   * the filter, so sitting silently under filtered projections they read as the same
   * set.
   */
  /*
   * AND IT NAMES ITS SCOPE, AND STAYS AWAY WHEN IT HAS NOTHING TO COMPARE (QA7-16).
   *
   * Both figures are `WHERE events.host_profile_id = :id` (`routes/insights.ts`), while
   * the panel above is participation-scoped. Read as "the same measure with the filter
   * off" — which is what the old wording invited — it told `co.host@` *"SEK 0 across 0
   * events you hosted"* directly under a panel saying SEK 83,000. The operator's own
   * copy agrees with their panel, which is precisely why this hid: it is invisible from
   * the seat the sentence was written in.
   *
   * Hosting nothing is not a scope difference worth stating, it is one side of the
   * comparison being empty by definition — so the line is not drawn at all.
   */
  const realizedNote =
    revenue.data && summary.data && summary.data.eventsHosted > 0 ? (
      <div style={{ color: "var(--muted)", fontSize: 12.5 }}>
        All time, as host — ignoring the filter above: budgeted revenue{" "}
        <span style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>
          {formatMoney(revenue.data.totalRevenue, currency)}
        </span>{" "}
        across {summary.data.eventsHosted} {pluralEvents(summary.data.eventsHosted)} you hosted.
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
          {/*
            WHY THIS SCREEN AND THE PLANNER DIFFER, said once and plainly. Without it a reader has
            two numbers for one night and no way to tell which is theirs.

            THE SECOND REASON was measured by QA sweep run 11: a ticket tier typed on Event
            Details lives in `events.extras.ticketTiers` and writes no budget line, so the planner
            counted SEK 163,000 against this screen's SEK 83,000 on the same night. The planner
            merges those tiers with the ledger's own rows; so does the settlement
            (`seedTicketTiersIntoBudget`), which makes this screen the odd one out.

            SAID RATHER THAN SUMMED, deliberately. A tier only counts if no line already states it,
            and that rule — match by id, match by name, and a hand-typed door row suppressing the
            tiers entirely — is already written twice, in `mergeTicketTierSeeds` and in the
            settlement, each with a comment saying the two must agree. Its third case exists
            because getting it wrong once showed SEK 57,000 on a SEK 25,000 night. A third copy on
            a money screen is how that comes back; the fix is to move the rule into
            `@showme/shared` and have all three ask it, which is its own piece of work.
          */}
          <div style={{ color: "var(--muted)", fontSize: 12.5 }}>
            Every figure here comes from the event's shared ledger. What the deals pay the acts is
            not a budget line, so it is <strong>not</strong> subtracted — an event's Budget Planner,
            which derives the performer fee from its deals, will show less for the same night. A
            ticket tier entered on Event Details is not a budget line either, so it is{" "}
            <strong>not</strong> added here until the planner or the settlement writes it in — and
            the planner, which reads those tiers directly, will show more.
          </div>
          {/*
            AND WHOSE MONEY IT IS. The paragraph above explains that the deals have not paid out;
            this says the other half — on a co-promoted night the ledger is both operators'. A
            co-host read SEK 50,000 at "60% of revenue" on a night that owed them SEK 7,500.
          */}
          {sharedNote && !budgetsPending && (
            <div style={{ color: "var(--muted)", fontSize: 12.5 }}>{sharedNote}</div>
          )}
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
      description="A projection rolls up the event budget, which only the operator running the event can see."
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
