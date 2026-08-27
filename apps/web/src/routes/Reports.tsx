import {
  getGetApiV1EventsIdPerformanceReportQueryOptions,
  getGetApiV1EventsIdSetlistsQueryOptions,
} from "@showme/api-client";
import { Badge, Button, EmptyState, Icon, SectionHeader } from "@showme/design-system";
import { useQueries } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { PerformanceReportModal } from "../components/PerformanceReportModal";
import { ErrorState, LoadingState } from "../components/states";
import type { PerformanceReportTarget } from "../components/usePerformanceReport";
import { type EventItem, useAllEvents } from "../hooks/useEventList";
import { formatDate, formatMoney } from "../lib/format";
import { isDestinationForKind } from "../shell/navigation";

/**
 * PRO royalties — the operator's filings, one per show.
 *
 * A FILING IS ABOUT A PERFORMANCE, NOT ABOUT AN ACT, which is what makes this a
 * per-EVENT list rather than the per-setlist one it used to be:
 * `performance_reports` is keyed on the event, a society is told about a night
 * once, and a three-band bill produces one report with every act's works in it.
 *
 * NOT ON THE SETTLEMENT SCREEN, where the design prototype put the button. A
 * settlement is `entitlement − cash-held → transfers` between the parties on the
 * bill and must satisfy Σ net = 0; a PRO royalty flows from a society to
 * rightsholders on another schedule entirely and never enters that arithmetic.
 * Putting the two on one screen would conflate two unrelated money streams.
 */

type ReportCardData = {
  readonly event: EventItem;
  readonly report: NonNullable<ReturnType<typeof useEventFilings>["cards"][number]>["report"];
};

/**
 * The filings for every event the operator can see, and the filing state of each.
 *
 * TWO PASSES ON PURPOSE. The setlist list is one cheap query per event and
 * answers "is there anything to report at all"; the filing endpoint behind it
 * resolves a territory, a tariff, a budget and every setlist on the show, so it
 * is asked ONLY about the events that passed the first question. An event with no
 * setlist has nothing to file and never appears.
 */
function useEventFilings() {
  const { session } = useAuth();
  const profileId = session?.memberships[0]?.profileId ?? "";

  // Every event, not the first page: a report over page one is not a report.
  const events = useAllEvents();
  const eventItems = events.items;

  const setlistQueries = useQueries({
    queries: eventItems.map((event) =>
      getGetApiV1EventsIdSetlistsQueryOptions(event.id, {
        query: { enabled: Boolean(profileId) },
      }),
    ),
  });

  const filingQueries = useQueries({
    queries: eventItems.map((event, index) =>
      getGetApiV1EventsIdPerformanceReportQueryOptions(event.id, {
        query: { enabled: (setlistQueries[index]?.data?.length ?? 0) > 0 },
      }),
    ),
  });

  const cards = eventItems
    .map((event, index) => ({ event, report: filingQueries[index]?.data }))
    .filter((card): card is { event: EventItem; report: NonNullable<typeof card.report> } =>
      Boolean(card.report),
    );

  return {
    profileId,
    cards,
    isPending: events.isPending,
    isError: events.isError,
    error: events.error,
    childrenPending:
      eventItems.length > 0 &&
      (setlistQueries.some((query) => query.isPending) ||
        filingQueries.some((query) => query.isPending && query.fetchStatus !== "idle")),
  };
}

/** `16 min`, or an em dash when not one entry carried a length. */
function runtimeLabel(works: readonly { durationSeconds: number | null }[]): string {
  const known = works.filter((work) => work.durationSeconds != null);
  if (known.length === 0) return "—";
  return `${Math.round(known.reduce((sum, work) => sum + (work.durationSeconds ?? 0), 0) / 60)} min`;
}

/** One show's royalty report: its works, its society, and whether it has been filed. */
function ReportCard({
  card,
  onOpen,
}: {
  card: ReportCardData;
  onOpen: (target: PerformanceReportTarget) => void;
}) {
  const navigate = useNavigate();
  const { event, report } = card;
  // The society covering the SHOW's territory. Null when the venue has no
  // country recorded — the card then says "PRO" rather than naming one it guessed.
  const societyName = report.society?.name ?? report.tariff?.proName ?? "PRO";
  const performers = [...new Set(report.works.map((work) => work.performer).filter(Boolean))];

  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 16,
        padding: "20px 22px",
        boxShadow: "var(--shadow)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <h3
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 600,
              fontSize: 17,
              margin: "0 0 3px",
              color: "var(--text)",
            }}
          >
            {report.eventTitle || "Untitled show"}
          </h3>
          <div style={{ color: "var(--muted)", fontSize: 12.5 }}>
            {[formatDate(report.eventDate), report.venueName, performers.join(" · ")]
              .filter(Boolean)
              .join(" · ")}
          </div>
          <div style={{ display: "flex", gap: 16, marginTop: 10, flexWrap: "wrap" }}>
            <Metric label="Works" value={String(report.works.length)} />
            <Metric label="Runtime" value={runtimeLabel(report.works)} />
            {/* The estimate appears only when a published tariff is configured
                for the territory. No tariff, no number — never a fallback rate. */}
            <Metric
              label="Royalty est."
              value={
                report.estimate === null
                  ? "No tariff on file"
                  : formatMoney(report.estimate, report.currency)
              }
            />
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <Button
            variant="secondary"
            onClick={() => navigate({ to: "/events/$eventId", params: { eventId: event.id } })}
          >
            View event
            <Icon name="arrow-right" size={14} />
          </Button>
          <Badge>{societyName}</Badge>
          {report.report ? (
            <Badge status="confirmed">Filed {formatDate(report.report.filedAt)}</Badge>
          ) : (
            <Badge status="pending">Not filed</Badge>
          )}
          <Button variant="cta" onClick={() => onOpen({ eventId: event.id })}>
            <Icon name="file" size={14} />
            Report to {societyName}
          </Button>
        </div>
      </div>

      {report.works.length > 0 && (
        <div
          style={{
            fontSize: 12.5,
            color: "var(--muted)",
            lineHeight: 1.6,
            marginTop: 12,
            paddingTop: 12,
            borderTop: "1px solid var(--border)",
          }}
        >
          {report.works.map((work) => work.title).join(" · ")}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text)" }}>
      <span style={{ color: "var(--dim)" }}>{label}</span> {value}
    </span>
  );
}

function ReportsScreen() {
  const [target, setTarget] = useState<PerformanceReportTarget | null>(null);
  const filings = useEventFilings();

  return (
    <>
      <SectionHeader
        eyebrow="PRO royalties"
        title="Performance Reports"
        subtitle="Performed-works filings to the collecting societies (STIM, GEMA, PRS…), derived from the setlists on each show. Operators file the report; performers author the setlist."
      />

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: "12px 16px",
          marginBottom: 16,
          color: "var(--muted)",
          fontSize: 12.5,
        }}
      >
        <Icon name="alert" size={15} />
        Each show's setlists become one royalty report, addressed to the society that covers where
        it happened. shoWMe does not submit to a society — you download the report, send it, and
        record here that you did.
      </div>

      {!filings.profileId ? (
        <EmptyState icon={<Icon name="file" />} title="No profile selected" />
      ) : filings.isPending ? (
        <LoadingState label="Loading reports" />
      ) : filings.isError ? (
        <ErrorState error={filings.error} title="Couldn't load performance reports" />
      ) : filings.childrenPending ? (
        <LoadingState label="Loading setlists" />
      ) : filings.cards.length === 0 ? (
        <EmptyState
          icon={<Icon name="file" />}
          title="No setlists to report on yet"
          description="A show appears here once a performer on it writes a setlist — that is what the royalty report is made of."
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {filings.cards.map((card) => (
            <ReportCard key={card.event.id} card={card} onOpen={setTarget} />
          ))}
        </div>
      )}

      <PerformanceReportModal target={target} onClose={() => setTarget(null)} />
    </>
  );
}

/**
 * The screen is registered for every account kind — a hidden sidebar link is a
 * navigation decision, not an authorization one — but the other kinds cannot own the
 * data behind it, so reaching it by URL says so instead of asking the API for
 * rows it will (correctly) refuse. Authorization itself stays server-side: the
 * filing capability is refused to any non-operator by the ceiling, not by this.
 */
function OperatorOnlyReports({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  if (isDestinationForKind("/reports", session?.kind ?? null)) return <>{children}</>;
  return (
    <EmptyState
      icon={<Icon name="trending-up" />}
      title="The PRO filing is the operator's"
      description="Performance reports are filed by whoever hosts the show; a performer authors the setlist it derives from."
    />
  );
}

export function Reports() {
  return (
    <OperatorOnlyReports>
      <ReportsScreen />
    </OperatorOnlyReports>
  );
}
