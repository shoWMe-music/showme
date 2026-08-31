import {
  getGetApiV1EventsIdPerformanceReportQueryOptions,
  getGetApiV1EventsIdSetlistsQueryOptions,
} from "@showme/api-client";
import { Badge, Button, EmptyState, Icon, SectionHeader } from "@showme/design-system";
import { formatDurationClock } from "@showme/shared";
import { useQueries } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { PerformanceReportModal } from "../components/PerformanceReportModal";
import { ErrorState, LoadingState } from "../components/states";
import type { PerformanceReportTarget } from "../components/usePerformanceReport";
import { type EventItem, useAllEvents } from "../hooks/useEventList";
import { formatDay, formatMoney } from "../lib/format";
import { PRO_FILING_AVAILABLE, PRO_FILING_COMING_SOON } from "../lib/proFilingAvailability";
import { isDestinationForKind } from "../shell/navigation";

/**
 * The operator's PRO filing desk: one performed-works report per night.
 *
 * IT IS NOT THE SETLISTS SCREEN, and it used to be labelled as one. decisions.md
 * ("Setlists", RESOLVED) splits the module in two — the performer authors the
 * setlist, the operator files the report DERIVED from it — and Ran said the same
 * on 2026-08-31: *"Operators don't need setlists page, just that the setlists
 * from performers will be connected to their event managers."* That connection is
 * the event workspace's Setlist tab (`EventSetlistTab`); the act's authoring
 * surface is `/setlists`. What is left here is the filing: the collected running
 * order for a night, the society covering its territory, the royalty estimate and
 * the record of a filing made.
 *
 * FILING DARK. Sending anything to a society waits on commercial agreements with
 * the societies (`lib/proFilingAvailability`), so the report actions and the
 * filed/not-filed state are behind `PRO_FILING_AVAILABLE` rather than deleted —
 * the generator, the export and the modal are all still here and still tested.
 * The report itself is worth reading meanwhile, which is why the screen stays.
 *
 * A REPORT IS ABOUT A NIGHT, NOT ABOUT AN ACT, which is what makes this a
 * per-EVENT list: a society is told about a performance once, and a three-band
 * bill produces one collected running order with every act's works in it.
 */

type SetlistCardData = {
  readonly event: EventItem;
  readonly report: NonNullable<ReturnType<typeof useEventSetlists>["cards"][number]>["report"];
};

/**
 * The performed-works report for every event the operator can see.
 *
 * TWO PASSES ON PURPOSE. The setlist list is one cheap query per event and
 * answers "was anything played at all"; the endpoint behind it resolves a
 * territory, a tariff, a budget and every setlist on the show, so it is asked ONLY
 * about the events that passed the first question. An event with no setlist never
 * appears.
 */
function useEventSetlists() {
  const { session } = useAuth();
  const profileId = session?.memberships[0]?.profileId ?? "";

  // Every event, not the first page: a roll-up over page one is not a roll-up.
  const events = useAllEvents();
  const eventItems = events.items;

  const setlistQueries = useQueries({
    queries: eventItems.map((event) =>
      getGetApiV1EventsIdSetlistsQueryOptions(event.id, {
        query: { enabled: Boolean(profileId) },
      }),
    ),
  });

  const detailQueries = useQueries({
    queries: eventItems.map((event, index) =>
      getGetApiV1EventsIdPerformanceReportQueryOptions(event.id, {
        query: { enabled: (setlistQueries[index]?.data?.length ?? 0) > 0 },
      }),
    ),
  });

  const cards = eventItems
    .map((event, index) => ({ event, report: detailQueries[index]?.data }))
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
        detailQueries.some((query) => query.isPending && query.fetchStatus !== "idle")),
  };
}

/** `16 min`, or an em dash when not one entry carried a length. */
function runtimeLabel(works: readonly { durationSeconds: number | null }[]): string {
  const known = works.filter((work) => work.durationSeconds != null);
  if (known.length === 0) return "—";
  return `${Math.round(known.reduce((sum, work) => sum + (work.durationSeconds ?? 0), 0) / 60)} min`;
}

/** One night's set: what was played, by whom, and how long it ran. */
function SetlistCard({
  card,
  onOpenFiling,
}: {
  card: SetlistCardData;
  onOpenFiling: (target: PerformanceReportTarget) => void;
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
            {[formatDay(report.eventDate), report.venueName, performers.join(" · ")]
              .filter(Boolean)
              .join(" · ")}
          </div>
          <div style={{ display: "flex", gap: 16, marginTop: 10, flexWrap: "wrap" }}>
            <Metric label="Works" value={String(report.works.length)} />
            <Metric label="Runtime" value={runtimeLabel(report.works)} />
            {/* The royalty estimate appears only when a published tariff is
                configured for the territory. No tariff, no number — and with
                filing dark, "no tariff on file" is plumbing the reader can do
                nothing with, so the metric simply stays away. */}
            {report.estimate !== null && (
              <Metric label="Royalty est." value={formatMoney(report.estimate, report.currency)} />
            )}
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
          {PRO_FILING_AVAILABLE ? (
            <>
              <Badge>{societyName}</Badge>
              {report.report ? (
                <Badge status="confirmed">Filed {formatDay(report.report.filedAt)}</Badge>
              ) : (
                <Badge status="pending">Not filed</Badge>
              )}
              <Button variant="cta" onClick={() => onOpenFiling({ eventId: event.id })}>
                <Icon name="file" size={14} />
                Report to {societyName}
              </Button>
            </>
          ) : (
            // No "Not filed" chip while filing is dark: a state chip is a nudge to
            // act, and there is nothing here to act on yet.
            <Badge>{PRO_FILING_COMING_SOON}</Badge>
          )}
        </div>
      </div>

      <SetlistWorks works={report.works} />
    </div>
  );
}

/**
 * The set itself, in playing order.
 *
 * This is the reason the screen still exists, so it is a readable list rather
 * than the single run-on line of titles it used to be under the filing chrome.
 */
function SetlistWorks({ works }: { works: SetlistCardData["report"]["works"] }) {
  if (works.length === 0) return null;
  return (
    <ol
      style={{
        listStyle: "decimal",
        margin: "14px 0 0",
        paddingLeft: 22,
        paddingTop: 12,
        borderTop: "1px solid var(--border)",
        color: "var(--dim)",
        fontSize: 12.5,
        lineHeight: 1.9,
      }}
    >
      {works.map((work) => (
        <li key={`${work.position}-${work.title}`}>
          <span style={{ color: "var(--text)" }}>{work.title}</span>
          {work.performer ? <span> — {work.performer}</span> : null}
          {work.durationSeconds != null ? (
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5 }}>
              {" · "}
              {formatDurationClock(work.durationSeconds)}
            </span>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text)" }}>
      <span style={{ color: "var(--dim)" }}>{label}</span> {value}
    </span>
  );
}

function PerformanceReportsScreen() {
  const [target, setTarget] = useState<PerformanceReportTarget | null>(null);
  const setlists = useEventSetlists();

  return (
    <>
      <SectionHeader eyebrow="Performing rights" title="Performance Reports" />

      {!setlists.profileId ? (
        <EmptyState icon={<Icon name="file" />} title="No profile selected" />
      ) : setlists.isPending ? (
        <LoadingState label="Loading performance reports" />
      ) : setlists.isError ? (
        <ErrorState error={setlists.error} title="Couldn't load performance reports" />
      ) : setlists.childrenPending ? (
        <LoadingState label="Loading performance reports" />
      ) : setlists.cards.length === 0 ? (
        <EmptyState
          icon={<Icon name="file" />}
          title="Nothing to report yet"
          description="A show appears here once a performer on it writes a setlist — the report is derived from what they wrote."
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {setlists.cards.map((card) => (
            <SetlistCard key={card.event.id} card={card} onOpenFiling={setTarget} />
          ))}
        </div>
      )}

      {PRO_FILING_AVAILABLE && (
        <PerformanceReportModal target={target} onClose={() => setTarget(null)} />
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
function OperatorOnlyReports({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  if (isDestinationForKind("/reports", session?.kind ?? null)) return <>{children}</>;
  return (
    <EmptyState
      icon={<Icon name="file" />}
      title="The filing belongs to the operator"
      description="A performed-works report is filed by whoever ran the show. A performer writes the setlist it is derived from — that is the Setlists screen."
    />
  );
}

export function Reports() {
  return (
    <OperatorOnlyReports>
      <PerformanceReportsScreen />
    </OperatorOnlyReports>
  );
}
