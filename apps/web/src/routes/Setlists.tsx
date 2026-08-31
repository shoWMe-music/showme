import { getGetApiV1EventsIdSetlistsQueryOptions } from "@showme/api-client";
import { Button, EmptyState, Icon, SectionHeader } from "@showme/design-system";
import { formatDurationClock, parseSetlistWorks, totalDurationSeconds } from "@showme/shared";
import { useQueries } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { SetlistEditor } from "../components/SetlistEditor";
import { ErrorState, LoadingState } from "../components/states";
import { type EventItem, useAllEvents } from "../hooks/useEventList";
import { useEventSetlist } from "../hooks/useEventSetlist";
import { formatDay } from "../lib/format";
import { isDestinationForKind } from "../shell/navigation";

/**
 * The performer's Setlists screen — the surface `shell/navigation.ts` has been
 * saying "does not exist yet" about, and the one Ran asked for: *"setlists page
 * is missing from performer account"*.
 *
 * THE ACT'S SIDE OF THE MODULE. decisions.md ("Setlists", RESOLVED) splits it in
 * two: the performer authors the setlist, the operator files the performed-works
 * report derived from it. This is the authoring half and only that — there is no
 * filing here, no society, no royalty estimate, because none of those are the
 * act's business (story.md: the performer's world is "my bookings, my
 * availability, my riders, my money").
 *
 * The same set is editable from the show's own workspace (`EventSetlistTab`).
 * This screen exists because the act's question is "which of my shows still
 * needs a setlist", which is a question about the whole diary and cannot be
 * answered from inside one event.
 */

/** One show on the reader's diary, with what their setlist for it says. */
interface ShowSummary {
  readonly event: EventItem;
  readonly songCount: number;
  readonly runtimeSeconds: number | null;
  readonly isPending: boolean;
}

/**
 * Every show the reader is on, each with the size of their own setlist.
 *
 * One cheap list query per event. The rows come back already scoped — a
 * performer is served their own set and nothing else — so the count is the
 * count of THEIR songs, never the bill's.
 */
function useShowSummaries(): {
  shows: ShowSummary[];
  isPending: boolean;
  isError: boolean;
  error: unknown;
} {
  // Every event, not the first page: "which shows still need a setlist" over
  // page one is not an answer.
  const events = useAllEvents();
  const eventItems = events.items;

  const setlistQueries = useQueries({
    queries: eventItems.map((event) => getGetApiV1EventsIdSetlistsQueryOptions(event.id)),
  });

  const shows = eventItems.map((event, index) => {
    const query = setlistQueries[index];
    const own = query?.data?.find((row) => row.mine);
    const works = parseSetlistWorks(Array.isArray(own?.items) ? own.items : []);
    return {
      event,
      songCount: works.length,
      runtimeSeconds: totalDurationSeconds(works),
      isPending: query?.isPending ?? true,
    };
  });

  return {
    shows,
    isPending: events.isPending,
    isError: events.isError,
    error: events.error,
  };
}

/** `4 songs · 16:39`, or what is still missing. */
function summaryLabel(show: ShowSummary): string {
  if (show.isPending) return "…";
  if (show.songCount === 0) return "No setlist yet";
  const runtime = formatDurationClock(show.runtimeSeconds);
  return `${show.songCount} ${show.songCount === 1 ? "song" : "songs"}${runtime ? ` · ${runtime}` : ""}`;
}

/**
 * The editor for ONE show, mounted only while its row is open.
 *
 * A component of its own because that is what keeps `useEventSetlist` — and the
 * two requests behind it — out of the closed rows: hooks cannot be called per
 * item in a list, and a screen that fetched every show's editor to render a
 * count would ask the API for a dozen answers nobody is reading.
 */
function OpenShowSetlist({ eventId }: { eventId: string }) {
  const view = useEventSetlist(eventId);
  return (
    <div style={{ marginTop: 12 }}>
      <SetlistEditor view={view} />
    </div>
  );
}

function ShowRow({
  show,
  open,
  onToggle,
}: {
  show: ShowSummary;
  open: boolean;
  onToggle: () => void;
}) {
  const { event } = show;
  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 16,
        padding: "18px 20px",
        boxShadow: "var(--shadow)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 14,
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
            {event.title || "Untitled show"}
          </h3>
          <div style={{ color: "var(--muted)", fontSize: 12.5 }}>
            {[formatDay(event.eventDate), event.venueName].filter(Boolean).join(" · ")}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--dim)" }}>
            {summaryLabel(show)}
          </span>
          <Button
            variant={open ? "secondary" : "primary"}
            aria-expanded={open}
            onClick={onToggle}
            rightIcon={
              <Icon
                name="chevron-down"
                size={14}
                style={open ? { transform: "rotate(180deg)" } : undefined}
              />
            }
          >
            {open ? "Close" : show.songCount === 0 ? "Write setlist" : "Edit setlist"}
          </Button>
        </div>
      </div>

      {open && <OpenShowSetlist eventId={event.id} />}
    </div>
  );
}

function SetlistsScreen() {
  // ONE open at a time: the editor is a full running order, and two of them
  // stacked turns the diary into a scroll with no diary left in it.
  const [openEventId, setOpenEventId] = useState<string | null>(null);
  const shows = useShowSummaries();

  if (shows.isPending) return <LoadingState label="Loading your shows" />;
  if (shows.isError) return <ErrorState error={shows.error} title="Couldn't load your shows" />;

  return (
    <>
      <SectionHeader eyebrow="Your shows" title="Setlists" />
      {shows.shows.length === 0 ? (
        <EmptyState
          icon={<Icon name="music" />}
          title="No shows yet"
          description="A setlist belongs to a show. Once you're booked on one it appears here, ready to write."
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {shows.shows.map((show) => (
            <ShowRow
              key={show.event.id}
              show={show}
              open={openEventId === show.event.id}
              onToggle={() =>
                setOpenEventId((current) => (current === show.event.id ? null : show.event.id))
              }
            />
          ))}
        </div>
      )}
    </>
  );
}

/**
 * The route stays registered for every kind — hiding a sidebar link is a
 * navigation decision, not an authorization one — but only the act authors a
 * setlist, so reaching this by URL as anyone else says so rather than listing a
 * diary of shows with nothing to write on any of them. The refusal itself is
 * still the server's: `PUT /events/:id/setlists` wants `setlist.author`, which
 * the ceiling grants to the performing roles alone.
 */
function PerformerOnlySetlists({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  if (isDestinationForKind("/setlists", session?.kind ?? null)) return <>{children}</>;
  return (
    <EmptyState
      icon={<Icon name="music" />}
      title="A setlist belongs to the act"
      description="The performer writes it; the venue reads it on the show to report the performance. Open an event to see the setlists on it."
    />
  );
}

export function Setlists() {
  return (
    <PerformerOnlySetlists>
      <SetlistsScreen />
    </PerformerOnlySetlists>
  );
}
