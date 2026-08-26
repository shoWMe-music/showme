import {
  type getApiV1EventsIdParticipants,
  type getApiV1EventsIdSetlists,
  getGetApiV1EventsIdParticipantsQueryOptions,
  getGetApiV1EventsIdSetlistsQueryOptions,
} from "@showme/api-client";
import { Button, EmptyState, Icon, SectionHeader } from "@showme/design-system";
import { useQueries } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { ProFilingExportModal } from "../components/ProFilingExportModal";
import { ErrorState, LoadingState } from "../components/states";
import type { ProFilingTarget } from "../components/useProFilingExport";
import { type EventItem, useAllEvents } from "../hooks/useEventList";
import { parseSetlistWorks, societyLabel, totalDurationSeconds } from "../lib/proFilingExport";
import { societyForTimezone } from "../lib/proSocieties";
import { isDestinationForKind } from "../shell/navigation";

type Setlist = Awaited<ReturnType<typeof getApiV1EventsIdSetlists>>[number];
type Participant = Awaited<ReturnType<typeof getApiV1EventsIdParticipants>>[number];

/** `16 min`, or an em dash when not one setlist entry carried a length. */
function runtimeLabel(seconds: number | null): string {
  if (seconds == null) return "—";
  return `${Math.round(seconds / 60)} min`;
}

const NEUTRAL_PILL: React.CSSProperties = {
  padding: "4px 11px",
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 600,
  whiteSpace: "nowrap",
};

/** One royalty-report card: a performer's setlist for an event, ready to file. */
function ReportCard({
  setlist,
  event,
  participant,
  onExport,
}: {
  setlist: Setlist;
  event: EventItem;
  participant: Participant | undefined;
  onExport: (target: ProFilingTarget) => void;
}) {
  const navigate = useNavigate();
  const items = Array.isArray(setlist.items) ? setlist.items : [];
  const works = parseSetlistWorks(items);
  const proLabel = societyLabel(societyForTimezone(event.timezone));
  // The ACT's name, never `performerTag` — that field holds the event role
  // ("headliner"), and a society's report names the artist who performed.
  const performerName = participant?.name?.trim() || null;
  // The heading already carries the event title, so the line under it identifies
  // WHO is being reported on: the act, and the slot they played.
  const subtitle =
    [performerName, participant?.performerTag?.trim()].filter(Boolean).join(" · ") ||
    "Unknown performer";
  const songs = works.map((work) => work.title).join(" · ");

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
            {event.title || "Untitled set"}
          </h3>
          <div style={{ color: "var(--muted)", fontSize: 12.5 }}>{subtitle}</div>
          <div style={{ display: "flex", gap: 16, marginTop: 10 }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text)" }}>
              <span style={{ color: "var(--dim)" }}>Songs</span> {works.length}
            </span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text)" }}>
              <span style={{ color: "var(--dim)" }}>Runtime</span>{" "}
              {runtimeLabel(totalDurationSeconds(works))}
            </span>
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
          <span
            style={{
              ...NEUTRAL_PILL,
              background: "var(--elevated)",
              border: "1px solid var(--border)",
              color: "var(--muted)",
            }}
          >
            {proLabel}
          </span>
          <span
            style={{
              ...NEUTRAL_PILL,
              background: "color-mix(in srgb, var(--brand-amber) 16%, transparent)",
              color: "var(--brand-amber)",
            }}
          >
            Not filed
          </span>
          <Button
            variant="cta"
            onClick={() =>
              onExport({
                eventId: event.id,
                eventTitle: event.title,
                eventDate: event.eventDate,
                timezone: event.timezone,
                performerName,
                works,
              })
            }
          >
            <Icon name="download" size={14} />
            Report to {proLabel}
          </Button>
        </div>
      </div>

      {songs && (
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
          {songs}
        </div>
      )}
    </div>
  );
}

function ReportsScreen() {
  const { session } = useAuth();
  const [exportTarget, setExportTarget] = useState<ProFilingTarget | null>(null);
  const profileId = session?.memberships[0]?.profileId ?? "";

  // Every event, not the first page: a report over page one is not a report.
  const events = useAllEvents();
  const eventItems = events.items;

  // Setlists and participants live under each event, so expand one query per event.
  const setlistQueries = useQueries({
    queries: eventItems.map((event) =>
      getGetApiV1EventsIdSetlistsQueryOptions(event.id, {
        query: { enabled: Boolean(profileId) },
      }),
    ),
  });
  const participantQueries = useQueries({
    queries: eventItems.map((event) =>
      getGetApiV1EventsIdParticipantsQueryOptions(event.id, {
        query: { enabled: Boolean(profileId) },
      }),
    ),
  });

  const childrenPending = eventItems.length > 0 && setlistQueries.some((query) => query.isPending);

  // Flatten every event's setlists into per-set cards, resolving each set's author.
  const cards = eventItems.flatMap((event, index) => {
    const setlists = setlistQueries[index]?.data ?? [];
    const participants = participantQueries[index]?.data ?? [];
    return setlists.map((setlist) => ({
      setlist,
      event,
      participant: participants.find((person) => person.id === setlist.participantId),
    }));
  });

  return (
    <>
      <SectionHeader
        eyebrow="PRO royalties"
        title="Performance Reports"
        subtitle="Performed-works filings to the collecting societies (STIM, GEMA, PRS…), derived from each performer's setlist. Operators file the report; performers author the setlist."
      />

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          background: "var(--elevated)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: "12px 16px",
          marginBottom: 16,
          color: "var(--muted)",
          fontSize: 12.5,
        }}
      >
        <Icon name="alert" size={15} />
        Each event's setlist becomes a royalty report, addressed to the society that covers where
        the show happened. Writer shares and ISWC codes aren't captured yet — the export marks them
        so you can add them before you file.
      </div>

      {!profileId ? (
        <EmptyState icon={<Icon name="file" />} title="No profile selected" />
      ) : events.isPending ? (
        <LoadingState label="Loading reports" />
      ) : events.isError ? (
        <ErrorState error={events.error} title="Couldn't load performance reports" />
      ) : childrenPending ? (
        <LoadingState label="Loading setlists" />
      ) : cards.length === 0 ? (
        <EmptyState
          icon={<Icon name="file" />}
          title="No setlists to report on yet"
          description="Setlists appear here once performers add them to your events — each one becomes a royalty report."
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {cards.map(({ setlist, event, participant }) => (
            <ReportCard
              key={setlist.id}
              setlist={setlist}
              event={event}
              participant={participant}
              onExport={setExportTarget}
            />
          ))}
        </div>
      )}

      {/* Export only. Closing it changes nothing — no filing has been made. */}
      <ProFilingExportModal target={exportTarget} onClose={() => setExportTarget(null)} />
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
