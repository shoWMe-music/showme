import {
  type getApiV1EventsIdParticipants,
  type getApiV1EventsIdSetlists,
  getGetApiV1EventsIdParticipantsQueryOptions,
  getGetApiV1EventsIdSetlistsQueryOptions,
} from "@showme/api-client";
import { Button, EmptyState, Icon, SectionHeader, useToast } from "@showme/design-system";
import { useQueries } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useAuth } from "../auth/AuthProvider";
import { ErrorState, LoadingState } from "../components/states";
import { type EventItem, useAllEvents } from "../hooks/useEventList";
import { isDestinationForKind } from "../shell/navigation";
type Setlist = Awaited<ReturnType<typeof getApiV1EventsIdSetlists>>[number];
type Participant = Awaited<ReturnType<typeof getApiV1EventsIdParticipants>>[number];

/**
 * The PRO (collecting society) is derived from where the show happens — the same
 * honest, location-driven mapping the prototype uses (STIM/GEMA/PRS). We derive it
 * from the event timezone (the only location signal on the event); unknown → null,
 * rendered as a neutral "PRO" so the chrome still reads correctly.
 */
function proForEvent(event: EventItem): string | null {
  const timezone = event.timezone ?? "";
  if (/stockholm|sweden|helsinki|oslo|copenhagen/i.test(timezone)) return "STIM";
  if (/berlin|germany|zurich|vienna/i.test(timezone)) return "GEMA";
  if (/london/i.test(timezone)) return "PRS";
  return null;
}

/** A setlist's `items` is an untyped jsonb array of songs — read it defensively. */
function songTitle(item: unknown): string {
  if (typeof item === "string") return item;
  if (item && typeof item === "object") {
    const record = item as Record<string, unknown>;
    const title = record.title ?? record.name ?? record.song;
    if (typeof title === "string" && title.trim()) return title;
  }
  return "Untitled";
}

/** Best-effort duration in seconds from a song entry; null when the data doesn't carry it. */
function songSeconds(item: unknown): number | null {
  if (!item || typeof item !== "object") return null;
  const record = item as Record<string, unknown>;
  const raw = record.duration ?? record.durationSeconds ?? record.seconds ?? record.length;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const clock = raw.match(/^(\d+):(\d{2})$/);
    if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
    const minutes = Number(raw);
    if (!Number.isNaN(minutes)) return Math.round(minutes * 60);
  }
  return null;
}

function runtimeLabel(items: unknown[]): string {
  let total = 0;
  let known = false;
  for (const item of items) {
    const seconds = songSeconds(item);
    if (seconds != null) {
      total += seconds;
      known = true;
    }
  }
  if (!known) return "—";
  return `${Math.round(total / 60)} min`;
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
  onReport,
}: {
  setlist: Setlist;
  event: EventItem;
  participant: Participant | undefined;
  onReport: (pro: string) => void;
}) {
  const navigate = useNavigate();
  const items = Array.isArray(setlist.items) ? setlist.items : [];
  const pro = proForEvent(event);
  const proLabel = pro ?? "PRO";
  const artist = participant?.performerTag?.trim();
  const subtitle = [artist, event.title].filter(Boolean).join(" · ") || "Untitled event";
  const songs = items.map(songTitle).join(" · ");

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
              <span style={{ color: "var(--dim)" }}>Songs</span> {items.length}
            </span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text)" }}>
              <span style={{ color: "var(--dim)" }}>Runtime</span> {runtimeLabel(items)}
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
          <Button variant="cta" onClick={() => onReport(proLabel)}>
            <Icon name="file" size={14} />
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
  const toast = useToast();
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

  const handleReport = (pro: string) => {
    toast.info(
      `Filing to ${pro} isn't connected yet — PRO submission goes live once the collecting-society integration lands.`,
    );
  };

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
        Each event's setlist becomes a royalty report. Writer shares and ISWC codes come from the
        performer's repertoire.
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
              onReport={handleReport}
            />
          ))}
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
